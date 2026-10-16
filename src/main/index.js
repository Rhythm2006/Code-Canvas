import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron'
import { join, dirname, extname, isAbsolute, relative, resolve, basename } from 'node:path'
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises'
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import pty from 'node-pty'

let projectRoot = null
const ptys = new Map() // id -> node-pty process

// --- settings store (Phase C: remember the session) ------------------------

let settings = {}

function settingsPath() {
  return join(app.getPath('userData'), 'settings.json')
}

// The app used to be called "Sketch REPL", which stored its data under a
// "sketch-repl" userData folder. Carry that session over once on first launch.
function migrateLegacySettings() {
  if (existsSync(settingsPath())) return
  const legacy = join(app.getPath('appData'), 'sketch-repl', 'settings.json')
  try {
    if (existsSync(legacy)) {
      mkdirSync(dirname(settingsPath()), { recursive: true })
      copyFileSync(legacy, settingsPath())
    }
  } catch {
    /* ignore */
  }
}

function loadSettings() {
  try {
    settings = JSON.parse(readFileSync(settingsPath(), 'utf8')) || {}
  } catch {
    settings = {}
  }
  return settings
}

function saveSettings(patch) {
  settings = { ...settings, ...patch }
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
  } catch {
    /* ignore */
  }
  return settings
}

// --- window ----------------------------------------------------------------

