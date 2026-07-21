/**
 * AI image generator powered by Perchance.
 */

import { Generator, BrowserPage } from "./generator.js";
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

    const urls: string[] = [];
    if (this.proxyDownload) {
      urls.push(`${BASE_URL}/${this.proxyDownload}`);
    }
    urls.push(`${BASE_URL}/downloadTemporaryImage?imageId=${this.imageId}`);

    const page = await ctx.newPage();
    try {
      await page.goto(
        `${BASE_URL}/verifyUser?thread=0&__cacheBust=${Math.random()}`,
      );

      const result = await page.evaluate<
        { ok: true; data: string } | { ok: false; failures: string[] }
      >(
        `async (urls) => {
          const failures = [];
          for (const url of urls) {
            const response = await fetch(url);
            if (!response.ok) { failures.push(response.status + ' ' + url); continue; }
            const blob = await response.blob();
            const base64 = await new Promise(resolve => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result.split(',')[1]);
              reader.readAsDataURL(blob);
            });
            return { ok: true, data: base64 };
          }
          return { ok: false, failures };
        }`,
        urls,
      );

      if (!result.ok) {
        throw new ConnectionError(`Failed to download image: ${result.failures.join(", ")}`);
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
  private static readonly BASE_URL = BASE_URL;

  /**
   * Generate an image.
   *
   * Self-healing: if the userKey is rejected by the API, a fresh
   * key is obtained (which may trigger the full Turnstile flow if
   * Cloudflare clearance has expired) and the request is retried.
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

    for (let attempt = 0; attempt < 2; attempt++) {
      const key = await this.ensureUserKey(BASE_URL);

      const response = await this.generateWithKey(
        key, resolution, prompt, negativePrompt, seed, guidanceScale,
      );

      // Check if the key was rejected (no imageId = auth failure)
      if (response.imageId === undefined) {
        if (attempt === 0) {
          this.invalidateKey();
          continue;
        }
        throw new AuthenticationError(
          `User key rejected after retry. Response: ${JSON.stringify(response)}`,
        );
      }

      return new ImageResult(this, response as ImageResultData);
    }

    throw new AuthenticationError("Failed to generate image after key refresh");
  }

  /** Make the actual API call. Returns the JSON response. */
  private async generateWithKey(
    key: string,
    resolution: string,
    prompt: string,
    negativePrompt: string | null,
    seed: number,
    guidanceScale: number,
  ): Promise<Partial<ImageResultData>> {
    const ctx = this.getBrowserContext();
    if (!ctx) throw new ConnectionError("No browser context available");

    const page = await ctx.newPage();
    try {
      await page.goto(
        `${BASE_URL}/verifyUser?thread=0&__cacheBust=${Math.random()}`,
      );

      const requestId = `aiImageCompletion${Math.floor(Math.random() * 2 ** 30)}`;
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

      return await page.evaluate<Partial<ImageResultData>>(
        `async ({ url, body }) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          return await response.json();
        }`,
        { url, body },
      );
    } finally {
      await page.close();
    }
  }

  /** Expose browser context for ImageResult.download(). */
  getBrowserContext() {
    return this.browserContext;
  }
}
