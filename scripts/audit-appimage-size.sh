#!/bin/sh
set -eu

CDPATH=
SCRIPT_DIR=$(dirname "$0")
ROOT=$(cd -P "$SCRIPT_DIR/.." && pwd)
DEFAULT_IMAGE="$ROOT/release/Perchance-1.0.0-x86_64.AppImage"
DEFAULT_APPDIR="$ROOT/build/appimage/staging/Perchance.AppDir"
APPIMAGE=${1:-$DEFAULT_IMAGE}
APPDIR=${2:-$DEFAULT_APPDIR}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

path_bytes() {
  key=$1
  path=$2
  if [ -e "$path" ]; then
    bytes=$(du -sb "$path" | awk '{print $1}')
  else
    bytes=0
  fi
  printf '%s\t%s\t1\n' "$key" "$bytes"
}

matching_files() {
  key=$1
  shift
  result=$(find "$APPDIR" -type f "$@" -printf '%s\n' |
    awk '{ bytes += $1; count += 1 } END {
      printf "%d\t%d", bytes + 0, count + 0
    }')
  printf '%s\t%s\n' "$key" "$result"
}

[ -x "$APPIMAGE" ] || fail "AppImage is missing: $APPIMAGE"
[ -d "$APPDIR" ] || fail "AppDir is missing: $APPDIR"
command -v unsquashfs >/dev/null 2>&1 || fail "unsquashfs is required"

OFFSET=$("$APPIMAGE" --appimage-offset)
SQUASHFS_BYTES=$(unsquashfs -o "$OFFSET" -s "$APPIMAGE" |
  awk '/^Filesystem size / { print $3 }')

printf 'metric\tbytes\tcount\n'
printf 'appimage\t%s\t1\n' "$(stat -c %s "$APPIMAGE")"
printf 'appimage_runtime\t%s\t1\n' "$OFFSET"
printf 'squashfs\t%s\t1\n' "$SQUASHFS_BYTES"
printf 'appdir\t%s\t1\n' "$(du -sb "$APPDIR" | awk '{print $1}')"

CAMOUFOX="$APPDIR/usr/lib/camoufox"
NODE="$APPDIR/usr/lib/node"
APPLICATION="$APPDIR/usr/lib/perchance"

path_bytes camoufox "$CAMOUFOX"
path_bytes camoufox_fonts "$CAMOUFOX/fonts"
path_bytes camoufox_fonts_linux "$CAMOUFOX/fonts/linux"
path_bytes camoufox_fonts_macos "$CAMOUFOX/fonts/macos"
path_bytes camoufox_fonts_windows "$CAMOUFOX/fonts/windows"
path_bytes camoufox_addons "$CAMOUFOX/addons"
path_bytes camoufox_browser "$CAMOUFOX/browser"
path_bytes camoufox_geoip "$CAMOUFOX/GeoLite2-City.mmdb"
path_bytes node_distribution "$NODE"
path_bytes node_binary "$NODE/bin/node"
path_bytes node_headers "$NODE/include"
path_bytes node_package_tools "$NODE/lib"
path_bytes application "$APPLICATION"
path_bytes application_node_modules "$APPLICATION/node_modules"
path_bytes playwright_core "$APPLICATION/node_modules/playwright-core"
path_bytes better_sqlite3 "$APPLICATION/node_modules/better-sqlite3"

matching_files python_source -name '*.py'
matching_files python_bytecode -name '*.pyc'
matching_files source_maps -name '*.map'
matching_files typescript_declarations \( -name '*.d.ts' -o -name '*.d.mts' \
  -o -name '*.d.cts' \)
matching_files markdown_documentation \( -iname '*.md' -o -iname '*.markdown' \)
matching_files headers \( -name '*.h' -o -name '*.hpp' \)
matching_files static_libraries \( -name '*.a' -o -name '*.la' \)
matching_files debug_symbols \( -name '*.debug' -o -name '*.sym' \
  -o -name '*.pdb' \)

printf 'files\t0\t%s\n' "$(find "$APPDIR" -type f | wc -l | tr -d ' ')"
printf 'directories\t0\t%s\n' \
  "$(find "$APPDIR" -type d | wc -l | tr -d ' ')"
printf 'symlinks\t0\t%s\n' \
  "$(find "$APPDIR" -type l | wc -l | tr -d ' ')"
