import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { launchCamoufox } from "./camoufox.js";
import {
  ConnectionError,
  GalleryNotFoundError,
  GalleryProtocolError,
} from "./errors.js";
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
  mkdir?: (path: string) => Promise<void>;
  writeFile?: (path: string, data: Buffer) => Promise<void>;
}

export class GalleryClient {
  private context: BrowserContext | null;
  private readonly launchBrowser: () => Promise<BrowserContext>;
  private readonly makeDirectory: (path: string) => Promise<void>;
  private readonly saveFile: (path: string, data: Buffer) => Promise<void>;
  private ownsContext = false;
  private closePromise: Promise<void> | null = null;

  constructor(options: GalleryClientOptions = {}) {
    this.context = options.browserContext ?? null;
    this.launchBrowser =
      options.launchBrowser ?? (() => launchCamoufox({ headless: true }));
    this.makeDirectory = options.mkdir ?? (async (path) => {
      await mkdir(path, { recursive: true });
    });
    this.saveFile = options.writeFile ?? ((path, data) => writeFile(path, data));
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    this.context = await this.launchBrowser();
    this.ownsContext = true;
    this.closePromise = null;
    return this.context;
  }

  async list(options: GalleryListOptions = {}): Promise<GalleryPage> {
    const normalized = normalizeListOptions(options);
    const context = await this.ensureContext();
    const page = await context.newPage();
    try {
      await page.goto(buildGalleryUrl(normalized), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      const raw = await readGalleryFeed(page, {
        startSkip: normalized.skip,
        limit: normalized.limit,
      });
      if (
        !Array.isArray(raw.records) ||
        !Number.isInteger(raw.consumed) ||
        raw.consumed !== raw.records.length ||
        typeof raw.hasMore !== "boolean" ||
        (raw.hasMore && raw.consumed === 0)
      ) {
        throw new GalleryProtocolError(
          "Gallery feed returned invalid pagination state.",
        );
      }

      const result: GalleryPage = {
        entries: raw.records.map((record) =>
          normalizeFeedEntry(record, normalized.channel)
        ),
      };
      if (raw.hasMore) {
        result.nextCursor = encodeGalleryCursor(
          normalized.skip + raw.consumed,
        );
      }
      return result;
    } finally {
      await page.close();
    }
  }

  async get(
    idOrUrl: string,
    options: GalleryGetOptions = {},
  ): Promise<GalleryEntry> {
    const imageId = parseGalleryImageId(idOrUrl);
    const normalized = normalizeGetOptions(options);
    const context = await this.ensureContext();
    const page = await context.newPage();
    try {
      await page.goto(
        buildGalleryUrl({
          channel: normalized.channel,
          sort: "recent",
          timeRange: "all-time",
          contentFilter: normalized.contentFilter,
        }),
        { waitUntil: "domcontentloaded", timeout: 30_000 },
      );
      const response = await fetchGalleryDocument(page, imageId);
      const expectedUrl = `${GALLERY_DOCUMENT_ORIGIN}/docs/${imageId}.json`;
      if (response.status === 404) {
        throw new GalleryNotFoundError(
          `Gallery image ${imageId} was not found.`,
        );
      }
      if (response.status < 200 || response.status >= 300) {
        throw new ConnectionError(
          `Gallery item request failed with status ${response.status}.`,
        );
      }
      if (
        response.finalUrl !== expectedUrl ||
        !response.contentType.toLowerCase().includes("application/json")
      ) {
        throw new GalleryProtocolError(
          "Gallery item response used an unsupported origin or content type.",
        );
      }

      const entry = normalizeGalleryDocument(
        response.body,
        normalized.channel,
        normalized.contentFilter,
      );
      if (entry.imageId !== imageId) {
        throw new GalleryProtocolError(
          "Gallery item response ID did not match the request.",
        );
      }
      return entry;
    } finally {
      await page.close();
    }
  }

  async download(entry: GalleryEntry, destination: string): Promise<string> {
    if (destination.length === 0) {
      throw new TypeError("Gallery download destination must not be empty.");
    }
    const normalizedEntry = normalizeFeedEntry(entry, entry.channel);
    const context = await this.ensureContext();
    const page = await context.newPage();
    const finalPath = resolve(destination);
    try {
      await page.goto(
        buildGalleryUrl({
          channel: normalizedEntry.channel,
          sort: "recent",
          timeRange: "all-time",
          contentFilter: "g",
        }),
        { waitUntil: "domcontentloaded", timeout: 30_000 },
      );
      const response = await fetchGalleryImage(
        page,
        normalizedEntry.imageUrl,
      );
      if (response.status < 200 || response.status >= 300) {
        throw new ConnectionError(
          `Gallery image request failed with status ${response.status}.`,
        );
      }
      const finalEntry = normalizeFeedEntry(
        { ...normalizedEntry, imageUrl: response.finalUrl },
        normalizedEntry.channel,
      );
      if (
        finalEntry.imageId !== normalizedEntry.imageId ||
        !response.contentType.toLowerCase().startsWith("image/")
      ) {
        throw new GalleryProtocolError(
          "Gallery image response used an unsupported URL or content type.",
        );
      }

      const data = Buffer.from(response.data, "base64");
      if (data.length === 0) {
        throw new GalleryProtocolError("Gallery image response was empty.");
      }
      await this.makeDirectory(dirname(finalPath));
      await this.saveFile(finalPath, data);
      return finalPath;
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (!this.ownsContext || !this.context) return;
    const context = this.context;
    this.closePromise ??= context.close().finally(() => {
      if (this.context === context) this.context = null;
      this.ownsContext = false;
    });
    await this.closePromise;
  }
}
