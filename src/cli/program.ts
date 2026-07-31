import { access, mkdir, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

import {
  Command,
  CommanderError,
  InvalidArgumentError,
  type OptionValues,
} from "commander";

import { launchCamoufox } from "../camoufox.js";
import { GalleryClient } from "../galleryClient.js";
import type { BrowserContext } from "../generator.js";
import { ImageGenerator } from "../imageGenerator.js";
import {
  decodeGalleryCursor,
  parseGalleryImageId,
  trustedImageExtension,
  validateGalleryChannel,
  validateGalleryContentFilter,
  validateGalleryTimeRange,
} from "../internal/galleryProtocol.js";
import { TextGenerator } from "../textGenerator.js";
import type {
  GenerateImageOptions,
  GenerateTextOptions,
  GalleryEntry,
  GalleryGetOptions,
  GalleryListOptions,
  GalleryPage,
  GallerySort,
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

export interface GalleryClientLike {
  list(options: GalleryListOptions): Promise<GalleryPage>;
  get(idOrUrl: string, options: GalleryGetOptions): Promise<GalleryEntry>;
  download(entry: GalleryEntry, destination: string): Promise<string>;
  close(): Promise<void>;
}

export interface CliDependencies {
  launchBrowser(options: { headless: boolean }): Promise<BrowserContext>;
  createImageGenerator(): ImageGeneratorLike;
  createTextGenerator(): TextGeneratorLike;
  createGalleryClient(context: BrowserContext): GalleryClientLike;
  runBrowserCommand(args: string[]): Promise<number>;
  isImmutableBundle(): boolean;
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

function parseImageCount(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 100) {
    throw new InvalidArgumentError("Expected at most 100 images.");
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

function parseGalleryLimit(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 100) {
    throw new InvalidArgumentError("Expected at most 100 gallery entries.");
  }
  return parsed;
}

function parseGallerySort(value: string): GallerySort {
  if (value !== "recent" && value !== "top" && value !== "trending") {
    throw new InvalidArgumentError("Expected recent, top, or trending.");
  }
  return value;
}

function commanderValue<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new InvalidArgumentError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function parseGalleryId(value: string): string {
  commanderValue(() => parseGalleryImageId(value));
  return value;
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

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const productionDependencies: CliDependencies = {
  launchBrowser: launchCamoufox,
  createImageGenerator: () => new ImageGenerator(),
  createTextGenerator: () => new TextGenerator(),
  createGalleryClient: (context) => new GalleryClient({ browserContext: context }),
  runBrowserCommand: runCamoufoxCommand,
  isImmutableBundle: () => process.env.PERCHANCE_APPIMAGE === "1",
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
  count: number;
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
  batchIndex = 0,
  batchCount = 1,
): Promise<string> {
  if (!requested) {
    const directory = join(dependencies.cwd(), "generated_images");
    await dependencies.mkdir(directory);
    return join(directory, generatedName);
  }

  let destination = absolutePath(requested, dependencies);
  const endsWithSeparator = /[\\/]$/.test(requested);
  const exists = await dependencies.pathExists(destination);
  const isDirectory = exists && await dependencies.isDirectory(destination);

  if (endsWithSeparator || isDirectory) {
    await dependencies.mkdir(destination);
    return join(destination, generatedName);
  }

  if (batchCount > 1) {
    const extension = extname(destination);
    const stem = extension
      ? destination.slice(0, -extension.length)
      : destination;
    destination = `${stem}-${batchIndex + 1}${extension}`;
  }

  await dependencies.mkdir(dirname(destination));
  return destination;
}

async function resolveGalleryDirectory(
  requested: string | undefined,
  dependencies: CliDependencies,
): Promise<string> {
  const directory = requested
    ? absolutePath(requested, dependencies)
    : join(dependencies.cwd(), "gallery_images");
  if (
    await dependencies.pathExists(directory) &&
    !await dependencies.isDirectory(directory)
  ) {
    throw new Error(`Gallery output is not a directory: ${directory}`);
  }
  await dependencies.mkdir(directory);
  return directory;
}

async function availableGalleryPath(
  directory: string,
  generatedName: string,
  dependencies: CliDependencies,
): Promise<string> {
  const extension = extname(generatedName);
  const stem = extension
    ? generatedName.slice(0, -extension.length)
    : generatedName;
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
  const generatedName =
    `${entry.imageId}.${trustedImageExtension(entry.imageUrl)}`;
  if (!requested) {
    const directory = await resolveGalleryDirectory(undefined, dependencies);
    return await availableGalleryPath(directory, generatedName, dependencies);
  }

  const destination = absolutePath(requested, dependencies);
  if (/\.(?:png|jpe?g|webp)$/i.test(destination)) {
    await dependencies.mkdir(dirname(destination));
    return destination;
  }

  const directory = await resolveGalleryDirectory(requested, dependencies);
  return await availableGalleryPath(directory, generatedName, dependencies);
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
    .option("-n, --count <number>", "number of images", parseImageCount, 1)
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

        const jsonResults: Array<Record<string, unknown>> = [];
        for (let index = 0; index < options.count; index += 1) {
          const generationOptions: GenerateImageOptions = {
            shape: options.shape,
            seed: options.seed === -1 ? -1 : options.seed + index,
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
            index,
            options.count,
          );
          const savedPath = await result.save(output);
          const jsonResult = {
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
          };

          if (options.json) {
            jsonResults.push(jsonResult);
          } else {
            dependencies.stdout(`${savedPath}\n`);
          }
        }

        if (options.json) {
          const output = options.count === 1 ? jsonResults[0] : jsonResults;
          dependencies.stdout(`${JSON.stringify(output)}\n`);
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
        let wroteText = false;
        let endsWithLineBreak = false;
        for await (const chunk of generator.stream(prompt, generationOptions)) {
          if (options.json) {
            chunks.push(chunk);
          } else {
            dependencies.stdout(chunk);
            if (chunk.length > 0) {
              wroteText = true;
              endsWithLineBreak = /[\r\n]$/.test(chunk);
            }
          }
        }

        if (options.json) {
          dependencies.stdout(`${JSON.stringify({ text: chunks.join("") })}\n`);
        } else if (wroteText && !endsWithLineBreak) {
          dependencies.stdout("\n");
        }
      });
    });
}

interface GalleryListCommandOptions extends OptionValues {
  channel: string;
  contentFilter: string;
  limit: number;
  cursor?: string;
  sort: GallerySort;
  timeRange?: string;
  download?: boolean;
  output?: string;
  visible?: boolean;
}

interface GalleryGetCommandOptions extends OptionValues {
  channel: string;
  contentFilter: string;
  download?: boolean;
  output?: string;
  visible?: boolean;
}

function addGalleryCommand(
  program: Command,
  dependencies: CliDependencies,
): void {
  const gallery = program
    .command("gallery")
    .description("Retrieve public gallery images and prompts");

  gallery
    .command("list")
    .description("List public gallery entries")
    .option(
      "--channel <name>",
      "gallery channel",
      parseGalleryChannel,
      "ai-text-to-image-generator",
    )
    .option(
      "--content-filter <value>",
      "gallery content filter",
      parseGalleryContentFilter,
      "g",
    )
    .option("--limit <number>", "number of entries", parseGalleryLimit, 20)
    .option(
      "--cursor <value>",
      "opaque continuation cursor",
      parseGalleryCursor,
    )
    .option(
      "--sort <value>",
      "recent, top, or trending",
      parseGallerySort,
      "recent",
    )
    .option(
      "--time-range <value>",
      "gallery time range",
      parseGalleryTimeRange,
    )
    .option("--download", "download returned images")
    .option("-o, --output <path>", "download directory")
    .option("--visible", "show the Camoufox window")
    .action(async (options: GalleryListCommandOptions) => {
      await withBrowserContext(dependencies, options.visible, async (context) => {
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
          let output: Array<GalleryEntry & { filePath?: string }> =
            page.entries.map((entry) => ({ ...entry }));
          if (options.download) {
            const directory = await resolveGalleryDirectory(
              options.output,
              dependencies,
            );
            output = [];
            for (const entry of page.entries) {
              const generatedName =
                `${entry.imageId}.${trustedImageExtension(entry.imageUrl)}`;
              const destination = await availableGalleryPath(
                directory,
                generatedName,
                dependencies,
              );
              output.push({
                ...entry,
                filePath: await client.download(entry, destination),
              });
            }
          }
          dependencies.stdout(
            `${JSON.stringify({
              entries: output,
              nextCursor: page.nextCursor,
            })}\n`,
          );
        } finally {
          await client.close();
        }
      });
    });

  gallery
    .command("get")
    .description("Retrieve one public gallery entry")
    .argument(
      "<id-or-url>",
      "gallery image ID or supported URL",
      parseGalleryId,
    )
    .option(
      "--channel <name>",
      "gallery channel",
      parseGalleryChannel,
      "ai-text-to-image-generator",
    )
    .option(
      "--content-filter <value>",
      "gallery content filter",
      parseGalleryContentFilter,
      "g",
    )
    .option("--download", "download the returned image")
    .option("-o, --output <path>", "destination file or directory")
    .option("--visible", "show the Camoufox window")
    .action(
      async (idOrUrl: string, options: GalleryGetCommandOptions) => {
        await withBrowserContext(
          dependencies,
          options.visible,
          async (context) => {
            const client = dependencies.createGalleryClient(context);
            try {
              const entry = await client.get(idOrUrl, {
                channel: options.channel,
                contentFilter: options.contentFilter,
              });
              const output: GalleryEntry & { filePath?: string } = {
                ...entry,
              };
              if (options.download) {
                output.filePath = await client.download(
                  entry,
                  await resolveGalleryGetOutput(
                    options.output,
                    entry,
                    dependencies,
                  ),
                );
              }
              dependencies.stdout(`${JSON.stringify(output)}\n`);
            } finally {
              await client.close();
            }
          },
        );
      },
    );
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
        if (command === "fetch" && dependencies.isImmutableBundle()) {
          dependencies.stderr(
            "Error: Camoufox is embedded in this immutable AppImage. " +
              "Replace or rebuild the AppImage to update it.\n",
          );
          setStatus(1);
          return;
        }
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
    .description("Generate and retrieve content through Perchance")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: dependencies.stdout,
      writeErr: dependencies.stderr,
    });

  addImageCommand(program, dependencies);
  addTextCommand(program, dependencies);
  addGalleryCommand(program, dependencies);
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
