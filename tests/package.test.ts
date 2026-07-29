/**
 * Package metadata smoke tests.
 */
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("package", () => {
  it("exports the compiled public API from the declared entry point", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, "package.json"), "utf8"),
    ) as { main: string; types: string };

    await access(resolve(projectRoot, packageJson.types));
    const publicApi = await import(
      pathToFileURL(resolve(projectRoot, packageJson.main)).href
    );

    assert.equal(typeof publicApi.ImageGenerator, "function");
    assert.equal(typeof publicApi.TextGenerator, "function");
  });

  it("exports the documented Camoufox helper subpath", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, "package.json"), "utf8"),
    ) as {
      exports?: Record<string, { import: string; types: string }>;
    };
    const camoufoxExport = packageJson.exports?.["./camoufox"];

    assert.ok(camoufoxExport, "package.json must export ./camoufox");
    await access(resolve(projectRoot, camoufoxExport.types));
    const camoufoxApi = await import(
      pathToFileURL(resolve(projectRoot, camoufoxExport.import)).href
    );

    assert.equal(typeof camoufoxApi.launchCamoufox, "function");
  });

  it("declares the perchance executable", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, "package.json"), "utf8"),
    ) as {
      bin?: Record<string, string>;
      engines?: { node?: string };
      files?: string[];
      scripts?: Record<string, string>;
    };
    const executable = packageJson.bin?.perchance;

    assert.equal(executable, "dist/src/cli.js");
    assert.equal(packageJson.engines?.node, ">=22");
    assert.deepEqual(packageJson.files, ["dist/src"]);
    assert.equal(packageJson.scripts?.prepack, "npm run build");
    assert.ok(executable);
    await access(resolve(projectRoot, executable));
  });
});
