/**
 * Unit tests for utils.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateUserAgent } from "../src/utils.js";

describe("utils", () => {
  it("generateUserAgent returns a string", () => {
    const ua = generateUserAgent();
    assert.equal(typeof ua, "string");
    assert.ok(ua.length > 0);
  });

  it("generateUserAgent starts with Mozilla/5.0", () => {
    const ua = generateUserAgent();
    assert.ok(ua.startsWith("Mozilla/5.0 ("));
  });

  it("generateUserAgent produces variety", () => {
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      results.add(generateUserAgent());
    }
    // With 6 platforms x 4 engines x 5 browsers = 120 combos, we should get at least 10 unique ones
    assert.ok(results.size >= 10, `Expected variety, got ${results.size} unique UAs out of 100`);
  });
});
