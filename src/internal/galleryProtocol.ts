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
const DOCUMENT_PATH_PATTERN = /^\/docs\/([a-f0-9]{64})\.json$/;
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
    throw new TypeError(
      `${name} must contain between 1 and ${maxLength} characters.`,
    );
  }
  return value;
}

export function validateGalleryChannel(channel: string): string {
  if (!CHANNEL_PATTERN.test(channel)) {
    throw new TypeError(
      "Gallery channel must contain only ASCII letters, digits, underscores, and hyphens.",
    );
  }
  return channel;
}

export function validateGalleryContentFilter(value: string): string {
  return boundedString("Gallery content filter", value, MAX_FILTER_LENGTH);
}

export function validateGalleryTimeRange(value: string): string {
  return boundedString("Gallery time range", value, MAX_TIME_RANGE_LENGTH);
}

export function encodeGalleryCursor(skip: number): string {
  if (!Number.isSafeInteger(skip) || skip < 0) {
    throw new TypeError("Gallery cursor offset must be a non-negative integer.");
  }
  return Buffer.from(JSON.stringify({ v: 1, skip }), "utf8").toString(
    "base64url",
  );
}

export function decodeGalleryCursor(cursor: string): number {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      parsed.v !== 1 ||
      !Number.isSafeInteger(parsed.skip) ||
      (parsed.skip as number) < 0
    ) {
      throw new Error("invalid cursor shape");
    }
    return parsed.skip as number;
  } catch {
    throw new TypeError("Invalid gallery cursor.");
  }
}

export function normalizeListOptions(
  options: GalleryListOptions = {},
): NormalizedGalleryListOptions {
  const limit = options.limit ?? 20;
  const sort = options.sort ?? "recent";
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("Gallery limit must be an integer between 1 and 100.");
  }
  if (!SORTS.has(sort)) {
    throw new TypeError("Gallery sort must be recent, top, or trending.");
  }

  return {
    channel: validateGalleryChannel(
      options.channel ?? DEFAULT_GALLERY_CHANNEL,
    ),
    limit,
    skip: options.cursor === undefined ? 0 : decodeGalleryCursor(options.cursor),
    sort,
    timeRange: validateGalleryTimeRange(
      options.timeRange ?? (sort === "recent" ? "all-time" : "1-month"),
    ),
    contentFilter: validateGalleryContentFilter(options.contentFilter ?? "g"),
  };
}

export function normalizeGetOptions(
  options: GalleryGetOptions = {},
): NormalizedGalleryGetOptions {
  return {
    channel: validateGalleryChannel(
      options.channel ?? DEFAULT_GALLERY_CHANNEL,
    ),
    contentFilter: validateGalleryContentFilter(options.contentFilter ?? "g"),
  };
}

