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
| `better-sqlite3` | 27,353,961 | Required; prune non-target build files |
| Impit x86_64 native module | 8,594,352 | Required by static Camoufox imports |
| Compiled Perchance source | 48,394 | Retain |

No Playwright browser download is present. There is no Chromium, WebKit,
standard Firefox, Selenium, or secondary Camoufox installation in the AppDir.
Playwright Core is JavaScript protocol support for the embedded Camoufox
browser, not another browser engine.

The `better-sqlite3` package contains eight native prebuilds for Linux, macOS,
Windows, glibc, musl, x86_64, and ARM64 plus 10.2 MB of SQLite and C++ source.
Dependency tracing found that Camoufox dynamically imports `better-sqlite3`
when sampling its bundled WebGL fingerprint database under Node.js. The package
must remain, but this glibc x86_64 AppImage needs only `linux-x64.node`, the JS
loader, manifest, and license. Other platform binaries, compilation sources,
headers, and `node-addon-api` are build-time payload.

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

The baseline relied on host GTK 3, GLib, Pango, Cairo, X11, DBus, fontconfig,
FreeType, and ALSA libraries. That failed in the Debian validation environment
when `libasound.so.2` was unavailable. The final AppImage now embeds the
non-glibc native closure described below. It still relies on the host Linux
kernel, glibc loader and ABI, graphics drivers, and optional display system.

## Planned Safe Reductions

The first reduction tranche removes only build-time Node components after
production dependencies are installed. The second tranche retains the active
`better-sqlite3` runtime while removing its non-x86_64 prebuilds, compilation
sources, and runtime-unneeded package metadata. The final tranche benchmarks
stronger SquashFS compression without altering browser bytes.

Camoufox fonts, addons, GeoIP data, codecs, TLS libraries, browser archives,
fingerprint data, WebGL data, fontconfig, dictionaries, hyphenation, and native
browser libraries remain unchanged unless later evidence proves a removal safe
and every live validation still passes.

## Reduction 1: Node Build Tooling

Commit scope: remove Node components needed only while constructing the AppDir.

Removed after `npm ci` completes:

- 58,969,198 bytes of Node C and C++ headers.
- 12,583,283 bytes of bundled npm and Corepack packages.
- Node package-manager command shims from `usr/lib/node/bin`.
- 56,468 bytes of Node documentation under `share`.
- Node `README.md` and `CHANGELOG.md`.

Retained:

- The official Node.js v24.18.1 x86_64 executable.
- The Node.js license.
- The `usr/bin/node` AppDir link used by `AppRun`.

| Measurement | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Uncompressed AppDir | 1,621,223,305 | 1,549,004,665 | 72,218,640 |
| Complete AppImage | 742,050,296 | 738,433,528 | 3,616,768 |

Verification passed: 52 unit tests, checksum and extracted-runtime checks,
embedded-browser path and version checks, immutable browser-update behavior,
live image generation, generated-image validation, process cleanup, and
`strace` provenance showing only the embedded Node.js and Camoufox executables.

## Reduction 2: Native Runtime Pruning

Dependency tracing corrected the initial assumption about `better-sqlite3`:
Camoufox imports it when reading `webgl_data.db` under Node.js. The active
runtime was retained and explicitly exercised during build and verification.

Removed:

- Seven `better-sqlite3` binaries for ARM64, musl, macOS, and Windows.
- The vendored 9.5 MB SQLite amalgamation and supporting headers.
- `better-sqlite3` C++ source, GYP files, download script, and build metadata.
- The build-only `node-addon-api` package.
- Debug and symbol sections from the official Node.js executable.
- Debug and symbol sections from `better-sqlite3`'s Linux x86_64 module.

Retained:

- `better-sqlite3/prebuilds/linux-x64.node` for glibc x86_64 distributions,
  including Debian and Fedora derivatives.
- The complete JS loader and database API used by Camoufox.
- `webgl_data.db` and all WebGL fingerprint sampling behavior.
- The x86_64 glibc Impit module used by Camoufox networking.

| Measurement | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Uncompressed AppDir | 1,549,004,665 | 1,505,358,106 | 43,646,559 |
| Complete AppImage | 738,433,528 | 724,949,496 | 13,484,032 |
| Node runtime tree | 123,814,422 | 105,811,350 | 18,003,072 |
| `better-sqlite3` | 27,353,961 | 2,127,756 | 25,226,205 |

