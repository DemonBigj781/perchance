import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GalleryNotFoundError,
  GalleryProtocolError,
} from "../src/errors.js";
import { GalleryClient } from "../src/galleryClient.js";
import type {
  BrowserContext,
  BrowserFrame,
  BrowserPage,
} from "../src/generator.js";
import { decodeGalleryCursor } from "../src/internal/galleryProtocol.js";
import type { GalleryEntry } from "../src/types.js";

const imageId = "c".repeat(64);
const imageUrl = `https://aigc.uploads.dev/image/${imageId}.jpeg`;

interface FakeGalleryPageConfig {
  feed?: { records: unknown[]; consumed: number; hasMore: boolean };
  document?: {
    status: number;
    finalUrl: string;
    contentType: string;
    body: unknown;
  };
  image?: {
    status: number;
    finalUrl: string;
    contentType: string;
    data: string;
  };
}

function makeGalleryPage(config: FakeGalleryPageConfig): BrowserPage & {
  gotos: string[];
  closes: number;
  evaluateArguments: unknown[];
} {
  let activated = false;
  let galleryFrameUrl =
    "https://image-generation.perchance.org/gallery?sort=trending";
  const page: BrowserPage & {
    gotos: string[];
    closes: number;
    evaluateArguments: unknown[];
  } = {
    gotos: [] as string[],
    closes: 0,
    evaluateArguments: [] as unknown[],
    async goto(url: string) {
      page.gotos.push(url);
    },
    async content() {
      return "";
    },
    async evaluate() {
      throw new Error("gallery operations must run in the embedded frame");
    },
    frames() {
      return [generatorFrame, ...(activated ? [galleryFrame] : [])];
    },
    url(): string {
      return page.gotos.at(-1) ?? "about:blank";
    },
    on() {},
    async waitForTimeout() {},
    async close() {
      page.closes += 1;
    },
    async exposeFunction() {},
  };

  const generatorFrame: BrowserFrame = {
    url() {
      return "https://generator-id.perchance.org/ai-text-to-image-generator";
    },
    async evaluate<T = unknown>() {
      activated = true;
      return true as T;
    },
  };

  const galleryFrame: BrowserFrame = {
    url() {
      return galleryFrameUrl;
    },
    async evaluate<T = unknown>(
      _fn: string | ((...args: unknown[]) => T | Promise<T>),
      ...args: unknown[]
    ) {
      const argument = args[0];
      if (argument === undefined) return true as T;
      if (
        typeof argument === "string" &&
        argument.startsWith("https://image-generation.perchance.org/gallery?")
      ) {
        galleryFrameUrl = argument;
        return undefined as T;
      }

      page.evaluateArguments.push(argument);
      if (
        typeof argument === "object" &&
        argument !== null &&
        "startSkip" in argument
      ) {
        if (!config.feed) throw new Error("missing feed fixture");
        return config.feed as T;
      }
      if (typeof argument === "string" && argument.includes("/docs/")) {
        if (!config.document) throw new Error("missing document fixture");
        return config.document as T;
      }
      if (typeof argument === "string" && argument.includes("/image/")) {
        if (!config.image) throw new Error("missing image fixture");
        return config.image as T;
      }
      throw new Error(`unexpected browser argument: ${String(argument)}`);
    },
  };
  return page;
}

function contextWithPage(page: BrowserPage): BrowserContext & {
  closes: number;
  pageCalls: number;
} {
  const context = {
    closes: 0,
    pageCalls: 0,
    async newPage() {
      context.pageCalls += 1;
      return page;
    },
    async close() {
      context.closes += 1;
    },
  };
  return context;
}

function validEntry(): GalleryEntry {
  return {
    imageId,
    imageUrl,
    prompt: "gallery prompt",
    channel: "ai-text-to-image-generator",
    subChannel: "public",
  };
}

function validDocument(): Record<string, unknown> {
  return {
    id: imageId,
    ext: "jpeg",
    channels: ["ai-text-to-image-generator"],
    prompt: "exact prompt",
    nsfw: false,
    shocking: false,
    pg13Soft: false,
  };
}

