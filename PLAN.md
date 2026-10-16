# Code Canvas — Build Plan

A desktop editor with an infinite drawing canvas layered **on top of** the code,
so you can run a program and sketch the explanation directly over it — for
learning and teaching.

> **Goal of this document:** the what, the why, the phases, and where the code
> lives — so anyone (including future me) can pick this up cold.

---

## 1. The idea in one sentence

> A desktop app where a student writes and runs code in a real editor **and**
> sketches diagrams on the same surface, with everything saved together as an
> ordinary project folder.

---

## 2. Why desktop, not the browser

The first attempt was a browser page running Python through Pyodide. It was
abandoned deliberately:

| Decision | Choice | Reason |
|----------|--------|--------|
| Form factor | **Electron desktop app** | Direct filesystem access; real projects, real folders |
| Execution | **The user's own toolchains**, via a PTY | Real languages at real speed — not just WASM Python |
| Terminal | **node-pty + xterm.js** | True `stdin`, colours, and `Ctrl+C`; interactive programs just work |
| Storage | **The project folder itself** | Drawings are versioned and shared with the code |
| Editor | **Monaco** | VS Code's editor: multi-language, familiar, fast |

The browser version could never run `g++`, could never open a folder, and could
never accept typed input. Those turned out to *be* the product.

---

## 3. Stack

- **Electron 44** — app shell, native menus, vibrancy
- **electron-vite 6 + Vite 8** — main / preload / renderer builds
- **React 19** — UI
- **Monaco Editor** (`@monaco-editor/react`) — the code editor
- **Excalidraw** (MIT) — the drawing canvas, with self-hosted fonts
- **@xterm/xterm + node-pty** — the terminal
- **electron-builder** — macOS `.dmg`

---

## 4. Architecture

