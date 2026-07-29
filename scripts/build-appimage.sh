#!/bin/sh
set -eu

CDPATH=
SCRIPT_DIR=$(dirname "$0")
ROOT=$(cd -P "$SCRIPT_DIR/.." && pwd)

NODE_VERSION=24.18.1
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
NODE_DIRECTORY="node-v${NODE_VERSION}-linux-x64"
NODE_SHA256=d6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0
APPIMAGE_RUNTIME=runtime-x86_64
APPIMAGE_RUNTIME_SHA256=1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf
CAMOUFOX_VERSION=152.0.4
CAMOUFOX_RELEASE=beta.28

BUILD_ROOT="$ROOT/build/appimage"
CACHE_DIR="$BUILD_ROOT/cache"
STAGING_DIR="$BUILD_ROOT/staging"
APPDIR="$STAGING_DIR/Perchance.AppDir"
NODE_DOWNLOAD="$CACHE_DIR/$NODE_ARCHIVE"
RUNTIME_DOWNLOAD="$CACHE_DIR/$APPIMAGE_RUNTIME"
CAMOUFOX_SOURCE=${CAMOUFOX_INSTALL_DIR:-"$HOME/.cache/camoufox"}
RELEASE_DIR="$ROOT/release"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

reset_staging() {
  case "$STAGING_DIR" in
    "$ROOT"/build/appimage/staging) ;;
    *) fail "refusing to remove unexpected staging path: $STAGING_DIR" ;;
  esac
  rm -rf "$STAGING_DIR"
  mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/lib" "$RELEASE_DIR"
}

find_appimagetool() {
  if [ -n "${APPIMAGETOOL:-}" ]; then
    printf '%s\n' "$APPIMAGETOOL"
    return
  fi
  if command -v appimagetool >/dev/null 2>&1; then
    command -v appimagetool
    return
  fi
  if [ -x "$HOME/AppImages/appimagetool" ]; then
    printf '%s\n' "$HOME/AppImages/appimagetool"
    return
  fi
  fail "appimagetool was not found; set APPIMAGETOOL to its executable path"
}

verify_elf_dependencies() {
  binary=$1
  library_path=${2:-}
  if [ -n "$library_path" ]; then
    dependencies=$(LD_LIBRARY_PATH="$library_path" ldd "$binary" 2>&1)
  else
    dependencies=$(ldd "$binary" 2>&1)
  fi
  if printf '%s\n' "$dependencies" | grep -F 'not found' >/dev/null; then
    printf '%s\n' "$dependencies" >&2
    fail "unresolved ELF dependency for $binary"
  fi
}

for command_name in curl find grep ldd node npm sha256sum tar; do
  require_command "$command_name"
done

[ "$(uname -m)" = "x86_64" ] || fail "AppImage builds require x86_64"
APPIMAGETOOL_PATH=$(find_appimagetool)
[ -x "$APPIMAGETOOL_PATH" ] || fail "appimagetool is not executable"

[ -x "$CAMOUFOX_SOURCE/camoufox" ] ||
  fail "Camoufox executable not found in $CAMOUFOX_SOURCE"
[ -x "$CAMOUFOX_SOURCE/camoufox-bin" ] ||
  fail "Camoufox runtime executable not found in $CAMOUFOX_SOURCE"
[ -f "$CAMOUFOX_SOURCE/version.json" ] ||
  fail "Camoufox version metadata is missing"
[ -n "$(find "$CAMOUFOX_SOURCE/fonts" -type f -print -quit)" ] ||
  fail "Camoufox fonts are missing"
[ -n "$(find "$CAMOUFOX_SOURCE/addons" -type f -print -quit)" ] ||
  fail "Camoufox addons are missing"

