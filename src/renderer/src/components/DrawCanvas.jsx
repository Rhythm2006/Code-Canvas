import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'

export default function DrawCanvas({ onMount, hideUi = false }) {
  return (
    <Tldraw
      hideUi={hideUi}
      // Do NOT grab keyboard focus on mount: tldraw's single-letter tool hotkeys
      // would otherwise swallow typing meant for the Monaco editor.
      autoFocus={false}
      onMount={(editor) => {
        // Match the app's dark theme.
        editor.user.updateUserPreferences({ colorScheme: 'dark' })
        // Pass the return value through: tldraw calls it on unmount.
        return onMount?.(editor)
      }}
    />
  )
}
