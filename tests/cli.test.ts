import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BrowserContext } from "../src/generator.js";
import { encodeGalleryCursor } from "../src/internal/galleryProtocol.js";
import { runCli, type CliDependencies } from "../src/cli/program.js";
import type {
  GenerateImageOptions,
  GenerateTextOptions,
  GalleryEntry,
  GalleryGetOptions,
  GalleryListOptions,
  GalleryPage,
} from "../src/types.js";

interface FakeState {
  stdout: string;
  stderr: string;
  launchCalls: Array<{ headless: boolean }>;
  browserCloseCalls: number;
  imageCalls: Array<{ prompt: string; options: GenerateImageOptions }>;
  savedPaths: string[];
  mkdirPaths: string[];
  existingDirectories: Set<string>;
  imageError?: Error;
  textCalls: Array<{ prompt: string; options: GenerateTextOptions }>;
  textChunks: string[];
  textError?: Error;
  browserCommands: string[][];
  browserCommandStatus: number;
  immutableBundle: boolean;
  signalHandlers: Map<"SIGINT" | "SIGTERM", () => void>;
  terminatedSignals: Array<"SIGINT" | "SIGTERM">;
  imageGate?: Promise<void>;
  galleryListCalls: GalleryListOptions[];
  galleryGetCalls: Array<{ idOrUrl: string; options: GalleryGetOptions }>;
  galleryDownloadCalls: Array<{ entry: GalleryEntry; destination: string }>;
  galleryCloseCalls: number;
  galleryPage: GalleryPage;
  galleryEntry: GalleryEntry;
  galleryError?: Error;
  galleryDownloadError?: Error;
}

function createFakeDependencies(): CliDependencies & { state: FakeState } {
  const galleryEntry: GalleryEntry = {
    imageId: "d".repeat(64),
    imageUrl: `https://aigc.uploads.dev/image/${"d".repeat(64)}.jpeg`,
    prompt: "gallery prompt",
    channel: "ai-text-to-image-generator",
    subChannel: "public",
  };
  const state: FakeState = {
    stdout: "",
    stderr: "",
    launchCalls: [],
    browserCloseCalls: 0,
    imageCalls: [],
    savedPaths: [],
    mkdirPaths: [],
    existingDirectories: new Set(),
    textCalls: [],
    textChunks: [],
    browserCommands: [],
    browserCommandStatus: 0,
    immutableBundle: false,
    signalHandlers: new Map(),
    terminatedSignals: [],
    galleryListCalls: [],
    galleryGetCalls: [],
    galleryDownloadCalls: [],
    galleryCloseCalls: 0,
    galleryPage: { entries: [galleryEntry], nextCursor: "next-cursor" },
    galleryEntry,
  };
  const browser: BrowserContext = {
    async newPage() {
      throw new Error("unused fake page");
    },
    async close() {
      state.browserCloseCalls += 1;
    },
  };

  return {
    state,
    async launchBrowser(options) {
      state.launchCalls.push(options);
      return browser;
    },
    createImageGenerator() {
      return {
        setBrowserContext() {},
        async image(prompt, options) {
          state.imageCalls.push({ prompt, options });
          const imageNumber = state.imageCalls.length;
          await state.imageGate;
          if (state.imageError) throw state.imageError;
          return {
            imageId: `image-${imageNumber}`,
            fileExtension: "png",
            seed: 41 + imageNumber,
            prompt,
            width: 768,
            height: 768,
            guidanceScale: options.guidanceScale ?? 7,
            negativePrompt: options.negativePrompt ?? "",
            maybeNsfw: false,
            toString() {
              return `image-${imageNumber}.png`;
            },
            async save(path) {
              state.savedPaths.push(path);
              return path;
            },
          };
        },
      };
    },
    createTextGenerator() {
      return {
        setBrowserContext() {},
        async *stream(prompt, options) {
          state.textCalls.push({ prompt, options });
          if (state.textError) throw state.textError;
          for (const chunk of state.textChunks) yield chunk;
        },
      };
    },
    createGalleryClient() {
      return {
        async list(options: GalleryListOptions) {
          state.galleryListCalls.push(options);
          if (state.galleryError) throw state.galleryError;
          return state.galleryPage;
        },
        async get(idOrUrl: string, options: GalleryGetOptions) {
          state.galleryGetCalls.push({ idOrUrl, options });
          if (state.galleryError) throw state.galleryError;
          return state.galleryEntry;
        },
        async download(entry: GalleryEntry, destination: string) {
          state.galleryDownloadCalls.push({ entry, destination });
          if (state.galleryDownloadError) throw state.galleryDownloadError;
          return destination;
        },
        async close() {
          state.galleryCloseCalls += 1;
        },
      };
    },
    async runBrowserCommand(args) {
      state.browserCommands.push(args);
      return state.browserCommandStatus;
    },
    isImmutableBundle() {
      return state.immutableBundle;
    },
    stdout(text) {
      state.stdout += text;
    },
    stderr(text) {
      state.stderr += text;
    },
    cwd() {
      return "/work";
    },
    async pathExists(path) {
      return state.existingDirectories.has(path);
    },
    async isDirectory(path) {
      return state.existingDirectories.has(path);
    },
    async mkdir(path) {
      state.mkdirPaths.push(path);
    },
    onSignal(signal, handler) {
      state.signalHandlers.set(signal, handler);
      return () => state.signalHandlers.delete(signal);
    },
    terminateSignal(signal) {
      state.terminatedSignals.push(signal);
    },
  };
}