```
┌──────────────────────────── main process (Node) ────────────────────────────┐
│  window + vibrancy · native application menu · settings store                │
│  FS IPC (read/write/create/rename/trash) · export IPC                        │
│  toolchain resolver (RUNNERS, resolveExe, planRun)                           │
│  PTY manager (node-pty, one persistent shell: id "main")                     │
└───────────────▲──────────────────────────────────────────────▲──────────────┘
                │ window.api (contextBridge)                    │ ipcRenderer
┌───────────────┴──────────────── renderer (React) ─────────────┴──────────────┐
│  App.jsx        — state, session restore/persist, file ops, menu dispatch     │
│  FileTree · Tabs · MonacoPane · DrawCanvas · Terminal · Welcome · Dialog      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Data flow for a run:** press **Run** → renderer saves the file to disk → main
resolves a toolchain and composes a command → the command is *typed into the
shell* → output streams back over `pty:data` → xterm renders it. Because the run
happens in a live shell, the user can type back at any prompt.

**Data flow for a drawing:** Excalidraw `onChange` → the scene is held in memory
for the active file → debounced serialization to
`<project>/.sketch/drawings.json` (one sidecar per project).

---

## 5. Data model

### Session settings — `settings.json` in Electron's `userData`

```json
{
  "lastRoot": "/Users/you/projects/algorithms",
  "openFiles": ["/Users/you/projects/algorithms/main.py"],
  "activePath": "/Users/you/projects/algorithms/main.py",
  "mode": "code",
  "outputHeight": 220,
  "windowBounds": { "x": 100, "y": 80, "width": 1440, "height": 900 },
  "recentProjects": ["/Users/you/projects/algorithms"]
}
```

### Project drawings — `<project>/.sketch/drawings.json`

A map of absolute file path → that file's serialized Excalidraw scene:

```json
{
  "/Users/you/projects/algorithms/main.py": {
    "type": "excalidraw",
    "version": 2,
    "elements": [],
    "appState": { "viewBackgroundColor": "transparent" },
    "files": {}
  }
}
```

The `.sketch` folder is hidden from the Explorer but belongs to the project, so
drawings travel with the code through git and shares.

### Toolchain resolution

```
RUNNERS = {
  ".py":  Python   → ["python3", "python"]
  ".js":  Node     → ["node"]
  ".c":   C        → ["clang", "gcc", "cc"]        → compile to temp, then run
  ".cpp": C++      → ["clang++", "g++"]            → compile to temp, then run
  ".rs":  Rust     → ["rustc"]                     → compile to temp, then run
  ".go":  Go       → ["go"]
  ".rb":  Ruby, ".php": PHP
  ".java": Java    → javac + java (macOS stub detected and rejected)
}
```

The first candidate actually present on `PATH` wins, and the choice is cached
for the session.

---

## 6. Build phases

All six refinement phases are complete.

### ✅ Phase A — File management
- [x] New File / New Folder, Rename
- [x] Delete → OS **Trash** (`shell.trashItem`), never a hard delete
- [x] Explorer context menu + keyboard navigation (`↑↓←→`, `Enter`, `F2`, `Delete`)
- [x] Unsaved-changes prompt when closing a dirty tab

### ✅ Phase B — Toolchain resolution + runners
- [x] `PATH`-based resolver with per-language candidate lists and caching
- [x] Go / Rust / Java added; compiled languages build to a temp binary
- [x] Reports which toolchain was chosen; clear errors when none is found
- [x] macOS Java-stub detection

### ✅ Phase C — Remember the session
- [x] `settings.json` in `userData`: last project, tabs, active file, mode, terminal height, window bounds
- [x] Restore on launch via `project:setRoot`
- [x] One-time migration from the old `sketch-repl` data folder

### ✅ Phase D — Terminal & editor polish
- [x] Terminal **Clear** / **Restart** + imperative API
- [x] Run separator banner naming the toolchain; `[shell exited with code N]`
- [x] `⌘↵` Run, `⌘S` Save, `⌘⇧S` Save all; per-language tab size; live window title
- [x] Tabs: Save all / Close all, middle-click close

### ✅ Phase E — Drawing polish
- [x] **Clear drawing**
- [x] **Export** — snapshot (code + sketch), drawing PNG, drawing SVG
- [x] "has sketch" `✎` indicator in the file tree

### ✅ Phase F — Ship it
- [x] Native application menu wired to the renderer via `menu:action`
- [x] Welcome screen with **recent projects** (persisted, prunable)
- [x] App icon rendered from SVG via Electron → `.icns` (`npm run icon`)
- [x] electron-builder config → **`.dmg`** (`npm run dist`)
- [x] README + PLAN rewritten for the desktop app

---

## 7. Packaging

```bash
npm run pack   # unpacked .app in release/  (fast smoke test)
npm run dist   # release/Code Canvas-0.2.0-arm64.dmg
```

Key config choices in `electron-builder.yml`:

- `asarUnpack: **/node_modules/node-pty/**` — a native module cannot be spawned
  from inside an asar archive.
- `mac.identity: null` — no signing certificate is available. On another Mac the
  app must be opened via right-click → **Open** (or `xattr -dr
  com.apple.quarantine`).
- Target is `arm64` only.

---

## 8. Risks / trade-offs

| Risk | Mitigation |
|------|------------|
| `node-pty` is native → breaks after `node_modules` reinstall or Node/Electron upgrade | `npm run rebuild`; electron-builder rebuilds it automatically at package time |
| Unsigned `.dmg` triggers Gatekeeper on other machines | Documented; needs an Apple Developer certificate to fix properly |
| `⇧Tab` is captured globally for mode switching | The only deliberately-registered global shortcut; it does **not** steal focus traversal in dialogs (menu item shows it without registering it) |
| Annotations don't scroll with the code | Known; best for short snippets — see roadmap |
| Running arbitrary user code | This is the point — it runs the user's own code with their own toolchains, no sandboxing pretence |
| Monaco ships a large `ts.worker` (~11 MB) | Costs bundle size; ships as-is for full language support |

---

## 9. Future ideas

- **Link code ↔ drawing:** bind a shape to a line number; a presentation mode that
  steps through code while the drawing stays put; a shared pointer for teaching.
- **Auto visuals:** turn program output into sticky notes; diagram control flow.
- **Platforms:** Windows and Linux targets, plus a signed and notarised macOS build.
- **Multiple terminals** and per-project shells.
- Collaboration (Yjs) so a teacher and student share a board.

---

## 10. File map

```
code-canvas/
├── PLAN.md                    ← this file
├── README.md
├── electron-builder.yml       ← .dmg packaging
├── electron.vite.config.mjs
├── package.json
├── build/
│   ├── icon.png               ← master icon (rendered from SVG)
│   └── icon.icns
├── scripts/
│   ├── render-icon.cjs        ← SVG → PNG, via Electron
│   └── make-icns.sh           ← PNG → .icns, via sips + iconutil
└── src/
    ├── main/index.js          ← window, menu, FS + export IPC, toolchains, PTY
    ├── preload/index.js       ← window.api bridge
    └── renderer/
        ├── index.html
        └── src/
            ├── App.jsx        ← state, session, file ops, menu dispatch
            ├── App.css        ← themed stylesheet
            ├── index.css      ← design tokens
            ├── lib/monaco.js  ← local Monaco + workers, sketch-dark theme
            └── components/
                ├── FileTree.jsx
                ├── Tabs.jsx
                ├── MonacoPane.jsx
                ├── DrawCanvas.jsx
                ├── Terminal.jsx
                ├── Welcome.jsx
                └── Dialog.jsx
```
