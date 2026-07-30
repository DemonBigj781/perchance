#!/bin/sh
set -eu

APPDIR=${1:-}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

strip_elf() {
  binary=$1
  if file -b "$binary" | grep -q '^ELF '; then
    strip --strip-unneeded "$binary"
  fi
}

[ -n "$APPDIR" ] || fail "usage: $0 APPDIR"
[ -d "$APPDIR" ] || fail "AppDir is missing: $APPDIR"

NODE_ROOT="$APPDIR/usr/lib/node"
[ -x "$NODE_ROOT/bin/node" ] || fail "embedded Node.js runtime is missing"
[ -f "$NODE_ROOT/LICENSE" ] || fail "embedded Node.js license is missing"

# npm and the compiler headers are needed only while staging dependencies.
rm -rf "${NODE_ROOT:?}/include" "${NODE_ROOT:?}/lib" "${NODE_ROOT:?}/share"
find "$NODE_ROOT/bin" -mindepth 1 -maxdepth 1 ! -name node -exec rm -rf {} +
rm -f "$NODE_ROOT/CHANGELOG.md" "$NODE_ROOT/README.md"

APP_HOME="$APPDIR/usr/lib/perchance"
BETTER_SQLITE="$APP_HOME/node_modules/better-sqlite3"
if [ -d "$BETTER_SQLITE" ]; then
  [ -f "$BETTER_SQLITE/prebuilds/linux-x64.node" ] ||
    fail "better-sqlite3 Linux x86_64 runtime is missing"
  find "$BETTER_SQLITE/prebuilds" -type f ! -name linux-x64.node -delete
  rm -rf "${BETTER_SQLITE:?}/deps" "${BETTER_SQLITE:?}/src"
  rm -f "$BETTER_SQLITE/binding.gyp" "$BETTER_SQLITE/README.md"
  rm -rf "${APP_HOME:?}/node_modules/node-addon-api"
  strip_elf "$BETTER_SQLITE/prebuilds/linux-x64.node"
fi

if [ -d "$APP_HOME/node_modules" ]; then
  find "$APP_HOME/node_modules" -type f \( \
    -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \
    \) -delete
  find "$APP_HOME/node_modules" -type f \( \
    -iname 'README*' -o -iname 'CHANGELOG*' -o -iname 'HISTORY*' -o \
    -iname 'CONTRIBUTING*' -o -name '.npmignore' -o -name '.gitignore' -o \
    -name 'tsconfig*.json' \
    \) -delete
  rm -f "$APP_HOME/node_modules/.package-lock.json"
  rm -f "$APP_HOME/node_modules/xml2js/lib/xml2js.bc.js"
  rm -rf "${APP_HOME:?}/node_modules/ua-parser-js/dist"
  rm -rf "${APP_HOME:?}/node_modules/playwright-core/lib/vite"
  find "$APP_HOME/node_modules" -depth -type d -empty -delete
fi

strip_elf "$NODE_ROOT/bin/node"

[ -x "$NODE_ROOT/bin/node" ] || fail "Node.js runtime was removed during pruning"
[ -f "$NODE_ROOT/LICENSE" ] || fail "Node.js license was removed during pruning"
