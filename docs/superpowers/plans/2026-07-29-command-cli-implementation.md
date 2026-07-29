# Perchance Command CLI Implementation Plan

<!-- markdownlint-disable MD013 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and user-globally install a tested `perchance` command with image, text, and Camoufox browser-management subcommands.

**Architecture:** A thin executable delegates to a testable Commander program factory. Generation actions receive injected factories and output streams, while Camoufox management delegates to an injected child-process runner; production defaults connect these seams to the existing library classes and local `camoufox-js` executable.

**Tech Stack:** TypeScript, Node.js 22+, Commander.js 14, Node test runner, Camoufox-JS, Playwright Core.

---

## File Map

- Create `src/cli.ts`: executable shebang and top-level process error handling.
- Create `src/cli/program.ts`: command definitions, option parsing, generation orchestration, output formatting, and cleanup.
- Create `src/cli/browser.ts`: resolve and run the installed `camoufox-js` executable.
- Create `tests/cli.test.ts`: parser, image, text, browser, output, and cleanup tests using injected fakes.
- Modify `tests/package.test.ts`: assert the packed package declares the executable.
- Modify `package.json`: direct Commander dependency, Node engine, bin entry, and CLI test registration.
- Modify `README.md`: command installation and usage examples.

### Task 1: Declare The Executable Package Contract

**Files:**

- Modify: `tests/package.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing package test**

Extend the package metadata test with:

```typescript
it("declares the perchance executable", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(projectRoot, "package.json"), "utf8"),
  ) as { bin?: Record<string, string>; engines?: { node?: string } };

  assert.equal(packageJson.bin?.perchance, "dist/src/cli.js");
  assert.equal(packageJson.engines?.node, ">=22");
  await access(resolve(projectRoot, packageJson.bin.perchance));
});
```

- [ ] **Step 2: Run the package test and verify RED**

Run: `npm test`

Expected: FAIL because `packageJson.bin?.perchance` is undefined.

- [ ] **Step 3: Add package metadata and Commander**

Add these fields to `package.json`:

```json
"bin": {
  "perchance": "dist/src/cli.js"
},
"engines": {
  "node": ">=22"
}
```

Add `"commander": "^14.0.3"` to runtime dependencies and add
`dist/tests/cli.test.js` to the explicit unit-test command.

Run: `npm install --ignore-scripts`

- [ ] **Step 4: Add the temporary executable stub**

Create `src/cli.ts` so the package contract can compile before behavior exists:

```typescript
#!/usr/bin/env node

export {};
```

- [ ] **Step 5: Verify GREEN**

Run: `npm test`

Expected: all package and existing library tests pass.

- [ ] **Step 6: Commit**

Run: `git add package.json tests/package.test.ts src/cli.ts && git commit -m "feat(cli): declare executable package entry"`

### Task 2: Build The Testable Program And Validation

**Files:**

- Create: `src/cli/program.ts`
- Create: `tests/cli.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing parser and help tests**

Create fake writable streams that collect strings, then test:

```typescript
it("shows the command surface", async () => {
  const output = createOutput();
  const result = await runCli(["node", "perchance", "--help"], fakeDependencies(output));

  assert.equal(result, 0);
  assert.match(output.stdout, /image <prompt>/);
  assert.match(output.stdout, /text <prompt>/);
  assert.match(output.stdout, /browser/);
});

it("rejects an invalid image shape before launching a browser", async () => {
  const deps = fakeDependencies(createOutput());
  const result = await runCli(
    ["node", "perchance", "image", "cat", "--shape", "wide"],
    deps,
  );

  assert.equal(result, 1);
  assert.equal(deps.launchCalls.length, 0);
});
```

Also cover invalid integers, invalid finite numbers, non-positive timeout values,
and missing prompts.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: TypeScript or test failure because `runCli` and the program do not exist.

- [ ] **Step 3: Implement the program factory and parsers**

Create `src/cli/program.ts` with these public seams:

```typescript
interface ImageResultLike {
  imageId: string;
  fileExtension: string;
  seed: number;
  prompt: string;
  width: number;
  height: number;
  guidanceScale: number;
  negativePrompt: string;
  maybeNsfw: boolean;
  toString(): string;
  save(path: string): Promise<string>;
}

interface ImageGeneratorLike {
  setBrowserContext(context: BrowserContext): void;
  image(prompt: string, options: GenerateImageOptions): Promise<ImageResultLike>;
}

interface TextGeneratorLike {
  setBrowserContext(context: BrowserContext): void;
  stream(prompt: string, options: GenerateTextOptions): AsyncGenerator<string>;
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

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = productionDependencies,
): Promise<number>;
```

Use Commander `parseAsync`, `configureOutput`, and `exitOverride`. Implement
`parseInteger`, `parseFiniteNumber`, `parsePositiveInteger`, `parseShape`, and a
repeatable `collect` parser using `InvalidArgumentError`. Convert Commander
help exits to status `0` and input errors to status `1` without terminating the
test process.