Verification passed: direct `better-sqlite3` loading, an actual Camoufox WebGL
fingerprint query against the bundled database, all 52 unit tests, extracted
runtime verification, and live Perchance image generation. The generated JPEG
was 87,038 bytes and no Camoufox process remained afterward.

## Reduction 3: Runtime-Irrelevant Metadata

Removed from production npm packages:

- 4,042,787 bytes of source maps.
- 2,557,230 bytes of package TypeScript declarations.
- Package readmes, changelogs, histories, contributing guides, npm ignore
  files, Git ignore files, TypeScript build configuration, and npm's staging
  lock metadata.
- Playwright's 3,046,426-byte recorder and trace-viewer web frontend. The
  Firefox protocol, browser server, page execution, networking, cookies,
  storage, TLS, tracing internals, screenshots, and browser-context runtime
  remain present.
- `ua-parser-js/dist`, including icon artwork not referenced by its exported
  parser implementation.
- The unreferenced 3,391,490-byte `xml2js.bc.js` alternate bytecode artifact;
  the CommonJS parser used by Camoufox remains present.
- Empty directories left by these removals.

Intentionally retained:

- Every package manifest and license or notice file.
- 11,565 bytes of Perchance's own public TypeScript declarations.
- Runtime JavaScript for every transitive dependency.
- Camoufox configuration databases, XML territory data, fingerprint network
  model, browser archives, addons, dictionaries, fonts, codecs, and libraries.

| Measurement | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Uncompressed AppDir | 1,505,358,106 | 1,490,907,401 | 14,450,705 |
| Complete AppImage | 724,949,496 | 721,373,688 | 3,575,808 |
| Perchance application tree | 37,282,304 | 22,831,599 | 14,450,705 |
| Playwright Core | 9,311,756 | 4,530,004 | 4,781,752 |

The first smoke attempt exhausted the 7.3 GB `/tmp` tmpfs because AppImage's
extract-and-run mode had retained earlier 1.4-1.6 GB extraction directories.
This was a test-harness storage failure, not a runtime regression. The harness
now sets `TMPDIR` to its workspace-owned directory, removes extraction trees on
every exit, and deletes the generated test image after recording its type and
size. The clean rerun generated an 87,844-byte JPEG and left zero Camoufox
processes and zero test images.

## Reduction 4: SquashFS Compression

Two strongest practical codecs were benchmarked against the same unchanged
1,490,907,401-byte AppDir with 1 MiB blocks:

| Compressor | SquashFS bytes | Build time | Difference from zstd baseline |
| --- | ---: | ---: | ---: |
| zstd level 15, 128 KiB | 720,429,024 | 110 seconds | baseline |
| zstd level 22, 1 MiB | 669,413,376 | 318 seconds | -51,015,648 |
| xz, 1 MiB dictionary, x86 BCJ | 619,196,416 | 501 seconds | -101,232,608 |

The newer pinned `AppImage/type2-runtime` binary supports only zlib and zstd,
so it correctly rejected the xz candidate. The official AppImageKit x86_64
runtime supports xz and passed direct mounting, extraction-and-run, CLI help,
and live Perchance image generation. Its pinned SHA-256 is
`66f5b22f035022b8bdebb54c066aa6edc7b5db282fe6cdb372e7965f80772557`.

The build now creates SquashFS directly with the system `mksquashfs`, appends
it to the pinned official type 2 runtime, and normalizes all SquashFS ownership
to root. The selected settings are xz, 1 MiB blocks and dictionary, and the x86
BCJ filter. This increases release build time but leaves every application and
browser byte unchanged.

## Reduction 5: Debian Native Portability Closure

The first clean Debian 13 validation correctly failed because the previous
artifact depended on the host's `libasound.so.2`. Rather than weakening the
browser or documenting a system-package prerequisite, the build now derives a
native runtime closure in a pinned Debian Bookworm container.

The persistent builder image is content-addressed by the Containerfile hash.
Its base image digest, Debian repository snapshot (`20260730T090000Z`), and
top-level package versions are pinned. The collector script is mounted read-only
at runtime, so changing audit logic does not rebuild the dependency image. The
collector runs `lddtree` against every ELF file in the staged AppDir, copies
only non-glibc dependencies, and records package versions, licenses, SHA-256
hashes, SONAMEs, and duplicate hashes.

Final closure results:

- 68 shared libraries totaling 32,986,296 bytes uncompressed.
- 63 Debian package owners and corresponding copyright files.
- Zero libraries with unknown package provenance.
- Zero duplicate native-library hashes.
- 68 matching filename/SONAME records.
- No bundled glibc, dynamic loader, kernel interface, or GPU driver.
- All native libraries were already stripped and contained zero debug sections;
  no additional binary rewriting was necessary.