describe("CLI parsing", () => {
  it("shows the command surface", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli(
      ["node", "perchance", "--help"],
      dependencies,
    );

    assert.equal(status, 0);
    assert.match(dependencies.state.stdout, /image \[options\] <prompt>/);
    assert.match(dependencies.state.stdout, /text \[options\] <prompt>/);
    assert.match(dependencies.state.stdout, /gallery/);
    assert.match(dependencies.state.stdout, /browser/);
  });

  it("rejects invalid gallery arguments before launching a browser", async () => {
    const invalidLimit = createFakeDependencies();
    const invalidLimitStatus = await runCli(
      ["node", "perchance", "gallery", "list", "--limit", "101"],
      invalidLimit,
    );

    assert.equal(invalidLimitStatus, 1);
    assert.equal(invalidLimit.state.launchCalls.length, 0);

    const invalidId = createFakeDependencies();
    const invalidIdStatus = await runCli(
      ["node", "perchance", "gallery", "get", "not-an-id"],
      invalidId,
    );

    assert.equal(invalidIdStatus, 1);
    assert.equal(invalidId.state.launchCalls.length, 0);

    const invalidChannel = createFakeDependencies();
    const invalidChannelStatus = await runCli(
      [
        "node",
        "perchance",
        "gallery",
        "list",
        "--channel",
        "bad/channel",
      ],
      invalidChannel,
    );

    assert.equal(invalidChannelStatus, 1);
    assert.equal(invalidChannel.state.launchCalls.length, 0);
  });

  it("rejects an invalid image shape before launching a browser", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli(
      ["node", "perchance", "image", "cat", "--shape", "wide"],
      dependencies,
    );

    assert.equal(status, 1);
    assert.equal(dependencies.state.launchCalls.length, 0);
    assert.match(dependencies.state.stderr, /portrait, square, or landscape/);
  });

  it("rejects invalid numeric options", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli(
      ["node", "perchance", "image", "cat", "--seed", "nope"],
      dependencies,
    );

    assert.equal(status, 1);
    assert.equal(dependencies.state.launchCalls.length, 0);
    assert.match(dependencies.state.stderr, /integer/);
  });

  it("requires a prompt", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli(
      ["node", "perchance", "text"],
      dependencies,
    );

    assert.equal(status, 1);
    assert.equal(dependencies.state.launchCalls.length, 0);
    assert.match(dependencies.state.stderr, /missing required argument/);
  });
});

