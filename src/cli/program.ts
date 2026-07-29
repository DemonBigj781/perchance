import { access, mkdir, stat } from "node:fs/promises";

import {
  Command,
  CommanderError,
  InvalidArgumentError,
  type OptionValues,
} from "commander";

import { launchCamoufox } from "../camoufox.js";
import type { BrowserContext } from "../generator.js";
import { ImageGenerator } from "../imageGenerator.js";
import { TextGenerator } from "../textGenerator.js";
import type {
  GenerateImageOptions,
  GenerateTextOptions,
  ImageShape,
} from "../types.js";

export interface ImageResultLike {
  readonly imageId: string;
  readonly fileExtension: string;
  readonly seed: number;
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
  readonly guidanceScale: number;
  readonly negativePrompt: string;
  readonly maybeNsfw: boolean;
  toString(): string;
  save(path: string): Promise<string>;
}

export interface ImageGeneratorLike {
  setBrowserContext(context: BrowserContext): void;
  image(
    prompt: string,
    options: GenerateImageOptions,
  ): Promise<ImageResultLike>;
}

export interface TextGeneratorLike {
  setBrowserContext(context: BrowserContext): void;
  stream(
    prompt: string,
    options: GenerateTextOptions,
  ): AsyncGenerator<string, void, undefined>;
}

export interface CliDependencies {
  launchBrowser(options: { headless: boolean }): Promise<BrowserContext>;
  createImageGenerator(): ImageGeneratorLike;
  createTextGenerator(): TextGeneratorLike;
  runBrowserCommand(args: string[]): Promise<number>;
  stdout(text: string): void;
  stderr(text: string): void;
  cwd(): string;
  pathExists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  onSignal(
    signal: "SIGINT" | "SIGTERM",
    handler: () => void,
  ): () => void;
}

const IMAGE_SHAPES: readonly ImageShape[] = [
  "portrait",
  "square",
  "landscape",
];

function parseInteger(value: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new InvalidArgumentError("Expected an integer.");
  }
  return Number(value);
}

function parseFiniteNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new InvalidArgumentError("Expected a finite number.");
  }
  return parsed;
}

function parsePositiveInteger(value: string): number {
  const parsed = parseInteger(value);
  if (parsed <= 0) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  return parsed;
}

function parseShape(value: string): ImageShape {
  if (!IMAGE_SHAPES.includes(value as ImageShape)) {
    throw new InvalidArgumentError(
      "Expected portrait, square, or landscape.",
    );
  }
  return value as ImageShape;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const productionDependencies: CliDependencies = {
  launchBrowser: launchCamoufox,
  createImageGenerator: () => new ImageGenerator(),
  createTextGenerator: () => new TextGenerator(),
  async runBrowserCommand() {
    throw new Error("Browser management is not available yet.");
  },
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: () => process.cwd(),
  async pathExists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  async isDirectory(path) {
    return (await stat(path)).isDirectory();
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  onSignal(signal, handler) {
    process.once(signal, handler);
    return () => process.off(signal, handler);
  },
};

function addImageCommand(program: Command): void {
  program
    .command("image")
    .description("Generate and save an image")
    .argument("<prompt>", "image prompt")
    .option("-o, --output <path>", "destination file or directory")
    .option("--shape <shape>", "portrait, square, or landscape", parseShape, "square")
    .option("--negative-prompt <text>", "features to avoid")
    .option("--seed <number>", "generation seed", parseInteger, -1)
    .option("--guidance-scale <number>", "guidance scale", parseFiniteNumber, 7)
    .option("--json", "print structured JSON")
    .option("--visible", "show the Camoufox window")
    .action(async (_prompt: string, _options: OptionValues) => {
      throw new Error("Image command is not implemented yet.");
    });
}

function addTextCommand(program: Command): void {
  program
    .command("text")
    .description("Generate text")
    .argument("<prompt>", "text prompt")
    .option("--start-with <text>", "initial generated prefix")
    .option("--stop <sequence>", "stop sequence", collect, [])
    .option("--timeout <milliseconds>", "per-chunk timeout", parsePositiveInteger)
    .option("--json", "print structured JSON")
    .option("--visible", "show the Camoufox window")
    .action(async (_prompt: string, _options: OptionValues) => {
      throw new Error("Text command is not implemented yet.");
    });
}

function addBrowserCommand(program: Command): void {
  const browser = program
    .command("browser")
    .description("Manage the Camoufox browser installation");

  for (const command of ["fetch", "path", "version"] as const) {
    browser
      .command(command)
      .description(`${command} Camoufox browser information`)
      .action(async () => {
        throw new Error("Browser management is not implemented yet.");
      });
  }
}

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = productionDependencies,
): Promise<number> {
  const program = new Command()
    .name("perchance")
    .description("Generate images and text through Perchance")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: dependencies.stdout,
      writeErr: dependencies.stderr,
    });

  addImageCommand(program);
  addTextCommand(program);
  addBrowserCommand(program);

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.code === "commander.helpDisplayed" ? 0 : 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    dependencies.stderr(`Error: ${message}\n`);
    return 1;
  }
}
