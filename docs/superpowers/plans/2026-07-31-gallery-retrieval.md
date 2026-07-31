<!-- markdownlint-disable MD013 -->

# Public Gallery Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add typed public Perchance gallery feed, item metadata, prompt retrieval, and optional image downloads to the package and CLI without adding a UI server.

**Architecture:** Keep upstream details behind a focused browser adapter. `GalleryClient` owns or reuses one Camoufox context, validates all caller input before launch, navigates the official gallery for feed markup, uses the gallery runtime's `skip` fragments for pagination, and requests exact metadata from `aigc.uploads.dev/docs/<id>.json`. Pure protocol helpers validate and normalize every boundary before public types or filesystem writes are produced.

**Verified transport correction:** Live Camoufox testing showed that top-level
gallery navigation redirects to the generator. Execution therefore opens the
official generator, activates its comments-and-gallery control, waits for the
embedded `image-generation.perchance.org/gallery` frame, and navigates that
frame to the requested feed URL before extraction or document/image fetches.

**Tech Stack:** TypeScript, Node.js 22, Camoufox/Playwright browser adapter, Commander, Node test runner.

---

## File Map

- Create `src/internal/galleryProtocol.ts`: constants, input validation, cursor encoding, URL construction, upstream record validation, item normalization, and trusted extension lookup.
- Create `src/internal/galleryBrowser.ts`: browser-evaluated feed extraction, fragment pagination, item-document fetch, and image fetch.
- Create `src/galleryClient.ts`: public lifecycle, `list`, `get`, `download`, injected-context handling, and owned-browser cleanup.
- Modify `src/types.ts`: public gallery option and result interfaces.
- Modify `src/errors.ts`: gallery not-found and protocol errors.
- Modify `src/index.ts`: public gallery exports.
- Modify `src/cli/program.ts`: `gallery list` and `gallery get`, argument parsing, JSON output, download destinations, and cleanup.
- Create `tests/galleryProtocol.test.ts`: pure validation, cursor, URL, normalization, and protocol-drift tests.
- Create `tests/galleryBrowser.test.ts`: browser adapter extraction, pagination, filtering, and image response tests with fake pages.
- Create `tests/galleryClient.test.ts`: client defaults, ownership, lookup, download, and failure cleanup.
- Modify `tests/cli.test.ts`: gallery command parsing, forwarding, serialization, downloads, and browser cleanup.
- Modify `tests/package.test.ts`: package export assertion.
- Modify `tests/integration.test.ts`: opt-in read-only live gallery smoke test.
- Modify `README.md`: library and CLI usage.
- Modify `package.json`: include the three new gallery unit-test files in the default test script.

### Task 1: Public Gallery Types And Errors

**Files:**

- Modify: `src/types.ts`
- Modify: `src/errors.ts`
- Test: `tests/galleryProtocol.test.ts`

- [ ] **Step 1: Add a failing public contract test**

Create `tests/galleryProtocol.test.ts` with an initial compile-time and runtime contract:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GalleryNotFoundError,
  GalleryProtocolError,
  PerchanceError,
} from "../src/errors.js";
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build`

Expected: TypeScript fails because the gallery types and error classes do not exist.

- [ ] **Step 3: Add the public types**

Append to `src/types.ts`:

```ts
export type GallerySort = "recent" | "top" | "trending";

export interface GalleryEntry {
  imageId: string;
  imageUrl: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  guidanceScale?: number;
  width?: number;
  height?: number;
  score?: number;
  createdAt?: string;
  channel: string;
  subChannel: string;
}

export interface GalleryPage {
  entries: GalleryEntry[];
  nextCursor?: string;
}

export interface GalleryListOptions {
  channel?: string;
  limit?: number;
  cursor?: string;
  sort?: GallerySort;
  timeRange?: string;
  contentFilter?: string;
}

export interface GalleryGetOptions {
  channel?: string;
  contentFilter?: string;
}
```

- [ ] **Step 4: Add the error classes**

Append to `src/errors.ts`:

```ts
export class GalleryNotFoundError extends PerchanceError {
  constructor(message: string) {
    super(message);
    this.name = "GalleryNotFoundError";
  }
}

export class GalleryProtocolError extends PerchanceError {
  constructor(message: string) {
    super(message);
    this.name = "GalleryProtocolError";
  }
}
```

- [ ] **Step 5: Run the contract test**

Run: `npm run build && node --test --test-concurrency=1 dist/tests/galleryProtocol.test.js`

Expected: one passing test.

- [ ] **Step 6: Commit the public contract**

Run: `git add src/types.ts src/errors.ts tests/galleryProtocol.test.ts && git commit -m "feat: define gallery public contracts"`

### Task 2: Gallery Protocol Validation And Normalization

**Files:**

- Create: `src/internal/galleryProtocol.ts`
- Modify: `tests/galleryProtocol.test.ts`

- [ ] **Step 1: Add failing validation and cursor tests**

Extend `tests/galleryProtocol.test.ts`:

```ts
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
    assert.throws(() => normalizeGetOptions({ contentFilter: "x".repeat(129) }), /content filter/);
  });

  it("accepts IDs and supported URLs only", () => {
    assert.equal(parseGalleryImageId(imageId), imageId);
    assert.equal(
      parseGalleryImageId(`https://aigc.uploads.dev/image/${imageId}.jpeg`),
      imageId,
    );
    assert.throws(() => parseGalleryImageId("http://example.com/image.png"), /supported/);
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
      width: 768,
      height: 512,
      score: 9,
      t: 1_725_000_000_000,
      nsfw: false,
      shocking: false,
      pg13Soft: false,
    }, "demo-channel");
    assert.equal(documentEntry.score, 9);
    assert.equal(documentEntry.createdAt, new Date(1_725_000_000_000).toISOString());
  });

  it("rejects protocol drift instead of dropping records", () => {
    assert.throws(
      () => normalizeFeedEntry({ imageId, imageUrl: "javascript:bad", prompt: 7 }, "demo"),
      GalleryProtocolError,
    );
    assert.throws(
      () => normalizeGalleryDocument({ id: imageId, channels: [] }, "demo"),
      GalleryProtocolError,
    );
  });

  it("derives extensions only from trusted image URLs", () => {
    assert.equal(
      trustedImageExtension(`https://aigc.uploads.dev/image/${imageId}.jpeg`),
      "jpeg",
    );
    assert.throws(() => trustedImageExtension("https://example.com/file.jpeg"), /image URL/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build`

Expected: TypeScript fails because `src/internal/galleryProtocol.ts` does not exist.

- [ ] **Step 3: Implement constants, option validation, and cursor encoding**

Create `src/internal/galleryProtocol.ts` with these exported boundaries:

```ts
import { GalleryNotFoundError, GalleryProtocolError } from "../errors.js";
import type {
  GalleryEntry,
  GalleryGetOptions,
  GalleryListOptions,
  GallerySort,
} from "../types.js";

export const DEFAULT_GALLERY_CHANNEL = "ai-text-to-image-generator";
export const GALLERY_ORIGIN = "https://image-generation.perchance.org";
export const GALLERY_URL = `${GALLERY_ORIGIN}/gallery`;
export const GALLERY_DOCUMENT_ORIGIN = "https://aigc.uploads.dev";
export const GALLERY_SUB_CHANNEL = "public";

const CHANNEL_PATTERN = /^[A-Za-z0-9_-]+$/;
const IMAGE_ID_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_PATH_PATTERN = /^\/image\/([a-f0-9]{64})\.(png|jpe?g|webp)$/;
const SORTS = new Set<GallerySort>(["recent", "top", "trending"]);
const MAX_FILTER_LENGTH = 128;
const MAX_TIME_RANGE_LENGTH = 64;

export interface NormalizedGalleryListOptions {
  channel: string;
  limit: number;
  skip: number;
  sort: GallerySort;
  timeRange: string;
  contentFilter: string;
}

export interface NormalizedGalleryGetOptions {
  channel: string;
  contentFilter: string;
}

function boundedString(name: string, value: string, maxLength: number): string {
  if (value.length === 0 || value.length > maxLength) {
    throw new TypeError(`${name} must contain between 1 and ${maxLength} characters.`);
  }
  return value;
}

export function validateGalleryChannel(channel: string): string {
  if (!CHANNEL_PATTERN.test(channel)) {
    throw new TypeError("Gallery channel must contain only ASCII letters, digits, underscores, and hyphens.");
  }
  return channel;
}

export function encodeGalleryCursor(skip: number): string {
  return Buffer.from(JSON.stringify({ v: 1, skip }), "utf8").toString("base64url");
}

export function decodeGalleryCursor(cursor: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.v !== 1 || !Number.isSafeInteger(parsed.skip) || (parsed.skip as number) < 0) {
      throw new Error("shape");
    }
    return parsed.skip as number;
  } catch {
    throw new TypeError("Invalid gallery cursor.");
  }
}

export function normalizeListOptions(options: GalleryListOptions = {}): NormalizedGalleryListOptions {
  const limit = options.limit ?? 20;
  const sort = options.sort ?? "recent";
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("Gallery limit must be an integer between 1 and 100.");
  }
  if (!SORTS.has(sort)) throw new TypeError("Gallery sort must be recent, top, or trending.");
  return {
    channel: validateGalleryChannel(options.channel ?? DEFAULT_GALLERY_CHANNEL),
    limit,
    skip: options.cursor === undefined ? 0 : decodeGalleryCursor(options.cursor),
    sort,
    timeRange: validateGalleryTimeRange(options.timeRange ?? (sort === "recent" ? "all-time" : "1-month")),
    contentFilter: validateGalleryContentFilter(options.contentFilter ?? "g"),
  };
}

