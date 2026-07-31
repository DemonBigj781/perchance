import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BrowserPage } from "../src/generator.js";
import {
  fetchGalleryDocument,
  fetchGalleryImage,
  readGalleryFeed,
} from "../src/internal/galleryBrowser.js";

function fakePage(results: unknown[]): BrowserPage & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    async goto() {},
    async content() {
      return "";
    },
    async evaluate(_fn, ...args) {
      calls.push(args);
      return results.shift() as never;
    },
    frames() {
      return [];
    },
    url() {
      return "https://image-generation.perchance.org/gallery";
    },
    on() {},
    async waitForTimeout() {},
    async close() {},
    async exposeFunction() {},
  };
}

describe("gallery browser adapter", () => {
  it("returns structured feed records and continuation state", async () => {
    const page = fakePage([{
      records: [{ imageId: "a".repeat(64) }],
      consumed: 1,
      hasMore: true,
    }]);

    const result = await readGalleryFeed(page, { startSkip: 20, limit: 1 });

    assert.equal(result.consumed, 1);
    assert.equal(result.hasMore, true);
    assert.deepEqual(page.calls[0][0], { startSkip: 20, limit: 1 });
  });

  it("returns item response metadata and parsed JSON", async () => {
    const imageId = "b".repeat(64);
    const finalUrl = `https://aigc.uploads.dev/docs/${imageId}.json`;
    const page = fakePage([{
      status: 200,
      finalUrl,
      contentType: "application/json",
      body: { id: imageId },
    }]);

    const result = await fetchGalleryDocument(page, imageId);

    assert.equal(result.status, 200);
    assert.equal(result.finalUrl, finalUrl);
    assert.equal((result.body as { id: string }).id, imageId);
    assert.equal(page.calls[0][0], finalUrl);
  });

  it("returns image response metadata and base64 data", async () => {
    const imageUrl = `https://aigc.uploads.dev/image/${"c".repeat(64)}.jpeg`;
    const page = fakePage([{
      status: 200,
      finalUrl: imageUrl,
      contentType: "image/jpeg",
      data: "AQID",
    }]);

    const result = await fetchGalleryImage(page, imageUrl);

    assert.equal(result.data, "AQID");
    assert.equal(result.contentType, "image/jpeg");
    assert.equal(page.calls[0][0], imageUrl);
  });
});