function createWindow() {
  const b = settings.windowBounds || {}
  const win = new BrowserWindow({
    width: b.width ?? 1440,
    height: b.height ?? 900,
    x: b.x,
    y: b.y,
    minWidth: 900,
    minHeight: 600,
    // Transparent so the macOS vibrancy material shows through the chrome.
    backgroundColor: '#00000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    title: 'Code Canvas',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Remember window size/position for next launch.
  win.on('close', () => {
    if (!win.isMinimized() && !win.isFullScreen()) {
      saveSettings({ windowBounds: win.getBounds() })
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

// --- application menu ------------------------------------------------------
// The menu is the native home for the app's actions. Every custom item forwards
// a `menu:action` message to the renderer, which owns the real handlers — so the
// buttons in the toolbar and the menu items stay in lockstep.

function sendMenuAction(action) {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) win.webContents.send('menu:action', action)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const act = (label, action, accelerator, extra = {}) => ({
    label,
    accelerator,
    click: () => sendMenuAction(action),
    ...extra,
  })

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        act('New File…', 'new-file', 'CmdOrCtrl+N'),
        act('Open Folder…', 'open-folder', 'CmdOrCtrl+O'),
        { type: 'separator' },
        act('Save', 'save', 'CmdOrCtrl+S'),
        act('Save All', 'save-all', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        act('Export Snapshot…', 'export-snapshot'),
        { type: 'separator' },
        act('Close Tab', 'close-tab', 'CmdOrCtrl+W'),
        ...(isMac
          ? [{ role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' }]
          : [{ role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        // The renderer already owns the ⇧Tab shortcut; show it here but don't
        // register it, so ⇧Tab still works for focus traversal in dialogs.
        act('Toggle Code / Draw', 'toggle-mode', 'Shift+Tab', {
          registerAccelerator: false,
        }),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        act('Clear Terminal', 'clear-terminal'),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --- error logging ---------------------------------------------------------
// Never let an unexpected error surface as Electron's scary "A JavaScript error
// occurred in the main process" dialog. Log it to a file we can inspect instead.

function logError(scope, err) {
  const detail = err && err.stack ? err.stack : String(err)
  const line = `[${new Date().toISOString()}] ${scope}: ${detail}\n`
  try {
    appendFileSync(join(app.getPath('userData'), 'code-canvas-errors.log'), line)
  } catch {
    /* ignore */
  }
  console.error(line.trimEnd())
}

process.on('uncaughtException', (err) => logError('uncaughtException', err))
process.on('unhandledRejection', (err) => logError('unhandledRejection', err))

// --- app lifecycle ---------------------------------------------------------
// A single-instance lock means launching the app again (or double-clicking it)
// simply focuses the existing window instead of starting a second copy — which
// is the usual cause of confusing "main process" errors.

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  console.log('[app] another instance is already running; focusing it instead.')
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.on('render-process-gone', (_e, _wc, details) =>
      logError('render-process-gone', JSON.stringify(details))
    )
    app.on('child-process-gone', (_e, details) =>
      logError('child-process-gone', JSON.stringify(details))
    )

    migrateLegacySettings()
    loadSettings()
    createWindow()
    buildMenu()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Make sure no shell/compiler processes are left behind when we quit.
  app.on('before-quit', () => {
    for (const p of ptys.values()) {
      try {
        p.kill()
      } catch {
        /* ignore */
      }
    }
    ptys.clear()
  })
}

// --- path safety -----------------------------------------------------------

function safePath(p) {
  if (!projectRoot) throw new Error('No project is open.')
  const abs = isAbsolute(p) ? resolve(p) : resolve(projectRoot, p || '.')
  const rel = relative(projectRoot, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path is outside the open project.')
  }
  return abs
}

function defaultCwd() {
  return projectRoot || app.getPath('home')
}

// --- project ---------------------------------------------------------------

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return null
  projectRoot = res.filePaths[0]
  return { root: projectRoot, name: basename(projectRoot) }
})

ipcMain.handle('project:root', () => projectRoot)

// Restore the last project without showing the picker (Phase C).
ipcMain.handle('project:setRoot', async (_e, dir) => {
  try {
    const info = await stat(dir)
    if (!info.isDirectory()) return null
  } catch {
    return null
  }
  projectRoot = dir
  return { root: projectRoot, name: basename(projectRoot) }
})

// --- settings --------------------------------------------------------------

ipcMain.handle('settings:get', () => settings)
ipcMain.handle('settings:set', (_e, patch) => saveSettings(patch))

// --- filesystem ------------------------------------------------------------

const IGNORED = new Set(['node_modules', '.git', '.sketch', '.DS_Store', 'out', 'dist'])

ipcMain.handle('fs:readDir', async (_e, dir) => {
  const abs = safePath(dir)
  const entries = await readdir(abs, { withFileTypes: true })
  return entries
    .filter((e) => !IGNORED.has(e.name))
    .map((e) => ({ name: e.name, path: join(abs, e.name), isDir: e.isDirectory() }))
    .sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
    )
})

ipcMain.handle('fs:readFile', async (_e, p) => readFile(safePath(p), 'utf8'))

ipcMain.handle('fs:writeFile', async (_e, { path: p, content }) => {
  const abs = safePath(p)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
  return true
})

ipcMain.handle('fs:exists', async (_e, p) => {
  try {
    await readFile(safePath(p))
    return true
  } catch {
    return false
  }
})

// --- file management (Phase A) ---------------------------------------------

ipcMain.handle('fs:createFile', async (_e, { dir, name }) => {
  const abs = safePath(join(dir, name))
  try {
    await stat(abs)
    throw new Error(`"${name}" already exists.`)
  } catch (err) {
    if (err.message?.includes('already exists')) throw err
    /* ENOENT = good, it doesn't exist yet */
  }
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, '', 'utf8')
  return abs
})

ipcMain.handle('fs:createDir', async (_e, { dir, name }) => {
  const abs = safePath(join(dir, name))
  try {
    await stat(abs)
    throw new Error(`"${name}" already exists.`)
  } catch (err) {
    if (err.message?.includes('already exists')) throw err
    /* ENOENT = good */
  }
  await mkdir(abs, { recursive: true })
  return abs
})

ipcMain.handle('fs:rename', async (_e, { path: p, newName }) => {
  const abs = safePath(p)
  const target = safePath(join(dirname(abs), newName))
  try {
    await stat(target)
    throw new Error(`"${newName}" already exists.`)
  } catch (err) {
    if (err.message?.includes('already exists')) throw err
    /* ENOENT = good */
  }
  const { rename } = await import('node:fs/promises')
  await rename(abs, target)
  return target
})

ipcMain.handle('fs:delete', async (_e, p) => {
  const abs = safePath(p)
  // Move to the OS Trash rather than a permanent delete — recoverable.
  await shell.trashItem(abs)
  return true
})

// --- export (Phase E) -------------------------------------------------------

// Snapshot of the whole shared surface (code + sketch) via the compositor.
ipcMain.handle('export:snapshot', async (event, { rect } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return null

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export snapshot',
    defaultPath: join(app.getPath('pictures'), 'code-canvas-snapshot.png'),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  })
  if (canceled || !filePath) return null

  // Capture *after* the dialog closes so it never ends up in the image.
  const image = await win.webContents.capturePage(rect)
  await writeFile(filePath, image.toPNG())
  return filePath
})

// Generic "save some text/base64 as…" used for drawing PNG + SVG exports.
ipcMain.handle('export:saveAs', async (event, { defaultName, filters, content, base64 } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: join(app.getPath('pictures'), defaultName || 'export'),
    filters,
  })
  if (canceled || !filePath) return null

  if (base64) await writeFile(filePath, Buffer.from(content, 'base64'))
  else await writeFile(filePath, content, 'utf8')
  return filePath
})

// --- toolchains ------------------------------------------------------------

const TOOLCHAINS = [
  'python3', 'python', 'node', 'clang++', 'g++', 'clang', 'gcc', 'cc',
  'java', 'javac', 'go', 'rustc', 'ruby', 'php',
]

function which(cmd) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd])
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('close', (code) => resolvePromise(code === 0 ? out.trim().split('\n')[0] : null))
    child.on('error', () => resolvePromise(null))
  })
}