describe("image command", () => {
  it("generates with defaults, saves the image, and closes the browser", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli(
      ["node", "perchance", "image", "a red fox"],
      dependencies,
    );

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.launchCalls, [{ headless: true }]);
    assert.deepEqual(dependencies.state.imageCalls, [{
      prompt: "a red fox",
      options: { shape: "square", seed: -1, guidanceScale: 7 },
    }]);
    assert.deepEqual(dependencies.state.mkdirPaths, ["/work/generated_images"]);
    assert.deepEqual(dependencies.state.savedPaths, [
      "/work/generated_images/image-1.png",
    ]);
    assert.equal(
      dependencies.state.stdout,
      "/work/generated_images/image-1.png\n",
    );
    assert.equal(dependencies.state.browserCloseCalls, 1);
  });

  it("passes image options and treats an output filename exactly", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli([
      "node",
      "perchance",
      "image",
      "a blue fox",
      "--shape",
      "landscape",
      "--negative-prompt",
      "blur",
      "--seed",
      "12",
      "--guidance-scale",
      "8.5",
      "--output",
      "/work/output/fox.png",
      "--visible",
    ], dependencies);

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.launchCalls, [{ headless: false }]);
    assert.deepEqual(dependencies.state.imageCalls[0], {
      prompt: "a blue fox",
      options: {
        shape: "landscape",
        negativePrompt: "blur",
        seed: 12,
        guidanceScale: 8.5,
      },
    });
    assert.deepEqual(dependencies.state.mkdirPaths, ["/work/output"]);
    assert.deepEqual(dependencies.state.savedPaths, ["/work/output/fox.png"]);
  });

  it("generates multiple images through one browser context", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli([
      "node",
      "perchance",
      "image",
      "three foxes",
      "--count",
      "3",
      "--seed",
      "50",
    ], dependencies);

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.launchCalls, [{ headless: true }]);
    assert.deepEqual(dependencies.state.imageCalls, [
      {
        prompt: "three foxes",
        options: { shape: "square", seed: 50, guidanceScale: 7 },
      },
      {
        prompt: "three foxes",
        options: { shape: "square", seed: 51, guidanceScale: 7 },
      },
      {
        prompt: "three foxes",
        options: { shape: "square", seed: 52, guidanceScale: 7 },
      },
    ]);
    assert.deepEqual(dependencies.state.savedPaths, [
      "/work/generated_images/image-1.png",
      "/work/generated_images/image-2.png",
      "/work/generated_images/image-3.png",
    ]);
    assert.equal(
      dependencies.state.stdout,
      "/work/generated_images/image-1.png\n" +
        "/work/generated_images/image-2.png\n" +
        "/work/generated_images/image-3.png\n",
    );
    assert.equal(dependencies.state.browserCloseCalls, 1);
  });

  it("numbers an explicit output filename for a batch", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli([
      "node",
      "perchance",
      "image",
      "two foxes",
      "--count",
      "2",
      "--output",
      "/work/output/fox.png",
    ], dependencies);

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.savedPaths, [
      "/work/output/fox-1.png",
      "/work/output/fox-2.png",
    ]);
  });

  it("prints a JSON array for a multi-image batch", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.existingDirectories.add("/work/pictures");

    const status = await runCli([
      "node",
      "perchance",
      "image",
      "two green foxes",
      "--count",
      "2",
      "--output",
      "/work/pictures",
      "--json",
    ], dependencies);

    assert.equal(status, 0);
    const output = JSON.parse(dependencies.state.stdout);
    assert.equal(output.length, 2);
    assert.equal(output[0].path, "/work/pictures/image-1.png");
    assert.equal(output[1].path, "/work/pictures/image-2.png");
    assert.equal(output[0].imageId, "image-1");
    assert.equal(output[1].imageId, "image-2");
  });

  it("rejects an unsafe image count before launching a browser", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli([
      "node",
      "perchance",
      "image",
      "too many foxes",
      "--count",
      "101",
    ], dependencies);

    assert.equal(status, 1);
    assert.equal(dependencies.state.launchCalls.length, 0);
    assert.match(dependencies.state.stderr, /at most 100/);
  });

  it("appends the generated name to an output directory and prints JSON", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.existingDirectories.add("/work/pictures");

    const status = await runCli([
      "node",
      "perchance",
      "image",
      "a green fox",
      "--output",
      "/work/pictures",
      "--json",
    ], dependencies);

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.savedPaths, [
      "/work/pictures/image-1.png",
    ]);
    assert.deepEqual(JSON.parse(dependencies.state.stdout), {
      path: "/work/pictures/image-1.png",
      imageId: "image-1",
      fileExtension: "png",
      seed: 42,
      prompt: "a green fox",
      width: 768,
      height: 768,
      guidanceScale: 7,
      negativePrompt: "",
      maybeNsfw: false,
    });
  });

  it("reports generation failures and still closes the browser", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.imageError = new Error("generation failed");

    const status = await runCli(
      ["node", "perchance", "image", "a broken fox"],
      dependencies,
    );

    assert.equal(status, 1);
    assert.equal(dependencies.state.browserCloseCalls, 1);
    assert.equal(dependencies.state.stderr, "Error: generation failed\n");
  });
});