The closure includes ALSA, GTK 3, GLib/GIO/GObject, ATK, Pango, Cairo, X11,
XCB, Wayland client libraries, fontconfig, FreeType, HarfBuzz, DBus, image
codecs, compression libraries, and the C++ runtime. `AppRun` prepends the
Camoufox and native-library directories to `LD_LIBRARY_PATH` before launching
the embedded Node.js executable.

| Measurement | Before closure | Final | Increase |
| --- | ---: | ---: | ---: |
| Uncompressed AppDir | 1,490,907,401 | 1,524,795,248 | 33,887,847 |
| Complete AppImage | 619,390,144 | 629,195,968 | 9,805,824 |

The increase is intentional: it converts a host-library-dependent artifact
into a self-contained user-space browser package while keeping the final image
well below the original baseline.

## Final Result

| Measurement | Original | Final | Saved |
| --- | ---: | ---: | ---: |
| Uncompressed AppDir | 1,621,223,305 | 1,524,795,248 | 96,428,057 (5.95%) |
| Complete AppImage | 742,050,296 | 629,195,968 | 112,854,328 (15.21%) |
| AppImage runtime | 944,632 | 193,728 | 750,904 |
| Compressed SquashFS | 741,105,611 | 629,002,016 | 112,103,595 |

The final AppImage SHA-256 is
`295b9cc7545179fc3b4ffc9d9d2485846bfebb49a0c0c3e9fa9ad3f9df027154`.

All 1,257 Camoufox files are byte-for-byte identical to the working installed
browser. Their sorted content manifest hash is
`7126e62f92e4013bd89c8d318ff47eff9e0a32f92efbee7c62a0bf32cdf57400`.
No browser archive, binary, addon, font, dictionary, locale, codec, TLS file,
fingerprint database, GeoIP data, WebGL data, or rendering resource was changed
in this phase.

Final validation passed:

- 56 unit and packaging tests.
- ShellCheck, POSIX-shell formatting, and whitespace checks.
- AppImage checksum, xz/1 MiB SquashFS structure, extracted CLI, immutable
  browser behavior, native-library checksums, package provenance, SONAMEs,
  package imports, SQLite, and WebGL sampling.
- Host extraction-and-run image generation with `strace` provenance.
- Host direct FUSE-mounted image generation.
- Debian 13 Distrobox extraction-and-run image generation without system Node,
  Firefox, Chromium, or Chrome.
- Embedded Node.js and Camoufox execution confirmed in the Debian trace; no
  external Python or browser executable was launched.
- Every generated validation image was deleted, and no new Camoufox process
  remained after any smoke test.
- Live AppImage text generation wrote console output, terminated it with one
  newline, produced no stderr, and left no new browser process.

## Intentionally Retained Components

The following large components remain because removing or changing them would
risk generation, verification, portability, fingerprinting, or rendering:

- All 975,849,336 bytes of Linux, macOS, and Windows Camoufox font trees,
  including emoji, symbols, fallback fonts, spacing seeds, and fontconfig data.
- `libxul.so`, both Mozilla `omni.ja` archives, dictionaries, hyphenation data,
  browser developer resources, addons, and GeoIP data.
- NSS/TLS, sandbox, audio, GTK/Wayland, codecs, image decoding, ONNX inference,
  WebGL, canvas, SQLite, and fingerprint resources.
- Playwright's Firefox protocol and runtime JavaScript, cookies, storage,
  networking, TLS, JavaScript execution, browser contexts, and page APIs.
- The glibc x86_64 Impit networking module and `better-sqlite3` WebGL database
  runtime.
- The complete Debian native user-space closure identified by ELF dependency
  analysis.

UPX was not used. Applying it globally would add decompression and compatibility
risk, and Camoufox/Firefox binaries were deliberately excluded from binary
rewriting in this phase. Browser core archive pruning was also rejected: the
approximately 20.5 MB of developer resources is small after xz compression and
modifying signed or tightly coupled Mozilla resources is not justified without
a source-built browser and full regression validation.

## Portability Boundary

The artifact is portable across tested glibc-based x86_64 Linux environments,
including the Bazzite/Fedora-family build host and Debian 13. It is not a
Windows executable, an ARM64 build, or a musl-native package. It cannot bundle
the host kernel, glibc loader, GPU kernel driver, or display server. Software
rendering and headless browser rendering remain available through Camoufox;
hardware acceleration depends on compatible host graphics drivers.
