#!/bin/sh
set -eu

APPDIR=${1:-/app}
OUTPUT=${2:-/out}
LIBRARIES="$OUTPUT/libraries"
LICENSES="$OUTPUT/licenses"
DEPENDENCIES="$OUTPUT/dependencies.txt"
PACKAGES="$OUTPUT/packages.tsv"
SONAMES="$OUTPUT/sonames.tsv"
DUPLICATES="$OUTPUT/duplicate-hashes.tsv"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

[ -d "$APPDIR/usr" ] || fail "AppDir is missing: $APPDIR"
mkdir -p "$LIBRARIES" "$LICENSES"

find "$APPDIR/usr" -type f -print |
  while IFS= read -r candidate; do
    if file -b "$candidate" | grep -q '^ELF '; then
      LD_LIBRARY_PATH="$APPDIR/usr/lib/camoufox" \
        lddtree -l "$candidate" 2>/dev/null || true
    fi
  done | sort -u >"$DEPENDENCIES"

printf 'library\tsource\tpackage\tversion\n' >"$PACKAGES"
while IFS= read -r dependency; do
  case "$dependency" in
    "$APPDIR"/* | */ld-linux-x86-64.so.2 | */libc.so.6 | */libm.so.6 | \
      */libdl.so.2 | */libpthread.so.0 | */librt.so.1 | */libresolv.so.2)
      continue
      ;;
  esac
  [ -f "$dependency" ] || continue
  source_path=$(readlink -f "$dependency")
  [ -f "$source_path" ] || fail "cannot resolve dependency $dependency"

  library=$(basename "$dependency")
  destination="$LIBRARIES/$library"
  if [ -f "$destination" ]; then
    cmp -s "$source_path" "$destination" ||
      fail "incompatible libraries share the name $library"
  else
    cp "$source_path" "$destination"
  fi

  package=$(dpkg-query -S "$source_path" 2>/dev/null |
    sed -n '1{s/: \/.*$//;p}')
  if [ -z "$package" ] && [ "$source_path" != "$dependency" ]; then
    package=$(dpkg-query -S "$dependency" 2>/dev/null |
      sed -n '1{s/: \/.*$//;p}')
  fi
  version=unknown
  if [ -n "$package" ]; then
    version=$(dpkg-query -W -f='${Version}' "$package" 2>/dev/null ||
      printf 'unknown')
    package_name=${package%%:*}
    copyright="/usr/share/doc/$package_name/copyright"
    if [ -f "$copyright" ]; then
      cp "$copyright" "$LICENSES/$package_name.copyright"
    fi
  else
    package=unknown
  fi
  printf '%s\t%s\t%s\t%s\n' \
    "$library" "$source_path" "$package" "$version" >>"$PACKAGES"
done <"$DEPENDENCIES"

(
  cd "$LIBRARIES"
  sha256sum ./* >"$OUTPUT/libraries.sha256"
)

printf 'library\tsoname\n' >"$SONAMES"
for library_path in "$LIBRARIES"/*; do
  library=$(basename "$library_path")
  soname=$(readelf -d "$library_path" |
    sed -n 's/.*(SONAME).*\[\(.*\)\]/\1/p')
  if [ -z "$soname" ]; then
    soname='<none>'
  fi
  [ "$soname" = '<none>' ] || [ "$library" = "$soname" ] ||
    fail "native library name $library does not match SONAME $soname"
  printf '%s\t%s\n' "$library" "$soname" >>"$SONAMES"
done

printf 'sha256\tlibraries\n' >"$DUPLICATES"
awk '
  {
    count[$1] += 1
    paths[$1] = paths[$1] " " $2
  }
  END {
    for (hash in count) {
      if (count[hash] > 1) {
        print hash "\t" substr(paths[hash], 2)
      }
    }
  }
' "$OUTPUT/libraries.sha256" | sort >>"$DUPLICATES"