describe("gallery commands", () => {
  it("lists entries with defaults as one gallery-page object", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli(
      ["node", "perchance", "gallery", "list"],
      dependencies,
    );

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
      "node",
      "perchance",
      "gallery",
      "list",
      "--channel",
      "demo-channel",
      "--limit",
      "2",
      "--cursor",
      cursor,
      "--sort",
      "top",
      "--time-range",
      "1-week",
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

    const status = await runCli(
      ["node", "perchance", "gallery", "get", url],
      dependencies,
    );

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.galleryGetCalls, [{
      idOrUrl: url,
      options: {
        channel: "ai-text-to-image-generator",
        contentFilter: "g",
      },
    }]);
    assert.deepEqual(
      JSON.parse(dependencies.state.stdout),
      dependencies.state.galleryEntry,
    );
  });

  it("downloads list entries with collision-safe deterministic names", async () => {
    const dependencies = createFakeDependencies();
    const initial =
      `/work/gallery_images/${dependencies.state.galleryEntry.imageId}.jpeg`;
    dependencies.state.existingDirectories.add(initial);

    const status = await runCli(
      ["node", "perchance", "gallery", "list", "--download"],
      dependencies,
    );

    const expected =
      `/work/gallery_images/${dependencies.state.galleryEntry.imageId}-2.jpeg`;
    assert.equal(status, 0);
    assert.equal(
      dependencies.state.galleryDownloadCalls[0].destination,
      expected,
    );
    assert.equal(
      JSON.parse(dependencies.state.stdout).entries[0].filePath,
      expected,
    );
  });

  it("treats an image extension as an exact get filename", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli([
      "node",
      "perchance",
      "gallery",
      "get",
      dependencies.state.galleryEntry.imageId,
      "--download",
      "--output",
      "selected.jpeg",
    ], dependencies);

    assert.equal(status, 0);
    assert.equal(
      dependencies.state.galleryDownloadCalls[0].destination,
      "/work/selected.jpeg",
    );
    assert.equal(
      JSON.parse(dependencies.state.stdout).filePath,
      "/work/selected.jpeg",
    );
  });

  it("treats an extensionless get output as a directory", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli([
      "node",
      "perchance",
      "gallery",
      "get",
      dependencies.state.galleryEntry.imageId,
      "--download",
      "--output",
      "selected",
    ], dependencies);

    assert.equal(status, 0);
    assert.equal(
      dependencies.state.galleryDownloadCalls[0].destination,
      `/work/selected/${dependencies.state.galleryEntry.imageId}.jpeg`,
    );
  });

  it("prints no partial JSON and closes resources after a download error", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.galleryDownloadError = new Error("download failed");

    const status = await runCli(
      ["node", "perchance", "gallery", "list", "--download"],
      dependencies,
    );

    assert.equal(status, 1);
    assert.equal(dependencies.state.stdout, "");
    assert.match(dependencies.state.stderr, /download failed/);
    assert.equal(dependencies.state.galleryCloseCalls, 1);
    assert.equal(dependencies.state.browserCloseCalls, 1);
  });
});

