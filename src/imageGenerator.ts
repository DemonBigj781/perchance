/**
 * AI image generator powered by Perchance.
 */

import { Generator } from "./generator.js";
import { AuthenticationError, ConnectionError } from "./errors.js";
import type { GenerateImageOptions, ImageResultData, ImageShape } from "./types.js";

const BASE_URL = "https://image-generation.perchance.org/api";

const SHAPE_TO_RESOLUTION: Record<ImageShape, string> = {
  portrait: "512x768",
  square: "768x768",
  landscape: "768x512",
};

/**
 * Find the proxy image download path or token in a generate response.
 * Recursively searches dicts/lists/strings.
 */
function findProxyDownload(value: unknown): string | null {
  if (typeof value === "string") {
    if (value.includes("downloadTemporaryImageViaProxy")) return value;
    if (value.startsWith("v1.") && value.length > 80) {
      return `/downloadTemporaryImageViaProxy?t=${value}`;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const item of Object.values(obj)) {
      const result = findProxyDownload(item);
      if (result) return result;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findProxyDownload(item);
      if (result) return result;
    }
  }
  return null;
}

export class ImageResult {
  readonly imageId: string;
  readonly fileExtension: string;
  readonly seed: number;
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
  readonly guidanceScale: number;
  readonly negativePrompt: string;
  readonly maybeNsfw: boolean;
  readonly proxyDownload: string | null;

  private readonly generator: ImageGenerator;

  constructor(generator: ImageGenerator, data: ImageResultData) {
    this.generator = generator;
    this.imageId = data.imageId;
    this.fileExtension = data.fileExtension;
    this.seed = data.seed;
    this.prompt = data.prompt;
    this.width = data.width;
    this.height = data.height;
    this.guidanceScale = data.guidanceScale;
    this.negativePrompt = data.negativePrompt;
    this.maybeNsfw = data.maybeNsfw;
    this.proxyDownload = findProxyDownload(data);
  }

  toString(): string {
    return `${this.imageId}.${this.fileExtension}`;
  }

  get size(): readonly [number, number] {
    return [this.width, this.height] as const;
  }

  /**
   * Download the generated image as a Buffer.
   * Tries the proxy download URL first (if available), then falls
   * back to the direct downloadTemporaryImage endpoint.
   */
  async download(): Promise<Buffer> {
    const ctx = this.generator.getBrowserContext();
    if (!ctx) throw new ConnectionError("No browser context available");

    const ORIGIN = "https://image-generation.perchance.org";
    const urls: string[] = [];
    if (this.proxyDownload) {
      // proxyDownload already contains the full path (e.g. /api/downloadTemporaryImageViaProxy?t=...)
      urls.push(`${ORIGIN}${this.proxyDownload}`);
    }

    const page = await ctx.newPage();
    try {
      await page.goto(
        `${BASE_URL}/verifyUser?thread=0&__cacheBust=${Math.random()}`,
        { waitUntil: "domcontentloaded", timeout: 60_000 },
      );

      const result = await page.evaluate<
        { ok: true; data: string } | { ok: false; failures: string[] }
      >(
        async (urls: string[]) => {
          const failures: string[] = [];
          for (const url of urls) {
            const response = await fetch(url);
            if (!response.ok) { failures.push(response.status + ' ' + url); continue; }
            const blob = await response.blob();
            const base64 = await new Promise<string>(resolve => {
              const reader = new FileReader();
              reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
              reader.readAsDataURL(blob);
            });
            return { ok: true, data: base64 };
          }
          return { ok: false, failures };
        },
        urls,
      );

      if (!result.ok) {
        const errResult = result as { ok: false; failures: string[] };
        throw new ConnectionError(`Failed to download image: ${errResult.failures.join(", ")}`);
      }

      return Buffer.from(result.data, "base64");
    } finally {
      await page.close();
    }
  }

  /** Download and save the image to disk. */
  async save(filename?: string): Promise<string> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = filename ?? `${this.imageId}.${this.fileExtension}`;
    const data = await this.download();
    await fs.writeFile(path.resolve(file), data);
    return file;
  }
}

