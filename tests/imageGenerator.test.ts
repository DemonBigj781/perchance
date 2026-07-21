/**
 * Unit tests for imageGenerator.ts
 * Tests findProxyDownload logic and ImageResult construction with mock data.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ImageResult, ImageGenerator } from "../src/imageGenerator.js";
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
});