- [ ] **Step 4: Connect the executable**

Replace the stub in `src/cli.ts` with:

```typescript
#!/usr/bin/env node

import { runCli } from "./cli/program.js";

process.exitCode = await runCli(process.argv);
```

- [ ] **Step 5: Verify GREEN**

Run: `npm test`

Expected: parser and help tests pass without launching Camoufox.

- [ ] **Step 6: Commit**

Run: `git add src/cli.ts src/cli/program.ts tests/cli.test.ts && git commit -m "feat(cli): add command parser and validation"`

### Task 3: Implement Image Generation

**Files:**

- Modify: `src/cli/program.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Write failing image-command tests**

Use a fake image result with stable metadata and a `save` call recorder. Cover:

```typescript
it("generates an image with defaults and closes the browser", async () => {
  const deps = fakeDependencies(createOutput());
  const result = await runCli(["node", "perchance", "image", "a red fox"], deps);

  assert.equal(result, 0);
  assert.deepEqual(deps.imageCalls, [{
    prompt: "a red fox",
    options: { shape: "square", seed: -1, guidanceScale: 7 },
  }]);
  assert.equal(deps.browserCloseCalls, 1);
  assert.match(deps.output.stdout, /generated_images\/image-1\.png/);
});
```

Add tests for all image options, `--visible`, exact output files, existing output
directories, trailing-separator directories, directory creation, JSON metadata,
save failures, generation failures, and cleanup on every outcome.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: image tests fail because the action has no implementation.

- [ ] **Step 3: Implement output resolution**

Add a focused helper:

```typescript
export async function resolveImageOutput(
  requested: string | undefined,
  generatedName: string,
  dependencies: Pick<CliDependencies, "cwd" | "pathExists" | "isDirectory" | "mkdir">,
): Promise<string>;
```

Resolve omitted output beneath `<cwd>/generated_images`. Treat existing
directories and paths ending in `/` or `\\` as directories. Otherwise treat the
request as a filename. Create the selected directory or file parent before
calling `ImageResult.save`.

- [ ] **Step 4: Implement the image action**

Launch with `{ headless: !options.visible }`, inject the context into a new
`ImageGenerator`, call `image(prompt, generationOptions)`, resolve the output,
and call `save`. Normal output is the saved path plus a newline. JSON output is:

```typescript
{
  path,
  imageId: result.imageId,
  fileExtension: result.fileExtension,
  seed: result.seed,
  prompt: result.prompt,
  width: result.width,
  height: result.height,
  guidanceScale: result.guidanceScale,
  negativePrompt: result.negativePrompt,
  maybeNsfw: result.maybeNsfw,
}
```

Always close the browser context in `finally`.

- [ ] **Step 5: Verify GREEN**

Run: `npm test`

Expected: all image and existing tests pass.

- [ ] **Step 6: Commit**

Run: `git add src/cli/program.ts tests/cli.test.ts && git commit -m "feat(cli): add image generation command"`

### Task 4: Implement Text Generation

**Files:**

- Modify: `src/cli/program.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Write failing text-command tests**

Cover streamed output and options:

```typescript
it("streams generated text to stdout", async () => {
  const deps = fakeDependencies(createOutput());
  deps.textChunks = ["hello", " world"];

  const result = await runCli(["node", "perchance", "text", "greet me"], deps);

  assert.equal(result, 0);
  assert.equal(deps.output.stdout, "hello world");
  assert.equal(deps.browserCloseCalls, 1);
});
```

Add tests for `--start-with`, repeated `--stop`, `--timeout`, `--visible`, JSON
output, no synthetic newline in streaming mode, generator errors, and cleanup.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: text command tests fail because the action is not implemented.

- [ ] **Step 3: Implement streaming and JSON actions**

Launch Camoufox, inject the context into a `TextGenerator`, and pass only
defined options. In normal mode, write each yielded chunk immediately. In JSON
mode, collect all chunks and print `JSON.stringify({ text }) + "\n"`. Close the
context in `finally`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test`

Expected: all text, image, parser, package, and library tests pass.

- [ ] **Step 5: Commit**

Run: `git add src/cli/program.ts tests/cli.test.ts && git commit -m "feat(cli): add text generation command"`

### Task 5: Implement Camoufox Browser Management

**Files:**

- Create: `src/cli/browser.ts`
- Modify: `src/cli/program.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Write failing browser-command tests**

Cover exact forwarding without real downloads:

```typescript
it("forwards browser fetch to the local Camoufox executable", async () => {
  const deps = fakeDependencies(createOutput());
  const result = await runCli(
    ["node", "perchance", "browser", "fetch"],
    deps,
  );

  assert.equal(result, 0);
  assert.deepEqual(deps.browserCommands, [["fetch"]]);
});
```

