import { useEffect, useRef, useState } from 'react'

export default function Dialog({ state }) {
  const [value, setValue] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (state) {
      setValue(state.initialValue ?? '')
      setTimeout(() => inputRef.current?.select?.(), 0)
    }
  }, [state])

  if (!state) return null

  const isInput = state.kind === 'input'
  const submit = () => {
    if (isInput && !value.trim()) return
    state.onConfirm?.(isInput ? value.trim() : undefined)
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => state.onCancel?.()}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{state.title}</h3>
        {state.message && <p className="modal-message">{state.message}</p>}
        {isInput && (
          <input
            ref={inputRef}
            className="modal-input"
            value={value}
            placeholder={state.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') state.onCancel?.()
            }}
            autoFocus
          />
        )}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={() => state.onCancel?.()}>
            Cancel
          </button>
          <button
            className={state.danger ? 'btn-danger' : 'btn-primary'}
            onClick={submit}
            disabled={isInput && !value.trim()}
          >
            {state.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
