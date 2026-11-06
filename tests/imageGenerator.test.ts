/**
 * Unit tests for imageGenerator.ts
 * Tests findProxyDownload logic and ImageResult construction with mock data.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { ImageResult, ImageGenerator } from "../src/imageGenerator.js";
import type {
  BrowserContext,
  BrowserPage,
} from "../src/generator.js";
import type { ImageResultData } from "../src/types.js";

const MOCK_RESULT: ImageResultData = {
  imageId: "abc123",
  fileExtension: "jpg",
  seed: 42,
  prompt: "a cat",
  width: 768,
  height: 768,
  guidanceScale: 7.0,
  negativePrompt: "",
  maybeNsfw: false,
};

describe("imageGenerator", () => {
  it("ImageResult constructs from mock data", () => {
    const gen = new ImageGenerator();
    const result = new ImageResult(gen, MOCK_RESULT);
    assert.equal(result.imageId, "abc123");
    assert.equal(result.fileExtension, "jpg");
    assert.equal(result.seed, 42);
    assert.equal(result.prompt, "a cat");
    assert.equal(result.width, 768);
    assert.equal(result.height, 768);
    assert.equal(result.maybeNsfw, false);
    assert.equal(result.proxyDownload, null);
  });

  it("ImageResult.toString returns imageId.extension", () => {
    const gen = new ImageGenerator();
    const result = new ImageResult(gen, MOCK_RESULT);
    assert.equal(result.toString(), "abc123.jpg");
  });

  it("ImageResult.size returns [width, height]", () => {
    const gen = new ImageGenerator();
    const result = new ImageResult(gen, MOCK_RESULT);
    assert.deepEqual(result.size, [768, 768]);
  });

  it("findProxyDownload detects proxy path in response", () => {
    const gen = new ImageGenerator();
    const data: ImageResultData = {
      ...MOCK_RESULT,
      someField: "/downloadTemporaryImageViaProxy?t=xyz123",
    };
    const result = new ImageResult(gen, data);
    assert.equal(result.proxyDownload, "/downloadTemporaryImageViaProxy?t=xyz123");
  });

  it("findProxyDownload detects v1. token", () => {
    const gen = new ImageGenerator();
    const longToken = "v1." + "a".repeat(80);
    const data: ImageResultData = {
      ...MOCK_RESULT,
      token: longToken,
    };
    const result = new ImageResult(gen, data);
    assert.equal(result.proxyDownload, `/downloadTemporaryImageViaProxy?t=${longToken}`);
  });

  it("findProxyDownload returns null when no proxy path exists", () => {
    const gen = new ImageGenerator();
    const result = new ImageResult(gen, MOCK_RESULT);
    assert.equal(result.proxyDownload, null);
  });

  it("ImageGenerator has browser context null by default", () => {
    const gen = new ImageGenerator();
    assert.equal(gen.getBrowserContext(), null);
  });

  it("uses bounded DOM-ready navigation when downloading an image", async () => {
    const page = {
      goto: mock.fn(async () => {}),
      content: mock.fn(async () => ""),
      evaluate: mock.fn(async () => ({ ok: true, data: "AQID" })),
      frames: mock.fn(() => []),
      url: mock.fn(() => "about:blank"),
      on: mock.fn(() => {}),
      waitForTimeout: mock.fn(async () => {}),
      close: mock.fn(async () => {}),
      exposeFunction: mock.fn(async () => {}),
    } as unknown as BrowserPage;
    const context = {
      newPage: mock.fn(async () => page),
      close: mock.fn(async () => {}),
    } as unknown as BrowserContext;
    const generator = new ImageGenerator();
    generator.setBrowserContext(context);
    const result = new ImageResult(generator, {
      ...MOCK_RESULT,
      token: `v1.${"a".repeat(80)}`,
    });

    assert.deepEqual(await result.download(), Buffer.from([1, 2, 3]));
    assert.deepEqual(
      (page.goto as unknown as ReturnType<typeof mock.fn>)
        .mock.calls[0].arguments[1],
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
  });
});

/** Mock only the existing key lookup: no real browser or verification is used. */
function imageHarness(responses: unknown[]) {
  const requests: { url: string; body: Record<string, unknown>; timeoutMs: number }[] = [];
  const pages: BrowserPage[] = [];
  const context = {
    newPage: mock.fn(async () => {
      const page = {
        goto: mock.fn(async () => {}),
        evaluate: mock.fn(async (_fn: unknown, args: typeof requests[number]) => {
          requests.push(args);
          return responses.shift();
        }),
        close: mock.fn(async () => {}),
      } as unknown as BrowserPage;
      pages.push(page);
      return page;
    }),
    close: mock.fn(async () => {}),
  };
  const generator = new ImageGenerator();
  generator.setBrowserContext(context);
  const keyLookup = mock.method(generator, "ensureUserKey", async () => "test-key");
  const invalidate = mock.method(generator, "invalidateKey", () => {});
  return { generator, context, pages, requests, keyLookup, invalidate };
}

