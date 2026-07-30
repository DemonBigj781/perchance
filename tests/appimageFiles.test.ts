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
    assert.match(smokeScript, /strace/);
    assert.match(smokeScript, /usr\/lib\/camoufox\/camoufox/);
    assert.match(smokeScript, /external Python runtime/);
    assert.match(smokeScript, /Camoufox processes remain/);
  });

  it("prunes Node build tooling while retaining the runtime and license", async () => {
    const buildScript = await readFile(buildScriptPath, "utf8");
    const temporaryRoot = await mkdtemp(join(tmpdir(), "perchance-prune-"));
    const nodeRoot = join(temporaryRoot, "usr/lib/node");

    try {
      assert.match(buildScript, /prune-appimage-runtime\.sh/);
      await mkdir(join(nodeRoot, "bin"), { recursive: true });
      await mkdir(join(nodeRoot, "include/node"), { recursive: true });
      await mkdir(join(nodeRoot, "lib/node_modules/npm"), { recursive: true });
      await mkdir(join(nodeRoot, "share/doc"), { recursive: true });
      await writeFile(join(nodeRoot, "bin/node"), "node-runtime");
      await writeFile(join(nodeRoot, "bin/npm"), "npm-shim");
      await writeFile(join(nodeRoot, "bin/corepack"), "corepack-shim");
      await writeFile(join(nodeRoot, "include/node/node.h"), "header");
      await writeFile(join(nodeRoot, "lib/node_modules/npm/index.js"), "npm");
      await writeFile(join(nodeRoot, "share/doc/readme"), "documentation");
      await writeFile(join(nodeRoot, "LICENSE"), "license");
      await writeFile(join(nodeRoot, "README.md"), "readme");
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
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
