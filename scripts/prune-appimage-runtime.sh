#!/bin/sh
set -eu

APPDIR=${1:-}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
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

[ -x "$NODE_ROOT/bin/node" ] || fail "Node.js runtime was removed during pruning"
[ -f "$NODE_ROOT/LICENSE" ] || fail "Node.js license was removed during pruning"