export class ImageGenerator extends Generator {
  private static readonly GENERATION_TIMEOUT_MS = 180_000;
  private static readonly POLL_INTERVAL_MS = 2_000;

  /**
   * Generate an image.
   *
   * Keep the same request ID while the server queues or completes an image.
   * Only an explicit invalid_key response refreshes the key, at most once.
   * After the initial key lookup, polling has a three-minute budget.
   */
  async image(prompt: string, options: GenerateImageOptions = {}): Promise<ImageResult> {
    const {
      negativePrompt = null,
      seed = -1,
      shape = "square",
      guidanceScale = 7.0,
    } = options;

    const resolution = SHAPE_TO_RESOLUTION[shape];
    if (!resolution) throw new Error(`Invalid shape: ${shape}`);

    const requestId = `aiImageCompletion${Math.floor(Math.random() * 2 ** 30)}`;
    let key = await this.ensureUserKey(BASE_URL);
    const deadline = Date.now() + ImageGenerator.GENERATION_TIMEOUT_MS;
    let keyRefreshed = false;

    while (Date.now() < deadline) {
      const response = await this.generateWithKey(
        key, requestId, resolution, prompt, negativePrompt, seed, guidanceScale, deadline,
      );

      // Success
      const record = response && typeof response === "object"
        ? response as Record<string, unknown>
        : null;
      if (typeof record?.imageId === "string" && record.imageId.length > 0) {
        return new ImageResult(this, response as ImageResultData);
      }

      // Queue responses are not authentication failures. Poll the same job.
      const status = record?.status;
      if (status === "waiting_for_prev_request_to_finish") {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise(resolve => setTimeout(
          resolve, Math.min(ImageGenerator.POLL_INTERVAL_MS, remaining),
        ));
        continue;
      }

      if (status === "invalid_key" && !keyRefreshed) {
        keyRefreshed = true;
        this.invalidateKey();
        key = await this.ensureUserKey(BASE_URL);
        continue;
      }

      if (status === "invalid_key") {
        throw new AuthenticationError("User key rejected after one refresh");
      }

      throw new ConnectionError(
        `Unexpected image generation response: status=${String(status ?? "(none)").slice(0, 100)}`,
      );
    }

    throw new ConnectionError("Image generation timed out after 180 seconds");
  }

  /** Make the actual API call. Returns the JSON response. */
  private async generateWithKey(
    key: string,
    requestId: string,
    resolution: string,
    prompt: string,
    negativePrompt: string | null,
    seed: number,
    guidanceScale: number,
    deadline: number,
  ): Promise<unknown> {
    const ctx = this.getBrowserContext();
    if (!ctx) throw new ConnectionError("No browser context available");

    const page = await ctx.newPage();
    try {
      const remaining = () => {
        const ms = deadline - Date.now();
        if (ms <= 0) throw new ConnectionError("Image generation timed out after 180 seconds");
        return ms;
      };
      await page.goto(
        `${BASE_URL}/verifyUser?thread=0&__cacheBust=${Math.random()}`,
        { waitUntil: "domcontentloaded", timeout: Math.min(60_000, remaining()) },
      );

      const url =
        `${BASE_URL}/generate?userKey=${key}` +
        `&requestId=${requestId}` +
        `&__cacheBust=${Math.random()}`;

      const body = {
        generatorName: "ai-image-generator",
        channel: "ai-text-to-image-generator",
        subChannel: "public",
        prompt,
        negativePrompt: negativePrompt ?? "",
        seed,
        resolution,
        guidanceScale,
      };

      return await page.evaluate<unknown>(
        async ({ url, body, timeoutMs }: {
          url: string;
          body: Record<string, unknown>;
          timeoutMs: number;
        }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            return await response.json();
          } finally {
            clearTimeout(timer);
          }
        },
        { url, body, timeoutMs: remaining() },
      );
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new ConnectionError("Image generation timed out after 180 seconds");
      }
      throw error;
    } finally {
      await page.close();
    }
  }

  /** Expose browser context for ImageResult.download(). */
  getBrowserContext() {
    return this.browserContext;
  }
}
