# Perchance AppImage Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify one x86_64 AppImage containing Perchance, Node.js,
all production npm dependencies, and the complete Camoufox runtime.

**Architecture:** A POSIX shell builder creates a deterministic AppDir from
pinned inputs and packages it with `appimagetool`. A small runtime launcher sets
the embedded Camoufox path before invoking the existing TypeScript CLI. The CLI
rejects browser updates when running from the immutable AppImage.

**Tech Stack:** TypeScript, Node.js 24 LTS, npm lockfiles, POSIX `sh`, AppImage
type 2, SquashFS, Camoufox.

---

## Tasks

### Task 1: Lock Dependencies and Protect the Immutable Browser

**Files:**

- Modify: `.gitignore`
- Create: `package-lock.json`
- Modify: `src/cli/program.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Add a failing immutable-browser test**

Extend the fake CLI dependencies with an immutable-bundle predicate:

```typescript
export interface CliDependencies {
  // Existing dependencies remain unchanged.
  isImmutableBundle(): boolean;
}
```

Add a test that invokes `browser fetch`, sets the predicate to `true`, and
expects status `1`, no delegated Camoufox command, and this stderr message:

The message must explain that Camoufox is embedded in an immutable AppImage and
that replacing or rebuilding the AppImage is required to update it.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test`

Expected: TypeScript or assertion failure because immutable AppImage handling
does not exist.

- [ ] **Step 3: Implement immutable browser-fetch handling**

Set the production predicate from the launcher environment:

```typescript
isImmutableBundle: () => process.env.PERCHANCE_APPIMAGE === "1",
```

Before delegating `browser fetch`, reject it when the predicate is true. Keep
`browser path` and `browser version` delegated unchanged.

- [ ] **Step 4: Commit an npm dependency lock**

Remove `package-lock.json` from `.gitignore`, then run:

`npm install --package-lock-only --ignore-scripts`

Verify that the lockfile pins `camoufox-js@0.11.5`, `commander`,
`playwright-core@1.58.0`, and the complete production dependency graph.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests pass, including the immutable browser-fetch test.

Run: `git add .gitignore package-lock.json src/cli/program.ts tests/cli.test.ts`

Run: `git commit -m "feat: protect embedded Camoufox runtime"`

### Task 2: Add AppImage Runtime Files

**Files:**

- Create: `packaging/appimage/AppRun`
- Create: `packaging/appimage/perchance.desktop`
- Create: `packaging/appimage/perchance.svg`
- Create: `tests/appimageFiles.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing packaging-file tests**

Add tests that assert:

- `AppRun` exists and is executable.
- It exports `CAMOUFOX_INSTALL_DIR` beneath `$APPDIR/usr/lib/camoufox`.
- It exports `PERCHANCE_APPIMAGE=1`.
- It substitutes `--help` when no arguments are supplied.
- It executes bundled `usr/bin/node` and `usr/lib/perchance/dist/src/cli.js`.
- The desktop entry declares `Type=Application`, `Terminal=true`, and the
  `perchance` icon.
- The SVG is non-empty and declares an SVG root element.

Add `dist/tests/appimageFiles.test.js` to the package test command.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test`

Expected: failure because the packaging files do not exist.

- [ ] **Step 3: Add the POSIX AppRun launcher**

Implement a strict POSIX launcher equivalent to:

```sh
#!/bin/sh
set -eu

APPDIR=${APPDIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)}
export CAMOUFOX_INSTALL_DIR="$APPDIR/usr/lib/camoufox"
export PERCHANCE_APPIMAGE=1
export PATH="$APPDIR/usr/bin:$PATH"

if [ "$#" -eq 0 ]; then
  set -- --help
fi

exec "$APPDIR/usr/bin/node" \
  "$APPDIR/usr/lib/perchance/dist/src/cli.js" "$@"
```

Add a terminal desktop entry and a simple scalable SVG icon.

- [ ] **Step 4: Verify shell and metadata files**

Run: `shellcheck -s sh packaging/appimage/AppRun`

Run: `shfmt -d -i 2 -ci packaging/appimage/AppRun`

Run:
`desktop-file-validate packaging/appimage/perchance.desktop`

Expected: all commands exit successfully.

- [ ] **Step 5: Run tests and commit**

Run: `npm test`

Expected: all tests pass.

Run:
`git add package.json packaging/appimage tests/appimageFiles.test.ts`

Run: `git commit -m "feat: add AppImage runtime launcher"`

### Task 3: Implement the Reproducible AppImage Builder

**Files:**

- Create: `scripts/build-appimage.sh`
- Create: `scripts/verify-appimage.sh`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add build constants and prerequisite checks**

The build script must use these exact pinned values:

```sh
NODE_VERSION=24.18.1
NODE_ARCHIVE=node-v24.18.1-linux-x64.tar.xz
NODE_SHA256=d6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0
CAMOUFOX_VERSION=152.0.4
CAMOUFOX_RELEASE=beta.29
```

