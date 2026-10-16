import { Excalidraw } from '@excalidraw/excalidraw'
import { useRef } from 'react'
import '@excalidraw/excalidraw/index.css'

// Strokes have to read against dark code, so new drawings start light. Seeding it
// here (rather than only via updateScene when a file loads) also covers the very
// first stroke, before any file has been opened.
export const CANVAS_STROKE = '#e8eaed'

// The drawable layer that sits over the code.
//
// Excalidraw is MIT-licensed and needs no key, but two details matter here:
//
//  1. `viewBackgroundColor: 'transparent'` has to be seeded through initialData
//     (and re-applied with every updateScene) so the code stays visible under
//     the strokes instead of being covered by an opaque canvas.
//  2. `handleKeyboardGlobally` stays false, so Excalidraw's single-letter tool
//     hotkeys only fire while its own container has focus — otherwise they'd
//     swallow typing meant for the editor.
export default function DrawCanvas({ chromeHidden = false, onReady, onChange }) {
  const wrapRef = useRef(null)

  return (
    <div className="draw-root" ref={wrapRef}>
      <Excalidraw
        theme="dark"
        autoFocus={false}
        handleKeyboardGlobally={false}
        // Zen mode strips Excalidraw's chrome, leaving only the strokes on the
        // code while the user is writing.
        zenModeEnabled={chromeHidden}
        initialData={{
          appState: {
            viewBackgroundColor: 'transparent',
            currentItemStrokeColor: CANVAS_STROKE,
          },
        }}
        excalidrawAPI={(api) => onReady?.(api, wrapRef.current)}
        onChange={onChange}
      />
    </div>
  )
}