export function normalizeGetOptions(options: GalleryGetOptions = {}): NormalizedGalleryGetOptions {
  return {
    channel: validateGalleryChannel(options.channel ?? DEFAULT_GALLERY_CHANNEL),
    contentFilter: validateGalleryContentFilter(options.contentFilter ?? "g"),
  };
}

export function validateGalleryContentFilter(value: string): string {
  return boundedString("Gallery content filter", value, MAX_FILTER_LENGTH);
}

export function validateGalleryTimeRange(value: string): string {
  return boundedString("Gallery time range", value, MAX_TIME_RANGE_LENGTH);
}

export function buildGalleryUrl(options: Pick<NormalizedGalleryListOptions, "channel" | "sort" | "timeRange" | "contentFilter">): string {
  const url = new URL(GALLERY_URL);
  url.searchParams.set("channel", options.channel);
  url.searchParams.set("subChannel", GALLERY_SUB_CHANNEL);
  url.searchParams.set("sort", options.sort);
  url.searchParams.set("timeRange", options.timeRange);
  url.searchParams.set("contentFilter", options.contentFilter);
  return url.href;
}
```

- [ ] **Step 4: Implement ID, URL, and upstream record validation**

Complete `src/internal/galleryProtocol.ts` with:

```ts
function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new GalleryProtocolError(`Gallery record has an invalid ${key}.`);
  }
  return value;
}

function optionalNumber(value: unknown, key: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new GalleryProtocolError(`Gallery record has an invalid ${key}.`);
  }
  return parsed;
}

function validateImageUrl(value: string, expectedImageId?: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GalleryProtocolError("Gallery record has an invalid image URL.");
  }
  const match = url.origin === GALLERY_DOCUMENT_ORIGIN && url.protocol === "https:"
    ? url.pathname.match(IMAGE_PATH_PATTERN)
    : null;
  if (!match || (expectedImageId !== undefined && match[1] !== expectedImageId)) {
    throw new GalleryProtocolError("Gallery record has an unsupported image URL.");
  }
  return url;
}

export function parseGalleryImageId(idOrUrl: string): string {
  if (IMAGE_ID_PATTERN.test(idOrUrl)) return idOrUrl;
  try {
    const url = new URL(idOrUrl);
    if (url.protocol !== "https:") throw new Error("scheme");
    const imageMatch = url.origin === GALLERY_DOCUMENT_ORIGIN
      ? url.pathname.match(IMAGE_PATH_PATTERN)
      : null;
    const galleryId = url.origin === GALLERY_ORIGIN
      ? url.searchParams.get("imageId")
      : null;
    const candidate = imageMatch?.[1] ?? galleryId;
    if (candidate && IMAGE_ID_PATTERN.test(candidate)) return candidate;
  } catch {
    // The single error below is the stable public validation result.
  }
  throw new TypeError("Expected a gallery image ID or supported HTTPS Perchance gallery URL.");
}

export function trustedImageExtension(imageUrl: string): string {
  const match = validateImageUrl(imageUrl).pathname.match(IMAGE_PATH_PATTERN);
  if (!match) throw new GalleryProtocolError("Gallery record has an invalid image URL.");
  return match[2].toLowerCase();
}

export function normalizeFeedEntry(value: unknown, channel: string): GalleryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GalleryProtocolError("Gallery feed record must be an object.");
  }
  const record = value as Record<string, unknown>;
  const imageId = requiredString(record, "imageId");
  if (!IMAGE_ID_PATTERN.test(imageId)) throw new GalleryProtocolError("Gallery record has an invalid imageId.");
  const imageUrl = validateImageUrl(requiredString(record, "imageUrl"), imageId).href;
  const entry: GalleryEntry = {
    imageId,
    imageUrl,
    prompt: requiredString(record, "prompt"),
    channel,
    subChannel: GALLERY_SUB_CHANNEL,
  };
  const optionalStrings = [["negativePrompt", "negativePrompt"]] as const;
  for (const [source, target] of optionalStrings) {
    if (record[source] !== undefined && typeof record[source] !== "string") {
      throw new GalleryProtocolError(`Gallery record has an invalid ${source}.`);
    }
    if (typeof record[source] === "string" && record[source] !== "") entry[target] = record[source];
  }
  for (const key of ["seed", "guidanceScale", "width", "height", "score"] as const) {
    const parsed = optionalNumber(record[key], key);
    if (parsed !== undefined) entry[key] = parsed;
  }
  return entry;
}

