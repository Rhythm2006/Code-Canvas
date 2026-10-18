import { useEffect, useRef, useState } from 'react'
import FileTree from './components/FileTree'
import Tabs from './components/Tabs'
import MonacoPane from './components/MonacoPane'
import DrawCanvas, { CANVAS_STROKE } from './components/DrawCanvas'
import Terminal from './components/Terminal'
import Dialog from './components/Dialog'
import Welcome from './components/Welcome'
import { exportToBlob, exportToSvg, restore, serializeAsJSON } from '@excalidraw/excalidraw'
import './App.css'

const SIDECAR = '/.sketch/drawings.json'
const PTY_ID = 'main'
const nameOf = (p) => p.split('/').pop()

// Does a saved Excalidraw scene actually contain any shapes? Entries written by
// the earlier tldraw-based version have no `elements` array, so they are ignored
// rather than rendered as garbage.
const sceneHasElements = (scene) =>
  Array.isArray(scene?.elements) && scene.elements.some((el) => !el.isDeleted)

export default function App() {
  const [root, setRoot] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [files, setFiles] = useState([]) // open files: { path, name, content, dirty }
  const [activePath, setActivePath] = useState(null)
  const [mode, setMode] = useState('code') // 'code' | 'draw'
  const [toolchains, setToolchains] = useState({})
  const [outputHeight, setOutputHeight] = useState(220)
  const [dialog, setDialog] = useState(null)
  const [treeVersion, setTreeVersion] = useState(0)
  const [sessionReady, setSessionReady] = useState(false)
  const [drawingPaths, setDrawingPaths] = useState(() => new Set())
  const [exportOpen, setExportOpen] = useState(false)
  const [recents, setRecents] = useState([])
  const [canvasReady, setCanvasReady] = useState(false)

  const canvasRef = useRef(null) // Excalidraw imperative API
  const canvasWrapRef = useRef(null)
  const monacoRef = useRef(null)
  const drawingsRef = useRef({}) // { [filePath]: serialized Excalidraw scene }
  const prevPathRef = useRef(null)
  const latestSceneRef = useRef(null) // scene as last reported by Excalidraw
  const suppressCanvasUntilRef = useRef(0) // ignore programmatic onChange until this time
  const rootRef = useRef(null)
  const activePathRef = useRef(null)
  const saveTimerRef = useRef(null)
  const termApiRef = useRef(null)
  // Latest menu/keyboard handlers, reached from the once-registered listeners.
  const actionsRef = useRef({})

  useEffect(() => {
    rootRef.current = root
  }, [root])
  useEffect(() => {
    activePathRef.current = activePath
  }, [activePath])

  const activeFile = files.find((f) => f.path === activePath) || null
  const bumpTree = () => setTreeVersion((v) => v + 1)

  // Track which files currently have a sketch, for the Explorer indicator.
  const updateDrawingPath = (path, has) => {
    setDrawingPaths((prev) => {
      if (prev.has(path) === has) return prev
      const next = new Set(prev)
      if (has) next.add(path)
      else next.delete(path)
      return next
    })
  }

  // --- drawing persistence --------------------------------------------------
  // Excalidraw hands us the scene on every change. We hold on to those
  // references (cheap) and only serialize at save time, so what gets persisted is
  // exactly what the user last edited — never a re-read of the canvas at some
  // later moment, which is how a momentarily-empty canvas could clobber a good
  // sketch.
  const captureScene = (path) => {
    const latest = latestSceneRef.current
    if (!latest || latest.path !== path) return
    if (!latest.elements.some((el) => !el.isDeleted)) {
      // Nothing drawn on this file. Drop our own now-empty scene, but leave a
      // legacy tldraw entry alone rather than silently destroying the old sketch.
      if (!drawingsRef.current[path] || Array.isArray(drawingsRef.current[path]?.elements)) {
        delete drawingsRef.current[path]
      }
      return
    }
    drawingsRef.current[path] = JSON.parse(
      // Positional signature; 'local' embeds any inserted images so the sidecar
      // stays self-contained.
      serializeAsJSON(latest.elements, latest.appState, latest.files, 'local')
    )
  }

  const scheduleSaveDrawings = () => {
    if (!rootRef.current) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      captureScene(activePathRef.current)
      window.api
        .writeFile(rootRef.current + SIDECAR, JSON.stringify(drawingsRef.current))
        .catch(() => {})
    }, 800)
  }

  // Fires on every scene change, including mid-drag, so it stays cheap: stash the
  // scene, toggle the Explorer's pencil marker, debounce a save.
  const handleCanvasChange = (elements, appState, files) => {
    // Excalidraw also reports the programmatic updateScene() we issue when loading
    // a file. Those aren't user edits, and they arrive *after* the call returns —
    // so a time window, rather than a flag flipped around the call, is what
    // reliably ignores them.
    if (performance.now() < suppressCanvasUntilRef.current) return
    const path = activePathRef.current
    if (!path) return
    latestSceneRef.current = { path, elements, appState, files }
    updateDrawingPath(path, elements.some((el) => !el.isDeleted))
    scheduleSaveDrawings()
  }

  // --- project --------------------------------------------------------------
  const applyProject = async (res) => {
    setRoot(res.root)
    setProjectName(res.name)
    // Remember this project (most-recent first, no duplicates).
    setRecents((prev) => [res.root, ...prev.filter((p) => p !== res.root)].slice(0, 8))
    drawingsRef.current = {}
    try {
      if (await window.api.exists(res.root + SIDECAR)) {
        drawingsRef.current = JSON.parse(await window.api.readFile(res.root + SIDECAR))
      }
    } catch {
      drawingsRef.current = {}
    }
    prevPathRef.current = null

    // Rebuild the "has a sketch" set from the sidecar.
    const hasDrawings = new Set()
    for (const [p, scene] of Object.entries(drawingsRef.current)) {
      if (sceneHasElements(scene)) hasDrawings.add(p)
    }
    setDrawingPaths(hasDrawings)

    // Point the shell at the new project.
    window.api.ptyWrite(PTY_ID, `cd ${JSON.stringify(res.root)}\n`)?.catch?.(() => {})
    window.api.detectToolchains().then(setToolchains).catch(() => {})
  }

  const openFolder = async () => {
    const res = await window.api.openFolder()
    if (!res) return
    setFiles([])
    setActivePath(null)
    await applyProject(res)
    bumpTree()
  }

  // Reopen a project from the welcome screen's Recent list.
  const openRecent = async (dir) => {
    const res = await window.api.setProjectRoot(dir)
    if (!res) {
      setRecents((prev) => prev.filter((p) => p !== dir))
      showError('Project unavailable', `“${dir}” can no longer be opened.`)
      return
    }
    setFiles([])
    setActivePath(null)
    await applyProject(res)
    bumpTree()
  }

  const forgetRecent = (dir) => setRecents((prev) => prev.filter((p) => p !== dir))

  // --- session restore (Phase C) --------------------------------------------
  useEffect(() => {
    let alive = true
    ;(async () => {
      let s = {}
      try {
        s = (await window.api.getSettings()) || {}
      } catch {
        /* ignore */
      }
      if (!alive) return

      if (typeof s.outputHeight === 'number') setOutputHeight(s.outputHeight)
      if (s.mode === 'draw' || s.mode === 'code') setMode(s.mode)
      if (Array.isArray(s.recentProjects)) setRecents(s.recentProjects)

      if (s.lastRoot) {
        const res = await window.api.setProjectRoot(s.lastRoot)
        if (!alive) return
        if (res) {
          await applyProject(res)
          const paths = Array.isArray(s.openFiles) ? s.openFiles : []
          const restored = []
          for (const p of paths) {
            try {
              const content = await window.api.readFile(p)
              restored.push({ path: p, name: nameOf(p), content, dirty: false })
            } catch {
              /* file was moved/deleted since last time — skip it */
            }
          }
          if (!alive) return
          setFiles(restored)
          const act = restored.find((f) => f.path === s.activePath)
          setActivePath(act ? act.path : restored[0]?.path ?? null)
        }
      }
      if (alive) setSessionReady(true)
    })().catch(() => {
      if (alive) setSessionReady(true)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- session persist ------------------------------------------------------
  const openPathsKey = files.map((f) => f.path).join('|')
  const recentsKey = recents.join('|')
  useEffect(() => {
    if (!sessionReady) return
    const t = setTimeout(() => {
      window.api.setSettings({
        lastRoot: root,
        openFiles: openPathsKey ? openPathsKey.split('|') : [],
        activePath,
        mode,
        outputHeight,
        recentProjects: recents,
      })
    }, 500)
    return () => clearTimeout(t)
  }, [sessionReady, root, openPathsKey, activePath, mode, outputHeight, recentsKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // --- files ----------------------------------------------------------------
  const addTab = (path, name, content) => {
    setFiles((prev) =>
      prev.some((f) => f.path === path) ? prev : [...prev, { path, name, content, dirty: false }]
    )
    setActivePath(path)
    setMode('code')
  }

  const openFile = async (entry) => {
    if (entry.isDir) return
    const existing = files.find((f) => f.path === entry.path)
    if (existing) {
      setActivePath(entry.path)
      return
    }
    try {
      const content = await window.api.readFile(entry.path)
      addTab(entry.path, entry.name, content)
    } catch (err) {
      alert('Could not open file: ' + err.message)
    }
  }

  const updateActive = (value) => {
    setFiles((prev) =>
      prev.map((f) => (f.path === activePath ? { ...f, content: value, dirty: true } : f))
    )
  }

  const saveActive = async () => {
    const f = files.find((x) => x.path === activePath)
    if (!f) return
    await window.api.writeFile(f.path, f.content)
    setFiles((prev) => prev.map((x) => (x.path === activePath ? { ...x, dirty: false } : x)))
  }

  const saveAll = async () => {
    const dirty = files.filter((f) => f.dirty)
    if (!dirty.length) return
    await Promise.all(dirty.map((f) => window.api.writeFile(f.path, f.content)))
    setFiles((prev) => prev.map((f) => ({ ...f, dirty: false })))
  }

  const doCloseTab = (path) => {
    const next = files.filter((f) => f.path !== path)
    setFiles(next)
    if (activePath === path) {
      const idx = files.findIndex((f) => f.path === path)
      const neighbour = next[Math.min(idx, next.length - 1)]
      setActivePath(neighbour ? neighbour.path : null)
    }
    // Closing a tab is a view action, not a delete: the sketch belongs to the
    // file and lives in the sidecar, so it has to survive. Persist the outgoing
    // file's strokes first (captureScene still drops our own scene if the file
    // genuinely has no strokes left).
    captureScene(path)
    scheduleSaveDrawings()
    updateDrawingPath(path, sceneHasElements(drawingsRef.current[path]))
  }

  const closeTab = (path) => {
    const f = files.find((x) => x.path === path)
    if (f?.dirty) {
      setDialog({
        kind: 'confirm',
        title: 'Unsaved changes',
        message: `“${f.name}” has unsaved changes. Close it anyway?`,
        confirmLabel: 'Discard & close',
        danger: true,
        onConfirm: () => {
          setDialog(null)
          doCloseTab(path)
        },
        onCancel: () => setDialog(null),
      })
      return
    }
    doCloseTab(path)
  }

  const closeAllTabs = () => {
    if (!files.length) return
    const dirty = files.filter((f) => f.dirty).length
    if (dirty) {
      setDialog({
        kind: 'confirm',
        title: 'Unsaved changes',
        message: `${dirty} file${dirty === 1 ? '' : 's'} with unsaved changes will be closed. Continue?`,
        confirmLabel: 'Discard & close all',
        danger: true,
        onConfirm: () => {
          setDialog(null)
          setFiles([])
          setActivePath(null)
        },
        onCancel: () => setDialog(null),
      })
      return
    }
    setFiles([])
    setActivePath(null)
  }

  // --- file management (Phase A) --------------------------------------------
  const showError = (title, err) =>
    setDialog({
      kind: 'confirm',
      title,
      message: String(err?.message || err),
      confirmLabel: 'OK',
      onConfirm: () => setDialog(null),
      onCancel: () => setDialog(null),
    })

  const newFile = (dir) => {
    setDialog({
      kind: 'input',
      title: 'New File',
      placeholder: 'e.g. solution.cpp',
      confirmLabel: 'Create',
      onConfirm: async (name) => {
        try {
          const p = await window.api.createFile(dir, name)
          setDialog(null)
          bumpTree()
          addTab(p, name, '')
        } catch (err) {
          showError('Could not create file', err)
        }
      },
      onCancel: () => setDialog(null),
    })
  }

  const newFolder = (dir) => {
    setDialog({
      kind: 'input',
      title: 'New Folder',
      placeholder: 'folder name',
      confirmLabel: 'Create',
      onConfirm: async (name) => {
        try {
          await window.api.createDir(dir, name)
          setDialog(null)
          bumpTree()
        } catch (err) {
          showError('Could not create folder', err)
        }
      },
      onCancel: () => setDialog(null),
    })
  }

  const renameEntry = (entry) => {
    setDialog({
      kind: 'input',
      title: `Rename ${entry.isDir ? 'folder' : 'file'}`,
      initialValue: entry.name,
      confirmLabel: 'Rename',
      onConfirm: async (newName) => {
        if (newName === entry.name) {
          setDialog(null)
          return
        }
        try {
          const target = await window.api.rename(entry.path, newName)
          setDialog(null)
          bumpTree()
          // Repoint open tabs (the entry itself, or files inside a renamed dir).
          setFiles((prev) =>
            prev.map((f) => {
              if (f.path === entry.path) return { ...f, path: target, name: newName }
              if (entry.isDir && f.path.startsWith(entry.path + '/')) {
                const np = target + f.path.slice(entry.path.length)
                return { ...f, path: np, name: nameOf(np) }
              }
              return f
            })
          )
          const d = drawingsRef.current[entry.path]
          if (d) {
            delete drawingsRef.current[entry.path]
            drawingsRef.current[target] = d
          }
          setDrawingPaths((prev) => {
            const next = new Set()
            for (const p of prev) {
              if (p === entry.path) next.add(target)
              else if (entry.isDir && p.startsWith(entry.path + '/'))
                next.add(target + p.slice(entry.path.length))
              else next.add(p)
            }
            return next
          })
          if (activePathRef.current === entry.path) setActivePath(target)
        } catch (err) {
          showError('Could not rename', err)
        }
      },
      onCancel: () => setDialog(null),
    })
  }

  const deleteEntry = (entry) => {
    setDialog({
      kind: 'confirm',
      title: `Delete ${entry.isDir ? 'folder' : 'file'}`,
      message: `Move “${entry.name}” to the Trash?`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await window.api.deletePath(entry.path)
          setDialog(null)
          bumpTree()
          const next = files.filter(
            (f) => f.path !== entry.path && !(entry.isDir && f.path.startsWith(entry.path + '/'))
          )
          setFiles(next)
          if (!next.some((f) => f.path === activePath)) {
            setActivePath(next[0]?.path ?? null)
          }
          delete drawingsRef.current[entry.path]
          scheduleSaveDrawings()
          setDrawingPaths((prev) => {
            const next = new Set()
            for (const p of prev) {
              if (p === entry.path || (entry.isDir && p.startsWith(entry.path + '/'))) continue
              next.add(p)
            }
            return next
          })
        } catch (err) {
          showError('Could not delete', err)
        }
      },
      onCancel: () => setDialog(null),
    })
  }

  // --- running --------------------------------------------------------------
  const run = async () => {
    const f = files.find((x) => x.path === activePath)
    if (!f) return
    // Save first: Run must compile what's in the editor, not stale bytes on disk.
    try {
      await window.api.writeFile(f.path, f.content)
      setFiles((prev) => prev.map((x) => (x.path === activePath ? { ...x, dirty: false } : x)))
    } catch (err) {
      window.api.ptyWrite(PTY_ID, `\n# could not save before run: ${err.message}\n`)
      return
    }
    window.api.runFile(PTY_ID, activePath)
  }

  const stop = () => {
    // Ctrl+C in the shell.
    window.api.ptyWrite(PTY_ID, '\x03')
  }

  // Registered once; the native menu and keyboard reach the latest handlers
  // through this ref rather than capturing the first render's state.
  useEffect(() => {
    actionsRef.current = {
      'new-file': () => (rootRef.current ? newFile(rootRef.current) : openFolder()),
      'open-folder': openFolder,
      save: saveActive,
      'save-all': saveAll,
      'close-tab': () => {
        if (activePathRef.current) closeTab(activePathRef.current)
      },
      run,
      stop,
      'toggle-mode': toggleMode,
      'export-snapshot': exportSnapshot,
      'clear-terminal': () => termApiRef.current?.clear(),
    }
  })

  // Native menu items arrive here as `menu:action` messages.
  useEffect(() => {
    const off = window.api.onMenuAction((action) => actionsRef.current[action]?.())
    return off
  }, [])

  // Reflect the active file + dirty state in the native window title.
  useEffect(() => {
    const base = projectName ? `${projectName} — Code Canvas` : 'Code Canvas'
    document.title = activeFile
      ? `${activeFile.dirty ? '● ' : ''}${activeFile.name} — ${base}`
      : base
  }, [activeFile, projectName])

  // --- drawing actions (Phase E) --------------------------------------------
  const clearDrawing = () => {
    if (!activePath) return
    setDialog({
      kind: 'confirm',
      title: 'Clear drawing',
      message: `Remove the sketch for “${nameOf(activePath)}”? This cannot be undone.`,
      confirmLabel: 'Clear',
      danger: true,
      onConfirm: () => {
        setDialog(null)
        const api = canvasRef.current
        if (api) {
          suppressCanvasUntilRef.current = performance.now() + 300
          api.updateScene({
            elements: [],
            appState: { viewBackgroundColor: 'transparent' },
            files: {},
          })
          api.history.clear()
        }
        latestSceneRef.current = null
        delete drawingsRef.current[activePath]
        updateDrawingPath(activePath, false)
        scheduleSaveDrawings()
      },
      onCancel: () => setDialog(null),
    })
  }

  const exportSnapshot = async () => {
    const el = document.querySelector('.workspace')
    let rect
    if (el) {
      const r = el.getBoundingClientRect()
      rect = {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      }
    }
    try {
      await window.api.exportSnapshot(rect)
    } catch (err) {
      showError('Could not export snapshot', err)
    }
  }

  const exportDrawing = async (format) => {
    const api = canvasRef.current
    if (!api) return
    const elements = api.getSceneElements()
    if (!elements.some((el) => !el.isDeleted)) {
      showError('Nothing to export', 'The current file has no drawing yet.')
      return
    }
    const base = nameOf(activePath || 'drawing').replace(/\.[^.]+$/, '') || 'drawing'
    // Export the strokes alone — no scene background — so the result drops cleanly
    // onto slides and handouts.
    const opts = {
      elements,
      appState: { ...api.getAppState(), exportBackground: false, exportWithDarkMode: true },
      files: api.getFiles(),
    }
    try {
      if (format === 'svg') {
        const svg = await exportToSvg(opts)
        await window.api.exportSaveAs({
          defaultName: `${base}.svg`,
          filters: [{ name: 'SVG image', extensions: ['svg'] }],
          content: new XMLSerializer().serializeToString(svg),
        })
      } else {
        const blob = await exportToBlob({ ...opts, mimeType: 'image/png', quality: 1 })
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        await window.api.exportSaveAs({
          defaultName: `${base}.png`,
          filters: [{ name: 'PNG image', extensions: ['png'] }],
          content: base64,
          base64: true,
        })
      }
    } catch (err) {
      showError('Could not export drawing', err)
    }
  }

  // Close the export menu when clicking anywhere else.
  useEffect(() => {
    if (!exportOpen) return
    const close = () => setExportOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [exportOpen])

  // --- mode toggle ----------------------------------------------------------
  const toggleMode = () => setMode((m) => (m === 'code' ? 'draw' : 'code'))

  // --- focus management -----------------------------------------------------
  // Excalidraw's tool hotkeys only fire while its own container has focus, so in
  // code mode we keep focus on Monaco; in draw mode we hand it to the canvas.
  const canvasContainer = () => canvasWrapRef.current?.querySelector('.excalidraw') ?? null

  useEffect(() => {
    if (mode === 'draw') {
      canvasContainer()?.focus?.()
    } else {
      const active = document.activeElement
      if (active && canvasWrapRef.current?.contains(active)) active.blur?.()
      monacoRef.current?.focus()
    }
  }, [mode, activePath])

  // Safety net: if the canvas container ever steals focus in code mode, bounce
  // focus straight back to the editor so typing is never swallowed.
  useEffect(() => {
    if (mode !== 'code') return
    const onFocusIn = (e) => {
      if (canvasWrapRef.current?.contains(e.target)) {
        e.target.blur?.()
        monacoRef.current?.focus()
      }
    }
    window.addEventListener('focusin', onFocusIn, true)
    return () => window.removeEventListener('focusin', onFocusIn, true)
  }, [mode])

  useEffect(() => {
    const onKeyDown = (e) => {
      // ⇧Tab is the one shortcut the menu deliberately does not register, so it
      // still works for focus traversal everywhere else.
      if (e.shiftKey && e.code === 'Tab') {
        e.preventDefault()
        toggleMode()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- swap drawings when the active file changes ---------------------------
  useEffect(() => {
    const api = canvasRef.current
    if (!api) return

    // Park the outgoing file's strokes back in memory before loading the next one.
    if (prevPathRef.current) {
      captureScene(prevPathRef.current)
      updateDrawingPath(
        prevPathRef.current,
        sceneHasElements(drawingsRef.current[prevPathRef.current])
      )
    }

    suppressCanvasUntilRef.current = performance.now() + 300
    const scene = activePath ? drawingsRef.current[activePath] : null
    let restored = null
    if (scene) {
      try {
        restored = restore(scene, null, null)
      } catch {
        restored = null
      }
    }
    api.updateScene({
      elements: restored?.elements ?? [],
      appState: {
        ...(restored?.appState ?? {}),
        // A saved scene must never reintroduce an opaque background.
        viewBackgroundColor: 'transparent',
        currentItemStrokeColor: CANVAS_STROKE,
      },
      files: restored?.files ?? {},
    })
    // Undo shouldn't reach back across files.
    api.history.clear()
    prevPathRef.current = activePath
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, canvasReady])

  // --- output resize --------------------------------------------------------
  const startResize = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = outputHeight
    const onMove = (ev) => {
      const next = Math.min(
        Math.max(startHeight - (ev.clientY - startY), 80),
        window.innerHeight - 160
      )
      setOutputHeight(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const toolchainList = Object.entries(toolchains)
    .filter(([, p]) => p)
    .map(([name]) => name)

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">Code Canvas</span>
        <button onClick={openFolder}>Open Folder</button>
        {projectName && <span className="project-name">{projectName}</span>}

        <div
          className="segmented"
          role="group"
          aria-label="Mode"
          title="Toggle code / draw (⇧Tab)"
        >
          <button
            className={mode === 'code' ? 'on' : ''}
            onClick={() => setMode('code')}
          >
            Code
          </button>
          <button
            className={mode === 'draw' ? 'on' : ''}
            onClick={() => setMode('draw')}
          >
            Draw
          </button>
        </div>

        <div className="run-controls">
          {mode === 'draw' && activePath && (
            <button
              className="btn-ghost"
              onClick={clearDrawing}
              title="Erase this file's sketch"
            >
              Clear drawing
            </button>
          )}

          <div className="dropdown">
            <button
              onClick={() => setExportOpen((o) => !o)}
              title="Export a snapshot or the drawing"
            >
              Export ▾
            </button>
            {exportOpen && (
              <div className="dropdown-menu" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  onClick={() => {
                    setExportOpen(false)
                    exportSnapshot()
                  }}
                >
                  Snapshot (code + sketch) — PNG…
                </button>
                <button
                  disabled={!activePath}
                  onClick={() => {
                    setExportOpen(false)
                    exportDrawing('png')
                  }}
                >
                  Drawing only — PNG…
                </button>
                <button
                  disabled={!activePath}
                  onClick={() => {
                    setExportOpen(false)
                    exportDrawing('svg')
                  }}
                >
                  Drawing only — SVG…
                </button>
              </div>
            )}
          </div>

          <button
            className="btn-ghost"
            onClick={saveActive}
            disabled={!activePath}
            title="Save active file (⌘S)"
          >
            Save
          </button>
          <button
            className="btn-primary"
            onClick={run}
            disabled={!activePath}
            title="Save & run active file (⌘↵)"
          >
            Run
          </button>
          <button className="btn-danger" onClick={stop} title="Send Ctrl+C to the terminal">
            Stop
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Explorer</span>
            {root && (
              <div className="sidebar-actions">
                <button title="New File" onClick={() => newFile(root)}>
                  +
                </button>
                <button title="Refresh" onClick={bumpTree}>
                  ↻
                </button>
              </div>
            )}
          </div>
          <FileTree
            root={root}
            onOpen={openFile}
            onNewFile={newFile}
            onNewFolder={newFolder}
            onRename={renameEntry}
            onDelete={deleteEntry}
            version={treeVersion}
            drawingPaths={drawingPaths}
          />
          {toolchainList.length > 0 && (
            <div className="toolchains" title={toolchainList.join(', ')}>
              Detected: {toolchainList.join(' · ')}
            </div>
          )}
        </aside>

        <main className="main">
          <Tabs
            files={files}
            activePath={activePath}
            onSelect={setActivePath}
            onClose={closeTab}
            onSaveAll={saveAll}
            onCloseAll={closeAllTabs}
          />

          <div className={`workspace mode-${mode}`}>
            <div className="editor-layer">
              {!sessionReady ? (
                // First paint happens before the saved session (last folder +
                // open files) has been restored. Show a neutral pane instead
                // of flashing Welcome, which would be swapped out a moment
                // later by the restored project.
                <div className="placeholder" aria-hidden="true" />
              ) : !root ? (
                <Welcome
                  recents={recents}
                  onOpenFolder={openFolder}
                  onOpenRecent={openRecent}
                  onForget={forgetRecent}
                />
              ) : activeFile ? (
                <MonacoPane
                  path={activeFile.path}
                  value={activeFile.content}
                  onChange={updateActive}
                  onSave={saveActive}
                  onReady={(editor) => {
                    monacoRef.current = editor
                  }}
                />
              ) : (
                <div className="placeholder">Select a file from the Explorer</div>
              )}
            </div>

            <div className="canvas-wrap" ref={canvasWrapRef}>
              <DrawCanvas
                chromeHidden={mode === 'code'}
                onReady={(api) => {
                  canvasRef.current = api
                  setCanvasReady(true)
                }}
                onChange={handleCanvasChange}
              />
            </div>
          </div>

          <div className="resizer" onMouseDown={startResize} title="Drag to resize" />
          <div className="terminal" style={{ height: outputHeight }}>
            <div className="terminal-header">
              <span>Terminal</span>
              <span className="terminal-hint">
                ▶ Run types the command here — type back to answer prompts (stdin)
              </span>
              <div className="terminal-actions">
                <button title="Clear the terminal" onClick={() => termApiRef.current?.clear()}>
                  Clear
                </button>
                <button
                  title="Kill and restart the shell"
                  onClick={() => termApiRef.current?.restart()}
                >
                  Restart
                </button>
              </div>
            </div>
            <Terminal
              ptyId={PTY_ID}
              cwd={root}
              onReady={(api) => {
                termApiRef.current = api
              }}
            />
          </div>
        </main>
      </div>

      <Dialog state={dialog} />
    </div>
  )
}
