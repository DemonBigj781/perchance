/**
 * Integration / E2E tests for the Perchance TS library.
 *
 * These tests launch a REAL Camoufox browser and hit Perchance's servers.
 * They are NOT part of the default `npm test` suite.
 *
 * Run them explicitly:
 *   npm run test:integration
 *
 * Requirements:
 *   - camoufox-js and playwright-core installed (npm install)
 *   - Camoufox browser binary present (camoufox-js downloads it on first run)
 *   - Network access to perchance.org and image-generation.perchance.org
 *   - Xvfb or a display (Camoufox handles headless internally)
 *
 * These tests are slow (30-90s each) because they do real browser automation
 * and wait for Cloudflare Turnstile challenges to solve.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ImageGenerator, launchCamoufox } from "../dist/index.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = join(process.cwd(), "test-output");

// Skip the entire suite unless explicitly invoked via PERCHANCE_E2E=1
const SHOULD_RUN = process.env["PERCHANCE_E2E"] === "1";

describe("E2E: ImageGenerator", { skip: !SHOULD_RUN }, () => {
  let generator: ImageGenerator;

  it("launches Camoufox and generates an image", { timeout: 120_000 }, async () => {
    const ctx = await launchCamoufox({ headless: true });
    generator = new ImageGenerator();
    generator.setBrowserContext(ctx);

    try {
      const result = await generator.image("a cute cat sitting on a windowsill", {
        shape: "square",
      });

      // We got an image back
      assert.ok(result.imageId, "should have imageId");
      assert.ok(result.fileExtension, "should have fileExtension");
      assert.ok(result.width > 0, "should have positive width");
      assert.ok(result.height > 0, "should have positive height");
      assert.equal(result.prompt, "a cute cat sitting on a windowsill");
      assert.equal(result.toString(), `${result.imageId}.${result.fileExtension}`);
    } finally {
      await generator.close();
    }
  });

  it("downloads the generated image as a Buffer", { timeout: 120_000 }, async () => {
    const ctx = await launchCamoufox({ headless: true });
    generator = new ImageGenerator();
    generator.setBrowserContext(ctx);

    try {
      const result = await generator.image("a serene mountain landscape at sunset", {
        shape: "portrait",
      });

      const buf = await result.download();
      assert.ok(buf.length > 0, "downloaded buffer should not be empty");
      // PNG files start with the magic bytes 89 50 4E 47
      // WebP files start with 52 49 46 46
      const isPng = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const isWebp = buf.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46]));
      assert.ok(isPng || isWebp, `downloaded file should be PNG or WebP (got: ${buf.subarray(0, 4).toString("hex")})`);
    } finally {
      await generator.close();
    }
  });

  it("saves the generated image to disk", { timeout: 120_000 }, async () => {
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

    const ctx = await launchCamoufox({ headless: true });
    generator = new ImageGenerator();
    generator.setBrowserContext(ctx);

    try {
      const result = await generator.image("abstract neon geometric pattern", {
        shape: "landscape",
      });

      const filename = join(OUTPUT_DIR, `${result.imageId}.${result.fileExtension}`);
      const savedPath = await result.save(filename);
      assert.ok(existsSync(savedPath), `saved file should exist at ${savedPath}`);

      const { statSync } = await import("node:fs");
      const stats = statSync(savedPath);
      assert.ok(stats.size > 1000, `saved image should be > 1KB (got ${stats.size} bytes)`);

      // Clean up
      unlinkSync(savedPath);
    } finally {
      await generator.close();
    }
  });

  it("handles key caching across multiple generations", { timeout: 180_000 }, async () => {
    const ctx = await launchCamoufox({ headless: true });
    generator = new ImageGenerator();
    generator.setBrowserContext(ctx);

    try {
      const result1 = await generator.image("a red rose on white background");
      assert.ok(result1.imageId, "first image should have imageId");

      const result2 = await generator.image("a blue lotus flower");
      assert.ok(result2.imageId, "second image should have imageId");
      assert.notEqual(result1.imageId, result2.imageId, "images should be different");
    } finally {
      await generator.close();
    }
  });

  it("cleanly closes the browser context", { timeout: 30_000 }, async () => {
    const ctx = await launchCamoufox({ headless: true });
    generator = new ImageGenerator();
    generator.setBrowserContext(ctx);

    // Just open and close without generating — should not throw
    await generator.close();
    assert.ok(true, "close() completed without error");
  });
});
