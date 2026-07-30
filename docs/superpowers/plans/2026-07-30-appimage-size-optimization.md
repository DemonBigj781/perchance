# AppImage Size Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the Perchance AppImage as far as verified safe while keeping
Camoufox, all required dependencies, fingerprint behavior, and fully offline
runtime packaging intact.

**Architecture:** Preserve the browser payload and application behavior, prune
only build-time or demonstrably unused files from the staged AppDir, and then
use stronger SquashFS compression. Every reduction is isolated in a commit and
must pass unit, extraction, live image generation, process-cleanup, and runtime
provenance checks before another reduction is attempted.

**Tech Stack:** POSIX shell, TypeScript, Node.js 24, Camoufox, Playwright,
AppImage type 2, SquashFS, `strace`, Podman.

---

## Tasks

### Task 1: Record and Automate the Baseline

**Files:**

- Create: `docs/appimage-size-audit.md`
- Create: `scripts/audit-appimage-size.sh`
- Create: `scripts/smoke-appimage.sh`
- Modify: `tests/appimageFiles.test.ts`
- Modify: `package.json`

- [x] Record exact AppImage, SquashFS, AppDir, subsystem, extension, package,
  native library, font, locale, dictionary, archive, duplicate, and debug-data
  sizes.
- [x] Preserve the original AppImage under `release/baseline/`.
- [x] Add a clean-environment image-generation smoke test with `strace` checks
  proving that bundled Node.js and Camoufox are used and no Python or system
  browser is executed.
- [x] Run the baseline smoke test in extract-and-run mode.
- [ ] Commit the baseline before changing payload contents.

### Task 2: Remove Node.js Build-Time Payload

**Files:**

- Modify: `scripts/build-appimage.sh`
- Modify: `tests/appimageFiles.test.ts`
- Update: `docs/appimage-size-audit.md`

- [x] Add a failing test requiring removal of Node headers, npm, Corepack,
  documentation, and package-manager tooling after `npm ci` completes.
- [x] Keep the official Node.js executable and license but remove build-only
  directories and runtime-unneeded command shims.
- [x] Rebuild, audit, verify, and run the live smoke test.
- [ ] Commit only if all behavior remains valid.

### Task 3: Remove Unused Application Dependencies and Metadata

**Files:**

- Modify: `scripts/build-appimage.sh`
- Modify: `tests/appimageFiles.test.ts`
- Update: `docs/appimage-size-audit.md`

- [ ] Add failing tests for the exact staging cleanup rules.
- [ ] Remove `better-sqlite3`, which has no runtime reference in Camoufox JS,
  along with its eight cross-platform prebuilds and SQLite source tree.
- [ ] Remove source maps, TypeScript declarations, tests, examples,
  documentation, npm metadata caches, and Python/node-gyp sources that are not
  imported at runtime.
- [ ] Preserve package manifests, licenses, Camoufox data files, Playwright
  runtime JavaScript, the x86_64 Impit native module, and all browser payload.
- [ ] Rebuild, audit, verify, and run the live smoke test.
- [ ] Commit only if all behavior remains valid.

### Task 4: Optimize SquashFS Compression

**Files:**

- Modify: `scripts/build-appimage.sh`
- Modify: `scripts/verify-appimage.sh`
- Update: `docs/appimage-size-audit.md`

- [ ] Benchmark high-level zstd and xz with larger SquashFS blocks.
- [ ] Select the smallest format that mounts and extracts correctly.
- [ ] Rebuild and rerun every static and live validation.
- [ ] Commit the chosen compression settings separately.

### Task 5: Validate Portability and Report

**Files:**

- Create: `scripts/verify-appimage-container.sh`
- Modify: `package.json`
- Update: `README.md`
- Complete: `docs/appimage-size-audit.md`

- [ ] Validate direct and extraction-and-run modes on the host.
- [ ] Validate the extracted AppDir in a clean x86_64 Linux container without
  Node.js, Python, Firefox, Chromium, or Camoufox installed.
- [ ] Confirm image generation, verification, TLS networking, output saving,
  and process cleanup.
- [ ] Record exact original/final sizes, removals, retained components,
  rejected optimizations, compression, and portability tradeoffs.
- [ ] Run the final full suite and checksum verification.