export function normalizeGalleryDocument(
  value: unknown,
  channel: string,
  contentFilter = "g",
): GalleryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GalleryProtocolError("Gallery item document must be an object.");
  }
  const record = value as Record<string, unknown>;
  const imageId = requiredString(record, "id");
  const channels = record.channels;
  if (!IMAGE_ID_PATTERN.test(imageId) || !Array.isArray(channels) || !channels.every(item => typeof item === "string")) {
    throw new GalleryProtocolError("Gallery item document has invalid identity metadata.");
  }
  if (!channels.includes(channel)) throw new GalleryNotFoundError(`Gallery image ${imageId} is not available in channel ${channel}.`);
  if (typeof record.nsfw !== "boolean" || typeof record.shocking !== "boolean" || typeof record.pg13Soft !== "boolean") {
    throw new GalleryProtocolError("Gallery item document has invalid content metadata.");
  }
  if ((contentFilter === "g" && (record.nsfw || record.shocking || record.pg13Soft)) ||
      (contentFilter === "pg13" && (record.nsfw || record.shocking))) {
    throw new GalleryNotFoundError(`Gallery image ${imageId} is unavailable under content filter ${contentFilter}.`);
  }
  const ext = requiredString(record, "ext").toLowerCase();
  const entry = normalizeFeedEntry({
    imageId,
    imageUrl: `${GALLERY_DOCUMENT_ORIGIN}/image/${imageId}.${ext}`,
    prompt: record.prompt,
    negativePrompt: record.negativePrompt,
    seed: record.seed,
    guidanceScale: record.guidanceScale,
    width: record.width,
    height: record.height,
    score: record.score,
  }, channel);
  const timestamp = optionalNumber(record.t, "t");
  if (timestamp !== undefined) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) throw new GalleryProtocolError("Gallery item document has an invalid timestamp.");
    entry.createdAt = date.toISOString();
  }
  return entry;
}
```

- [ ] **Step 5: Run protocol tests**

Run: `npm run build && node --test --test-concurrency=1 dist/tests/galleryProtocol.test.js`

Expected: all gallery protocol tests pass.

- [ ] **Step 6: Commit the protocol boundary**

Run: `git add src/internal/galleryProtocol.ts tests/galleryProtocol.test.ts && git commit -m "feat: validate gallery protocol data"`

### Task 3: Browser-Backed Gallery Adapter

**Files:**

- Create: `src/internal/galleryBrowser.ts`
- Create: `tests/galleryBrowser.test.ts`

- [ ] **Step 1: Add failing browser adapter tests**

Create `tests/galleryBrowser.test.ts` with a fake `BrowserPage` whose `evaluate` method records the serialized request and returns fixtures:

```ts
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
    async content() { return ""; },
    async evaluate(_fn, ...args) {
      calls.push(args);
      return results.shift() as never;
    },
    frames() { return []; },
    url() { return "https://image-generation.perchance.org/gallery"; },
    on() {},
    async waitForTimeout() {},
    async close() {},
    async exposeFunction() {},
  };
}

describe("gallery browser adapter", () => {
  it("returns structured feed records and continuation state", async () => {
    const page = fakePage([{ records: [{ imageId: "a".repeat(64) }], consumed: 1, hasMore: true }]);
    const result = await readGalleryFeed(page, { startSkip: 20, limit: 1 });
    assert.equal(result.consumed, 1);
    assert.equal(result.hasMore, true);
    assert.deepEqual(page.calls[0][0], { startSkip: 20, limit: 1 });
  });

  it("returns status, final URL, content type, and parsed item body", async () => {
    const id = "b".repeat(64);
    const page = fakePage([{ status: 200, finalUrl: `https://aigc.uploads.dev/docs/${id}.json`, contentType: "application/json", body: { id } }]);
    const result = await fetchGalleryDocument(page, id);
    assert.equal(result.status, 200);
    assert.equal((result.body as { id: string }).id, id);
  });

  it("returns validated image transport metadata", async () => {
    const page = fakePage([{ status: 200, finalUrl: "https://aigc.uploads.dev/image/x.jpeg", contentType: "image/jpeg", data: "AQID" }]);
    const result = await fetchGalleryImage(page, "https://aigc.uploads.dev/image/x.jpeg");
    assert.equal(result.data, "AQID");
  });
});
```

- [ ] **Step 2: Run the build to verify it fails**

Run: `npm run build`

Expected: TypeScript fails because `src/internal/galleryBrowser.ts` does not exist.

- [ ] **Step 3: Implement structured feed extraction and fragment pagination**

Create `src/internal/galleryBrowser.ts`. `readGalleryFeed` must execute one browser function that uses only `.imageCtn` attributes and its child image source:

```ts
import type { BrowserPage } from "../generator.js";
import { GALLERY_DOCUMENT_ORIGIN } from "./galleryProtocol.js";

export interface RawGalleryFeedPage {
  records: unknown[];
  consumed: number;
  hasMore: boolean;
}

interface BrowserFetchResult {
  status: number;
  finalUrl: string;
  contentType: string;
  body: unknown;
}

export interface BrowserImageResult {
  status: number;
  finalUrl: string;
  contentType: string;
  data: string;
}

export async function readGalleryFeed(
  page: BrowserPage,
  request: { startSkip: number; limit: number },
): Promise<RawGalleryFeedPage> {
  return await page.evaluate(async ({ startSkip, limit }) => {
    function recordFromElement(element: Element): Record<string, unknown> {
      const container = element as HTMLElement;
      const image = container.querySelector("img");
      const ratio = image instanceof HTMLImageElement
        ? image.style.aspectRatio.split("/").map(part => Number(part.trim()))
        : [];
      return {
        imageId: container.dataset.imageId,
        imageUrl: image instanceof HTMLImageElement ? image.src : undefined,
        prompt: container.dataset.prompt,
        negativePrompt: container.dataset.negativePrompt,
        seed: container.dataset.seed,
        guidanceScale: container.dataset.guidanceScale,
        width: ratio[0],
        height: ratio[1],
      };
    }

    function extract(root: ParentNode): Record<string, unknown>[] {
      return Array.from(root.querySelectorAll(".imageCtn"), recordFromElement);
    }

    const initial = extract(document.querySelector("#main") ?? document);
    const pageSize = initial.length;
    const records: Record<string, unknown>[] = [];
    let offset = startSkip;
    let lastBatchCount = pageSize;

    if (startSkip === 0) records.push(...initial.slice(0, limit));
    while (records.length < limit && pageSize > 0) {
      if (startSkip === 0 && offset === 0) offset = initial.length;
      const url = new URL(window.location.href);
      url.searchParams.set("imageElementsHtmlOnly", "true");
      url.searchParams.set("skip", String(offset));
      const response = await fetch(url.href, { redirect: "error" });
      if (!response.ok || new URL(response.url).origin !== window.location.origin) {
        throw new Error(`Gallery fragment request failed with ${response.status}.`);
      }
      const wrapper = document.createElement("div");
      wrapper.innerHTML = await response.text();
      const batch = extract(wrapper);
      lastBatchCount = batch.length;
      records.push(...batch.slice(0, limit - records.length));
      offset += batch.length;
      if (batch.length < pageSize) break;
    }

    return {
      records,
      consumed: records.length,
      hasMore: pageSize > 0 && (records.length < (startSkip === 0 ? initial.length : 0) || lastBatchCount === pageSize),
    };
  }, request);
}
```

Keep `hasMore` deterministic with these assertions in
`tests/galleryBrowser.test.ts`:

```ts
it("reports more data when the requested limit truncates the initial batch", async () => {
  const page = fakePage([{ records: [{}, {}], consumed: 1, hasMore: true }]);
  assert.equal((await readGalleryFeed(page, { startSkip: 0, limit: 1 })).hasMore, true);
});

it("reports more data when a fetched batch equals the observed page size", async () => {
  const page = fakePage([{ records: [{}, {}], consumed: 2, hasMore: true }]);
  assert.equal((await readGalleryFeed(page, { startSkip: 20, limit: 2 })).hasMore, true);
});