const QUEUED = { status: "waiting_for_prev_request_to_finish" };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const calls = (fn: unknown) => (fn as ReturnType<typeof mock.fn>).mock.calls;

describe("image request lifecycle", () => {
  it("polls more than three times with one request ID and unchanged body", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const h = imageHarness([QUEUED, QUEUED, QUEUED, QUEUED, MOCK_RESULT]);
    const pending = h.generator.image("a cat", {
      negativePrompt: "rain", seed: 42, shape: "landscape", guidanceScale: 8,
    });
    await flush();
    for (let poll = 0; poll < 4; poll++) {
      t.mock.timers.tick(2_000);
      await flush();
    }
    assert.equal((await pending).imageId, MOCK_RESULT.imageId);
    assert.equal(h.requests.length, 5);
    assert.equal(new Set(h.requests.map(r => new URL(r.url).searchParams.get("requestId"))).size, 1);
    for (const request of h.requests) {
      assert.deepEqual(request.body, {
        generatorName: "ai-image-generator", channel: "ai-text-to-image-generator",
        subChannel: "public", prompt: "a cat", negativePrompt: "rain",
        seed: 42, resolution: "768x512", guidanceScale: 8,
      });
    }
    assert.equal(h.keyLookup.mock.callCount(), 1);
    assert.equal(h.invalidate.mock.callCount(), 0);
    assert.equal(calls(h.context.close).length, 0);
    for (const page of h.pages) {
      assert.equal(calls(page.close).length, 1);
      assert.deepEqual(calls(page.goto)[0].arguments[1], {
        waitUntil: "domcontentloaded", timeout: 60_000,
      });
    }
  });

  it("refreshes an invalid key once after queueing without changing the request ID", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const h = imageHarness([QUEUED, { status: "invalid_key" }, QUEUED, MOCK_RESULT]);
    h.keyLookup.mock.mockImplementationOnce(async () => "refreshed-key", 1);
    const pending = h.generator.image("a cat");
    await flush();
    t.mock.timers.tick(2_000);
    await flush();
    t.mock.timers.tick(2_000);
    assert.equal((await pending).imageId, MOCK_RESULT.imageId);
    assert.equal(h.keyLookup.mock.callCount(), 2);
    assert.equal(h.invalidate.mock.callCount(), 1);
    assert.deepEqual(h.requests.map(r => new URL(r.url).searchParams.get("userKey")),
      ["test-key", "test-key", "refreshed-key", "refreshed-key"]);
    assert.equal(new Set(h.requests.map(r => new URL(r.url).searchParams.get("requestId"))).size, 1);
  });

  it("stops after a second explicit invalid_key response", async () => {
    const h = imageHarness([{ status: "invalid_key" }, { status: "invalid_key" }]);
    await assert.rejects(h.generator.image("a cat"), {
      name: "AuthenticationError", message: "User key rejected after one refresh",
    });
    assert.equal(h.requests.length, 2);
    assert.equal(h.keyLookup.mock.callCount(), 2);
    assert.equal(h.invalidate.mock.callCount(), 1);
    assert.ok(h.pages.every(page => calls(page.close).length === 1));
  });

  for (const response of [null, undefined, "bad response", [], {}, { imageId: null },
    { imageId: "" }, { status: "server_error" }]) {
    it(`reports ${JSON.stringify(response)} without an authentication retry`, async () => {
      const h = imageHarness([response]);
      await assert.rejects(h.generator.image("a cat"), {
        name: "ConnectionError",
      });
      assert.equal(h.keyLookup.mock.callCount(), 1);
      assert.equal(h.invalidate.mock.callCount(), 0);
      assert.equal(h.requests.length, 1);
      assert.equal(calls(h.pages[0].close).length, 1);
    });
  }

  it("stops polling at the deadline without refreshing a valid key", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const h = imageHarness([QUEUED, MOCK_RESULT]);
    const rejected = assert.rejects(h.generator.image("a cat"), {
      name: "ConnectionError", message: "Image generation timed out after 180 seconds",
    });
    await flush();
    t.mock.timers.tick(180_000);
    await rejected;
    assert.equal(h.requests.length, 1);
    assert.equal(h.invalidate.mock.callCount(), 0);
    assert.equal(calls(h.pages[0].close).length, 1);
  });

  it("gives separate image calls separate request IDs", async (t) => {
    let randomValue = 0;
    t.mock.method(Math, "random", () => (randomValue += 0.1));
    const h = imageHarness([MOCK_RESULT, MOCK_RESULT]);
    await h.generator.image("first");
    await h.generator.image("second");
    const ids = h.requests.map(r => new URL(r.url).searchParams.get("requestId"));
    assert.notEqual(ids[0], ids[1]);
  });

  it("does not submit again when key refresh consumes the remaining budget", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const h = imageHarness([{ status: "invalid_key" }, MOCK_RESULT]);
    h.keyLookup.mock.mockImplementationOnce(async () => {
      t.mock.timers.tick(180_001);
      return "refreshed-key";
    }, 1);
    await assert.rejects(h.generator.image("a cat"), {
      name: "ConnectionError", message: "Image generation timed out after 180 seconds",
    });
    assert.equal(h.requests.length, 1);
    assert.equal(h.pages.length, 1);
    assert.equal(calls(h.pages[0].close).length, 1);
    assert.equal(h.keyLookup.mock.callCount(), 2);
  });

  it("clips the final poll delay to the remaining budget", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const h = imageHarness([QUEUED, MOCK_RESULT]);
    const page = await h.context.newPage();
    h.context.newPage.mock.mockImplementation(async () => page);
    page.goto = async () => { t.mock.timers.tick(179_500); };
    const rejected = assert.rejects(h.generator.image("a cat"), {
      name: "ConnectionError", message: "Image generation timed out after 180 seconds",
    });
    await flush();
    t.mock.timers.tick(500);
    await rejected;
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].timeoutMs, 500);
  });

  it("closes the request page on navigation or evaluation failure", async () => {
    for (const operation of ["goto", "evaluate"] as const) {
      const h = imageHarness([]);
      const page = await h.context.newPage();
      page[operation] = mock.fn(async () => { throw new Error(`${operation} failed`); });
      h.context.newPage.mock.mockImplementation(async () => page);
      await assert.rejects(h.generator.image("a cat"), new RegExp(`${operation} failed`));
      assert.equal(calls(page.close).length, 1);
      assert.equal(calls(h.context.close).length, 0);
      assert.equal(h.invalidate.mock.callCount(), 0);
    }
  });

  it("bounds a stalled fetch and closes its page", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const h = imageHarness([]);
    const page = await h.context.newPage();
    h.context.newPage.mock.mockImplementation(async () => page);
    let signal: AbortSignal | undefined;
    t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal!.reason), { once: true });
      });
    });
    page.evaluate = async (fn, args) => (fn as Function)(args);
    const rejected = assert.rejects(h.generator.image("a cat"), {
      name: "ConnectionError", message: "Image generation timed out after 180 seconds",
    });
    await flush();
    assert.equal(signal?.aborted, false);
    t.mock.timers.tick(180_000);
    await rejected;
    assert.equal(signal?.aborted, true);
    assert.equal(calls(page.close).length, 1);
    assert.equal(h.invalidate.mock.callCount(), 0);
  });

  it("clears the fetch abort timer on success", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const h = imageHarness([]);
    const page = await h.context.newPage();
    h.context.newPage.mock.mockImplementation(async () => page);
    let signal: AbortSignal | undefined;
    t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return { json: async () => MOCK_RESULT } as Response;
    });
    page.evaluate = async (fn, args) => (fn as Function)(args);
    assert.equal((await h.generator.image("a cat")).imageId, MOCK_RESULT.imageId);
    t.mock.timers.tick(180_000);
    assert.equal(signal?.aborted, false);
    assert.equal(calls(page.close).length, 1);
  });

  it("deducts navigation time from the fetch timeout", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const h = imageHarness([MOCK_RESULT]);
    const page = await h.context.newPage();
    h.context.newPage.mock.mockImplementation(async () => page);
    page.goto = async () => { t.mock.timers.tick(50_000); };
    await h.generator.image("a cat");
    assert.equal(h.requests[0].timeoutMs, 130_000);
  });
});
