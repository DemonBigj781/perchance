# perchance — fork by Nova

A fork of [eeemoon/perchance](https://github.com/eeemoon/perchance) with autonomous Cloudflare Turnstile bypass via [Camoufox-JS](https://github.com/apify/camoufox-js/).

## Why this fork?

As of mid-2026, Perchance tightened Cloudflare protection on the `image-generation.perchance.org/api/verifyUser` endpoint. The upstream library's direct navigation to `verifyUser` to scrape the `userKey` no longer works — the API now returns `token_required` unless a valid Cloudflare Turnstile token is presented.

The token is only issued through Turnstile widgets embedded inside the generator iframe on `perchance.org/ai-text-to-image-generator`. Standard headless browsers are fingerprinted by Cloudflare and cannot pass.

## What changed?

### Browser engine: Playwright Chromium → Camoufox-JS (patched Firefox fork)

Replaced Playwright Chromium with **Camoufox-JS**, a patched Firefox fork for anti-detection. Camoufox-JS passes Cloudflare fingerprinting natively, including Turnstile challenges.

- `headless=true` runs Firefox headlessly
- `humanize=true` enables anti-detection techniques
- `enable_cache=false` ensures fresh fingerprinting

### Authentication flow: direct scrape → iframe interception

**Original (Python version):** Navigate to `verifyUser`, scrape `userKey` from JSON response.

**New flow (TypeScript version):**

1.  Launch Camoufox-JS browser.
2.  Navigate to `perchance.org/ai-text-to-image-generator`.
3.  Wait for generator iframe to load.
4.  Inject dummy prompt into iframe textarea via JavaScript.
5.  Click Generate button via JavaScript.
6.  Perchance loads verification embeds that solve Turnstile internally.
7.  Intercept `verifyUser?token=***` response and extract the `userKey`.
8.  `userKey` is cached and used for direct `POST /api/generate` calls.

## Installation

```bash
npm install
npm run build
./node_modules/.bin/camoufox-js fetch
```

This installs the Node.js dependencies, compiles the TypeScript sources, and
downloads the Camoufox browser into the per-user cache.

## Command-Line Interface

Install the command for the current user from this checkout:

```bash
npm install --global .
```

The CLI runs Camoufox headlessly by default. Add `--visible` to an image or
text command when you need to inspect the browser window.

Generate an image with default settings:

```bash
perchance image "a red fox in a snowy forest"
```

The default output is `generated_images/<image-id>.<extension>` beneath the
current directory. Use an exact filename or an output directory:

```bash
perchance image "a red fox" --shape landscape --output ./fox.png
perchance image "a red fox" --output ./generated_images/
```

Additional image options include `--negative-prompt`, `--seed`,
`--guidance-scale`, and `--json`.

Stream generated text directly to stdout:

```bash
perchance text "Write a short greeting"
```

Text output can be redirected or piped without CLI status text being mixed
into stdout. Use `--json` for `{ "text": "..." }` output. Other text options
include `--start-with`, repeatable `--stop`, and `--timeout`.

Manage the Camoufox installation used by the CLI:

```bash
perchance browser fetch
perchance browser path
perchance browser version
```

## Bundled Linux AppImage

Build a self-contained x86_64 AppImage that includes Perchance, the official
Node.js 24 LTS runtime, production npm dependencies, and the complete Camoufox
browser installation:

```bash
npm run appimage
```

The builder expects Camoufox `v152.0.4-beta.28` in
`${CAMOUFOX_INSTALL_DIR:-$HOME/.cache/camoufox}`. It also requires `curl`,
`sha256sum`, `tar`, `ldd`, and `appimagetool`. Set `APPIMAGETOOL` when the tool
is not available on `PATH` or at `$HOME/AppImages/appimagetool`.

The resulting files are:

```text
release/Perchance-1.0.0-x86_64.AppImage
release/Perchance-1.0.0-x86_64.AppImage.sha256
```

Running the AppImage without arguments displays CLI help. Image and text
commands work the same as the globally installed command. The browser payload
inside an AppImage is immutable, so `browser path` and `browser version` are
available while `browser fetch` instructs you to replace or rebuild the
AppImage.

Verify an existing artifact with:

```bash
npm run verify:appimage -- release/Perchance-1.0.0-x86_64.AppImage
```

The AppImage targets modern glibc-based x86_64 desktop Linux. The host still
provides the kernel, glibc, graphics drivers, and display integration.

## Usage (TypeScript API)

```typescript
import { ImageGenerator } from "perchance"; // Or from "./dist/src/index.js" if local
import { launchCamoufox } from "perchance/camoufox"; // Or from "./dist/src/camoufox.js"

async function main() {
    const generator = new ImageGenerator();
    let ctx; // BrowserContext
    try {
        ctx = await launchCamoufox({ headless: true }); // Launch Camoufox browser
        generator.setBrowserContext(ctx);

        const result = await generator.image("a cyberpunk city street, neon lights, rain, high detail");
        console.log(`Generated image: ${result.toString()}`);

        const filePath = await result.save(`./generated_images/${result.toString()}`);
        console.log(`Image saved to ${filePath}`);
    } catch (error) {
        console.error("Error generating image:", error);
    } finally {
        if (ctx) await ctx.close();
    }
}

main();
```

## Running Tests

### Unit Tests (fast)

```bash
npm test
```

### Integration/E2E Tests (slow, requires network access)

These tests launch a real browser and interact with `perchance.org`.
They are skipped by default. To run them:

```bash
PERCHANCE_E2E=1 npm run test:integration
```

These tests can take 30-90 seconds each due to browser automation and Cloudflare challenges.

## Files changed

-   **`src/camoufox.ts`**: Rewritten to use `camoufox-js` API.
-   **`src/generator.ts`**: Core logic for `userKey` authentication and browser management.
-   **`src/imageGenerator.ts`**: Logic for image generation and downloading.
-   **`src/index.ts`**: Updated `camoufox` import comment.
-   **`package.json`**: Added `camoufox-js`, `playwright-core`, and `test:integration` script.
-   **`README.md`**: Updated to reflect TypeScript rewrite and new instructions.
-   **`tests/integration.test.ts`**: New integration test suite.

## Compatibility

-   Node.js 22+
-   Linux x86_64 (Camoufox-JS binary availability)

## License

MIT (inherited from upstream)