it("reports exhaustion when a fetched batch is shorter than the observed page size", async () => {
  const page = fakePage([{ records: [{}], consumed: 1, hasMore: false }]);
  assert.equal((await readGalleryFeed(page, { startSkip: 20, limit: 2 })).hasMore, false);
});
```

- [ ] **Step 4: Implement item and image fetch helpers**

Complete `src/internal/galleryBrowser.ts`:

```ts
export async function fetchGalleryDocument(
  page: BrowserPage,
  imageId: string,
): Promise<BrowserFetchResult> {
  const url = `${GALLERY_DOCUMENT_ORIGIN}/docs/${imageId}.json`;
  return await page.evaluate(async (documentUrl) => {
    const response = await fetch(documentUrl, { redirect: "follow" });
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown = null;
    if (contentType.toLowerCase().includes("application/json")) {
      body = await response.json();
    } else {
      await response.text();
    }
    return { status: response.status, finalUrl: response.url, contentType, body };
  }, url);
}

export async function fetchGalleryImage(
  page: BrowserPage,
  imageUrl: string,
): Promise<BrowserImageResult> {
  return await page.evaluate(async (url) => {
    const response = await fetch(url, { redirect: "follow" });
    const blob = await response.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.readAsDataURL(blob);
    });
    return {
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type") ?? "",
      data,
    };
  }, imageUrl);
}
```

- [ ] **Step 5: Run browser adapter tests**

Run: `npm run build && node --test --test-concurrency=1 dist/tests/galleryBrowser.test.js`

Expected: all gallery browser adapter tests pass without launching a browser.

- [ ] **Step 6: Commit the browser adapter**

Run: `git add src/internal/galleryBrowser.ts tests/galleryBrowser.test.ts && git commit -m "feat: add browser gallery transport"`

### Task 4: Gallery Client Listing And Item Lookup

**Files:**

- Create: `src/galleryClient.ts`
- Create: `tests/galleryClient.test.ts`

- [ ] **Step 1: Add failing lifecycle, list, and get tests**

Create `tests/galleryClient.test.ts` with these deterministic fake contexts and
pages, followed by the lifecycle cases below:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GalleryClient } from "../src/galleryClient.js";
import { GalleryNotFoundError, GalleryProtocolError } from "../src/errors.js";
import type { BrowserContext, BrowserPage } from "../src/generator.js";

const imageId = "c".repeat(64);

interface FakeGalleryPageConfig {
  feed?: { records: unknown[]; consumed: number; hasMore: boolean };
  document?: { status: number; finalUrl: string; contentType: string; body: unknown };
  image?: { status: number; finalUrl: string; contentType: string; data: string };
}

function makeGalleryPage(config: FakeGalleryPageConfig): BrowserPage & {
  gotos: string[];
  closes: number;
} {
  return {
    gotos: [],
    closes: 0,
    async goto(url) { this.gotos.push(url); },
    async content() { return ""; },
    async evaluate(_fn, argument) {
      if (typeof argument === "object" && argument !== null && "startSkip" in argument) {
        if (!config.feed) throw new Error("missing feed fixture");
        return config.feed as never;
      }
      if (typeof argument === "string" && argument.includes("/docs/")) {
        if (!config.document) throw new Error("missing document fixture");
        return config.document as never;
      }
      if (typeof argument === "string" && argument.includes("/image/")) {
        if (!config.image) throw new Error("missing image fixture");
        return config.image as never;
      }
      throw new Error(`unexpected browser argument: ${String(argument)}`);
    },
    frames() { return []; },
    url() { return this.gotos.at(-1) ?? "about:blank"; },
    on() {},
    async waitForTimeout() {},
    async close() { this.closes += 1; },
    async exposeFunction() {},
  };
}

function contextWithPage(page: BrowserPage): BrowserContext & { closes: number } {
  return {
    closes: 0,
    async newPage() { return page; },
    async close() { this.closes += 1; },
  };
}

it("validates options before launching an owned browser", async () => {
  let launches = 0;
  const client = new GalleryClient({
    launchBrowser: async () => {
      launches += 1;
      throw new Error("must not launch");
    },
  });
  await assert.rejects(client.list({ limit: 0 }), /between 1 and 100/);
  assert.equal(launches, 0);
});

it("lists normalized entries and returns an opaque next cursor", async () => {
  const page = makeGalleryPage({
    feed: {
      records: [{
        imageId,
        imageUrl: `https://aigc.uploads.dev/image/${imageId}.jpeg`,
        prompt: "gallery prompt",
      }],
      consumed: 1,
      hasMore: true,
    },
  });
  const context = contextWithPage(page);
  const client = new GalleryClient({ browserContext: context });
  const result = await client.list({ limit: 1 });
  assert.equal(result.entries[0].prompt, "gallery prompt");
  assert.ok(result.nextCursor);
  await client.close();
  assert.equal(context.closes, 0);
});

it("retrieves an exact item document without scanning feed pages", async () => {
  const page = makeGalleryPage({
    document: {
      status: 200,
      finalUrl: `https://aigc.uploads.dev/docs/${imageId}.json`,
      contentType: "application/json",
      body: {
        id: imageId,
        ext: "jpeg",
        channels: ["ai-text-to-image-generator"],
        prompt: "exact prompt",
        nsfw: false,
        shocking: false,
        pg13Soft: false,
      },
    },
  });
  const client = new GalleryClient({ browserContext: contextWithPage(page) });
  assert.equal((await client.get(imageId)).prompt, "exact prompt");
});

it("maps a missing item to GalleryNotFoundError", async () => {
  const page = makeGalleryPage({ document: { status: 404, finalUrl: `https://aigc.uploads.dev/docs/${imageId}.json`, contentType: "application/json", body: null } });
  const client = new GalleryClient({ browserContext: contextWithPage(page) });
  await assert.rejects(client.get(imageId), GalleryNotFoundError);
});

it("closes an owned browser once after protocol failure", async () => {
  const context = contextWithPage(makeGalleryPage({ feed: { records: [{ broken: true }], consumed: 1, hasMore: false } }));
  const client = new GalleryClient({ launchBrowser: async () => context });
  await assert.rejects(client.list(), GalleryProtocolError);
  await client.close();
  await client.close();
  assert.equal(context.closes, 1);
});
```

- [ ] **Step 2: Run the build to verify it fails**

Run: `npm run build`

Expected: TypeScript fails because `src/galleryClient.ts` does not exist.

- [ ] **Step 3: Implement browser ownership and listing**

Create `src/galleryClient.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { launchCamoufox } from "./camoufox.js";
import { ConnectionError, GalleryNotFoundError, GalleryProtocolError } from "./errors.js";
import type { BrowserContext } from "./generator.js";
import {
  fetchGalleryDocument,
  fetchGalleryImage,
  readGalleryFeed,
} from "./internal/galleryBrowser.js";
import {
  buildGalleryUrl,
  encodeGalleryCursor,
  GALLERY_DOCUMENT_ORIGIN,
  normalizeFeedEntry,
  normalizeGalleryDocument,
  normalizeGetOptions,
  normalizeListOptions,
  parseGalleryImageId,
} from "./internal/galleryProtocol.js";
import type {
  GalleryEntry,
  GalleryGetOptions,
  GalleryListOptions,
  GalleryPage,
} from "./types.js";

export interface GalleryClientOptions {
  browserContext?: BrowserContext;
  launchBrowser?: () => Promise<BrowserContext>;
}

export class GalleryClient {
  private context: BrowserContext | null;
  private readonly launchBrowser: () => Promise<BrowserContext>;
  private ownsContext: boolean;
  private closePromise: Promise<void> | null = null;