CAMOUFOX_ID=$(node -e '
  const data = require(process.argv[1]);
  process.stdout.write(data.version + "-" + data.release);
' "$CAMOUFOX_SOURCE/version.json")
[ "$CAMOUFOX_ID" = "$CAMOUFOX_VERSION-$CAMOUFOX_RELEASE" ] ||
  fail "expected Camoufox $CAMOUFOX_VERSION-$CAMOUFOX_RELEASE, found $CAMOUFOX_ID"

verify_elf_dependencies "$CAMOUFOX_SOURCE/camoufox" "$CAMOUFOX_SOURCE"
verify_elf_dependencies "$CAMOUFOX_SOURCE/camoufox-bin" "$CAMOUFOX_SOURCE"

cd "$ROOT"
npm run build
npm test

mkdir -p "$CACHE_DIR"
if [ ! -f "$NODE_DOWNLOAD" ]; then
  printf 'Downloading Node.js v%s...\n' "$NODE_VERSION"
  curl -fL \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" \
    -o "$NODE_DOWNLOAD.part"
  mv "$NODE_DOWNLOAD.part" "$NODE_DOWNLOAD"
fi

printf '%s  %s\n' "$NODE_SHA256" "$NODE_DOWNLOAD" | sha256sum -c -

if [ ! -f "$RUNTIME_DOWNLOAD" ]; then
  printf 'Downloading the AppImage type 2 runtime...\n'
  curl -fL \
    "https://github.com/AppImage/type2-runtime/releases/download/continuous/$APPIMAGE_RUNTIME" \
    -o "$RUNTIME_DOWNLOAD.part"
  mv "$RUNTIME_DOWNLOAD.part" "$RUNTIME_DOWNLOAD"
fi

printf '%s  %s\n' "$APPIMAGE_RUNTIME_SHA256" "$RUNTIME_DOWNLOAD" |
  sha256sum -c -

reset_staging
NODE_EXTRACT="$STAGING_DIR/node"
mkdir -p "$NODE_EXTRACT"
tar -xf "$NODE_DOWNLOAD" -C "$NODE_EXTRACT"
[ -x "$NODE_EXTRACT/$NODE_DIRECTORY/bin/node" ] ||
  fail "downloaded Node.js archive is incomplete"

mkdir -p "$APPDIR/usr/lib/node"
cp -R -p "$NODE_EXTRACT/$NODE_DIRECTORY/." "$APPDIR/usr/lib/node/"
ln -s ../lib/node/bin/node "$APPDIR/usr/bin/node"
ln -s ../../AppRun "$APPDIR/usr/bin/perchance"

APP_HOME="$APPDIR/usr/lib/perchance"
mkdir -p "$APP_HOME/dist"
cp -p "$ROOT/package.json" "$ROOT/package-lock.json" "$APP_HOME/"

mkdir -p "$BUILD_ROOT/home" "$BUILD_ROOT/npm-cache"
PATH="$APPDIR/usr/lib/node/bin:${PATH:-/usr/bin:/bin}" \
  HOME="$BUILD_ROOT/home" \
  npm_config_cache="$BUILD_ROOT/npm-cache" \
  "$APPDIR/usr/lib/node/bin/npm" ci \
  --omit=dev --ignore-scripts --prefix "$APP_HOME"

cp -R -p "$ROOT/dist/src" "$APP_HOME/dist/"
cp -p "$ROOT/LICENSE" "$APP_HOME/"

mkdir -p "$APPDIR/usr/lib/camoufox"
cp -R -p "$CAMOUFOX_SOURCE/." "$APPDIR/usr/lib/camoufox/"

cp -p "$ROOT/packaging/appimage/AppRun" "$APPDIR/AppRun"
cp -p "$ROOT/packaging/appimage/perchance.desktop" "$APPDIR/"
cp -p "$ROOT/packaging/appimage/perchance.svg" "$APPDIR/"
chmod 755 "$APPDIR/AppRun"
ln -s perchance.svg "$APPDIR/.DirIcon"

EMBEDDED_NODE="$APPDIR/usr/bin/node"
verify_elf_dependencies "$EMBEDDED_NODE"
verify_elf_dependencies \
  "$APPDIR/usr/lib/camoufox/camoufox" \
  "$APPDIR/usr/lib/camoufox"
verify_elf_dependencies \
  "$APPDIR/usr/lib/camoufox/camoufox-bin" \
  "$APPDIR/usr/lib/camoufox"

(
  cd "$APP_HOME"
  "$EMBEDDED_NODE" --input-type=module -e '
    import { createRequire } from "node:module";
    const require = createRequire(new URL("./package.json", import.meta.url));
    const api = await import("./dist/src/index.js");
    const camoufox = await import("camoufox-js");
    const Database = require("better-sqlite3");
    const database = new Database(":memory:");
    database.exec("select 1");
    database.close();
    if (typeof api.ImageGenerator !== "function") throw new Error("Perchance import failed");
    if (typeof camoufox.Camoufox !== "function") throw new Error("Camoufox import failed");
  '
)

export APPDIR
"$APPDIR/AppRun" --help >/dev/null

PACKAGE_VERSION=$(node -p "require('$ROOT/package.json').version")
OUTPUT_NAME="Perchance-${PACKAGE_VERSION}-x86_64.AppImage"
OUTPUT="$RELEASE_DIR/$OUTPUT_NAME"
CHECKSUM="$OUTPUT.sha256"
SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct)}

rm -f "$OUTPUT" "$CHECKSUM"
printf 'Packaging %s...\n' "$OUTPUT_NAME"
ARCH=x86_64 SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
  "$APPIMAGETOOL_PATH" --no-appstream --comp zstd \
  --runtime-file "$RUNTIME_DOWNLOAD" "$APPDIR" "$OUTPUT"
chmod 755 "$OUTPUT"
(
  cd "$RELEASE_DIR"
  sha256sum "$OUTPUT_NAME" >"$OUTPUT_NAME.sha256"
)

printf 'Created %s\n' "$OUTPUT"
printf 'Checksum: %s\n' "$CHECKSUM"
