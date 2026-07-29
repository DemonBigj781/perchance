# Perchance AppImage Packaging Design

## Goal

Produce a single executable Linux AppImage that runs the Perchance command-line
interface without requiring a separately installed Node.js runtime, npm
packages, or Camoufox browser download.

The release artifact is `release/Perchance-1.0.0-x86_64.AppImage`.

## Supported Platform

- Architecture: x86_64.
- Operating system: modern glibc-based desktop Linux.
- Display: headless generation is the default; `--visible` requires a working
  desktop display session.
- Foundational host interfaces such as the Linux kernel, glibc, graphics
  drivers, desktop display sockets, and common system integration libraries
  remain host responsibilities.

This package is not intended for ARM64, musl-only distributions, Windows, or
macOS.

## Bundled Payload

The AppImage contains all application-specific runtime components:

- Perchance's compiled JavaScript CLI and production npm dependencies.
- Official Node.js `v24.18.1` Linux x64 runtime.
- The complete Camoufox `v152.0.4-beta.28` installation from the local Camoufox
  cache, including its executable, shared libraries, fonts, addons, GeoIP data,
  and metadata.
- AppImage launch metadata, icon, desktop entry, and `AppRun` launcher.

The Node.js archive is downloaded from the official Node.js distribution
service and verified against the pinned SHA-256 digest:

`d6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0`

The build fails if the Camoufox installation is missing, incomplete, reports a
different version, or has unresolved ELF dependencies on the build host.

## AppDir Layout

```text
Perchance.AppDir/
|-- AppRun
|-- perchance.desktop
|-- perchance.svg
|-- .DirIcon -> perchance.svg
`-- usr/
    |-- bin/
    |   `-- node
    `-- lib/
        |-- node/
        |   `-- complete official Node.js distribution
        |-- perchance/
        |   |-- dist/src/
        |   |-- node_modules/
        |   |-- package.json
        |   `-- package-lock.json
        `-- camoufox/
            `-- complete Camoufox installation
```

`usr/bin/node` is a relative symlink into the bundled Node.js distribution.

## Runtime Behavior

`AppRun` resolves the AppImage mount directory, prepends bundled Node.js to
`PATH`, sets `CAMOUFOX_INSTALL_DIR` to the embedded Camoufox directory, and
executes the compiled CLI.

Running the AppImage without arguments displays the normal CLI help. All
existing CLI commands remain available:

- `image <prompt>` generates and saves an image.
- `text <prompt>` generates text.
- `browser path` prints the embedded Camoufox path.
- `browser version` prints the embedded Camoufox version.

The AppImage payload is immutable. `browser fetch` therefore exits nonzero with
an explanatory message instructing the operator to replace or rebuild the
AppImage instead of trying to modify the mounted filesystem.

Image and text commands retain the existing browser cleanup guarantees. Once
generation and file output complete, the browser context and owning Camoufox
process close before the CLI exits.

## Reproducible Build

The repository gains a POSIX `sh` build script that:

1. Validates the host architecture and required tools.
2. Builds and tests Perchance.
3. Downloads and verifies the pinned Node.js archive, reusing a verified local
   cache when available.
4. Creates a clean AppDir staging tree.
5. Installs production npm dependencies from a committed lockfile with
   lifecycle scripts disabled.
6. Copies the compiled Perchance CLI and complete Camoufox runtime.
7. Validates the staged Node.js and Camoufox executables.
8. Runs `appimagetool` with a deterministic source date and x86_64 architecture.
9. Writes the final AppImage and a neighboring SHA-256 checksum file.

Generated staging data is stored below `build/appimage/`. Release binaries are
stored below `release/`. Both are excluded from Git.

## Dependency Locking

`package-lock.json` is committed and used by both normal development
installation and AppImage production dependency installation. This removes the
repository's current nondeterministic dependency resolution.

The AppImage build uses `npm ci --omit=dev --ignore-scripts` in the staging
directory. The installed production package tree is then validated using the
bundled Node.js runtime, including direct imports of Perchance, Camoufox JS, and
the native `better-sqlite3` module.

## Verification

The completed artifact must pass all of the following checks:

- TypeScript build and unit tests.
- `npm audit` with zero known vulnerabilities.
- AppImage extraction and payload layout inspection.
- No-argument invocation displays CLI help.
- `browser path` resolves inside the AppImage mount or extracted AppDir.
- `browser version` reports Camoufox `v152.0.4-beta.28`.
- `browser fetch` is rejected as an immutable-bundle operation.
- A live image-generation smoke test writes a non-empty image file.
- No Camoufox process remains after the smoke test exits.
- The final AppImage SHA-256 checksum matches the generated checksum file.

## Failure Handling

The build exits immediately with a precise error when a required tool,
download, checksum, browser file, npm dependency, or packaging operation fails.
It never silently downloads a different Node.js or Camoufox version and never
falls back to the host Node.js runtime in the finished artifact.