  constructor(options: GalleryClientOptions = {}) {
    this.context = options.browserContext ?? null;
    this.ownsContext = false;
    this.launchBrowser = options.launchBrowser ?? (() => launchCamoufox({ headless: true }));
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    this.context = await this.launchBrowser();
    this.ownsContext = true;
    return this.context;
  }

  async list(options: GalleryListOptions = {}): Promise<GalleryPage> {
    const normalized = normalizeListOptions(options);
    const context = await this.ensureContext();
    const page = await context.newPage();
    try {
      await page.goto(buildGalleryUrl(normalized), { waitUntil: "domcontentloaded", timeout: 30_000 });
      const raw = await readGalleryFeed(page, { startSkip: normalized.skip, limit: normalized.limit });
      if (!Array.isArray(raw.records) || raw.consumed !== raw.records.length || typeof raw.hasMore !== "boolean") {
        throw new GalleryProtocolError("Gallery feed returned invalid pagination state.");
      }
      const result: GalleryPage = {
        entries: raw.records.map(record => normalizeFeedEntry(record, normalized.channel)),
      };
      if (raw.hasMore && raw.consumed > 0) {
        result.nextCursor = encodeGalleryCursor(normalized.skip + raw.consumed);
      }
      return result;
    } finally {
      await page.close();
    }
  }
```

- [ ] **Step 4: Implement exact item lookup and idempotent close**

Complete `src/galleryClient.ts`:

```ts
  async get(idOrUrl: string, options: GalleryGetOptions = {}): Promise<GalleryEntry> {
    const imageId = parseGalleryImageId(idOrUrl);
    const normalized = normalizeGetOptions(options);
    const context = await this.ensureContext();
    const page = await context.newPage();
    try {
      await page.goto(buildGalleryUrl({
        channel: normalized.channel,
        sort: "recent",
        timeRange: "all-time",
        contentFilter: normalized.contentFilter,
      }), { waitUntil: "domcontentloaded", timeout: 30_000 });
      const response = await fetchGalleryDocument(page, imageId);
      const expectedUrl = `${GALLERY_DOCUMENT_ORIGIN}/docs/${imageId}.json`;
      if (response.status === 404) throw new GalleryNotFoundError(`Gallery image ${imageId} was not found.`);
      if (response.status < 200 || response.status >= 300) {
        throw new ConnectionError(`Gallery item request failed with status ${response.status}.`);
      }
      if (response.finalUrl !== expectedUrl || !response.contentType.toLowerCase().includes("application/json")) {
        throw new GalleryProtocolError("Gallery item response used an unsupported origin or content type.");
      }
      const entry = normalizeGalleryDocument(
        response.body,
        normalized.channel,
        normalized.contentFilter,
      );
      if (entry.imageId !== imageId) throw new GalleryProtocolError("Gallery item response ID did not match the request.");
      return entry;
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (!this.ownsContext || !this.context) return;
    this.closePromise ??= this.context.close().finally(() => {
      this.context = null;
      this.ownsContext = false;
    });
    await this.closePromise;
  }
}
```

- [ ] **Step 5: Run client listing and lookup tests**

Run: `npm run build && node --test --test-concurrency=1 dist/tests/galleryProtocol.test.js dist/tests/galleryBrowser.test.js dist/tests/galleryClient.test.js`

Expected: all gallery tests pass.

- [ ] **Step 6: Commit the client read API**

Run: `git add src/galleryClient.ts tests/galleryClient.test.ts && git commit -m "feat: retrieve gallery feeds and items"`

### Task 5: Validated Gallery Downloads

**Files:**

- Modify: `src/galleryClient.ts`
- Modify: `tests/galleryClient.test.ts`

- [ ] **Step 1: Add failing download tests**

Extend `tests/galleryClient.test.ts` to cover:

```ts
it("downloads a trusted image and creates its parent directory", async () => {
  const writes: Array<{ path: string; data: Buffer }> = [];
  const directories: string[] = [];
  const page = makeGalleryPage({
    image: {
      status: 200,
      finalUrl: `https://aigc.uploads.dev/image/${imageId}.jpeg`,
      contentType: "image/jpeg",
      data: Buffer.from("image bytes").toString("base64"),
    },
  });
  const client = new GalleryClient({
    browserContext: contextWithPage(page),
    mkdir: async path => { directories.push(path); },
    writeFile: async (path, data) => { writes.push({ path, data }); },
  });
  const destination = "/tmp/gallery/item.jpeg";
  assert.equal(await client.download({
    imageId,
    imageUrl: `https://aigc.uploads.dev/image/${imageId}.jpeg`,
    prompt: "prompt",
    channel: "ai-text-to-image-generator",
    subChannel: "public",
  }, destination), destination);
  assert.deepEqual(directories, ["/tmp/gallery"]);
  assert.equal(writes[0].data.toString(), "image bytes");
});

it("rejects non-image download responses without writing", async () => {
  const page = makeGalleryPage({ image: { status: 200, finalUrl: "https://aigc.uploads.dev/image/x.jpeg", contentType: "text/html", data: "" } });
  const client = new GalleryClient({ browserContext: contextWithPage(page) });
  await assert.rejects(client.download(validEntry, "/tmp/x.jpeg"), GalleryProtocolError);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npm run build`

Expected: TypeScript fails because `GalleryClientOptions` does not accept filesystem injection and `download` is missing.

- [ ] **Step 3: Add injectable filesystem dependencies**

Change `GalleryClientOptions` and constructor state in `src/galleryClient.ts`:

```ts
export interface GalleryClientOptions {
  browserContext?: BrowserContext;
  launchBrowser?: () => Promise<BrowserContext>;
  mkdir?: (path: string) => Promise<void>;
  writeFile?: (path: string, data: Buffer) => Promise<void>;
}

private readonly makeDirectory: (path: string) => Promise<void>;
private readonly saveFile: (path: string, data: Buffer) => Promise<void>;

this.makeDirectory = options.mkdir ?? (path => mkdir(path, { recursive: true }));
this.saveFile = options.writeFile ?? ((path, data) => writeFile(path, data));
```

- [ ] **Step 4: Implement browser-session download validation**

Add to `GalleryClient` before `close()`:

```ts
  async download(entry: GalleryEntry, destination: string): Promise<string> {
    const normalizedEntry = normalizeFeedEntry(entry, entry.channel);
    const context = await this.ensureContext();
    const page = await context.newPage();
    const finalPath = resolve(destination);
    try {
      await page.goto(buildGalleryUrl({
        channel: normalizedEntry.channel,
        sort: "recent",
        timeRange: "all-time",
        contentFilter: "g",
      }), { waitUntil: "domcontentloaded", timeout: 30_000 });
      const response = await fetchGalleryImage(page, normalizedEntry.imageUrl);
      if (response.status < 200 || response.status >= 300) {
        throw new ConnectionError(`Gallery image request failed with status ${response.status}.`);
      }
      const finalEntry = normalizeFeedEntry({ ...normalizedEntry, imageUrl: response.finalUrl }, normalizedEntry.channel);
      if (finalEntry.imageId !== normalizedEntry.imageId || !response.contentType.toLowerCase().startsWith("image/")) {
        throw new GalleryProtocolError("Gallery image response used an unsupported URL or content type.");
      }
      const data = Buffer.from(response.data, "base64");
      if (data.length === 0) throw new GalleryProtocolError("Gallery image response was empty.");
      await this.makeDirectory(dirname(finalPath));
      await this.saveFile(finalPath, data);
      return finalPath;
    } finally {
      await page.close();
    }
  }
```

- [ ] **Step 5: Run download tests**

Run: `npm run build && node --test --test-concurrency=1 dist/tests/galleryClient.test.js`

Expected: all client tests pass, including MIME, redirect, empty-body, parent-directory, and page-cleanup cases.

- [ ] **Step 6: Commit download support**

Run: `git add src/galleryClient.ts tests/galleryClient.test.ts && git commit -m "feat: download gallery images safely"`

### Task 6: Public Package Exports

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/package.test.ts`

- [ ] **Step 1: Add a failing package export assertion**

Extend the first test in `tests/package.test.ts`:

```ts
assert.equal(typeof publicApi.GalleryClient, "function");
assert.equal(typeof publicApi.GalleryNotFoundError, "function");
assert.equal(typeof publicApi.GalleryProtocolError, "function");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test --test-concurrency=1 dist/tests/package.test.js`

Expected: failure because `GalleryClient` is not exported from the package entry point.

- [ ] **Step 3: Export the gallery API**

Add to `src/index.ts`:

```ts
export { GalleryClient } from "./galleryClient.js";
export type { GalleryClientOptions } from "./galleryClient.js";
export {
  GalleryNotFoundError,
  GalleryProtocolError,
} from "./errors.js";
export type {
  GalleryEntry,
  GalleryGetOptions,
  GalleryListOptions,
  GalleryPage,
  GallerySort,
} from "./types.js";
```

- [ ] **Step 4: Run package tests**

Run: `npm run build && node --test --test-concurrency=1 dist/tests/package.test.js`

Expected: all package tests pass.

- [ ] **Step 5: Commit package exports**

Run: `git add src/index.ts tests/package.test.ts && git commit -m "feat: export gallery client API"`

### Task 7: Gallery CLI Commands

**Files:**

- Modify: `src/cli/program.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Extend CLI fakes and add failing help/validation tests**

Import `GalleryEntry`, `GalleryGetOptions`, `GalleryListOptions`, and
`GalleryPage` from `src/types.ts`. Add these fields to `FakeState`:

```ts
galleryListCalls: GalleryListOptions[];
galleryGetCalls: Array<{ idOrUrl: string; options: GalleryGetOptions }>;
galleryDownloadCalls: Array<{ entry: GalleryEntry; destination: string }>;
galleryCloseCalls: number;
galleryPage: GalleryPage;
galleryEntry: GalleryEntry;
galleryError?: Error;
galleryDownloadError?: Error;
```

Initialize them in `createFakeDependencies` with one stable entry:

```ts
const galleryEntry: GalleryEntry = {
  imageId: "d".repeat(64),
  imageUrl: `https://aigc.uploads.dev/image/${"d".repeat(64)}.jpeg`,
  prompt: "gallery prompt",
  channel: "ai-text-to-image-generator",
  subChannel: "public",
};

galleryListCalls: [],
galleryGetCalls: [],
galleryDownloadCalls: [],
galleryCloseCalls: 0,
galleryPage: { entries: [galleryEntry], nextCursor: "next-cursor" },
galleryEntry,
```

Add this dependency implementation beside `createTextGenerator`:

```ts
createGalleryClient() {
  return {
    async list(options) {
      state.galleryListCalls.push(options);
      if (state.galleryError) throw state.galleryError;
      return state.galleryPage;
    },
    async get(idOrUrl, options) {
      state.galleryGetCalls.push({ idOrUrl, options });
      if (state.galleryError) throw state.galleryError;
      return state.galleryEntry;
    },
    async download(entry, destination) {
      state.galleryDownloadCalls.push({ entry, destination });
      if (state.galleryDownloadError) throw state.galleryDownloadError;
      return destination;
    },
    async close() {
      state.galleryCloseCalls += 1;
    },
  };
},
```

Extend the command-surface test and add two parsing tests:

```ts
assert.match(dependencies.state.stdout, /gallery/);

const invalidLimitStatus = await runCli(
  ["node", "perchance", "gallery", "list", "--limit", "101"],
  dependencies,
);
assert.equal(invalidLimitStatus, 1);
assert.equal(dependencies.state.launchCalls.length, 0);

const invalidIdStatus = await runCli(
  ["node", "perchance", "gallery", "get", "not-an-id"],
  dependencies,
);
assert.equal(invalidIdStatus, 1);
assert.equal(dependencies.state.launchCalls.length, 0);
```

- [ ] **Step 2: Run CLI tests to verify they fail**

Run: `npm run build && node --test --test-concurrency=1 dist/tests/cli.test.js`

Expected: help lacks gallery commands and gallery arguments are rejected as unknown commands.

- [ ] **Step 3: Add CLI client contracts and parsers**

Add to `src/cli/program.ts`:

```ts
import { GalleryClient } from "../galleryClient.js";
import {
  decodeGalleryCursor,
  parseGalleryImageId,
  trustedImageExtension,
  validateGalleryChannel,
  validateGalleryContentFilter,
  validateGalleryTimeRange,
} from "../internal/galleryProtocol.js";
import type {
  GalleryEntry,
  GalleryGetOptions,
  GalleryListOptions,
  GalleryPage,
  GallerySort,
} from "../types.js";

export interface GalleryClientLike {
  list(options: GalleryListOptions): Promise<GalleryPage>;
  get(idOrUrl: string, options: GalleryGetOptions): Promise<GalleryEntry>;
  download(entry: GalleryEntry, destination: string): Promise<string>;
  close(): Promise<void>;
}

// Add to CliDependencies:
createGalleryClient(context: BrowserContext): GalleryClientLike;

// Add to productionDependencies:
createGalleryClient: context => new GalleryClient({ browserContext: context }),

function parseGalleryLimit(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 100) throw new InvalidArgumentError("Expected at most 100 gallery entries.");
  return parsed;
}

function parseGallerySort(value: string): GallerySort {
  if (value !== "recent" && value !== "top" && value !== "trending") {
    throw new InvalidArgumentError("Expected recent, top, or trending.");
  }
  return value;
}

function parseGalleryId(value: string): string {
  try {
    parseGalleryImageId(value);
    return value;
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
  }
}

function commanderValue<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
  }
}

