import Editor from '@monaco-editor/react'
import { SKETCH_THEME } from '../lib/monaco'

const LANGUAGES = {
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  md: 'markdown',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  java: 'java',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
}

export function languageFor(path) {
  const ext = path?.split('.').pop()?.toLowerCase()
  return LANGUAGES[ext] || 'plaintext'
}

// Sensible default indent per language (Monaco still auto-detects existing files).
const TAB_SIZE = {
  js: 2,
  mjs: 2,
  cjs: 2,
  jsx: 2,
  ts: 2,
  tsx: 2,
  json: 2,
  html: 2,
  htm: 2,
  css: 2,
  scss: 2,
  yml: 2,
  yaml: 2,
  xml: 2,
  md: 2,
}

export function tabSizeFor(path) {
  const ext = path?.split('.').pop()?.toLowerCase()
  return TAB_SIZE[ext] ?? 4
}

export default function MonacoPane({ path, value, onChange, onSave, onReady }) {
  return (
    <Editor
      path={path}
      language={languageFor(path)}
      value={value}
      theme={SKETCH_THEME}
      height="100%"
      onChange={(v) => onChange(v ?? '')}
      onMount={(editor, monaco) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave?.())
        onReady?.(editor)
      }}
      options={{
        fontSize: 13,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: tabSizeFor(path),
        insertSpaces: true,
        renderWhitespace: 'selection',
      }}
    />
  )
}