Add equivalent tests for `path`, `version`, and a nonzero child exit status.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: browser tests fail because no action or runner exists.

- [ ] **Step 3: Implement the production runner**

Create `src/cli/browser.ts` with:

```typescript
export async function runCamoufoxCommand(args: string[]): Promise<number>;
```

Resolve `camoufox-js/package.json` with `createRequire(import.meta.url)`, derive
the declared bin path from the package directory, and spawn
`process.execPath` with `[binPath, ...args]` using `{ stdio: "inherit" }`.
Resolve with the child exit code, translate signal termination to status `1`,
and reject spawn errors.

- [ ] **Step 4: Register browser subcommands**

Register `fetch`, `path`, and `version` beneath `browser`; each calls the
injected runner and returns its status through `runCli`.

- [ ] **Step 5: Verify GREEN**

Run: `npm test`

Expected: all browser tests pass and no real Camoufox process is launched.

- [ ] **Step 6: Commit**

Run: `git add src/cli/browser.ts src/cli/program.ts tests/cli.test.ts && git commit -m "feat(cli): add Camoufox management commands"`

### Task 6: Handle Signals And User-Facing Failures

**Files:**

- Modify: `src/cli/program.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Write failing cleanup and error-output tests**

Test that thrown `Error("network failed")` produces `Error: network failed` on
stderr, returns status `1`, emits no stack trace, and closes an opened context.
Test cleanup through an injected signal-registration seam rather than sending a
real signal to the test process.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: failure because signal registration and concise error formatting are
not implemented.

- [ ] **Step 3: Implement active-context cleanup**

Track only the context opened by the current command. Register temporary
`SIGINT` and `SIGTERM` handlers after launch, close the context once, and remove
handlers in `finally`. Make cleanup idempotent so both a signal and normal
unwinding cannot close twice.

- [ ] **Step 4: Implement concise failure output**

Catch action errors at the `runCli` boundary, write one line to stderr, and
return status `1`. Preserve Commander help/version success exits and validation
failure status without duplicate output.

- [ ] **Step 5: Verify GREEN**

Run: `npm test`

Expected: all tests pass with no skipped tests.

- [ ] **Step 6: Commit**

Run: `git add src/cli/program.ts tests/cli.test.ts && git commit -m "fix(cli): guarantee cleanup and concise failures"`

### Task 7: Document, Package, Install, And Verify

**Files:**

- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Add CLI documentation**

Document the global installation and examples:

- `perchance image "a red fox"`
- `perchance image "a red fox" --shape landscape --output ./fox.png`
- `perchance text "Write a short greeting"`
- `perchance text "List three colors" --json`
- `perchance browser path`
- `perchance browser fetch`

State that generation is headless by default and `--visible` is diagnostic.

- [ ] **Step 2: Build and run the complete automated suite**

Run: `npm run build`

Run: `npm test`

Run: `npm audit`

Expected: compilation succeeds, all tests pass with zero skipped tests, and the
audit reports zero vulnerabilities.

- [ ] **Step 3: Verify the packed executable**

Pack into a temporary directory, install the tarball into a clean temporary npm
project, and run the installed `.bin/perchance --help`, `browser path`, and
`browser version`. Do not run `image`, `text`, or `browser fetch` in automated
verification.

Expected: every command exits `0`; help lists all commands; path and version use
the installed package's Camoufox dependency.

- [ ] **Step 4: Install the user-global command**

Run: `npm install --global .`

This installation does not require `sudo` with the configured user npm prefix.

- [ ] **Step 5: Verify the user-global command**

Run: `command -v perchance && perchance --help && perchance browser path && perchance browser version`

Expected: the executable resolves from the user's PATH, help is complete, and
Camoufox reports the already installed browser cache. Do not launch the browser
or contact Perchance.

- [ ] **Step 6: Review the final changeset**

Run: `git status --short --branch`

Run: `git diff --check HEAD`

Run: `git diff --stat HEAD`

Confirm no generated tarballs, caches, `node_modules`, or `dist` artifacts are
tracked.

- [ ] **Step 7: Commit documentation and final packaging adjustments**

Run: `git add README.md package.json && git commit -m "docs(cli): document command usage"`

## Completion Gate

- [ ] `perchance image` and `perchance text` are implemented with headless
  defaults and `--visible` overrides.
- [ ] Image and text output are shell-friendly and JSON modes are stable.
- [ ] Camoufox `fetch`, `path`, and `version` commands delegate locally.
- [ ] Browser contexts close on success, error, and signal paths.
- [ ] Unit tests do not launch Camoufox or contact Perchance.
- [ ] Build, tests, audit, packed-install smoke tests, and user-global smoke
  tests all pass.
- [ ] No game is launched, controlled, or uninstalled.