ipcMain.handle('toolchains:detect', async () => {
  const result = {}
  await Promise.all(
    TOOLCHAINS.map(async (c) => {
      result[c] = await which(c)
    })
  )
  return result
})

// --- terminal (PTY) --------------------------------------------------------

function shellPath() {
  return process.env.SHELL || '/bin/zsh'
}

// Sending to a renderer that has already gone away throws "Object has been
// destroyed"; the PTY can outlive the window, so guard every send.
function send(event, channel, payload) {
  try {
    if (!event.sender.isDestroyed()) event.sender.send(channel, payload)
  } catch {
    /* window already closed */
  }
}

function startPty(event, id, { command = null, cwd, cols = 100, rows = 30 }) {
  const existing = ptys.get(id)
  if (existing) existing.kill()

  // fit() can report 0 before layout; never hand node-pty degenerate dimensions.
  const safeCols = Number.isFinite(cols) && cols > 1 ? cols : 100
  const safeRows = Number.isFinite(rows) && rows > 1 ? rows : 30

  const p = pty.spawn(shellPath(), command ? ['-c', command] : [], {
    name: 'xterm-256color',
    cols: safeCols,
    rows: safeRows,
    cwd: cwd || defaultCwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
  })
  ptys.set(id, p)

  let bytes = 0
  p.onData((data) => {
    bytes += data.length
    send(event, 'pty:data', { id, data })
  })
  p.onExit(({ exitCode }) => {
    // Only remove from the map if this is still the active pty for `id`.
    if (ptys.get(id) === p) ptys.delete(id)
    console.log(`[pty] ${id} exited (code ${exitCode}) after ${bytes} bytes`)
    send(event, 'pty:exit', { id, code: exitCode })
  })
  console.log(
    `[pty] started ${id} (${safeCols}x${safeRows}): ${
      command ? command.slice(0, 90) : '(interactive shell)'
    }`
  )
  return p
}

ipcMain.handle('pty:start', (event, { id, command = null, cwd, cols, rows }) => {
  const dir = cwd ? (projectRoot ? safePath(cwd) : cwd) : defaultCwd()
  startPty(event, id, { command, cwd: dir, cols, rows })
  return { cwd: dir }
})

ipcMain.handle('pty:write', (_e, { id, data }) => {
  ptys.get(id)?.write(data)
})

ipcMain.handle('pty:resize', (_e, { id, cols, rows }) => {
  try {
    ptys.get(id)?.resize(cols, rows)
  } catch {
    /* ignore */
  }
})

ipcMain.handle('pty:kill', (_e, id) => {
  const p = ptys.get(id)
  if (p) {
    p.kill()
    ptys.delete(id)
  }
})

// --- running files ---------------------------------------------------------

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

// Toolchain resolution: for each language, try these executables in order and
// use the first one actually present on PATH. Cached for the session.
const toolchainCache = new Map()

async function resolveExe(candidates) {
  for (const c of candidates) {
    if (toolchainCache.has(c)) {
      const hit = toolchainCache.get(c)
      if (hit) return hit
      continue
    }
    const p = await which(c)
    toolchainCache.set(c, p)
    if (p) return p
  }
  return null
}

function outPath() {
  return join(tmpdir(), `codecanvas-${Date.now()}`)
}

