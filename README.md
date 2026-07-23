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
```

This will install `camoufox-js` and `playwright-core` along with other dependencies. `camoufox-js` will automatically download the necessary browser binary on first run.

## Usage (TypeScript API)

```typescript
import { ImageGenerator } from "perchance"; // Or from "./dist/index.js" if local
import { launchCamoufox } from "perchance/camoufox"; // Or from "./dist/camoufox.js"

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

-   Node.js 20+
-   Linux x86_64 (Camoufox-JS binary availability)

## License

MIT (inherited from upstream)
