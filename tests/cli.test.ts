import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BrowserContext } from "../src/generator.js";
import { runCli, type CliDependencies } from "../src/cli/program.js";
import type {
  GenerateImageOptions,
  GenerateTextOptions,
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
}

function createFakeDependencies(): CliDependencies & { state: FakeState } {
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
          await state.imageGate;
          if (state.imageError) throw state.imageError;
          return {
            imageId: "image-1",
            fileExtension: "png",
            seed: 42,
            prompt,
            width: 768,
            height: 768,
            guidanceScale: options.guidanceScale ?? 7,
            negativePrompt: options.negativePrompt ?? "",
            maybeNsfw: false,
            toString() {
              return "image-1.png";
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
    assert.match(dependencies.state.stdout, /browser/);
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

describe("text command", () => {
  it("streams generated text without adding a newline", async () => {
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
    assert.equal(dependencies.state.stdout, "hello world");
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
