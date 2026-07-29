/**
 * AI text generator powered by Perchance.
 */

import { Generator } from "./generator.js";
import { ConnectionError } from "./errors.js";
import type { GenerateTextOptions } from "./types.js";

const BASE_URL = "https://text-generation.perchance.org/api";
const DEFAULT_TIMEOUT_MS = 5000;

export class TextGenerator extends Generator {
  private static readonly BASE_URL = BASE_URL;
  private running = false;

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Stream generated text chunk by chunk.
   *
   * Yields decoded text chunks from the Perchance streaming API.
   * The response is line-delimited: lines starting with "t:" contain
   * JSON-encoded text chunks; a line starting with "data:" signals
   * the end of the stream.
   */
  async *stream(
    prompt: string,
    options: GenerateTextOptions = {},
  ): AsyncGenerator<string, void, undefined> {
    const {
      startWith = "",
      stopSequences = [],
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = options;

    const ctx = this.browserContext;
    if (!ctx) throw new ConnectionError("No browser context available");

    this.running = true;

    const page = await ctx.newPage();
    try {
      // Use the parent class key retrieval (fast path + Turnstile fallback + cache)
      const key = await this.ensureUserKey(BASE_URL);
      await page.goto(
        `${BASE_URL}/verifyUser?thread=0&__cacheBust=${Math.random()}`,
        { waitUntil: "networkidle", timeout: 15_000 },
      );
      const requestId = `aiTextCompletion${Math.floor(Math.random() * 2 ** 30)}`;
      const url =
        `${BASE_URL}/generate?userKey=${encodeURIComponent(key)}` +
        "&thread=0" +
        `&requestId=${requestId}` +
        `&__cacheBust=${Math.random()}`;

      const body = {
        generatorName: "ai-text-generator",
        instruction: prompt,
        instructionTokenCount: 1,
        startWith,
        startWithTokenCount: 1,
        stopSequences,
      };

      // We collect chunks via an exposed callback that the page JS calls.
      const chunks: string[] = [];
      let done = false;
      let streamComplete = false;
      let error: string | null = null;

      // Expose a function for the page to call with each chunk
      await page.exposeFunction("__perchanceOnChunk", (chunk: string) => {
        chunks.push(chunk);
      });
      await page.exposeFunction("__perchanceOnDone", () => {
        done = true;
      });
      await page.exposeFunction("__perchanceOnError", (msg: string) => {
        error = msg;
      });

      // Start the fetch in the page
      const fetchPromise = page.evaluate(
        async ({ url, body }: { url: string; body: Record<string, unknown> }) => {
          try {
            const controller = new AbortController();
            (window as any).__perchanceAbort = () => controller.abort();
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              await (window as any).__perchanceOnChunk(chunk);
            }
            await (window as any).__perchanceOnDone();
          } catch (e) {
            await (window as any).__perchanceOnError(String(e));
          }
        },
        { url, body },
      );

      // Poll for chunks with timeout
      let lastChunkTime = Date.now();
      while (!done && !error) {
        if (chunks.length > 0) {
          lastChunkTime = Date.now();
          const raw = chunks.shift()!;
          for (const line of raw.split("\n")) {
            if (line.startsWith("t:")) {
              yield JSON.parse(line.slice(2));
            } else if (line.startsWith("data:")) {
              streamComplete = true;
              done = true;
              break;
            }
          }
        } else {
          if (Date.now() - lastChunkTime > timeoutMs) {
            await page.evaluate(() => { (window as any).__perchanceAbort?.(); });
            throw new ConnectionError("Stream timed out");
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      // Drain remaining chunks
      while (chunks.length > 0 && !streamComplete) {
        const raw = chunks.shift()!;
        for (const line of raw.split("\n")) {
          if (line.startsWith("t:")) {
            yield JSON.parse(line.slice(2));
          } else if (line.startsWith("data:")) {
            streamComplete = true;
            break;
          }
        }
      }

      if (error) {
        throw new ConnectionError(error);
      }

      // Ensure the fetch promise resolves
      await fetchPromise;
    } finally {
      this.running = false;
      await page.close();
    }
  }

  /**
   * Generate text and return the full result as a string.
   */
  async text(
    prompt: string,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const parts: string[] = [];
    for await (const chunk of this.stream(prompt, options)) {
      parts.push(chunk);
    }
    return parts.join("");
  }
}
