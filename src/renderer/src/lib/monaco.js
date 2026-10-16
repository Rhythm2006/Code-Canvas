// Bundle Monaco locally (no CDN) and wire up its web workers for Vite.
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })

// --- theme -----------------------------------------------------------------
// A muted slate theme matching the app palette (see index.css tokens), so the
// editor doesn't look like a stock vs-dark panel bolted into the window.

export const SKETCH_THEME = 'sketch-dark'

monaco.editor.defineTheme(SKETCH_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'd5d8de', background: '1e1e1e' },
    { token: 'comment', foreground: '6e7480', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'a9b4c4' },
    { token: 'keyword.control', foreground: 'a9b4c4' },
    { token: 'string', foreground: '9dbfa6' },
    { token: 'number', foreground: 'c8a97e' },
    { token: 'constant', foreground: 'c8a97e' },
    { token: 'type', foreground: '8fb3c7' },
    { token: 'type.identifier', foreground: '8fb3c7' },
    { token: 'function', foreground: 'a7b8ce' },
    { token: 'variable', foreground: 'd5d8de' },
    { token: 'variable.predefined', foreground: 'c8a97e' },
    { token: 'operator', foreground: 'aab2be' },
    { token: 'delimiter', foreground: '8a919c' },
    { token: 'tag', foreground: 'a9b4c4' },
    { token: 'attribute.name', foreground: 'c8a97e' },
    { token: 'attribute.value', foreground: '9dbfa6' },
    { token: 'annotation', foreground: '8fb3c7' },
  ],
  colors: {
    'editor.background': '#1e1e1e',
    'editor.foreground': '#d5d8de',
    'editorLineNumber.foreground': '#54585f',
    'editorLineNumber.activeForeground': '#9aa0a8',
    'editorCursor.foreground': '#8b94a3',
    'editor.selectionBackground': '#3a4150',
    'editor.inactiveSelectionBackground': '#2a2f38',
    'editor.lineHighlightBackground': '#232326',
    'editor.lineHighlightBorder': '#00000000',
    'editorIndentGuide.background1': '#2a2a2e',
    'editorIndentGuide.activeBackground1': '#3a3a40',
    'editorWhitespace.foreground': '#3a3a40',
    'editorWidget.background': '#2c2c2e',
    'editorWidget.border': '#3a3a3e',
    'editorSuggestWidget.background': '#2c2c2e',
    'editorSuggestWidget.border': '#3a3a3e',
    'editorSuggestWidget.selectedBackground': '#3a4150',
    'editorHoverWidget.background': '#2c2c2e',
    'editorHoverWidget.border': '#3a3a3e',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#ffffff1a',
    'scrollbarSlider.hoverBackground': '#ffffff26',
    'scrollbarSlider.activeBackground': '#ffffff33',
    'minimap.background': '#1e1e1e',
  },
})

export default monaco
