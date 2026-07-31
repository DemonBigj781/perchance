import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GalleryNotFoundError,
  GalleryProtocolError,
  PerchanceError,
} from "../src/errors.js";
import {
  buildGalleryUrl,
  decodeGalleryCursor,
  encodeGalleryCursor,
  normalizeFeedEntry,
  normalizeGalleryDocument,
  normalizeGetOptions,
  normalizeListOptions,
  parseGalleryImageId,
  trustedImageExtension,
} from "../src/internal/galleryProtocol.js";
import type {
  GalleryEntry,
  GalleryGetOptions,
  GalleryListOptions,
  GalleryPage,
} from "../src/types.js";

describe("gallery public contracts", () => {
  it("exposes normalized gallery types and errors", () => {
    const options: GalleryListOptions = {
      channel: "ai-text-to-image-generator",
      limit: 20,
      sort: "recent",
      timeRange: "all-time",
      contentFilter: "g",
    };
    const getOptions: GalleryGetOptions = { contentFilter: "g" };
    const entry: GalleryEntry = {
      imageId: "a".repeat(64),
      imageUrl: `https://aigc.uploads.dev/image/${"a".repeat(64)}.jpeg`,
      prompt: "a lighthouse in fog",
      channel: options.channel!,
      subChannel: "public",
    };
    const page: GalleryPage = { entries: [entry], nextCursor: "cursor" };

    assert.equal(page.entries[0], entry);
    assert.equal(getOptions.contentFilter, "g");
    assert.ok(new GalleryNotFoundError("missing") instanceof PerchanceError);
    assert.ok(new GalleryProtocolError("bad payload") instanceof PerchanceError);
  });
});

describe("gallery protocol", () => {
  const imageId = "b".repeat(64);

  it("normalizes defaults and builds encoded gallery URLs", () => {
    const options = normalizeListOptions();
    assert.deepEqual(options, {
      channel: "ai-text-to-image-generator",
      limit: 20,
      skip: 0,
      sort: "recent",
      timeRange: "all-time",
      contentFilter: "g",
    });

    const url = new URL(buildGalleryUrl(options));
    assert.equal(url.origin, "https://image-generation.perchance.org");
    assert.equal(url.searchParams.get("channel"), options.channel);
    assert.equal(url.searchParams.get("subChannel"), "public");
    assert.equal(url.searchParams.get("sort"), "recent");
  });

  it("round-trips a versioned opaque cursor", () => {
    const cursor = encodeGalleryCursor(37);

    assert.equal(decodeGalleryCursor(cursor), 37);
    assert.throws(() => decodeGalleryCursor("not-a-cursor"), /Invalid gallery cursor/);
  });

  it("rejects invalid options before transport work", () => {
    assert.throws(() => normalizeListOptions({ channel: "bad/channel" }), /channel/);
    assert.throws(() => normalizeListOptions({ limit: 0 }), /between 1 and 100/);
    assert.throws(() => normalizeListOptions({ sort: "new" as never }), /sort/);
    assert.throws(
      () => normalizeGetOptions({ contentFilter: "x".repeat(129) }),
      /content filter/,
    );
  });

  it("accepts IDs and supported URLs only", () => {
    assert.equal(parseGalleryImageId(imageId), imageId);
    assert.equal(
      parseGalleryImageId(`https://aigc.uploads.dev/image/${imageId}.jpeg`),
      imageId,
    );
    assert.equal(
      parseGalleryImageId(
        `https://image-generation.perchance.org/gallery?imageId=${imageId}`,
      ),
      imageId,
    );
    assert.throws(
      () => parseGalleryImageId("http://example.com/image.png"),
      /supported/,
    );
  });

  it("normalizes feed records and item documents", () => {
    const entry = normalizeFeedEntry({
      imageId,
      imageUrl: `https://aigc.uploads.dev/image/${imageId}.jpeg`,
      prompt: "forest temple",
      negativePrompt: "text",
      seed: "42",
      guidanceScale: "7",
      width: "768",
      height: "512",
    }, "demo-channel");
    assert.equal(entry.seed, 42);
    assert.equal(entry.width, 768);

    const documentEntry = normalizeGalleryDocument({
      id: imageId,
      ext: "jpeg",
      channels: ["demo-channel"],
      prompt: "forest temple",
      negativePrompt: "text",
      width: 768,
      height: 512,
      score: 9,
      t: 1_725_000_000_000,
      nsfw: false,
      shocking: false,
      pg13Soft: false,
    }, "demo-channel");
    assert.equal(documentEntry.score, 9);
    assert.equal(
      documentEntry.createdAt,
      new Date(1_725_000_000_000).toISOString(),
    );
  });

  it("treats channel and content-filter mismatches as not found", () => {
    const baseDocument = {
      id: imageId,
      ext: "jpeg",
      channels: ["demo-channel"],
      prompt: "forest temple",
      nsfw: false,
      shocking: false,
      pg13Soft: false,
    };

    assert.throws(
      () => normalizeGalleryDocument(baseDocument, "other-channel"),
      GalleryNotFoundError,
    );
    assert.throws(
      () => normalizeGalleryDocument({ ...baseDocument, pg13Soft: true }, "demo-channel", "g"),
      GalleryNotFoundError,
    );
  });

  it("rejects protocol drift instead of dropping records", () => {
    assert.throws(
      () => normalizeFeedEntry({
        imageId,
        imageUrl: "javascript:bad",
        prompt: 7,
      }, "demo"),
      GalleryProtocolError,
    );
    assert.throws(
      () => normalizeGalleryDocument({ id: imageId, channels: "demo" }, "demo"),
      GalleryProtocolError,
    );
  });

  it("derives extensions only from trusted image URLs", () => {
    assert.equal(
      trustedImageExtension(`https://aigc.uploads.dev/image/${imageId}.jpeg`),
      "jpeg",
    );
    assert.throws(
      () => trustedImageExtension("https://example.com/file.jpeg"),
      /image URL/,
    );
  });
});
