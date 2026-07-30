#!/bin/sh
set -eu

CDPATH=
SCRIPT_DIR=$(dirname "$0")
ROOT=$(cd -P "$SCRIPT_DIR/.." && pwd)
CONTAINER=${APPIMAGE_DEBIAN_CONTAINER:-debian}
CONTAINER_USER=${APPIMAGE_DEBIAN_USER:-$(id -un)}
TIMEOUT_SECONDS=${APPIMAGE_SMOKE_TIMEOUT:-300}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command -v podman >/dev/null 2>&1 || fail "podman is required"
podman container exists "$CONTAINER" ||
  fail "Debian validation container does not exist: $CONTAINER"
[ "$(podman inspect -f '{{.State.Running}}' "$CONTAINER")" = true ] ||
  fail "Debian validation container is not running: $CONTAINER"

podman exec "$CONTAINER" sh -eu -c '
  . /etc/os-release
  [ "$ID" = debian ]
  [ "$(uname -m)" = x86_64 ]
  for command_name in file pgrep strace timeout; do
    command -v "$command_name" >/dev/null 2>&1
  done
  for external_runtime in node nodejs firefox chromium google-chrome; do
    ! command -v "$external_runtime" >/dev/null 2>&1
  done
' || fail "container is not a clean compatible Debian validation environment"

podman exec --user "$CONTAINER_USER" --workdir "$ROOT" \
  -e APPIMAGE_SMOKE_MODE=extract \
  -e APPIMAGE_SMOKE_TIMEOUT="$TIMEOUT_SECONDS" \
  "$CONTAINER" sh scripts/smoke-appimage.sh

printf 'debian_container=%s\n' "$CONTAINER"
printf 'debian_validation=passed\n'