describe("text command", () => {
  it("streams generated text and terminates console output", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.textChunks = ["hello", " world"];

    const status = await runCli(
      ["node", "perchance", "text", "greet me"],
      dependencies,
    );

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.launchCalls, [{ headless: true }]);
    assert.deepEqual(dependencies.state.textCalls, [{
      prompt: "greet me",
      options: { stopSequences: [] },
    }]);
    assert.equal(dependencies.state.stdout, "hello world\n");
    assert.equal(dependencies.state.browserCloseCalls, 1);
  });

  it("does not duplicate a generated trailing newline", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.textChunks = ["hello", " world\n"];

    const status = await runCli(
      ["node", "perchance", "text", "greet me"],
      dependencies,
    );

    assert.equal(status, 0);
    assert.equal(dependencies.state.stdout, "hello world\n");
    assert.equal(dependencies.state.browserCloseCalls, 1);
  });

  it("passes text options and returns JSON from a visible browser", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.textChunks = ["first", " second"];

    const status = await runCli([
      "node",
      "perchance",
      "text",
      "continue this",
      "--start-with",
      "Once",
      "--stop",
      ".",
      "--stop",
      "!",
      "--timeout",
      "12000",
      "--visible",
      "--json",
    ], dependencies);

    assert.equal(status, 0);
    assert.deepEqual(dependencies.state.launchCalls, [{ headless: false }]);
    assert.deepEqual(dependencies.state.textCalls, [{
      prompt: "continue this",
      options: {
        startWith: "Once",
        stopSequences: [".", "!"],
        timeoutMs: 12000,
      },
    }]);
    assert.deepEqual(JSON.parse(dependencies.state.stdout), {
      text: "first second",
    });
    assert.equal(dependencies.state.browserCloseCalls, 1);
  });

  it("rejects a non-positive timeout before launching a browser", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli([
      "node",
      "perchance",
      "text",
      "hello",
      "--timeout",
      "0",
    ], dependencies);

    assert.equal(status, 1);
    assert.equal(dependencies.state.launchCalls.length, 0);
    assert.match(dependencies.state.stderr, /positive integer/);
  });

  it("reports stream failures and still closes the browser", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.textError = new Error("stream failed");

    const status = await runCli(
      ["node", "perchance", "text", "break"],
      dependencies,
    );

    assert.equal(status, 1);
    assert.equal(dependencies.state.browserCloseCalls, 1);
    assert.equal(dependencies.state.stderr, "Error: stream failed\n");
  });
});

describe("browser command", () => {
  for (const subcommand of ["fetch", "path", "version"]) {
    it(`forwards browser ${subcommand} to Camoufox`, async () => {
      const dependencies = createFakeDependencies();

      const status = await runCli(
        ["node", "perchance", "browser", subcommand],
        dependencies,
      );

      assert.equal(status, 0);
      assert.deepEqual(dependencies.state.browserCommands, [[subcommand]]);
    });
  }

  it("returns a nonzero Camoufox status", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.browserCommandStatus = 7;

    const status = await runCli(
      ["node", "perchance", "browser", "version"],
      dependencies,
    );

    assert.equal(status, 7);
  });

  it("rejects browser fetch inside an immutable AppImage", async () => {
    const dependencies = createFakeDependencies();
    dependencies.state.immutableBundle = true;

    const status = await runCli(
      ["node", "perchance", "browser", "fetch"],
      dependencies,
    );

    assert.equal(status, 1);
    assert.deepEqual(dependencies.state.browserCommands, []);
    assert.equal(
      dependencies.state.stderr,
      "Error: Camoufox is embedded in this immutable AppImage. " +
        "Replace or rebuild the AppImage to update it.\n",
    );
  });
});

describe("browser lifecycle", () => {
  it("closes an active browser once when interrupted", async () => {
    const dependencies = createFakeDependencies();
    let releaseImage!: () => void;
    dependencies.state.imageGate = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });

    const command = runCli(
      ["node", "perchance", "image", "waiting fox"],
      dependencies,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    const interrupt = dependencies.state.signalHandlers.get("SIGINT");
    assert.ok(interrupt, "SIGINT handler must be registered after launch");
    interrupt();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(dependencies.state.browserCloseCalls, 1);
    assert.deepEqual(dependencies.state.terminatedSignals, ["SIGINT"]);
    releaseImage();
    assert.equal(await command, 0);
    assert.equal(dependencies.state.browserCloseCalls, 1);
    assert.equal(dependencies.state.signalHandlers.size, 0);
  });
});
