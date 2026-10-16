// Shown in the editor area until a project is open: a hero, the primary
// "Open Folder" call to action, and the list of recently opened projects.

const nameOf = (p) => p.split('/').filter(Boolean).pop() || p

export default function Welcome({ recents = [], onOpenFolder, onOpenRecent, onForget }) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-mark">Code Canvas</div>
        <p className="welcome-tag">
          Write code, then sketch on top of it. Press <kbd>⇧</kbd>
          <kbd>Tab</kbd> to switch between code and canvas.
        </p>

        <button className="welcome-open btn-primary" onClick={onOpenFolder}>
          Open Folder…
        </button>

        {recents.length > 0 ? (
          <div className="welcome-recent">
            <div className="welcome-recent-title">Recent</div>
            {recents.map((r) => (
              <div className="recent-row" key={r}>
                <button
                  className="recent-open"
                  onClick={() => onOpenRecent(r)}
                  title={r}
                >
                  <span className="recent-name">{nameOf(r)}</span>
                  <span className="recent-path">{r}</span>
                </button>
                <button
                  className="recent-forget"
                  title="Remove from list"
                  onClick={() => onForget(r)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="welcome-hint">No recent projects yet.</p>
        )}
      </div>
    </div>
  )
}