// Each language: a friendly label, candidate executables, and how to build the
// command. Compiled languages compile to a temp binary then run it.
const RUNNERS = {
  '.py': { label: 'Python', candidates: ['python3', 'python'], make: (exe, f) => `${shq(exe)} ${shq(f)}` },
  '.js': { label: 'Node', candidates: ['node'], make: (exe, f) => `${shq(exe)} ${shq(f)}` },
  '.mjs': { label: 'Node', candidates: ['node'], make: (exe, f) => `${shq(exe)} ${shq(f)}` },
  '.cjs': { label: 'Node', candidates: ['node'], make: (exe, f) => `${shq(exe)} ${shq(f)}` },
  '.rb': { label: 'Ruby', candidates: ['ruby'], make: (exe, f) => `${shq(exe)} ${shq(f)}` },
  '.php': { label: 'PHP', candidates: ['php'], make: (exe, f) => `${shq(exe)} ${shq(f)}` },
  '.go': { label: 'Go', candidates: ['go'], make: (exe, f) => `${shq(exe)} run ${shq(f)}` },
  '.c': {
    label: 'C',
    candidates: ['clang', 'gcc', 'cc'],
    make: (exe, f, out) => `${shq(exe)} ${shq(f)} -o ${shq(out)} && ${shq(out)}`,
  },
  '.cpp': {
    label: 'C++',
    candidates: ['clang++', 'g++'],
    make: (exe, f, out) => `${shq(exe)} ${shq(f)} -o ${shq(out)} && ${shq(out)}`,
  },
  '.cc': {
    label: 'C++',
    candidates: ['clang++', 'g++'],
    make: (exe, f, out) => `${shq(exe)} ${shq(f)} -o ${shq(out)} && ${shq(out)}`,
  },
  '.cxx': {
    label: 'C++',
    candidates: ['clang++', 'g++'],
    make: (exe, f, out) => `${shq(exe)} ${shq(f)} -o ${shq(out)} && ${shq(out)}`,
  },
  '.rs': {
    label: 'Rust',
    candidates: ['rustc'],
    make: (exe, f, out) => `${shq(exe)} ${shq(f)} -o ${shq(out)} && ${shq(out)}`,
  },
}

// Java is special: needs javac + java and the class name (not the file path).
async function javaPlan(file) {
  const javac = await resolveExe(['javac'])
  const java = await resolveExe(['java'])
  // macOS ships stub binaries at /usr/bin/java(c) that pop a "install a JDK"
  // dialog instead of running. Treat those as "not installed".
  const isStub = (p) => p === '/usr/bin/javac' || p === '/usr/bin/java'
  if (!javac || !java || isStub(javac) || isStub(java)) {
    return {
      error:
        'Java runtime not found — only the macOS stub is installed. Install a JDK (e.g. `brew install openjdk`) and try again.',
    }
  }
  const cls = basename(file, extname(file))
  const out = outPath()
  const command = `${shq(javac)} -d ${shq(out)} ${shq(file)} && ${shq(java)} -cp ${shq(out)} ${shq(cls)}`
  return { command, label: 'Java', exe: javac }
}

async function planRun(file) {
  const ext = extname(file).toLowerCase()
  if (ext === '.java') return javaPlan(file)

  const runner = RUNNERS[ext]
  if (!runner) return { error: `No runner configured for "${ext}" files yet.` }

  const exe = await resolveExe(runner.candidates)
  if (!exe) {
    return { error: `${runner.label} not found on PATH (tried: ${runner.candidates.join(', ')}).` }
  }
  return { command: runner.make(exe, file, outPath()), label: runner.label, exe }
}

ipcMain.handle('run:file', async (event, { id = 'main', file }) => {
  let abs
  try {
    abs = safePath(file)
  } catch (err) {
    send(event, 'pty:data', { id, data: `\r\n${err.message}\r\n` })
    return
  }

  // Empty file → clear message instead of a cryptic linker error.
  try {
    const info = await stat(abs)
    if (info.size === 0) {
      send(event, 'pty:data', {
        id,
        data: `\r\n\x1b[33m${basename(abs)} is empty — nothing to compile or run.\x1b[0m\r\n`,
      })
      return
    }
  } catch {
    /* fall through */
  }

  const plan = await planRun(abs)
  if (plan.error) {
    send(event, 'pty:data', { id, data: `\r\n\x1b[31m${plan.error}\x1b[0m\r\n` })
    return
  }

  const command = projectRoot ? `cd ${shq(projectRoot)} && ${plan.command}` : plan.command

  let p = ptys.get(id)
  if (!p) {
    p = startPty(event, id, { command: null, cwd: defaultCwd() })
  }

  // Tell the user which toolchain was actually chosen, as a section divider.
  send(event, 'pty:data', {
    id,
    data: `\r\n\x1b[2m─────\x1b[0m \x1b[36m▶ ${plan.label}\x1b[0m \x1b[2m(${plan.exe})\x1b[0m \x1b[2m─────\x1b[0m\r\n`,
  })

  console.log(`[run] ${abs}\n[run] -> ${command}`)
  setTimeout(() => {
    const live = ptys.get(id)
    if (live) live.write(`${command}\n`)
  }, 80)
})