describe("GalleryClient", () => {
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

  it("activates the official embedded gallery before reading the feed", async () => {
    const feed = {
      records: [{ imageId, imageUrl, prompt: "gallery prompt" }],
      consumed: 1,
      hasMore: false,
    };
    const page = makeGalleryPage({ feed });
    let activated = 0;
    let waits = 0;
    let galleryFrameUrl =
      "https://image-generation.perchance.org/gallery?sort=trending";
    const generatorFrame: BrowserFrame = {
      url() {
        return "https://generator-id.perchance.org/ai-text-to-image-generator";
      },
      async evaluate<T = unknown>() {
        activated += 1;
        return true as T;
      },
    };
    const galleryFrame: BrowserFrame = {
      url() {
        return galleryFrameUrl;
      },
      async evaluate<T = unknown>(
        _fn: string | ((...args: unknown[]) => T | Promise<T>),
        ...args: unknown[]
      ) {
        const argument = args[0];
        if (
          typeof argument === "string" &&
          argument.startsWith("https://image-generation.perchance.org/gallery?")
        ) {
          galleryFrameUrl = argument;
          return undefined as T;
        }
        if (
          typeof argument === "object" &&
          argument !== null &&
          "startSkip" in argument
        ) {
          return feed as T;
        }
        return true as T;
      },
    };
    page.frames = () => [
      generatorFrame,
      ...(activated > 1 && waits >= 4 ? [galleryFrame] : []),
    ];
    page.waitForTimeout = async () => {
      waits += 1;
    };
    const client = new GalleryClient({
      browserContext: contextWithPage(page),
    });

    await client.list({ limit: 1 });

    assert.equal(page.gotos[0], "https://perchance.org/ai-text-to-image-generator");
    assert.equal(activated, 2);
    assert.match(galleryFrameUrl, /sort=recent/);
  });

  it("retries transient official-generator navigation failures", async () => {
    const page = makeGalleryPage({
      feed: { records: [], consumed: 0, hasMore: false },
    });
    const successfulGoto = page.goto.bind(page);
    let attempts = 0;
    page.goto = async (url, options) => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary DNS failure");
      await successfulGoto(url, options);
    };
    const client = new GalleryClient({
      browserContext: contextWithPage(page),
    });

    await client.list({ limit: 1 });

    assert.equal(attempts, 3);
    assert.deepEqual(page.gotos, [
      "https://perchance.org/ai-text-to-image-generator",
    ]);
  });

  it("lists normalized entries and returns an opaque next cursor", async () => {
    const page = makeGalleryPage({
      feed: {
        records: [{ imageId, imageUrl, prompt: "gallery prompt" }],
        consumed: 1,
        hasMore: true,
      },
    });
    const context = contextWithPage(page);
    const client = new GalleryClient({ browserContext: context });

    const result = await client.list({ limit: 1 });

    assert.equal(result.entries[0].prompt, "gallery prompt");
    assert.equal(decodeGalleryCursor(result.nextCursor!), 1);
    assert.equal(page.gotos[0], "https://perchance.org/ai-text-to-image-generator");
    assert.equal(page.closes, 1);
    await client.close();
    assert.equal(context.closes, 0);
  });

  it("passes cursor offsets to the browser adapter", async () => {
    const page = makeGalleryPage({
      feed: { records: [], consumed: 0, hasMore: false },
    });
    const client = new GalleryClient({
      browserContext: contextWithPage(page),
    });
    const firstPage = makeGalleryPage({
      feed: {
        records: [
          { imageId, imageUrl, prompt: "first" },
          {
            imageId: "e".repeat(64),
            imageUrl: `https://aigc.uploads.dev/image/${"e".repeat(64)}.jpeg`,
            prompt: "second",
          },
        ],
        consumed: 2,
        hasMore: true,
      },
    });
    const firstClient = new GalleryClient({
      browserContext: contextWithPage(firstPage),
    });
    const cursor = (await firstClient.list({ limit: 2 })).nextCursor!;

    await client.list({ cursor, limit: 1 });

    assert.deepEqual(page.evaluateArguments[0], { startSkip: 2, limit: 1 });
  });

  it("retrieves an exact item document without scanning feed pages", async () => {
    const page = makeGalleryPage({
      document: {
        status: 200,
        finalUrl: `https://aigc.uploads.dev/docs/${imageId}.json`,
        contentType: "application/json",
        body: validDocument(),
      },
    });
    const client = new GalleryClient({
      browserContext: contextWithPage(page),
    });

    const result = await client.get(imageId);

    assert.equal(result.prompt, "exact prompt");
    assert.equal(page.evaluateArguments.length, 1);
    assert.equal(page.evaluateArguments[0], `https://aigc.uploads.dev/docs/${imageId}.json`);
    assert.equal(page.closes, 1);
  });

  it("maps a missing item to GalleryNotFoundError", async () => {
    const page = makeGalleryPage({
      document: {
        status: 404,
        finalUrl: `https://aigc.uploads.dev/docs/${imageId}.json`,
        contentType: "application/json",
        body: null,
      },
    });
    const client = new GalleryClient({
      browserContext: contextWithPage(page),
    });

    await assert.rejects(client.get(imageId), GalleryNotFoundError);

    assert.equal(page.closes, 1);
  });

  it("rejects malformed feed pagination and closes the page", async () => {
    const page = makeGalleryPage({
      feed: {
        records: [{ imageId, imageUrl, prompt: "gallery prompt" }],
        consumed: 2,
        hasMore: false,
      },
    });
    const client = new GalleryClient({
      browserContext: contextWithPage(page),
    });

    await assert.rejects(client.list(), GalleryProtocolError);

    assert.equal(page.closes, 1);
  });

  it("closes an owned browser exactly once", async () => {
    const page = makeGalleryPage({
      feed: { records: [], consumed: 0, hasMore: false },
    });
    const context = contextWithPage(page);
    const client = new GalleryClient({ launchBrowser: async () => context });

    await client.list();
    await client.close();
    await client.close();

    assert.equal(context.closes, 1);
  });

  it("downloads a trusted image and creates its parent directory", async () => {
    const directories: string[] = [];
    const writes: Array<{ path: string; data: Buffer }> = [];
    const page = makeGalleryPage({
      image: {
        status: 200,
        finalUrl: imageUrl,
        contentType: "image/jpeg",
        data: Buffer.from("image bytes").toString("base64"),
      },
    });
    const client = new GalleryClient({
      browserContext: contextWithPage(page),
      mkdir: async (path: string) => {
        directories.push(path);
      },
      writeFile: async (path: string, data: Buffer) => {
        writes.push({ path, data });
      },
    });

    const destination = "/tmp/gallery/item.jpeg";
    const result = await client.download(validEntry(), destination);

    assert.equal(result, destination);
    assert.deepEqual(directories, ["/tmp/gallery"]);
    assert.equal(writes[0].path, destination);
    assert.equal(writes[0].data.toString(), "image bytes");
    assert.equal(page.closes, 1);
  });

  it("rejects non-image download responses without writing", async () => {
    let writes = 0;
    const page = makeGalleryPage({
      image: {
        status: 200,
        finalUrl: imageUrl,
        contentType: "text/html",
        data: Buffer.from("not an image").toString("base64"),
      },
    });
    const client = new GalleryClient({
      browserContext: contextWithPage(page),
      writeFile: async () => {
        writes += 1;
      },
    });

    await assert.rejects(
      client.download(validEntry(), "/tmp/x.jpeg"),
      GalleryProtocolError,
    );

    assert.equal(writes, 0);
    assert.equal(page.closes, 1);
  });

  it("rejects image redirects to another image ID", async () => {
    const page = makeGalleryPage({
      image: {
        status: 200,
        finalUrl: `https://aigc.uploads.dev/image/${"d".repeat(64)}.jpeg`,
        contentType: "image/jpeg",
        data: "AQID",
      },
    });
    const client = new GalleryClient({
      browserContext: contextWithPage(page),
    });

    await assert.rejects(
      client.download(validEntry(), "/tmp/x.jpeg"),
      GalleryProtocolError,
    );
  });
});
