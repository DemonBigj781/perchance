import { access, mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

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
import { runCamoufoxCommand } from "./browser.js";

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
  terminateSignal(signal: "SIGINT" | "SIGTERM"): void;
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
  runBrowserCommand: runCamoufoxCommand,
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
  terminateSignal(signal) {
    process.kill(process.pid, signal);
  },
};

async function withBrowserContext<T>(
  dependencies: CliDependencies,
  visible: boolean | undefined,
  action: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const context = await dependencies.launchBrowser({ headless: !visible });
  let closePromise: Promise<void> | undefined;
  const closeOnce = (): Promise<void> => {
    closePromise ??= context.close();
    return closePromise;
  };
  const removers = (["SIGINT", "SIGTERM"] as const).map((signal) =>
    dependencies.onSignal(signal, () => {
      void closeOnce().finally(() => dependencies.terminateSignal(signal));
    })
  );

  try {
    return await action(context);
  } finally {
    for (const remove of removers) remove();
    await closeOnce();
  }
}

interface ImageCommandOptions extends OptionValues {
  output?: string;
  shape: ImageShape;
  negativePrompt?: string;
  seed: number;
  guidanceScale: number;
  json?: boolean;
  visible?: boolean;
}

function absolutePath(path: string, dependencies: CliDependencies): string {
  return isAbsolute(path) ? path : resolve(dependencies.cwd(), path);
}

export async function resolveImageOutput(
  requested: string | undefined,
  generatedName: string,
  dependencies: CliDependencies,
): Promise<string> {
  if (!requested) {
    const directory = join(dependencies.cwd(), "generated_images");
    await dependencies.mkdir(directory);
    return join(directory, generatedName);
  }

  const destination = absolutePath(requested, dependencies);
  const endsWithSeparator = /[\\/]$/.test(requested);
  const exists = await dependencies.pathExists(destination);
  const isDirectory = exists && await dependencies.isDirectory(destination);

  if (endsWithSeparator || isDirectory) {
    await dependencies.mkdir(destination);
    return join(destination, generatedName);
  }

  await dependencies.mkdir(dirname(destination));
  return destination;
}

function addImageCommand(
  program: Command,
  dependencies: CliDependencies,
): void {
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
    .action(async (prompt: string, options: ImageCommandOptions) => {
      await withBrowserContext(dependencies, options.visible, async (context) => {
        const generator = dependencies.createImageGenerator();
        generator.setBrowserContext(context);

        const generationOptions: GenerateImageOptions = {
          shape: options.shape,
          seed: options.seed,
          guidanceScale: options.guidanceScale,
        };
        if (options.negativePrompt !== undefined) {
          generationOptions.negativePrompt = options.negativePrompt;
        }

        const result = await generator.image(prompt, generationOptions);
        const output = await resolveImageOutput(
          options.output,
          result.toString(),
          dependencies,
        );
        const savedPath = await result.save(output);

        if (options.json) {
          dependencies.stdout(`${JSON.stringify({
            path: savedPath,
            imageId: result.imageId,
            fileExtension: result.fileExtension,
            seed: result.seed,
            prompt: result.prompt,
            width: result.width,
            height: result.height,
            guidanceScale: result.guidanceScale,
            negativePrompt: result.negativePrompt,
            maybeNsfw: result.maybeNsfw,
          })}\n`);
        } else {
          dependencies.stdout(`${savedPath}\n`);
        }
      });
    });
}

interface TextCommandOptions extends OptionValues {
  startWith?: string;
  stop: string[];
  timeout?: number;
  json?: boolean;
  visible?: boolean;
}

function addTextCommand(
  program: Command,
  dependencies: CliDependencies,
): void {
  program
    .command("text")
    .description("Generate text")
    .argument("<prompt>", "text prompt")
    .option("--start-with <text>", "initial generated prefix")
    .option("--stop <sequence>", "stop sequence", collect, [])
    .option("--timeout <milliseconds>", "per-chunk timeout", parsePositiveInteger)
    .option("--json", "print structured JSON")
    .option("--visible", "show the Camoufox window")
    .action(async (prompt: string, options: TextCommandOptions) => {
      await withBrowserContext(dependencies, options.visible, async (context) => {
        const generator = dependencies.createTextGenerator();
        generator.setBrowserContext(context);

        const generationOptions: GenerateTextOptions = {
          stopSequences: options.stop,
        };
        if (options.startWith !== undefined) {
          generationOptions.startWith = options.startWith;
        }
        if (options.timeout !== undefined) {
          generationOptions.timeoutMs = options.timeout;
        }

        const chunks: string[] = [];
        for await (const chunk of generator.stream(prompt, generationOptions)) {
          if (options.json) {
            chunks.push(chunk);
          } else {
            dependencies.stdout(chunk);
          }
        }

        if (options.json) {
          dependencies.stdout(`${JSON.stringify({ text: chunks.join("") })}\n`);
        }
      });
    });
}

function addBrowserCommand(
  program: Command,
  dependencies: CliDependencies,
  setStatus: (status: number) => void,
): void {
  const browser = program
    .command("browser")
    .description("Manage the Camoufox browser installation");

  for (const command of ["fetch", "path", "version"] as const) {
    browser
      .command(command)
      .description(`${command} Camoufox browser information`)
      .action(async () => {
        setStatus(await dependencies.runBrowserCommand([command]));
      });
  }
}

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = productionDependencies,
): Promise<number> {
  let status = 0;
  const program = new Command()
    .name("perchance")
    .description("Generate images and text through Perchance")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: dependencies.stdout,
      writeErr: dependencies.stderr,
    });

  addImageCommand(program, dependencies);
  addTextCommand(program, dependencies);
  addBrowserCommand(program, dependencies, (nextStatus) => {
    status = nextStatus;
  });

  try {
    await program.parseAsync(argv);
    return status;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.code === "commander.helpDisplayed" ? 0 : 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    dependencies.stderr(`Error: ${message}\n`);
    return 1;
  }
}
