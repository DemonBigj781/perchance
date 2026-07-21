/**
 * Unit tests for errors.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PerchanceError, ConnectionError, AuthenticationError, RateLimitError } from "../src/errors.js";

describe("errors", () => {
  it("PerchanceError is an Error", () => {
    const e = new PerchanceError("test");
    assert.ok(e instanceof Error);
    assert.equal(e.name, "PerchanceError");
    assert.equal(e.message, "test");
  });

  it("ConnectionError extends PerchanceError", () => {
    const e = new ConnectionError("boom");
    assert.ok(e instanceof PerchanceError);
    assert.ok(e instanceof Error);
    assert.equal(e.name, "ConnectionError");
    assert.equal(e.message, "boom");
  });

  it("AuthenticationError extends PerchanceError", () => {
    const e = new AuthenticationError("no key");
    assert.ok(e instanceof PerchanceError);
    assert.equal(e.name, "AuthenticationError");
  });

  it("RateLimitError extends PerchanceError", () => {
    const e = new RateLimitError("too many");
    assert.ok(e instanceof PerchanceError);
    assert.equal(e.name, "RateLimitError");
  });
});