function parseGalleryChannel(value: string): string {
  return commanderValue(() => validateGalleryChannel(value));
}

function parseGalleryContentFilter(value: string): string {
  return commanderValue(() => validateGalleryContentFilter(value));
}

function parseGalleryTimeRange(value: string): string {
  return commanderValue(() => validateGalleryTimeRange(value));
}

function parseGalleryCursor(value: string): string {
  commanderValue(() => decodeGalleryCursor(value));
  return value;
}
```

- [ ] **Step 4: Add deterministic gallery output resolvers**

Add these helpers to `src/cli/program.ts`:

```ts
async function resolveGalleryDirectory(
  requested: string | undefined,
  dependencies: CliDependencies,
): Promise<string> {
  const directory = requested
    ? absolutePath(requested, dependencies)
    : join(dependencies.cwd(), "gallery_images");
  await dependencies.mkdir(directory);
  return directory;
}

async function availableGalleryPath(
  directory: string,
  generatedName: string,
  dependencies: CliDependencies,
): Promise<string> {
  const extension = extname(generatedName);
  const stem = extension ? generatedName.slice(0, -extension.length) : generatedName;
  let candidate = join(directory, generatedName);
  for (let suffix = 2; await dependencies.pathExists(candidate); suffix += 1) {
    candidate = join(directory, `${stem}-${suffix}${extension}`);
  }
  return candidate;
}

