import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";

const appRunPath = "packaging/appimage/AppRun";
const desktopPath = "packaging/appimage/perchance.desktop";
const iconPath = "packaging/appimage/perchance.svg";
const auditScriptPath = "scripts/audit-appimage-size.sh";
const buildScriptPath = "scripts/build-appimage.sh";
const debianVerifyScriptPath = "scripts/verify-appimage-debian.sh";
const nativeCollectorPath = "scripts/collect-appimage-native-libs.sh";
const nativeContainerPath = "packaging/appimage/native-libs.Containerfile";
const nativeContainerCollectorPath =
  "packaging/appimage/collect-native-libs.sh";
const smokeScriptPath = "scripts/smoke-appimage.sh";
const pruneScriptPath = "scripts/prune-appimage-runtime.sh";
const execFileAsync = promisify(execFile);

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("AppImage runtime files", () => {
  it("launches the bundled CLI with the embedded Camoufox runtime", async () => {
    const appRun = await readFile(appRunPath, "utf8");
    const metadata = await stat(appRunPath);

    assert.notEqual(metadata.mode & 0o111, 0, "AppRun must be executable");
    assert.match(appRun, /^#!\/bin\/sh/m);
    assert.match(
      appRun,
      /CAMOUFOX_INSTALL_DIR="\$APPDIR\/usr\/lib\/camoufox"/,
    );
    assert.match(appRun, /PERCHANCE_APPIMAGE=1/);
    assert.match(appRun, /usr\/lib\/native/);
    assert.match(appRun, /LD_LIBRARY_PATH/);
    assert.match(appRun, /if \[ "\$#" -eq 0 \]; then/);
    assert.match(appRun, /set -- --help/);
    assert.match(appRun, /"\$APPDIR\/usr\/bin\/node"/);
    assert.match(
      appRun,
      /"\$APPDIR\/usr\/lib\/perchance\/dist\/src\/cli\.js"/,
    );
  });

  it("declares terminal desktop metadata", async () => {
    const desktop = await readFile(desktopPath, "utf8");

    assert.match(desktop, /^Type=Application$/m);
    assert.match(desktop, /^Terminal=true$/m);
    assert.match(desktop, /^Icon=perchance$/m);
  });

  it("provides a scalable icon", async () => {
    const icon = await readFile(iconPath, "utf8");

    assert.match(icon, /<svg\b/);
    assert.ok(icon.length > 100);
  });

  it("provides repeatable AppImage size and clean-runtime audits", async () => {
    const auditScript = await readFile(auditScriptPath, "utf8");
    const smokeScript = await readFile(smokeScriptPath, "utf8");
    const auditMetadata = await stat(auditScriptPath);
    const smokeMetadata = await stat(smokeScriptPath);

    assert.notEqual(auditMetadata.mode & 0o111, 0);
    assert.notEqual(smokeMetadata.mode & 0o111, 0);
    assert.match(auditScript, /unsquashfs/);
    assert.match(auditScript, /camoufox_fonts_macos/);
    assert.match(auditScript, /python_bytecode/);
    assert.match(smokeScript, /APPIMAGE_EXTRACT_AND_RUN/);
    assert.match(smokeScript, /TMPDIR=/);
    assert.match(smokeScript, /strace/);
    assert.match(smokeScript, /usr\/lib\/camoufox\/camoufox/);
    assert.match(smokeScript, /external Python runtime/);
    assert.match(smokeScript, /Camoufox processes remain/);
    assert.match(smokeScript, /image_removed=true/);
  });

  it("provides repeatable Debian container verification", async () => {
    const script = await readFile(debianVerifyScriptPath, "utf8");
    const metadata = await stat(debianVerifyScriptPath);

    assert.notEqual(metadata.mode & 0o111, 0);
    assert.match(script, /podman container exists/);
    assert.match(script, /ID.*debian/);
    assert.match(script, /external_runtime/);
    assert.match(script, /APPIMAGE_SMOKE_MODE=extract/);
    assert.match(script, /scripts\/smoke-appimage\.sh/);
  });

  it("prunes build-only payload while retaining runtime assets", async () => {
    const buildScript = await readFile(buildScriptPath, "utf8");
    const temporaryRoot = await mkdtemp(join(tmpdir(), "perchance-prune-"));
    const nodeRoot = join(temporaryRoot, "usr/lib/node");
    const modulesRoot = join(temporaryRoot, "usr/lib/perchance/node_modules");
    const sqliteRoot = join(modulesRoot, "better-sqlite3");

    try {
      assert.match(buildScript, /prune-appimage-runtime\.sh/);
      await mkdir(join(nodeRoot, "bin"), { recursive: true });
      await mkdir(join(nodeRoot, "include/node"), { recursive: true });
      await mkdir(join(nodeRoot, "lib/node_modules/npm"), { recursive: true });
      await mkdir(join(nodeRoot, "share/doc"), { recursive: true });
      await mkdir(join(sqliteRoot, "prebuilds"), { recursive: true });
      await mkdir(join(sqliteRoot, "deps/sqlite3"), { recursive: true });
      await mkdir(join(sqliteRoot, "src"), { recursive: true });
      await mkdir(join(modulesRoot, "node-addon-api"), { recursive: true });
      await mkdir(join(modulesRoot, "runtime-package"), { recursive: true });
      await mkdir(join(modulesRoot, "xml2js/lib"), { recursive: true });
      await mkdir(join(modulesRoot, "ua-parser-js/dist/icons"), {
        recursive: true,
      });
      await mkdir(join(modulesRoot, "playwright-core/lib/vite/traceViewer"), {
        recursive: true,
      });
      await writeFile(join(nodeRoot, "bin/node"), "node-runtime");
      await writeFile(join(nodeRoot, "bin/npm"), "npm-shim");
      await writeFile(join(nodeRoot, "bin/corepack"), "corepack-shim");
      await writeFile(join(nodeRoot, "include/node/node.h"), "header");
      await writeFile(join(nodeRoot, "lib/node_modules/npm/index.js"), "npm");
      await writeFile(join(nodeRoot, "share/doc/readme"), "documentation");
      await writeFile(join(nodeRoot, "LICENSE"), "license");
      await writeFile(join(nodeRoot, "README.md"), "readme");
      await writeFile(join(sqliteRoot, "prebuilds/linux-x64.node"), "linux-x64");
      await writeFile(join(sqliteRoot, "prebuilds/linux-arm64.node"), "linux-arm64");
      await writeFile(join(sqliteRoot, "prebuilds/linuxmusl-x64.node"), "musl-x64");
      await writeFile(join(sqliteRoot, "prebuilds/darwin-x64.node"), "darwin-x64");
      await writeFile(join(sqliteRoot, "prebuilds/win32-x64.node"), "win32-x64");
      await writeFile(join(sqliteRoot, "deps/sqlite3/sqlite3.c"), "sqlite source");
      await writeFile(join(sqliteRoot, "src/addon.cpp"), "addon source");
      await writeFile(join(sqliteRoot, "binding.gyp"), "build metadata");
      await writeFile(join(sqliteRoot, "README.md"), "documentation");
      await writeFile(join(modulesRoot, "node-addon-api/index.js"), "build helper");
      await writeFile(join(modulesRoot, "runtime-package/index.js"), "runtime");
      await writeFile(join(modulesRoot, "runtime-package/index.d.ts"), "types");
      await writeFile(join(modulesRoot, "runtime-package/index.js.map"), "map");
      await writeFile(join(modulesRoot, "runtime-package/README.md"), "docs");
      await writeFile(join(modulesRoot, "runtime-package/LICENSE"), "license");
      await writeFile(join(modulesRoot, "runtime-package/package.json"), "{}");
      await writeFile(join(modulesRoot, "xml2js/lib/xml2js.bc.js"), "unused");
      await writeFile(join(modulesRoot, "ua-parser-js/dist/icons/icon.svg"), "icon");
      await writeFile(
        join(modulesRoot, "playwright-core/lib/vite/traceViewer/index.html"),
        "developer frontend",
      );
      await chmod(join(nodeRoot, "bin/node"), 0o755);
      await chmod(pruneScriptPath, 0o755);

      await execFileAsync(pruneScriptPath, [temporaryRoot]);

      assert.equal(await pathExists(join(nodeRoot, "bin/node")), true);
      assert.equal(await pathExists(join(nodeRoot, "LICENSE")), true);
      assert.equal(await pathExists(join(nodeRoot, "bin/npm")), false);
      assert.equal(await pathExists(join(nodeRoot, "bin/corepack")), false);
      assert.equal(await pathExists(join(nodeRoot, "include")), false);
      assert.equal(await pathExists(join(nodeRoot, "lib")), false);
      assert.equal(await pathExists(join(nodeRoot, "share")), false);
      assert.equal(await pathExists(join(nodeRoot, "README.md")), false);
      assert.equal(
        await pathExists(join(sqliteRoot, "prebuilds/linux-x64.node")),
        true,
      );
      assert.equal(
        await pathExists(join(sqliteRoot, "prebuilds/linux-arm64.node")),
        false,
      );
      assert.equal(
        await pathExists(join(sqliteRoot, "prebuilds/linuxmusl-x64.node")),
        false,
      );
      assert.equal(
        await pathExists(join(sqliteRoot, "prebuilds/darwin-x64.node")),
        false,
      );
      assert.equal(
        await pathExists(join(sqliteRoot, "prebuilds/win32-x64.node")),
        false,
      );
      assert.equal(await pathExists(join(sqliteRoot, "deps")), false);
      assert.equal(await pathExists(join(sqliteRoot, "src")), false);
      assert.equal(await pathExists(join(sqliteRoot, "binding.gyp")), false);
      assert.equal(await pathExists(join(sqliteRoot, "README.md")), false);
      assert.equal(await pathExists(join(modulesRoot, "node-addon-api")), false);
      assert.equal(
        await pathExists(join(modulesRoot, "runtime-package/index.js")),
        true,
      );
      assert.equal(
        await pathExists(join(modulesRoot, "runtime-package/LICENSE")),
        true,
      );
      assert.equal(
        await pathExists(join(modulesRoot, "runtime-package/package.json")),
        true,
      );
      assert.equal(
        await pathExists(join(modulesRoot, "runtime-package/index.d.ts")),
        false,
      );
      assert.equal(
        await pathExists(join(modulesRoot, "runtime-package/index.js.map")),
        false,
      );
      assert.equal(
        await pathExists(join(modulesRoot, "runtime-package/README.md")),
        false,
      );
      assert.equal(
        await pathExists(join(modulesRoot, "xml2js/lib/xml2js.bc.js")),
        false,
      );
      assert.equal(await pathExists(join(modulesRoot, "ua-parser-js/dist")), false);
      assert.equal(
        await pathExists(join(modulesRoot, "playwright-core/lib/vite")),
        false,
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("uses the smallest validated SquashFS compression settings", async () => {
    const buildScript = await readFile(buildScriptPath, "utf8");

    assert.match(buildScript, /mksquashfs/);
    assert.match(buildScript, /-comp xz/);
    assert.match(buildScript, /-b 1M/);
    assert.match(buildScript, /-Xdict-size 100%/);
    assert.match(buildScript, /-Xbcj x86/);
    assert.match(buildScript, /-processors 1/);
    assert.match(buildScript, /-all-root/);
    assert.match(buildScript, /AppImageKit\/releases\/download\/continuous/);
  });

  it("bundles a Debian-compatible native library closure", async () => {
    const buildScript = await readFile(buildScriptPath, "utf8");
    const collector = await readFile(nativeCollectorPath, "utf8");
    const container = await readFile(nativeContainerPath, "utf8");
    const containerCollector = await readFile(
      nativeContainerCollectorPath,
      "utf8",
    );
    const metadata = await stat(nativeCollectorPath);

    assert.notEqual(metadata.mode & 0o111, 0);
    assert.match(buildScript, /collect-appimage-native-libs\.sh/);
    assert.match(collector, /podman image exists/);
    assert.match(collector, /IMAGE_KEY/);
    assert.match(collector, /collect-native-libs:ro/);
    assert.match(container, /debian:bookworm-slim@sha256:/);
    assert.match(container, /DEBIAN_SNAPSHOT=20260730T090000Z/);
    assert.match(container, /snapshot\.debian\.org/);
    assert.match(container, /file=1:5\.44-3/);
    assert.match(container, /libasound2/);
    assert.match(container, /libgtk-3-0/);
    assert.match(containerCollector, /lddtree/);
    assert.match(containerCollector, /libc\.so\.6/);
    assert.match(containerCollector, /packages\.tsv/);
    assert.match(containerCollector, /sonames\.tsv/);
    assert.match(containerCollector, /duplicate-hashes\.tsv/);
    assert.match(containerCollector, /readelf/);
    assert.match(containerCollector, /licenses/);
  });
});
