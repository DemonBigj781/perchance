import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { launchCamoufox } from "./camoufox.js";
import {
  ConnectionError,
  GalleryNotFoundError,
  GalleryProtocolError,
} from "./errors.js";
import type { BrowserContext, BrowserFrame, BrowserPage } from "./generator.js";
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

const GENERATOR_URL = "https://perchance.org/ai-text-to-image-generator";
const GALLERY_FRAME_PREFIX = "https://image-generation.perchance.org/gallery";
const GALLERY_FRAME_ID = "perchance-api-public-gallery";
const GALLERY_FRAME_TIMEOUT_STEPS = 240;
const GALLERY_FRAME_POLL_MS = 500;
const GALLERY_ACTIVATION_INTERVAL_STEPS = 4;
const GALLERY_NAVIGATION_ATTEMPTS = 3;

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

  private async openGalleryFrame(
    page: BrowserPage,
    galleryUrl: string,
  ): Promise<BrowserFrame> {
    let navigationError: unknown;
    for (let attempt = 0; attempt < GALLERY_NAVIGATION_ATTEMPTS; attempt += 1) {
      try {
        await page.goto(GENERATOR_URL, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        navigationError = undefined;
        break;
      } catch (error) {
        navigationError = error;
        if (attempt + 1 < GALLERY_NAVIGATION_ATTEMPTS) {
          await page.waitForTimeout(1_000 * (attempt + 1));
        }
      }
    }
    if (navigationError) throw navigationError;

    // Mount the public gallery directly inside the official generator wrapper.
    // Perchance randomizes the generator implementation and its gallery button,
    // and that control can take a long time to initialize (or never initialize
    // in a headless browser). The gallery endpoint is still intended to run as
    // an embedded frame, so creating that frame ourselves avoids depending on
    // the generator's presentation details.
    try {
      await page.evaluate((targetUrl: unknown, frameId: unknown) => {
        if (typeof targetUrl !== "string" || typeof frameId !== "string") {
          throw new Error("Gallery frame parameters must be strings.");
        }
        const existing = Array.from(document.querySelectorAll("iframe"))
          .find((candidate) => candidate.src === targetUrl);
        if (existing) return;

        const frame = document.createElement("iframe");
        frame.id = frameId;
        frame.src = targetUrl;
        frame.title = "Perchance public gallery";
        frame.setAttribute("aria-hidden", "true");
        frame.style.cssText =
          "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;";
        (document.body ?? document.documentElement).appendChild(frame);
      }, galleryUrl, GALLERY_FRAME_ID);
    } catch {
      // Fall back to activating the generator's own gallery control below.
    }

    let galleryFrame: BrowserFrame | undefined;
    for (let step = 0; step < GALLERY_FRAME_TIMEOUT_STEPS; step += 1) {
      galleryFrame = page.frames().find((frame) =>
        frame.url().startsWith(GALLERY_FRAME_PREFIX)
      );
      if (galleryFrame) break;

      if (step % GALLERY_ACTIVATION_INTERVAL_STEPS === 0) {
        const generatorFrames = page.frames().filter((frame) =>
          frame.url().includes(".perchance.org/ai-text-to-image-generator")
        );
        for (const frame of generatorFrames) {
          try {
            const activated = await frame.evaluate<boolean>(() => {
              const galleryFrameExists = Array.from(
                document.querySelectorAll("iframe"),
              ).some((candidate) =>
                (candidate.getAttribute("src") ?? "").includes(
                  "image-generation.perchance.org/gallery",
                )
              );
              if (galleryFrameExists) return false;

              const button = Array.from(document.querySelectorAll<HTMLElement>(
                "button, [role='button'], [onclick]",
              ))
                .find((candidate) => {
                  const handler = (
                    candidate.getAttribute("onclick") ?? ""
                  ).toLowerCase();
                  const text = (candidate.textContent ?? "").toLowerCase();
                  const label = `${
                    candidate.getAttribute("aria-label") ?? ""
                  } ${candidate.getAttribute("title") ?? ""}`.toLowerCase();
                  return handler.includes("showsocialsbuttonclickhandler") ||
                    (
                      (text.includes("gallery") || label.includes("gallery")) &&
                      (text.includes("comment") || label.includes("comment"))
                    );
                });
              if (!button) return false;
              button.click();
              return true;
            });
            if (activated) break;
          } catch {
            // The generator frame can navigate while its content initializes.
          }
        }
      }
      await page.waitForTimeout(GALLERY_FRAME_POLL_MS);
    }

    if (!galleryFrame) {
      throw new ConnectionError(
        "The official generator did not open its public gallery frame.",
      );
    }

    await galleryFrame.evaluate((targetUrl: unknown) => {
      if (typeof targetUrl !== "string") {
        throw new Error("Gallery target URL must be a string.");
      }
      if (window.location.href.split("#", 1)[0] !== targetUrl) {
        window.location.replace(targetUrl);
      }
    }, galleryUrl);

    for (let step = 0; step < GALLERY_FRAME_TIMEOUT_STEPS; step += 1) {
      const candidate = page.frames().find((frame) =>
        frame.url().startsWith(GALLERY_FRAME_PREFIX)
      );
      if (candidate && candidate.url().split("#", 1)[0] === galleryUrl) {
        try {
          const ready = await candidate.evaluate<boolean>(() =>
            Boolean(document.querySelector("#main"))
          );
          if (ready) return candidate;
        } catch {
          // Navigation can replace the frame document between polling steps.
        }
      }
      await page.waitForTimeout(GALLERY_FRAME_POLL_MS);
    }

    throw new ConnectionError(
      "The public gallery frame did not finish loading structured data.",
    );
  }

  async list(options: GalleryListOptions = {}): Promise<GalleryPage> {
    const normalized = normalizeListOptions(options);
    const context = await this.ensureContext();
    const page = await context.newPage();
    try {
      const frame = await this.openGalleryFrame(
        page,
        buildGalleryUrl(normalized),
      );
      const raw = await readGalleryFeed(frame, {
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
      const frame = await this.openGalleryFrame(
        page,
        buildGalleryUrl({
          channel: normalized.channel,
          sort: "recent",
          timeRange: "all-time",
          contentFilter: normalized.contentFilter,
        }),
      );
      const response = await fetchGalleryDocument(frame, imageId);
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
      const frame = await this.openGalleryFrame(
        page,
        buildGalleryUrl({
          channel: normalizedEntry.channel,
          sort: "recent",
          timeRange: "all-time",
          contentFilter: "g",
        }),
      );
      const response = await fetchGalleryImage(
        frame,
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
