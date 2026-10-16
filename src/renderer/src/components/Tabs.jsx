export default function Tabs({
  files,
  activePath,
  onSelect,
  onClose,
  onSaveAll,
  onCloseAll,
}) {
  const anyDirty = files.some((f) => f.dirty)

  return (
    <div className="tabs">
      <div className="tabs-strip">
        {files.map((f) => (
          <div
            key={f.path}
            className={`tab${f.path === activePath ? ' active' : ''}`}
            onClick={() => onSelect(f.path)}
            onAuxClick={(e) => {
              // Middle-click closes, like a browser tab.
              if (e.button === 1) {
                e.preventDefault()
                onClose(f.path)
              }
            }}
            title={f.path}
          >
            <span className={`tab-dot${f.dirty ? ' on' : ''}`} />
            <span className="tab-name">{f.name}</span>
            <button
              className="tab-close"
              title="Close"
              onClick={(e) => {
                e.stopPropagation()
                onClose(f.path)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {files.length > 0 && (
        <div className="tabs-actions">
          <button
            title="Save all (⌘⇧S)"
            onClick={onSaveAll}
            disabled={!anyDirty}
          >
            Save all
          </button>
          <button title="Close all tabs" onClick={onCloseAll}>
            Close all
          </button>
        </div>
      )}
    </div>
  )
}
