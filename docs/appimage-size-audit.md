# Perchance AppImage Size Audit

## Safety Priorities

This audit applies reductions in this order:

1. Preserve successful Perchance image generation.
2. Preserve the existing verification flow.
3. Preserve a self-contained AppImage with embedded Node.js and Camoufox.
4. Preserve Camoufox fingerprint and rendering consistency.
5. Reduce size only after the first four requirements are proven intact.

## Baseline

The baseline is the working artifact built from commit `4f872c1` on July 30,
2026. It is preserved locally as
`release/baseline/Perchance-1.0.0-x86_64-baseline.AppImage`.

| Measurement | Bytes | Human size |
| --- | ---: | ---: |
| Complete AppImage | 742,050,296 | 707.67 MiB |
| AppImage type 2 runtime | 944,632 | 0.90 MiB |
| Compressed SquashFS | 741,105,611 | 706.77 MiB |
| Uncompressed staged AppDir | 1,621,223,305 | 1.51 GiB |

The AppDir contains 8,291 regular files, 1,301 directories, and 12 symbolic
links. SquashFS already performs duplicate-file elimination.

## Subsystem Inventory

Compressed contributions are isolated SquashFS measurements using the same
zstd compressor and 128 KiB block size as the baseline. Their sum differs from
the complete filesystem by less than 0.1 percent because each isolated image
has separate metadata and cannot share duplicate blocks with other groups.

| Subsystem | Uncompressed bytes | Estimated compressed bytes |
| --- | ---: | ---: |
| Camoufox Linux fonts | 42,270,388 | 27,963,392 |
| Camoufox macOS fonts | 595,326,474 | 336,543,744 |
| Camoufox Windows fonts | 336,778,190 | 180,867,072 |
| Camoufox excluding fonts | 386,413,822 | 131,829,760 |
| Complete Node.js distribution | 196,033,175 | 44,154,880 |
| Perchance and production packages | 62,925,678 | 20,451,328 |

Camoufox totals 1,362,263,158 uncompressed bytes. Its font payload alone is
975,849,336 bytes and accounts for approximately 73.6 percent of the compressed
AppImage payload.

## Browser Inventory

| Component | Uncompressed bytes | Decision before testing |
| --- | ---: | --- |
| `libxul.so` | 181,972,104 | Retain |
| `GeoLite2-City.mmdb` | 66,175,396 | Retain |
| `browser/omni.ja` | 51,346,942 | Retain initially |
| `omni.ja` | 43,118,346 | Retain |
| uBlock Origin addon | 11,678,875 | Retain |
| `libonnxruntime.so` | 10,197,176 | Retain |
| `libgkcodecs.so` | 9,111,912 | Retain |
| `libmozavcodec.so` | 4,121,392 | Retain |
| `gmp-clearkey` | 73,513 | Retain |
| `vulkantest` | 15,328 | Retain |

All Camoufox ELF binaries and shared libraries are already stripped. No
standalone debug symbols, static libraries, browser crash-reporter executable,
or symbol archives are present. The small crash-reporting resources embedded
inside the browser archives are retained because their size is negligible.

The two `omni.ja` archives contain only English localization. The root archive
contains 594,254 bytes of English dictionaries and 4,471,692 bytes of
hyphenation data. These are retained for text rendering, input behavior,
fallback content, and fingerprint consistency. There are no unused language
packs to remove.

The browser archive contains approximately 20,520,782 bytes of developer-tool
resources. They are not removed in the first pass because modifying Mozilla's
core archive is materially riskier than pruning external build metadata and
would save only a fraction of the font payload after SquashFS compression.

## Font Findings

Camoufox JS supports Linux, macOS, and Windows fingerprints and chooses among
them when no `os` option is supplied. Twelve baseline launches produced ten
Windows fingerprints and two macOS fingerprints. Pinning the browser to Linux
or deleting either large font tree would therefore change current fingerprint
behavior and violate the optimization priorities.

All three platform font trees, root emoji support, fontconfig profiles, and
font-spacing fingerprint seeds are intentionally retained. The duplicated
1,474,284-byte Twemoji file is already deduplicated by SquashFS, so replacing it
with a link would not materially reduce the AppImage.

## Application Runtime Inventory

| Component | Uncompressed bytes | Initial finding |
| --- | ---: | --- |
| Playwright Core | 9,311,756 | Runtime required; metadata may be pruned |
| `better-sqlite3` | 27,353,961 | No Camoufox JS runtime reference found |
| Impit x86_64 native module | 8,594,352 | Required by static Camoufox imports |
| Compiled Perchance source | 48,394 | Retain |

No Playwright browser download is present. There is no Chromium, WebKit,
standard Firefox, Selenium, or secondary Camoufox installation in the AppDir.
Playwright Core is JavaScript protocol support for the embedded Camoufox
browser, not another browser engine.

The `better-sqlite3` package contains eight native prebuilds for Linux, macOS,
Windows, glibc, musl, x86_64, and ARM64 plus 10.2 MB of SQLite and C++ source.
Static searches found no import or require of this package anywhere in
Camoufox JS runtime code. It is a candidate for removal followed by full live
validation.

## Python, Development, and Metadata Inventory

There is no Python interpreter, Python standard library, Python package
environment, `.pyc` bytecode, or `__pycache__` directory in the AppImage. The
59 Python source files totaling 1,507,360 bytes belong to `node-gyp` inside the
bundled npm distribution. They disappear when npm and Node build tooling are
removed after staging.

| Candidate class | Files | Bytes |
| --- | ---: | ---: |
| Node C/C++ headers | 2,734 | 60,031,445 |
| Node npm and Corepack tree | n/a | 12,583,283 |
| Source maps | 141 | 4,042,787 |
| TypeScript declarations | 196 | 2,588,381 |
| Markdown documentation | 279 | 2,486,269 |
| Documentation directories | 232 | 2,174,079 |
| Examples | 19 | 77,409 |
| Static libraries | 0 | 0 |
| Debug-symbol files | 0 | 0 |

The build cache, npm download cache, Node archive, AppImage runtime download,
temporary files, and test output live outside the AppDir and do not contribute
to the release artifact.

## Native Dependency Findings

The AppDir contains the official x86_64 Node.js executable, Camoufox and its
Firefox shared libraries, the Vulkan probe, and the x86_64 glibc Impit module.
All current ELF dependencies resolve on the Bazzite build host. Camoufox
retains its NSS/TLS, codec, SQLite, inference, sandbox, Wayland, GTK bridge,
WebGL, audio, fontconfig, and X11 integration libraries.

The AppImage still relies on the host Linux kernel, glibc ABI, graphics stack,
and standard desktop libraries such as GTK 3, GLib, Pango, Cairo, X11, DBus,
fontconfig, FreeType, and ALSA. This is the same portability boundary as the
working baseline and will be tested in a clean compatible Linux container.

## Planned Safe Reductions

The first reduction tranche will remove only build-time Node components after
production dependencies are installed. The second tranche will remove the
unreferenced `better-sqlite3` dependency and runtime-unneeded package metadata.
The final tranche will benchmark stronger SquashFS compression without altering
browser bytes.

Camoufox fonts, addons, GeoIP data, codecs, TLS libraries, browser archives,
fingerprint data, WebGL data, fontconfig, dictionaries, hyphenation, and native
browser libraries remain unchanged unless later evidence proves a removal safe
and every live validation still passes.
