/**
 * Browser context manager using Camoufox/Playwright (same stack as
 * camofox-native, but standalone — no dependency on our plugin).
 *
 * Authentication strategy:
 * 1. Fast path: navigate directly to verifyUser. If Cloudflare
 *    remembers this IP (from a recent Turnstile pass), the userKey
 *    is returned immediately (under 1 second).
 * 2. Fallback: if the fast path fails (token_required), load the
 *    full Perchance generator page, inject a prompt, click Generate
 *    to trigger the Turnstile challenge, and intercept the
 *    verifyUser?token=*** response to extract the userKey.
 *
 * The consumer injects a BrowserContext (e.g. from a direct Camoufox
 * launch or a Playwright browser). Camoufox handles fingerprinting
 * and UA spoofing internally, so we don't override user agents here.
 */

import { AuthenticationError } from "./errors.js";

/** Minimal browser interface so users can inject their own context. */
export interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

export interface BrowserPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void>;
  content(): Promise<string>;
  evaluate<T = unknown>(fn: string | ((...args: any[]) => T | Promise<T>), ...args: any[]): Promise<T>;
  frames(): BrowserFrame[];
  url(): string;
  on(event: string, handler: (response: BrowserResponse) => void): void;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
  exposeFunction(name: string, callback: (...args: any[]) => unknown): Promise<void>;
}

export interface BrowserFrame {
  url(): string;
  evaluate<T = unknown>(fn: string | ((...args: unknown[]) => T | Promise<T>), ...args: unknown[]): Promise<T>;
}

export interface BrowserResponse {
  url(): string;
  text(): Promise<string>;
}

/** Key cache entry with TTL. */
interface KeyEntry {
  key: string;
  expiresAt: number;
}

const USER_KEY_REGEX = /"userKey":"([^"]+)"/;
const DEFAULT_KEY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TURNSTILE_TIMEOUT_MS = 60_000;

export abstract class Generator {
  protected browserContext: BrowserContext | null = null;
  private keyCache: KeyEntry | null = null;
  protected readonly keyTtlMs: number = DEFAULT_KEY_TTL_MS;

  /** Inject a browser context (e.g. from Camoufox or Playwright). */
  setBrowserContext(ctx: BrowserContext): void {
    this.browserContext = ctx;
  }

  /** Check if a browser context is available. */
  protected hasBrowser(): boolean {
    return this.browserContext !== null;
  }

  /**
   * Return a valid Perchance userKey.
   *
   * Tries the fast path first (direct verifyUser navigation).
   * Falls back to the full Turnstile flow if Cloudflare requires
   * a fresh challenge. Uses a TTL cache to avoid redundant requests.
   */
  async ensureUserKey(baseUrl: string): Promise<string> {
    // Check TTL cache first
    if (this.keyCache && Date.now() < this.keyCache.expiresAt) {
      return this.keyCache.key;
    }

    const key = await this.getKeyFast(baseUrl) ?? await this.getKeyViaTurnstile();
    if (!key) {
      throw new AuthenticationError("Failed to retrieve user key");
    }

    this.keyCache = {
      key,
      expiresAt: Date.now() + this.keyTtlMs,
    };
    return key;
  }

  /** Invalidate the key cache (e.g. after a 401 from the API). */
  invalidateKey(): void {
    this.keyCache = null;
  }

  /**
   * Fast path: direct navigation to verifyUser.
   * Works if Cloudflare remembers this IP from a recent Turnstile pass.
   */
  private async getKeyFast(baseUrl: string): Promise<string | null> {
    if (!this.browserContext) return null;

    const cacheBust = Math.random();
    const page = await this.browserContext.newPage();
    try {
      await page.goto(
        `${baseUrl}/verifyUser?thread=0&__cacheBust=${cacheBust}`,
        { waitUntil: "networkidle", timeout: 15_000 },
      );
      const content = await page.content();
      const match = content.match(USER_KEY_REGEX);
      if (match) return match[1];
      return null;
    } catch {
      return null;
    } finally {
      await page.close();
    }
  }

  /**
   * Full Turnstile flow: load the Perchance AI image generator page,
   * inject a dummy prompt, click Generate, and intercept the
   * verifyUser?token=*** response to extract the userKey.
   */
  private async getKeyViaTurnstile(): Promise<string | null> {
    if (!this.browserContext) return null;

    let key: string | null = null;
    const page = await this.browserContext.newPage();

    try {
      // Intercept verifyUser responses
      page.on("response", async (res: BrowserResponse) => {
        if (key) return;
        if (res.url().includes("verifyUser")) {
          try {
            const body = await res.text();
            const m = body.match(USER_KEY_REGEX);
            if (m) key = m[1];
          } catch { /* ignore */ }
        }
      });

      await page.goto(
        "https://perchance.org/ai-text-to-image-generator",
        { waitUntil: "networkidle", timeout: 60_000 },
      );
      await page.waitForTimeout(15_000);

      // Find the generator output iframe
      const target = page.frames().find(
        (f) =>
          f.url().includes("perchance.org") &&
          f.url().includes("ai-text-to-image-generator") &&
          f.url() !== page.url(),
      );

      if (!target) return null;

      // Inject a dummy prompt to enable the Generate button
      await target.evaluate(
        () => { const ta = document.querySelector("textarea"); if (ta) { ta.value = "test"; ta.dispatchEvent(new Event("input", {bubbles: true})); ta.dispatchEvent(new Event("change", {bubbles: true})); } }
      );
      await page.waitForTimeout(1_000);

      // Click Generate to trigger the Turnstile verification flow
      await target.evaluate(
        () => { const btns = document.querySelectorAll("button"); for (const b of btns) { if ((b.textContent || "").toLowerCase().includes("generate")) { b.click(); return; } } }
      );

      // Wait for Turnstile to solve and userKey to arrive
      const deadline = Date.now() + TURNSTILE_TIMEOUT_MS;
      while (!key && Date.now() < deadline) {
        await page.waitForTimeout(1_000);
      }

      return key;
    } finally {
      await page.close();
    }
  }

  /** Close the browser and release all resources. */
  async close(): Promise<void> {
    if (this.browserContext) {
      try {
        await this.browserContext.close();
      } catch { /* ignore */ }
      this.browserContext = null;
    }
    this.keyCache = null;
  }
}
