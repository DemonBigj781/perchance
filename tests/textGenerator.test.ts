/**
 * Unit tests for textGenerator.ts
 * Tests isRunning state and error handling without a real browser.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TextGenerator } from "../src/textGenerator.js";
import { ConnectionError } from "../src/errors.js";
import type { BrowserContext, BrowserPage } from "../src/generator.js";

class FixedKeyTextGenerator extends TextGenerator {
  override async ensureUserKey(): Promise<string> {
    return "test-key";
  }
}

describe("textGenerator", () => {
  it("isRunning returns false by default", () => {
    const gen = new TextGenerator();
    assert.equal(gen.isRunning(), false);
  });

  it("stream throws ConnectionError without browser context", async () => {
    const gen = new TextGenerator();
    await assert.rejects(
      () => gen.stream("hello").next(),
      (err: unknown) => err instanceof ConnectionError,
    );
    // Should not be running after the error
    assert.equal(gen.isRunning(), false);
  });

  it("text throws ConnectionError without browser context", async () => {
    const gen = new TextGenerator();
    await assert.rejects(
      () => gen.text("hello"),
      (err: unknown) => err instanceof ConnectionError,
    );
  });

  it("navigates to the text API origin before starting the stream", async () => {
    const events: string[] = [];
    const callbacks = new Map<string, (...args: unknown[]) => unknown>();
    let streamRequest: { url: string } | undefined;
    let currentUrl = "about:blank";
    const page = {
      async goto(url: string) {
        currentUrl = url;
        events.push(`goto:${url}`);
      },
      async content() {
        return "";
      },
      async evaluate(_fn: unknown, request?: { url: string }) {
        events.push("evaluate");
        streamRequest = request;
        await callbacks.get("__perchanceOnChunk")?.("data:done");
        await callbacks.get("__perchanceOnDone")?.();
        await new Promise<void>((resolve) => setImmediate(resolve));
        events.push("fetch-resolved");
      },
      frames() {
        return [];
      },
      url() {
        return currentUrl;
      },
      on() {},
      async waitForTimeout() {},
      async close() {
        events.push("close");
      },
      async exposeFunction(
        name: string,
        callback: (...args: unknown[]) => unknown,
      ) {
        callbacks.set(name, callback);
      },
    } as BrowserPage;
    const context = {
      async newPage() {
        return page;
      },
      async close() {},
    } as BrowserContext;
    const generator = new FixedKeyTextGenerator();
    generator.setBrowserContext(context);

    assert.equal(await generator.text("hello"), "");
    assert.match(
      events[0] ?? "",
      /^goto:https:\/\/text-generation\.perchance\.org\/api\/verifyUser\?/,
    );
    assert.equal(events[1], "evaluate");
    assert.match(streamRequest?.url ?? "", /[?&]thread=0(?:&|$)/);
    const fetchResolvedIndex = events.indexOf("fetch-resolved");
    const closeIndex = events.indexOf("close");
    assert.notEqual(fetchResolvedIndex, -1);
    assert.notEqual(closeIndex, -1);
    assert.ok(
      fetchResolvedIndex < closeIndex,
      "the browser fetch must settle before its page is closed",
    );
  });
});
