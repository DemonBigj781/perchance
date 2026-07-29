/**
 * Unit tests for generator.ts
 * Tests key cache, invalidation, and ensureUserKey with mock browser.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { Generator } from "../src/generator.js";
import type {
  BrowserContext,
  BrowserFrame,
  BrowserPage,
  BrowserResponse,
} from "../src/generator.js";

/** A concrete subclass for testing the abstract Generator. */
class TestGenerator extends Generator {}

/** Create a mock page that returns the given content and URL. */
function createMockPage(content: string): BrowserPage {
  return {
    goto: mock.fn(async () => {}),
    content: mock.fn(async () => content),
    evaluate: mock.fn(async () => undefined),
    frames: mock.fn(() => []),
    url: mock.fn(() => "https://example.com"),
    on: mock.fn(() => {}),
    waitForTimeout: mock.fn(async () => {}),
    close: mock.fn(async () => {}),
    exposeFunction: mock.fn(async () => {}),
  } as unknown as BrowserPage;
}

/** Create a mock browser context that returns the given pages in order. */
function createMockContext(pages: BrowserPage[]): BrowserContext {
  let idx = 0;
  return {
    newPage: mock.fn(async () => pages[idx++] ?? createMockPage("")),
    close: mock.fn(async () => {}),
  } as unknown as BrowserContext;
}

const KEY_RESPONSE = '<html>{"userKey":"test-key-12345"}</html>';
const NO_KEY_RESPONSE = "<html>token_required</html>";
const BASE_URL = "https://image-generation.perchance.org/api";
const TEXT_BASE_URL = "https://text-generation.perchance.org/api";

describe("generator", () => {
  it("ensureUserKey returns key from fast path", async () => {
    const ctx = createMockContext([createMockPage(KEY_RESPONSE)]);
    const gen = new TestGenerator();
    gen.setBrowserContext(ctx);
    const key = await gen.ensureUserKey(BASE_URL);
    assert.equal(key, "test-key-12345");
  });

  it("ensureUserKey uses cache on second call", async () => {
    const ctx = createMockContext([createMockPage(KEY_RESPONSE)]);
    const gen = new TestGenerator();
    gen.setBrowserContext(ctx);
    const key1 = await gen.ensureUserKey(BASE_URL);
    assert.equal(key1, "test-key-12345");
    // Second call should use cache, not open a new page
    const key2 = await gen.ensureUserKey(BASE_URL);
    assert.equal(key2, "test-key-12345");
    // Only one page should have been created
    assert.equal((ctx.newPage as unknown as ReturnType<typeof mock.fn>).mock.calls.length, 1);
  });

  it("invalidateKey forces re-fetch", async () => {
    const ctx = createMockContext([
      createMockPage(KEY_RESPONSE),
      createMockPage('<html>{"userKey":"new-key-67890"}</html>'),
    ]);
    const gen = new TestGenerator();
    gen.setBrowserContext(ctx);
    const key1 = await gen.ensureUserKey(BASE_URL);
    assert.equal(key1, "test-key-12345");
    gen.invalidateKey();
    const key2 = await gen.ensureUserKey(BASE_URL);
    assert.equal(key2, "new-key-67890");
  });

  it("uses the text generator verifier for text API keys", async () => {
    let responseHandler: ((response: BrowserResponse) => void) | undefined;
    const verifierPage = createMockPage("");
    verifierPage.on = mock.fn((_event, handler) => {
      responseHandler = handler;
    });
    verifierPage.goto = mock.fn(async () => {
      responseHandler?.({
        url: () => `${TEXT_BASE_URL}/verifyUser?token=test-token`,
        text: async () => KEY_RESPONSE,
      });
    });
    verifierPage.frames = mock.fn(() => [{
      url: () =>
        "https://example.perchance.org/ai-text-to-image-generator",
      evaluate: mock.fn(async () => undefined),
    } as BrowserFrame]);
    const ctx = createMockContext([
      createMockPage(NO_KEY_RESPONSE),
      verifierPage,
    ]);
    const gen = new TestGenerator();
    gen.setBrowserContext(ctx);

    assert.equal(await gen.ensureUserKey(TEXT_BASE_URL), "test-key-12345");
    assert.equal(
      (verifierPage.goto as unknown as ReturnType<typeof mock.fn>)
        .mock.calls[0].arguments[0],
      "https://perchance.org/ai-text-generator",
    );
  });

  it("throws AuthenticationError when no key found and no browser", async () => {
    const gen = new TestGenerator();
    // No browser context set — should throw
    await assert.rejects(
      () => gen.ensureUserKey(BASE_URL),
      /Failed to retrieve user key/,
    );
  });

  it("close clears browser context and cache", async () => {
    const ctx = createMockContext([createMockPage(KEY_RESPONSE)]);
    const gen = new TestGenerator();
    gen.setBrowserContext(ctx);
    await gen.ensureUserKey(BASE_URL);
    await gen.close();
    // After close, ensureUserKey should throw (no browser)
    await assert.rejects(
      () => gen.ensureUserKey(BASE_URL),
      /Failed to retrieve user key/,
    );
  });
});
