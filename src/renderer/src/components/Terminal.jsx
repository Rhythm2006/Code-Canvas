import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export default function Terminal({ ptyId = 'main', cwd, onReady }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  const startShell = () => {
    const fit = fitRef.current
    const dims = (fit && fit.proposeDimensions()) || { cols: 100, rows: 30 }
    window.api
      .ptyStart({ id: ptyId, command: null, cwd: cwdRef.current, cols: dims.cols, rows: dims.rows })
      .catch(() => {})
  }

  useEffect(() => {
    const term = new XTerm({
      fontSize: 12.5,
      fontFamily: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#d5d8de',
        cursor: '#8b94a3',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#3a4150',
        black: '#1e1e1e',
        red: '#e06c75',
        green: '#9dbfa6',
        yellow: '#c8a97e',
        blue: '#8fb3c7',
        magenta: '#b4a7ce',
        cyan: '#8fb8b8',
        white: '#d5d8de',
        brightBlack: '#6e7480',
        brightRed: '#e88b93',
        brightGreen: '#b0cfb8',
        brightYellow: '#d8bd94',
        brightBlue: '#a7c4d6',
        brightMagenta: '#c6bcdd',
        brightCyan: '#a3c8c8',
        brightWhite: '#f5f5f7',
      },
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
    })
    termRef.current = term
    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    // Clear any leftover DOM from a previous mount so we never stack terminals.
    if (hostRef.current) hostRef.current.replaceChildren()
    term.open(hostRef.current)
    try {
      fit.fit()
    } catch {
      /* ignore */
    }

    const offData = window.api.onPtyData(({ id, data }) => {
      if (id === ptyId) term.write(data)
    })
    const offExit = window.api.onPtyExit(({ id, code }) => {
      if (id !== ptyId) return
      const ok = code === 0
      term.write(`\r\n\x1b[${ok ? '32' : '31'}m[shell exited with code ${code}]\x1b[0m\r\n`)
    })
    const inputDisp = term.onData((d) => window.api.ptyWrite(ptyId, d))

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
      const dims = fit.proposeDimensions()
      if (dims) window.api.ptyResize(ptyId, dims.cols, dims.rows)
    })
    ro.observe(hostRef.current)

    startShell()

    // Deliberately do NOT focus the terminal on mount — that would steal focus
    // from the code editor. Click the terminal to type (e.g. answer stdin).
    onReady?.({
      clear: () => term.clear(),
      focus: () => term.focus(),
      restart: async () => {
        try {
          await window.api.ptyKill(ptyId)
        } catch {
          /* ignore */
        }
        term.reset()
        startShell()
      },
    })

    return () => {
      ro.disconnect()
      inputDisp.dispose()
      offData()
      offExit()
      window.api.ptyKill(ptyId)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyId])

  return <div className="terminal-host" ref={hostRef} />
}