async function resolveGalleryGetOutput(
  requested: string | undefined,
  entry: GalleryEntry,
  dependencies: CliDependencies,
): Promise<string> {
  const generatedName = `${entry.imageId}.${trustedImageExtension(entry.imageUrl)}`;
  if (!requested) {
    const directory = await resolveGalleryDirectory(undefined, dependencies);
    return await availableGalleryPath(directory, generatedName, dependencies);
  }
  const destination = absolutePath(requested, dependencies);
  if (/\.(?:png|jpe?g|webp)$/i.test(destination)) {
    await dependencies.mkdir(dirname(destination));
    return destination;
  }
  await dependencies.mkdir(destination);
  return await availableGalleryPath(destination, generatedName, dependencies);
}
```

- [ ] **Step 5: Implement `gallery list` and `gallery get`**

Add `addGalleryCommand` before `addBrowserCommand` and register it in `runCli`:

```ts
function addGalleryCommand(program: Command, dependencies: CliDependencies): void {
  const gallery = program.command("gallery").description("Retrieve public gallery images and prompts");

  gallery.command("list")
    .description("List public gallery entries")
    .option("--channel <name>", "gallery channel", parseGalleryChannel, "ai-text-to-image-generator")
    .option("--content-filter <value>", "gallery content filter", parseGalleryContentFilter, "g")
    .option("--limit <number>", "number of entries", parseGalleryLimit, 20)
    .option("--cursor <value>", "opaque continuation cursor", parseGalleryCursor)
    .option("--sort <value>", "recent, top, or trending", parseGallerySort, "recent")
    .option("--time-range <value>", "gallery time range", parseGalleryTimeRange)
    .option("--download", "download returned images")
    .option("-o, --output <path>", "download directory")
    .option("--visible", "show the Camoufox window")
    .action(async (options) => {
      await withBrowserContext(dependencies, options.visible, async context => {
        const client = dependencies.createGalleryClient(context);
        try {
          const page = await client.list({
            channel: options.channel,
            contentFilter: options.contentFilter,
            limit: options.limit,
            cursor: options.cursor,
            sort: options.sort,
            timeRange: options.timeRange,
          });
          let output: Array<GalleryEntry & { filePath?: string }> = page.entries.map(entry => ({ ...entry }));
          if (options.download) {
            const directory = await resolveGalleryDirectory(options.output, dependencies);
            output = [];
            for (const entry of page.entries) {
              const generatedName = `${entry.imageId}.${trustedImageExtension(entry.imageUrl)}`;
              const destination = await availableGalleryPath(directory, generatedName, dependencies);
              output.push({ ...entry, filePath: await client.download(entry, destination) });
            }
          }
          dependencies.stdout(`${JSON.stringify({ entries: output, nextCursor: page.nextCursor })}\n`);
        } finally {
          await client.close();
        }
      });
    });

  gallery.command("get")
    .description("Retrieve one public gallery entry")
    .argument("<id-or-url>", "gallery image ID or supported URL", parseGalleryId)
    .option("--channel <name>", "gallery channel", parseGalleryChannel, "ai-text-to-image-generator")
    .option("--content-filter <value>", "gallery content filter", parseGalleryContentFilter, "g")
    .option("--download", "download the returned image")
    .option("-o, --output <path>", "destination file or directory")
    .option("--visible", "show the Camoufox window")
    .action(async (idOrUrl, options) => {
      await withBrowserContext(dependencies, options.visible, async context => {
        const client = dependencies.createGalleryClient(context);
        try {
          const entry = await client.get(idOrUrl, { channel: options.channel, contentFilter: options.contentFilter });
          const output: GalleryEntry & { filePath?: string } = { ...entry };
          if (options.download) {
            output.filePath = await client.download(entry, await resolveGalleryGetOutput(options.output, entry, dependencies));
          }
          dependencies.stdout(`${JSON.stringify(output)}\n`);
        } finally {
          await client.close();
        }
      });
    });
}
```

Register with `addGalleryCommand(program, dependencies);` between text and browser
commands. Commander parsers must validate limit, sort, ID, channel, content
filter, time range, and cursor before `withBrowserContext` launches Camoufox.

- [ ] **Step 6: Add successful list/get/download/error/cleanup tests**

Import `encodeGalleryCursor` from `src/internal/galleryProtocol.ts`, then add
these complete tests to `tests/cli.test.ts`:

```ts
describe("gallery commands", () => {
  it("lists entries with defaults as one gallery-page object", async () => {
    const dependencies = createFakeDependencies();
    const status = await runCli(["node", "perchance", "gallery", "list"], dependencies);

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.galleryListCalls, [{
      channel: "ai-text-to-image-generator",
      contentFilter: "g",
      limit: 20,
      cursor: undefined,
      sort: "recent",
      timeRange: undefined,
    }]);
    assert.deepEqual(JSON.parse(dependencies.state.stdout), {
      entries: dependencies.state.galleryPage.entries,
      nextCursor: "next-cursor",
    });
    assert.equal(dependencies.state.galleryCloseCalls, 1);
    assert.equal(dependencies.state.browserCloseCalls, 1);
  });

  it("forwards explicit list options", async () => {
    const dependencies = createFakeDependencies();
    const cursor = encodeGalleryCursor(2);
    const status = await runCli([
      "node", "perchance", "gallery", "list",
      "--channel", "demo-channel",
      "--limit", "2",
      "--cursor", cursor,
      "--sort", "top",
      "--time-range", "1-week",
    ], dependencies);

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.galleryListCalls[0], {
      channel: "demo-channel",
      contentFilter: "g",
      limit: 2,
      cursor,
      sort: "top",
      timeRange: "1-week",
    });
  });

  it("retrieves an item by supported URL", async () => {
    const dependencies = createFakeDependencies();
    const url = dependencies.state.galleryEntry.imageUrl;
    const status = await runCli(["node", "perchance", "gallery", "get", url], dependencies);

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.galleryGetCalls, [{
      idOrUrl: url,
      options: { channel: "ai-text-to-image-generator", contentFilter: "g" },
    }]);
    assert.deepEqual(JSON.parse(dependencies.state.stdout), dependencies.state.galleryEntry);
  });

  it("downloads list entries with collision-safe deterministic names", async () => {
    const dependencies = createFakeDependencies();
    const initial = `/work/gallery_images/${dependencies.state.galleryEntry.imageId}.jpeg`;
    dependencies.state.existingDirectories.add(initial);
    const status = await runCli([
      "node", "perchance", "gallery", "list", "--download",
    ], dependencies);

    assert.equal(status, 0);
    assert.equal(
      dependencies.state.galleryDownloadCalls[0].destination,
      `/work/gallery_images/${dependencies.state.galleryEntry.imageId}-2.jpeg`,
    );
    assert.equal(
      JSON.parse(dependencies.state.stdout).entries[0].filePath,
      `/work/gallery_images/${dependencies.state.galleryEntry.imageId}-2.jpeg`,
    );
  });

  it("treats an image extension as an exact get filename", async () => {
    const dependencies = createFakeDependencies();
    const status = await runCli([
      "node", "perchance", "gallery", "get",
      dependencies.state.galleryEntry.imageId,
      "--download", "--output", "selected.jpeg",
    ], dependencies);

    assert.equal(status, 0);
    assert.equal(dependencies.state.galleryDownloadCalls[0].destination, "/work/selected.jpeg");
    assert.equal(JSON.parse(dependencies.state.stdout).filePath, "/work/selected.jpeg");
  });

  it("treats an extensionless get output as a directory", async () => {
    const dependencies = createFakeDependencies();
    await runCli([
      "node", "perchance", "gallery", "get",
      dependencies.state.galleryEntry.imageId,
      "--download", "--output", "selected",
    ], dependencies);

    assert.equal(
      dependencies.state.galleryDownloadCalls[0].destination,
      `/work/selected/${dependencies.state.galleryEntry.imageId}.jpeg`,
    );
  });

  it("prints no partial JSON and closes resources after a download error", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.galleryDownloadError = new Error("download failed");
    const status = await runCli([
      "node", "perchance", "gallery", "list", "--download",
    ], dependencies);

    assert.equal(status, 1);
    assert.equal(dependencies.state.stdout, "");
    assert.match(dependencies.state.stderr, /download failed/);
    assert.equal(dependencies.state.galleryCloseCalls, 1);
    assert.equal(dependencies.state.browserCloseCalls, 1);
  });
});
```

- [ ] **Step 7: Run CLI tests**

Run: `npm run build && node --test --test-concurrency=1 dist/tests/cli.test.js`

Expected: all CLI tests pass.

- [ ] **Step 8: Commit the CLI**

Run: `git add src/cli/program.ts tests/cli.test.ts && git commit -m "feat: add gallery CLI commands"`

### Task 8: Documentation, Default Test Wiring, And Live Smoke Test

**Files:**

- Modify: `README.md`
- Modify: `package.json`
- Modify: `tests/integration.test.ts`
- Modify: `docs/superpowers/specs/2026-07-31-gallery-retrieval-design.md`

- [ ] **Step 1: Add the gallery tests to the default test script**

Change `package.json` so the `test` command remains one line and includes:

```json
"test": "tsc && node --test --test-concurrency=1 dist/tests/appimageFiles.test.js dist/tests/camoufox.test.js dist/tests/cli.test.js dist/tests/errors.test.js dist/tests/galleryBrowser.test.js dist/tests/galleryClient.test.js dist/tests/galleryProtocol.test.js dist/tests/generator.test.js dist/tests/imageGenerator.test.js dist/tests/package.test.js dist/tests/textGenerator.test.js dist/tests/utils.test.js"
```

Keep `tests/integration.test.ts` excluded from the default test command and
make its explicit script single-worker as well:

```json
"test:integration": "PERCHANCE_E2E=1 tsc && node --test --test-concurrency=1 dist/tests/integration.test.js"
```

- [ ] **Step 2: Document library usage**

Add a `Gallery retrieval` section to `README.md` with executable examples:

```ts
import { GalleryClient } from "perchance";

