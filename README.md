<!-- markdownlint-disable MD013 MD030 -->

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

The CLI runs Camoufox headlessly by default. Add `--visible` to an image, text,
or gallery command when you need to inspect the browser window.

Generate an image with default settings:

```bash
perchance image "a red fox in a snowy forest"
```

The default output is `generated_images/<image-id>.<extension>` beneath the
current directory. Use an exact filename or an output directory:

```bash
perchance image "a red fox" --shape landscape --output ./fox.png
perchance image "a red fox" --output ./generated_images/
perchance image "a red fox" --count 4 --output ./generated_images/
```

`--count` queues up to 100 images through one browser context. Random seeds stay
random; an explicit seed advances once per image. For a batch sent to an exact
filename, the CLI inserts `-1`, `-2`, and so on before the extension. Batch JSON
output is an array, while the existing single-image JSON object is unchanged.
Additional image options include `--negative-prompt`, `--seed`,
`--guidance-scale`, and `--json`.

Stream generated text directly to stdout:

```bash
perchance text "Write a short greeting"
```

Text output can be redirected or piped without CLI status text being mixed
into stdout. Use `--json` for `{ "text": "..." }` output. Other text options
include `--start-with`, repeatable `--stop`, and `--timeout`.

Retrieve public gallery images and their generation prompts:

```bash
perchance gallery list --limit 20
perchance gallery list --sort top --time-range 1-month
perchance gallery get <64-character-image-id>
```

Gallery retrieval is read-only and defaults to the public
`ai-text-to-image-generator` channel with the `g` content filter. List output
is one JSON object with `entries` and an optional `nextCursor`; pass that cursor
back with `--cursor` to continue the feed. Item lookup accepts an image ID or a
supported Perchance gallery/image URL.

Use `--download` to save the returned image or images. Without `--output`, files
are written beneath `gallery_images/`. Existing generated names are preserved
by appending `-2`, `-3`, and so on instead of overwriting them.

```bash
perchance gallery list --limit 4 --download --output ./gallery_images
perchance gallery get <64-character-image-id> --download --output selected.jpeg
```

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
`${CAMOUFOX_INSTALL_DIR:-$HOME/.cache/camoufox}`. It requires Podman for the
cached Debian Bookworm native-library collector plus `curl`, `sha256sum`,
`tar`, `ldd`, `mksquashfs`, and `strip`. The collector image is tagged by the
hash of its Containerfile, so normal rebuilds reuse it instead of reinstalling
the Debian dependency set.

The resulting files are:

```text
release/Perchance-1.0.0-x86_64.AppImage
release/Perchance-1.0.0-x86_64.AppImage.sha256
```

Running the AppImage without arguments displays CLI help. Image, text, and
gallery commands work the same as the globally installed command. The browser
payload inside an AppImage is immutable, so `browser path` and `browser version`
are available while `browser fetch` instructs you to replace or rebuild the
AppImage.

Verify an existing artifact with:

```bash
npm run verify:appimage -- release/Perchance-1.0.0-x86_64.AppImage
```

Run a live extraction-and-generation test in the existing Debian Distrobox
with:

```bash
sh scripts/verify-appimage-debian.sh
```

The AppImage targets glibc-based x86_64 desktop Linux. It embeds the GTK, GLib,
Pango, Cairo, X11, Wayland, font, audio, and related native user-space library
closure required by Camoufox. The host still provides the Linux kernel, glibc
loader and ABI, graphics drivers, and optional display integration. FUSE is not
required because AppImage extraction-and-run mode is supported.

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

### Gallery retrieval

`GalleryClient` launches and owns Camoufox by default. Pass an existing browser
context to reuse a caller-owned session; `close()` never closes an injected
context.

```typescript
import { GalleryClient } from "perchance";

const gallery = new GalleryClient();
try {
    const page = await gallery.list({ limit: 10, contentFilter: "g" });
    for (const entry of page.entries) {
        console.log(entry.imageId, entry.prompt, entry.imageUrl);
    }

    if (page.entries[0]) {
        const exact = await gallery.get(page.entries[0].imageId);
        await gallery.download(
            exact,
            `gallery_images/${exact.imageId}.jpeg`,
        );
    }
} finally {
    await gallery.close();
}
```

Feed entries expose normalized prompt, image URL, channel, and available
generation metadata. Exact item lookup uses the gallery's structured metadata
document rather than scanning feed pages.

## Running Tests

### Unit Tests (fast)

```bash
npm test
```

### Integration/E2E Tests (slow, requires network access)

These tests launch a real browser and interact with `perchance.org`.
They are skipped by default. To run them:

```bash
npm run test:integration
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
