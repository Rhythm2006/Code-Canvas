import { useEffect, useRef, useState } from 'react'

function TreeNode({ entry, onOpen, onContextMenu, onKeyDown, depth, version, drawingPaths }) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState([])

  // (Re)load children whenever the node is open, the folder changes, or the
  // tree version changes (create / rename / delete elsewhere).
  useEffect(() => {
    if (!open || !entry.isDir) return
    let alive = true
    window.api
      .readDir(entry.path)
      .then((k) => alive && setChildren(k))
      .catch(() => alive && setChildren([]))
    return () => {
      alive = false
    }
  }, [open, version, entry.path, entry.isDir])

  const activate = () => {
    if (entry.isDir) setOpen((o) => !o)
    else onOpen(entry)
  }

  return (
    <div role={entry.isDir ? 'group' : undefined}>
      <div
        className="tree-row"
        role="treeitem"
        aria-expanded={entry.isDir ? open : undefined}
        tabIndex={0}
        data-depth={depth}
        data-dir={entry.isDir ? '1' : '0'}
        data-open={open ? '1' : '0'}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={activate}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu(e, entry)
        }}
        onKeyDown={(e) => onKeyDown(e, entry, open, setOpen)}
        title={entry.path}
      >
        <span className="tree-icon">{entry.isDir ? (open ? '▾' : '▸') : '·'}</span>
        <span className="tree-name">{entry.name}</span>
        {!entry.isDir && drawingPaths?.has(entry.path) && (
          <span className="tree-pencil" title="This file has a sketch">
            ✎
          </span>
        )}
      </div>
      {open &&
        children.map((c) => (
          <TreeNode
            key={c.path}
            entry={c}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
            onKeyDown={onKeyDown}
            depth={depth + 1}
            version={version}
            drawingPaths={drawingPaths}
          />
        ))}
    </div>
  )
}

export default function FileTree({
  root,
  onOpen,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  version,
  drawingPaths,
}) {
  const [entries, setEntries] = useState([])
  const [menu, setMenu] = useState(null) // { x, y, entry | null }
  const treeRef = useRef(null)

  useEffect(() => {
    let alive = true
    if (!root) {
      setEntries([])
      return
    }
    window.api
      .readDir(root)
      .then((e) => alive && setEntries(e))
      .catch(() => alive && setEntries([]))
    return () => {
      alive = false
    }
  }, [root, version])

  // Close the context menu on any click elsewhere / window blur.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  if (!root) return <p className="muted">No folder open.</p>

  const openMenu = (e, entry) => setMenu({ x: e.clientX, y: e.clientY, entry })

  // --- keyboard navigation --------------------------------------------------
  const rows = () => Array.from(treeRef.current?.querySelectorAll('.tree-row') ?? [])

  const focusRow = (row) => {
    if (!row) return
    // Roving focus: crawl up to the actual .tree-row from a nested target.
    const el = row.closest?.('.tree-row') ?? row
    el.focus()
  }

  const onKeyDown = (e, entry, open, setOpen) => {
    const all = rows()
    const i = all.indexOf(e.currentTarget)
    const depth = Number(e.currentTarget.dataset.depth)

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusRow(all[i + 1])
        break
      case 'ArrowUp':
        e.preventDefault()
        focusRow(all[i - 1])
        break
      case 'ArrowRight':
        e.preventDefault()
        if (entry.isDir && !open) {
          setOpen(true)
        } else if (entry.isDir && open) {
          // First child sits immediately after this row.
          const next = all[i + 1]
          if (next && Number(next.dataset.depth) === depth + 1) focusRow(next)
        }
        break
      case 'ArrowLeft': {
        e.preventDefault()
        if (entry.isDir && open) {
          setOpen(false)
          break
        }
        // Otherwise jump to the nearest parent (previous row with less depth).
        for (let j = i - 1; j >= 0; j--) {
          if (Number(all[j].dataset.depth) < depth) {
            focusRow(all[j])
            break
          }
        }
        break
      }
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (entry.isDir) setOpen((o) => !o)
        else onOpen(entry)
        break
      case 'F2':
        e.preventDefault()
        onRename(entry)
        break
      case 'Delete':
        e.preventDefault()
        onDelete(entry)
        break
      default:
        break
    }
  }

  // Where New File / New Folder should be created.
  const targetDir = menu?.entry
    ? menu.entry.isDir
      ? menu.entry.path
      : menu.entry.path.replace(/\/[^/]*$/, '')
    : root

  const item = (label, fn, danger) => (
    <button
      className={`ctx-item${danger ? ' danger' : ''}`}
      onClick={() => {
        setMenu(null)
        fn()
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      className="file-tree"
      role="tree"
      ref={treeRef}
      onContextMenu={(e) => {
        // Right-click on empty space → act on the project root.
        if (e.target === e.currentTarget) {
          e.preventDefault()
          openMenu(e, null)
        }
      }}
    >
      {entries.map((e) => (
        <TreeNode
          key={e.path}
          entry={e}
          onOpen={onOpen}
          onContextMenu={openMenu}
          onKeyDown={onKeyDown}
          depth={0}
          version={version}
          drawingPaths={drawingPaths}
        />
      ))}
      {entries.length === 0 && <p className="muted">Empty folder</p>}

      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="ctx-header">{menu.entry ? menu.entry.name : 'Project'}</div>
          {item('New File…', () => onNewFile(targetDir))}
          {item('New Folder…', () => onNewFolder(targetDir))}
          {menu.entry && item('Rename…', () => onRename(menu.entry))}
          {menu.entry && item('Delete', () => onDelete(menu.entry), true)}
        </div>
      )}
    </div>
  )
}