const gallery = new GalleryClient();
try {
  const page = await gallery.list({ limit: 10, contentFilter: "g" });
  console.log(page.entries.map(entry => ({
    imageId: entry.imageId,
    prompt: entry.prompt,
    imageUrl: entry.imageUrl,
  })));

  if (page.entries[0]) {
    const exact = await gallery.get(page.entries[0].imageId);
    await gallery.download(exact, `gallery_images/${exact.imageId}.jpeg`);
  }
} finally {
  await gallery.close();
}
```

State that retrieval is public/read-only, defaults to `ai-text-to-image-generator` and `g`, and launches Camoufox unless a context is injected.

- [ ] **Step 3: Document CLI usage**

Add these one-line examples to `README.md`:

```text
perchance gallery list --limit 20
perchance gallery list --sort top --time-range 1-month --download --output gallery_images
perchance gallery get <64-character-image-id>
perchance gallery get <64-character-image-id> --download --output selected.jpeg
```

Document that list output is `{ "entries": [...], "nextCursor": "..." }`, get output is one object, and downloaded entries add `filePath`.

- [ ] **Step 4: Add an opt-in live read-only integration test**

Extend `tests/integration.test.ts`:

```ts
import { GalleryClient, ImageGenerator, launchCamoufox } from "../src/index.js";

describe("E2E: GalleryClient", { skip: !SHOULD_RUN }, () => {
  it("retrieves one public g-filtered entry", { timeout: 120_000 }, async () => {
    const gallery = new GalleryClient();
    try {
      const page = await gallery.list({ limit: 1, contentFilter: "g" });
      assert.equal(page.entries.length, 1);
      assert.ok(page.entries[0].imageId);
      assert.ok(page.entries[0].prompt.trim().length > 0);
      assert.match(page.entries[0].imageUrl, /^https:\/\/aigc\.uploads\.dev\/image\//);
    } finally {
      await gallery.close();
    }
  });
});
```

- [ ] **Step 5: Mark the design implemented after verification**

After all verification steps pass, change the status in `docs/superpowers/specs/2026-07-31-gallery-retrieval-design.md` from `Approved, not yet implemented` to `Implemented` and append:

```text
- 2026-07-31: Implemented package, CLI, downloads, and test coverage.
```

- [ ] **Step 6: Run the full default suite with one test worker**

Run: `npm test`

Expected: TypeScript compilation succeeds and every default test passes with `--test-concurrency=1`.

- [ ] **Step 7: Run the live gallery test**

Run: `npm run test:integration`

Expected: the read-only gallery test retrieves one `g`-filtered public entry with a nonempty prompt. Existing generation tests may take several minutes; if an upstream generation test fails independently, rerun the compiled gallery test alone with `PERCHANCE_E2E=1 node --test --test-concurrency=1 --test-name-pattern='E2E: GalleryClient' dist/tests/integration.test.js` and record both outcomes.

- [ ] **Step 8: Verify AppImage command exposure without adding a server**

Run: `npm_config_jobs=1 CMAKE_BUILD_PARALLEL_LEVEL=1 npm run appimage`

Expected: AppImage build succeeds using one compiler worker.

Run: `npm run verify:appimage`

Expected: AppImage verification succeeds.

Run: `release/Perchance-1.0.0-x86_64.AppImage gallery --help`

Expected: help displays `list` and `get`; no UI server command, service, or dependency is present.

- [ ] **Step 9: Review the changeset for accidental server or generated artifacts**

Run: `git status --short && git diff --check && rg -n "express|fastify|localhost|createServer|ui server" src package.json README.md`

Expected: only intended source, tests, docs, and package-script changes are present; `git diff --check` is silent; the search finds no new server implementation.

- [ ] **Step 10: Commit documentation and verification wiring**

Run: `git add README.md package.json tests/integration.test.ts docs/superpowers/specs/2026-07-31-gallery-retrieval-design.md && git commit -m "docs: document gallery retrieval"`

## Final Verification Gate

- [ ] Run: `npm test`
- [ ] Run: `git diff --check`
- [ ] Run: `git status --short --branch`
- [ ] Confirm every `GalleryClient` page closes in `finally`.
- [ ] Confirm injected contexts are never closed by `GalleryClient.close()`.
- [ ] Confirm owned contexts close exactly once.
- [ ] Confirm invalid channel, limit, sort, cursor, ID, and URL inputs fail before browser launch.
- [ ] Confirm feed continuation uses only the versioned opaque cursor and upstream `skip` offset.
- [ ] Confirm exact lookup uses the item document endpoint and never scans feed pages.
- [ ] Confirm every returned prompt comes from validated structured metadata.
- [ ] Confirm downloads reject non-HTTPS, unsupported origins, non-image MIME types, and empty bodies.
- [ ] Confirm CLI failures print no partial JSON.
- [ ] Confirm the AppImage exposes gallery commands and contains no UI server.
