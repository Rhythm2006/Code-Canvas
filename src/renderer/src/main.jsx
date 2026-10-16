import React from 'react'
import { createRoot } from 'react-dom/client'
import './lib/monaco'
import App from './App'
import './index.css'

// NOTE: StrictMode is intentionally omitted. In development it remounts
// components, which duplicates the xterm/tldraw DOM that these imperative
// libraries append to their host elements.
createRoot(document.getElementById('root')).render(<App />)
