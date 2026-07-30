#!/bin/sh
set -eu

CDPATH=
SCRIPT_DIR=$(dirname "$0")
ROOT=$(cd -P "$SCRIPT_DIR/.." && pwd)
APPDIR=${1:-}
OUTPUT=${2:-}
CONTAINERFILE="$ROOT/packaging/appimage/native-libs.Containerfile"
CONTAINER_COLLECTOR="$ROOT/packaging/appimage/collect-native-libs.sh"
IMAGE_KEY=$(sha256sum "$CONTAINERFILE" | awk '{print substr($1, 1, 16)}')
IMAGE="localhost/perchance-appimage-native-libs:$IMAGE_KEY"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

[ -n "$APPDIR" ] || fail "usage: $0 APPDIR OUTPUT"
[ -n "$OUTPUT" ] || fail "usage: $0 APPDIR OUTPUT"
case "$APPDIR" in
  /*) ;;
  *) APPDIR=$(cd -P "$(dirname "$APPDIR")" && pwd)/$(basename "$APPDIR") ;;
esac
case "$OUTPUT" in
  "$ROOT"/build/appimage/native-libs) ;;
  *) fail "refusing to replace unexpected output path: $OUTPUT" ;;
esac
[ -d "$APPDIR/usr" ] || fail "AppDir is missing: $APPDIR"
for command_name in podman sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "$command_name is required"
done

rm -rf "$OUTPUT"
mkdir -p "$OUTPUT"

if ! podman image exists "$IMAGE"; then
  podman build --arch amd64 --network=host -t "$IMAGE" \
    -f "$CONTAINERFILE" "$ROOT/packaging/appimage"
fi
podman run --rm --arch amd64 --network=none --security-opt label=disable \
  -v "$APPDIR:/app:ro" \
  -v "$OUTPUT:/out" \
  -v "$CONTAINER_COLLECTOR:/usr/local/bin/collect-native-libs:ro" \
  "$IMAGE" /usr/local/bin/collect-native-libs

[ -n "$(find "$OUTPUT/libraries" -type f -print -quit)" ] ||
  fail "native library collection produced no files"
[ -f "$OUTPUT/libraries/libasound.so.2" ] ||
  fail "native library collection omitted libasound.so.2"
[ -f "$OUTPUT/packages.tsv" ] || fail "native package manifest is missing"
[ -f "$OUTPUT/libraries.sha256" ] || fail "native checksum manifest is missing"
[ -f "$OUTPUT/sonames.tsv" ] || fail "native SONAME manifest is missing"
[ -f "$OUTPUT/duplicate-hashes.tsv" ] ||
  fail "native duplicate manifest is missing"