The AppImage type 2 runtime must also be downloaded into the build cache and
verified against this SHA-256 digest:

`1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf`

Require `curl`, `sha256sum`, `tar`, `npm`, `ldd`, `find`, and
`appimagetool`. Reject non-x86_64 hosts. Resolve Camoufox from
`${CAMOUFOX_INSTALL_DIR:-$HOME/.cache/camoufox}`.

- [ ] **Step 2: Create and validate the AppDir**

The script must:

1. Run `npm run build` and `npm test`.
2. Download Node.js into `build/appimage/cache/` only when absent.
3. Verify the pinned Node.js SHA-256 before extraction.
4. Recreate `build/appimage/Perchance.AppDir` safely.
5. Copy the Node.js distribution under `usr/lib/node/`.
6. Symlink `usr/bin/node` to the embedded runtime.
7. Copy `dist/src`, `package.json`, and `package-lock.json` into
   `usr/lib/perchance/`.
8. Run the embedded npm with `npm ci --omit=dev --ignore-scripts` in the staged
   application directory.
9. Copy the complete Camoufox directory into `usr/lib/camoufox/`.
10. Copy AppRun, desktop metadata, and icon to the AppDir root.

Validate the staged application by importing Perchance, `camoufox-js`, and
`better-sqlite3` with the embedded Node.js binary. Validate that `ldd` reports
no missing dependencies for the staged Node.js and Camoufox executables.

- [ ] **Step 3: Package and checksum the artifact**

Invoke appimagetool with:

```sh
ARCH=x86_64 SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
  "$APPIMAGETOOL" --no-appstream --comp zstd \
  --runtime-file "$RUNTIME_FILE" "$APPDIR" "$OUTPUT"
```

Write `release/Perchance-1.0.0-x86_64.AppImage.sha256` with `sha256sum`.

- [ ] **Step 4: Add the verification script**

The verification script must:

- Verify the checksum file.
- Run the AppImage with no arguments and assert CLI help output.
- Assert `browser path` includes `/usr/lib/camoufox`.
- Assert `browser version` includes `v152.0.4-beta.29`.
- Assert `browser fetch` exits nonzero and reports immutable AppImage behavior.
- Extract the AppImage and assert the embedded Node.js, Perchance CLI,
  Camoufox executable, version metadata, fonts, and addons are present.

The script accepts the AppImage path as its only optional argument.

- [ ] **Step 5: Add npm commands and documentation**

Add:

```json
"appimage": "sh scripts/build-appimage.sh",
"verify:appimage": "sh scripts/verify-appimage.sh"
```

Document the build prerequisites, command, artifact path, included runtime,
supported platform, and immutable `browser fetch` behavior in `README.md`.

Ignore `build/appimage/`, `release/*.AppImage`, and
`release/*.AppImage.sha256`.

- [ ] **Step 6: Verify scripts and commit**

Run: `shellcheck -s sh scripts/build-appimage.sh scripts/verify-appimage.sh`

Run: `shfmt -d -i 2 -ci scripts/build-appimage.sh scripts/verify-appimage.sh`

Run: `npm test`

Expected: all checks pass.

Run `git add` for `.gitignore`, `package.json`, `README.md`, and both scripts.

Run: `git commit -m "build: add bundled AppImage pipeline"`

### Task 4: Build and Verify the Release Artifact

**Files:**

- Generate: `release/Perchance-1.0.0-x86_64.AppImage`
- Generate: `release/Perchance-1.0.0-x86_64.AppImage.sha256`

- [ ] **Step 1: Build the AppImage**

Run: `npm run appimage`

Expected: the builder completes and creates both release files.

- [ ] **Step 2: Run static and command verification**

Run:
`npm run verify:appimage -- release/Perchance-1.0.0-x86_64.AppImage`

Expected: checksum, extraction, help, browser path, browser version, and
immutable fetch checks pass.

- [ ] **Step 3: Run a live image-generation smoke test**

Record current Camoufox PIDs, then run:

`release/Perchance-1.0.0-x86_64.AppImage image "a small brass compass"`

Pass `--output build/appimage/smoke.png` to that command.

Expected: exit status `0` and a non-empty PNG file.

After the command exits, wait briefly and assert no new Camoufox process
remains.

- [ ] **Step 4: Run final quality gates**

Run: `npm test`

Run: `npm audit`

Run: `git diff --check HEAD`

Run: `sha256sum -c release/Perchance-1.0.0-x86_64.AppImage.sha256`

Expected: 100 percent of tests pass, zero known vulnerabilities, no whitespace
errors, and a valid artifact checksum.

- [ ] **Step 5: Record final artifact details**

Record the artifact's absolute path, byte size, human-readable size, SHA-256,
embedded Node.js version, embedded Camoufox version, and test totals for the
completion report.
