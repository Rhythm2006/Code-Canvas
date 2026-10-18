# Changelog

All notable changes to Code Canvas are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-18

First public release. A desktop code editor with a drawing canvas layered
directly over the code.

### Drawing

- A transparent [Excalidraw](https://excalidraw.com/) canvas sits over the
  Monaco editor, sharing one surface with it. `⇧Tab` or the **Code / Draw**
  toggle decides which layer receives input.
- Per-file sketches are saved with the project in `.sketch/drawings.json`, so
  annotations travel with the code and can be committed alongside it. The
  `.sketch` folder is hidden from the Explorer, and files that carry a sketch
  are marked in the tree.
- Export a combined *code + sketch* snapshot as PNG, or the drawing alone as
  PNG or SVG.
- The drawing engine is MIT-licensed: no license key, no trial, no watermark.
  Its fonts and locale bundles are self-hosted, so drawing works with no
  network access at all.

### Editor

- Multi-file projects with a real file tree: create files and folders, rename,
  and delete to the Trash. Tabs with unsaved-change dots, **Save all** and
  **Close all**.
- [Monaco](https://microsoft.github.io/monaco-editor/) editor with a dark theme
  matched to the rest of the app, bundled locally (no CDN).

### Terminal and running code

- The output panel is a real terminal ([xterm.js](https://xtermjs.org/) over
  [node-pty](https://github.com/microsoft/node-pty)) running your login shell.
- **Run** (`⌘↵`) saves the file, resolves a toolchain, prints a labelled
  divider, and *types* the command into that shell — so `stdin`, prompts,
  colours and `Ctrl+C` behave exactly as they do in Terminal.app.
- Toolchains are detected on your `PATH` for Python, Node/JavaScript, Ruby, PHP,
  Go, C, C++, Rust and Java. Executables are probed in preference order (C++
  tries `clang++` before `g++`) and the found set is reported in the sidebar.
  The macOS `/usr/bin/java` stub is detected and rejected with a real
  explanation.

### App

- Native application menu owning `⌘N`, `⌘O`, `⌘S`, `⌘⇧S`, `⌘W`, `⌘⇧W` and
  `⌘↵`.
- Welcome screen with recent projects, and session restore for the last
  project, open tabs, active file, mode, terminal height and window size.
- macOS-style dark UI: hidden-inset title bar, vibrancy behind the chrome, and
  one palette shared by the editor, terminal and canvas.

### Packaging

- Unsigned `arm64` `.dmg`, built with electron-builder.
- The `.dmg` window has its own artwork, rendered as a vector at 1x and 2x by
  `npm run dmg:art`.
- `npm run checksums` writes `release/SHA256SUMS.txt` for verifying a download.

### Fixed

- **Closing a tab no longer deletes that file's saved sketch.** A sketch belongs
  to the file and lives in the sidecar, so it now survives closing (and
  reopening) the tab. Previously the entry was dropped and, once the debounced
  save ran, the drawing was gone for good even though the file was still there.
- The Welcome screen no longer flashes for a moment on launch before the saved
  session is restored.

### Notes

- Released under the [MIT license](LICENSE).
- Not code-signed, so the first launch on another Mac needs a Gatekeeper
  override (right-click → **Open**).
- Drawings are viewport-anchored: they don't scroll with the code, so long
  files read best in shorter chunks.
