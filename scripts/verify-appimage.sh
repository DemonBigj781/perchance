#!/bin/sh
set -eu

CDPATH=
SCRIPT_DIR=$(dirname "$0")
ROOT=$(cd -P "$SCRIPT_DIR/.." && pwd)
DEFAULT_IMAGE="$ROOT/release/Perchance-1.0.0-x86_64.AppImage"
APPIMAGE=${1:-$DEFAULT_IMAGE}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

case "$APPIMAGE" in
  /*) ;;
  *) APPIMAGE=$(cd -P "$(dirname "$APPIMAGE")" && pwd)/$(basename "$APPIMAGE") ;;
esac

[ -x "$APPIMAGE" ] || fail "AppImage is missing or not executable: $APPIMAGE"
[ -f "$APPIMAGE.sha256" ] || fail "checksum file is missing: $APPIMAGE.sha256"
command -v unsquashfs >/dev/null 2>&1 || fail "unsquashfs is required"

(
  cd "$(dirname "$APPIMAGE")"
  sha256sum -c "$(basename "$APPIMAGE.sha256")"
)

OFFSET=$("$APPIMAGE" --appimage-offset)
SQUASHFS_INFO=$(unsquashfs -o "$OFFSET" -s "$APPIMAGE")
printf '%s\n' "$SQUASHFS_INFO" | grep -F 'Compression xz' >/dev/null ||
  fail "AppImage does not use the validated xz compressor"
printf '%s\n' "$SQUASHFS_INFO" | grep -F 'Block size 1048576' >/dev/null ||
  fail "AppImage does not use the validated 1 MiB SquashFS block size"

HELP_OUTPUT=$("$APPIMAGE" 2>&1) || {
  HELP_OUTPUT=$(APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGE" 2>&1) ||
    fail "AppImage did not display help"
}
printf '%s\n' "$HELP_OUTPUT" | grep -F 'Usage: perchance' >/dev/null ||
  fail "no-argument invocation did not display CLI help"

VERIFY_ROOT="$ROOT/build/appimage/verification"
case "$VERIFY_ROOT" in
  "$ROOT"/build/appimage/verification) ;;
  *) fail "refusing to remove unexpected verification path: $VERIFY_ROOT" ;;
esac
rm -rf "$VERIFY_ROOT"
mkdir -p "$VERIFY_ROOT"
(
  cd "$VERIFY_ROOT"
  "$APPIMAGE" --appimage-extract >/dev/null
)

EXTRACTED="$VERIFY_ROOT/squashfs-root"
[ -x "$EXTRACTED/AppRun" ] || fail "AppRun is missing from the AppImage"
[ -x "$EXTRACTED/usr/bin/node" ] || fail "embedded Node.js is missing"
[ -f "$EXTRACTED/usr/lib/perchance/dist/src/cli.js" ] ||
  fail "compiled Perchance CLI is missing"
[ -x "$EXTRACTED/usr/lib/camoufox/camoufox" ] ||
  fail "embedded Camoufox executable is missing"
[ -f "$EXTRACTED/usr/lib/camoufox/version.json" ] ||
  fail "embedded Camoufox version metadata is missing"
[ -f "$EXTRACTED/usr/lib/native/libasound.so.2" ] ||
  fail "embedded native audio library is missing"
[ -f "$EXTRACTED/usr/share/perchance/native-libs/packages.tsv" ] ||
  fail "native dependency package manifest is missing"
[ -f "$EXTRACTED/usr/share/perchance/native-libs/sonames.tsv" ] ||
  fail "native SONAME manifest is missing"
[ -f "$EXTRACTED/usr/share/perchance/native-libs/duplicate-hashes.tsv" ] ||
  fail "native duplicate manifest is missing"
[ -f "$EXTRACTED/usr/lib/perchance/node_modules/better-sqlite3/prebuilds/linux-x64.node" ] ||
  fail "better-sqlite3 Linux x86_64 runtime is missing"
[ ! -d "$EXTRACTED/usr/lib/perchance/node_modules/node-addon-api" ] ||
  fail "build-only node-addon-api package was not pruned"
[ ! -d "$EXTRACTED/usr/lib/perchance/node_modules/playwright-core/lib/vite" ] ||
  fail "Playwright developer-tool frontends were not pruned"
[ ! -d "$EXTRACTED/usr/lib/perchance/node_modules/ua-parser-js/dist" ] ||
  fail "unused UA parser distribution assets were not pruned"
[ ! -f "$EXTRACTED/usr/lib/perchance/node_modules/xml2js/lib/xml2js.bc.js" ] ||
  fail "unused xml2js bytecode artifact was not pruned"
[ -z "$(find "$EXTRACTED/usr/lib/perchance/node_modules" -type f \
  \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) \
  -print -quit)" ] || fail "source maps or TypeScript declarations remain"
[ -n "$(find "$EXTRACTED/usr/lib/camoufox/fonts" -type f -print -quit)" ] ||
  fail "embedded Camoufox fonts are missing"
[ -n "$(find "$EXTRACTED/usr/lib/camoufox/addons" -type f -print -quit)" ] ||
  fail "embedded Camoufox addons are missing"

NATIVE_METADATA="$EXTRACTED/usr/share/perchance/native-libs"
if awk -F '\t' 'NR > 1 && $3 == "unknown" { found = 1 } END { exit !found }' \
  "$NATIVE_METADATA/packages.tsv"; then
  fail "native dependency package manifest contains unknown packages"
fi
if [ "$(wc -l <"$NATIVE_METADATA/duplicate-hashes.tsv" | tr -d ' ')" -ne 1 ]; then
  fail "duplicate native libraries remain in the AppImage"
fi
(
  cd "$EXTRACTED/usr/lib/native"
  sha256sum -c "$NATIVE_METADATA/libraries.sha256"
)

PATH_OUTPUT=$(APPDIR="$EXTRACTED" "$EXTRACTED/AppRun" browser path)
printf '%s\n' "$PATH_OUTPUT" | grep -F '/usr/lib/camoufox' >/dev/null ||
  fail "browser path does not resolve to the embedded runtime"

VERSION_OUTPUT=$(APPDIR="$EXTRACTED" "$EXTRACTED/AppRun" browser version)
printf '%s\n' "$VERSION_OUTPUT" | grep -F 'v152.0.4-beta.29' >/dev/null ||
  fail "browser version does not report v152.0.4-beta.29"

if FETCH_OUTPUT=$(APPDIR="$EXTRACTED" "$EXTRACTED/AppRun" browser fetch 2>&1); then
  fail "browser fetch unexpectedly succeeded inside the immutable AppImage"
fi
printf '%s\n' "$FETCH_OUTPUT" | grep -F 'immutable AppImage' >/dev/null ||
  fail "browser fetch did not explain immutable AppImage behavior"

(
  cd "$EXTRACTED/usr/lib/perchance"
  "$EXTRACTED/usr/bin/node" --input-type=module -e '
    import { createRequire } from "node:module";
    const require = createRequire(new URL("./package.json", import.meta.url));
    await import("./dist/src/index.js");
    await import("camoufox-js");
    const webgl = await import("./node_modules/camoufox-js/dist/webgl/sample.js");
    const Database = require("better-sqlite3");
    const database = new Database(":memory:");
    database.close();
    const fingerprint = await webgl.sampleWebGL("win");
    if (!fingerprint["webGl:renderer"]) throw new Error("WebGL sampling failed");
  '
)

printf 'Verified %s\n' "$APPIMAGE"