export function buildGalleryUrl(
  options: Pick<
    NormalizedGalleryListOptions,
    "channel" | "sort" | "timeRange" | "contentFilter"
  >,
): string {
  const url = new URL(GALLERY_URL);
  url.searchParams.set("channel", options.channel);
  url.searchParams.set("subChannel", GALLERY_SUB_CHANNEL);
  url.searchParams.set("sort", options.sort);
  url.searchParams.set("timeRange", options.timeRange);
  url.searchParams.set("contentFilter", options.contentFilter);
  return url.href;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new GalleryProtocolError(`Gallery record has an invalid ${key}.`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
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

  const match =
    url.protocol === "https:" && url.origin === GALLERY_DOCUMENT_ORIGIN
      ? url.pathname.match(IMAGE_PATH_PATTERN)
      : null;
  if (!match || (expectedImageId !== undefined && match[1] !== expectedImageId)) {
    throw new GalleryProtocolError(
      "Gallery record has an unsupported image URL.",
    );
  }
  return url;
}

export function parseGalleryImageId(idOrUrl: string): string {
  if (IMAGE_ID_PATTERN.test(idOrUrl)) return idOrUrl;

  try {
    const url = new URL(idOrUrl);
    if (url.protocol !== "https:") throw new Error("unsupported scheme");

    const imageMatch =
      url.origin === GALLERY_DOCUMENT_ORIGIN
        ? url.pathname.match(IMAGE_PATH_PATTERN) ??
          url.pathname.match(DOCUMENT_PATH_PATTERN)
        : null;
    const galleryId =
      url.origin === GALLERY_ORIGIN
        ? url.searchParams.get("imageId")
        : null;
    const candidate = imageMatch?.[1] ?? galleryId;
    if (candidate && IMAGE_ID_PATTERN.test(candidate)) return candidate;
  } catch {
    // Return the stable validation error below.
  }

  throw new TypeError(
    "Expected a gallery image ID or supported HTTPS Perchance gallery URL.",
  );
}

export function trustedImageExtension(imageUrl: string): string {
  const match = validateImageUrl(imageUrl).pathname.match(IMAGE_PATH_PATTERN);
  if (!match) {
    throw new GalleryProtocolError("Gallery record has an invalid image URL.");
  }
  return match[2].toLowerCase();
}

export function normalizeFeedEntry(
  value: unknown,
  channel: string,
): GalleryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GalleryProtocolError("Gallery feed record must be an object.");
  }

  const record = value as Record<string, unknown>;
  const imageId = requiredString(record, "imageId");
  if (!IMAGE_ID_PATTERN.test(imageId)) {
    throw new GalleryProtocolError("Gallery record has an invalid imageId.");
  }

  const entry: GalleryEntry = {
    imageId,
    imageUrl: validateImageUrl(
      requiredString(record, "imageUrl"),
      imageId,
    ).href,
    prompt: requiredString(record, "prompt"),
    channel,
    subChannel: GALLERY_SUB_CHANNEL,
  };

  const negativePrompt = optionalString(record, "negativePrompt");
  if (negativePrompt !== undefined) entry.negativePrompt = negativePrompt;

  for (const key of [
    "seed",
    "guidanceScale",
    "width",
    "height",
    "score",
  ] as const) {
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
  if (
    !IMAGE_ID_PATTERN.test(imageId) ||
    !Array.isArray(channels) ||
    !channels.every((item) => typeof item === "string")
  ) {
    throw new GalleryProtocolError(
      "Gallery item document has invalid identity metadata.",
    );
  }
  if (!channels.includes(channel)) {
    throw new GalleryNotFoundError(
      `Gallery image ${imageId} is not available in channel ${channel}.`,
    );
  }

  for (const key of ["nsfw", "shocking", "pg13Soft"] as const) {
    if (typeof record[key] !== "boolean") {
      throw new GalleryProtocolError(
        "Gallery item document has invalid content metadata.",
      );
    }
  }
  const isNsfw = record.nsfw as boolean;
  const isShocking = record.shocking as boolean;
  const isPg13Soft = record.pg13Soft as boolean;
  if (
    (contentFilter === "g" && (isNsfw || isShocking || isPg13Soft)) ||
    (contentFilter === "pg13" && (isNsfw || isShocking))
  ) {
    throw new GalleryNotFoundError(
      `Gallery image ${imageId} is unavailable under content filter ${contentFilter}.`,
    );
  }

  const extension = requiredString(record, "ext").toLowerCase();
  const entry = normalizeFeedEntry(
    {
      imageId,
      imageUrl: `${GALLERY_DOCUMENT_ORIGIN}/image/${imageId}.${extension}`,
      prompt: record.prompt,
      negativePrompt: record.negativePrompt,
      seed: record.seed,
      guidanceScale: record.guidanceScale,
      width: record.width,
      height: record.height,
      score: record.score,
    },
    channel,
  );

  const timestamp = optionalNumber(record.t, "t");
  if (timestamp !== undefined) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      throw new GalleryProtocolError(
        "Gallery item document has an invalid timestamp.",
      );
    }
    entry.createdAt = date.toISOString();
  }
  return entry;
}
