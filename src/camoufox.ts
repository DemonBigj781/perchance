/**
 * Helper to launch Camoufox and adapt it to our BrowserContext interface.
 *
 * This is optional — consumers can inject any BrowserContext implementation.
 * This helper uses `camoufox-js` (the npm package wrapping the Camoufox browser)
 * which provides anti-detect fingerprinting out of the box.
 */

import type { BrowserContext, BrowserPage, BrowserFrame, BrowserResponse } from "./generator.js";

// We dynamically import camoufox-js so it's an optional peer dependency.
// Users who already have a Playwright BrowserContext can inject it directly.

type PlaywrightPage = {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  content(): Promise<string>;
  evaluate<T = unknown>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
  frames(): PlaywrightFrame[];
  url(): string;
  on(event: string, handler: (response: PlaywrightResponse) => void): void;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
  exposeFunction(name: string, callback: (...args: unknown[]) => unknown): Promise<void>;
};

type PlaywrightFrame = {
  url(): string;
  evaluate<T = unknown>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
};

type PlaywrightResponse = {
  url(): string;
  text(): Promise<string>;
};

type PlaywrightContext = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

/** Adapter that wraps a Playwright/Camoufox context into our interface. */
class PlaywrightContextAdapter implements BrowserContext {
  private ctx: PlaywrightContext;

  constructor(ctx: PlaywrightContext) {
    this.ctx = ctx;
  }

  async newPage(): Promise<BrowserPage> {
    const page = await this.ctx.newPage();
    return new PlaywrightPageAdapter(page);
  }

  async close(): Promise<void> {
    await this.ctx.close();
  }
}

class PlaywrightPageAdapter implements BrowserPage {
  private page: PlaywrightPage;

  constructor(page: PlaywrightPage) {
    this.page = page;
  }

  async goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void> {
    await this.page.goto(url, opts);
  }

  async content(): Promise<string> {
    return await this.page.content();
  }

  async evaluate<T = unknown>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
    return await this.page.evaluate(fn, ...args);
  }

  frames(): BrowserFrame[] {
    return this.page.frames().map(f => new PlaywrightFrameAdapter(f));
  }

  url(): string {
    return this.page.url();
  }

  on(event: string, handler: (response: BrowserResponse) => void): void {
    this.page.on(event, (res: PlaywrightResponse) => {
      handler({
        url: () => res.url(),
        text: () => res.text(),
      });
    });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  async close(): Promise<void> {
    await this.page.close();
  }

  async exposeFunction(name: string, callback: (...args: any[]) => unknown): Promise<void> {
    await (this.page as any).exposeFunction(name, callback);
  }
}

class PlaywrightFrameAdapter implements BrowserFrame {
  private frame: PlaywrightFrame;

  constructor(frame: PlaywrightFrame) {
    this.frame = frame;
  }

  url(): string {
    return this.frame.url();
  }

  async evaluate<T = unknown>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
    return await this.frame.evaluate(fn, ...args);
  }
}

export interface LaunchOptions {
  /** Run in headless mode (default: true) */
  headless?: boolean;
  /** Additional Camoufox options passed through */
  [key: string]: unknown;
}

/**
 * Launch Camoufox and return a BrowserContext adapter.
 *
 * Requires the `camoufox-js` npm package as a peer dependency.
 * ```
 * npm install camoufox-js
 * ```
 */
export async function launchCamoufox(options: LaunchOptions = {}): Promise<BrowserContext> {
  const { headless = true, ...rest } = options;

  // Dynamic import so camoufox-js is optional
  // @ts-ignore - camoufox-js is an optional peer dependency
  const { Camoufox } = await import("camoufox-js");

  const browserOrContext = await Camoufox({
    headless,
    humanize: true,
    enable_cache: false,
    ...rest,
  } as any);

  // camoufox-js may return either a Browser or a BrowserContext
  if ('newPage' in browserOrContext && 'browser' in browserOrContext && typeof browserOrContext.browser === 'function') {
    // Already a BrowserContext
    return new PlaywrightContextAdapter(browserOrContext as PlaywrightContext);
  }

  // It's a Browser, need to create a context
  const ctx = await (browserOrContext as any).newContext();
  return new PlaywrightContextAdapter(ctx as PlaywrightContext);
}

/**
 * Wrap an existing Playwright/Camoufox BrowserContext.
 * Useful if you already have a browser instance running.
 */
export function wrapContext(ctx: unknown): BrowserContext {
  return new PlaywrightContextAdapter(ctx as PlaywrightContext);
}
