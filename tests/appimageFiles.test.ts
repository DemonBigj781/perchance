import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { describe, it } from "node:test";

const appRunPath = "packaging/appimage/AppRun";
const desktopPath = "packaging/appimage/perchance.desktop";
const iconPath = "packaging/appimage/perchance.svg";
const auditScriptPath = "scripts/audit-appimage-size.sh";
const smokeScriptPath = "scripts/smoke-appimage.sh";

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
});
