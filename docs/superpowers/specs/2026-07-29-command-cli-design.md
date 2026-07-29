# Perchance Command CLI Design

## Goal

Add a user-global `perchance` executable that exposes the existing image and
text generation APIs as shell-friendly one-shot commands. The CLI must retain
the library API, use Camoufox headlessly by default, and avoid contacting
Perchance during unit tests.

## Command Surface

### `perchance image <prompt>`

Generate one image and save it locally.

Options:

- `-o, --output <path>`: destination file or directory. When omitted, save to
  `generated_images/<image-id>.<extension>`.
- `--shape <shape>`: `portrait`, `square`, or `landscape`; default `square`.
- `--negative-prompt <text>`: features to avoid.
- `--seed <number>`: generation seed; default `-1`.
- `--guidance-scale <number>`: model guidance; default `7`.
- `--json`: write structured result metadata to stdout instead of the saved
  path.
- `--visible`: launch Camoufox with a visible window instead of headless mode.

If `--output` is an existing directory or ends with a path separator, the
generated filename is appended. Otherwise it is treated as a file path; parent
directories are created and that exact path is used. JSON output contains the
saved `path` plus the image result metadata.

### `perchance text <prompt>`

Stream generated text directly to stdout.

Options:

- `--start-with <text>`: initial generated text prefix.
- `--stop <sequence>`: stop sequence; repeatable.
- `--timeout <milliseconds>`: per-chunk timeout.
- `--json`: buffer the result and print `{ "text": "..." }` instead of
  streaming.
- `--visible`: launch Camoufox with a visible window instead of headless mode.

Streaming mode writes only generated text to stdout so shell redirection and
pipes remain reliable. Status and error messages go to stderr.

### `perchance browser <command>`

Manage the Camoufox installation through the locally installed
`camoufox-js` package.

Commands:

- `fetch`: download or update Camoufox assets.
- `path`: print the Camoufox installation path.
- `version`: print package and browser versions.

## Architecture

- Add `commander` as a direct runtime dependency.
- Add `src/cli.ts` as the executable entry point with a Node shebang.
- Keep command construction separate from process startup so tests can inject
  fake browser launchers, generators, streams, and output writers.
- Add a `bin.perchance` entry targeting `dist/src/cli.js`.
- Add an `engines.node` requirement compatible with `camoufox-js`.
- Reuse `ImageGenerator`, `TextGenerator`, and `launchCamoufox`; do not
  duplicate generation or authentication logic.
- Resolve the Camoufox management executable from the installed package rather
  than relying on a globally installed `camoufox-js` command.

## Lifecycle And Errors

- Generation commands create one Camoufox context and close it in `finally`.
- `SIGINT` and `SIGTERM` trigger context cleanup before process termination.
- User input errors produce concise messages and a nonzero exit code without a
  stack trace.
- Unexpected failures include the underlying error message on stderr and use a
  nonzero exit code.
- Browser management commands forward child-process exit status and signals.

## Testing

- Parser tests cover required prompts, defaults, numeric validation, enum
  validation, repeatable stop sequences, and help behavior.
- Image command tests verify generator options, destination selection, saved
  path output, JSON output, and guaranteed browser cleanup.
- Text command tests verify streaming output, JSON output, options, and cleanup.
- Browser command tests use an injected command runner and never download or
  launch Camoufox.
- Packaging tests verify the packed package exposes an executable
  `perchance` command.
- Existing library tests remain unchanged and must continue to pass.

## Installation

After compilation, install the checkout as a user-global npm package so
`perchance --help` works from a normal terminal. No `sudo`, RPM, DNF,
`rpm-ostree`, game launch, or game-control operation is required.

## Non-Goals

- Persistent browser daemon or shared cross-process browser session.
- Interactive REPL.
- Automatic retries beyond those already implemented by the library.
- Configuration files, saved presets, shell completion, or API redesign.
- Live Perchance generation during automated verification.
