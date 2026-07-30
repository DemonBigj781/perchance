#!/bin/sh
set -eu

CDPATH=
SCRIPT_DIR=$(dirname "$0")
ROOT=$(cd -P "$SCRIPT_DIR/.." && pwd)
DEFAULT_IMAGE="$ROOT/release/Perchance-1.0.0-x86_64.AppImage"
APPIMAGE=${1:-$DEFAULT_IMAGE}
MODE=${APPIMAGE_SMOKE_MODE:-extract}
TIMEOUT_SECONDS=${APPIMAGE_SMOKE_TIMEOUT:-300}
PROMPT=${APPIMAGE_SMOKE_PROMPT:-a small brass compass on a clean studio background}
RUN_ROOT="$ROOT/build/appimage/smoke/latest"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

case "$APPIMAGE" in
  /*) ;;
  *) APPIMAGE=$(cd -P "$(dirname "$APPIMAGE")" && pwd)/$(basename "$APPIMAGE") ;;
esac

[ -x "$APPIMAGE" ] || fail "AppImage is missing: $APPIMAGE"
for command_name in file pgrep strace timeout; do
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "required command not found: $command_name"
done

case "$RUN_ROOT" in
  "$ROOT"/build/appimage/smoke/latest) ;;
  *) fail "refusing to remove unexpected smoke path: $RUN_ROOT" ;;
esac
rm -rf "$RUN_ROOT"
mkdir -p "$RUN_ROOT/home" "$RUN_ROOT/output"

OUTPUT="$RUN_ROOT/output/generated-image.bin"
STDOUT="$RUN_ROOT/stdout.log"
STDERR="$RUN_ROOT/stderr.log"
TRACE="$RUN_ROOT/execve.log"
BEFORE="$RUN_ROOT/camoufox-before.txt"
AFTER="$RUN_ROOT/camoufox-after.txt"

{
  pgrep -x camoufox 2>/dev/null || true
  pgrep -x camoufox-bin 2>/dev/null || true
} | sort -u >"$BEFORE"

case "$MODE" in
  extract)
    if ! timeout "$TIMEOUT_SECONDS" strace -f -qq -s 4096 \
      -e trace=execve -o "$TRACE" \
      env -i HOME="$RUN_ROOT/home" PATH=/usr/bin:/bin \
      APPIMAGE_EXTRACT_AND_RUN=1 \
      "$APPIMAGE" image "$PROMPT" --output "$OUTPUT" \
      >"$STDOUT" 2>"$STDERR"; then
      cat "$STDERR" >&2
      fail "AppImage image-generation smoke test failed"
    fi
    ;;
  direct)
    if ! timeout "$TIMEOUT_SECONDS" strace -f -qq -s 4096 \
      -e trace=execve -o "$TRACE" \
      env -i HOME="$RUN_ROOT/home" PATH=/usr/bin:/bin \
      "$APPIMAGE" image "$PROMPT" --output "$OUTPUT" \
      >"$STDOUT" 2>"$STDERR"; then
      cat "$STDERR" >&2
      fail "AppImage image-generation smoke test failed"
    fi
    ;;
  *) fail "APPIMAGE_SMOKE_MODE must be extract or direct" ;;
esac

[ -s "$OUTPUT" ] || fail "generation did not create a non-empty image"
IMAGE_TYPE=$(file -b "$OUTPUT")
printf '%s\n' "$IMAGE_TYPE" | grep -E 'JPEG|PNG|WebP' >/dev/null ||
  fail "generation output is not a supported image: $IMAGE_TYPE"

sleep 3
{
  pgrep -x camoufox 2>/dev/null || true
  pgrep -x camoufox-bin 2>/dev/null || true
} | sort -u >"$AFTER"
LEAKED=$(comm -13 "$BEFORE" "$AFTER")
[ -z "$LEAKED" ] || fail "Camoufox processes remain after generation: $LEAKED"

grep -E 'execve\("[^"]*/usr/bin/node"' "$TRACE" >/dev/null ||
  fail "the embedded Node.js runtime was not executed"
grep -E 'execve\("[^"]*/usr/lib/camoufox/camoufox-bin"' "$TRACE" >/dev/null ||
  fail "the embedded Camoufox browser was not executed"

if grep -E 'execve\("(/usr)?/bin/(node|nodejs)"' "$TRACE" >/dev/null; then
  fail "a system Node.js runtime was executed"
fi
if grep -E 'execve\("[^"]*/python([0-9.]*)?"' "$TRACE" >/dev/null; then
  fail "an external Python runtime was executed"
fi
if grep -E 'execve\("(/usr)?/bin/(firefox|chromium|chrome|google-chrome)' \
  "$TRACE" >/dev/null; then
  fail "an external system browser was executed"
fi

printf 'appimage=%s\n' "$APPIMAGE"
printf 'mode=%s\n' "$MODE"
printf 'image=%s\n' "$OUTPUT"
printf 'image_bytes=%s\n' "$(stat -c %s "$OUTPUT")"
printf 'image_type=%s\n' "$IMAGE_TYPE"
printf 'camoufox_processes_after=%s\n' "$(wc -l <"$AFTER" | tr -d ' ')"
printf 'trace=%s\n' "$TRACE"
