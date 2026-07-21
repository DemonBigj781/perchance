/**
 * Unit tests for textGenerator.ts
 * Tests isRunning state and error handling without a real browser.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TextGenerator } from "../src/textGenerator.js";
import { ConnectionError } from "../src/errors.js";

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
});
