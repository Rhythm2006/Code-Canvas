// Renders the Code Canvas app icon to build/icon.png.
//
// The icon is defined as SVG below and rasterised with Electron's own compositor,
// so there is no dependency on ImageMagick / librsvg / design tools. Run it with:
//
//     npx electron scripts/render-icon.cjs
//
// then `npm run icon` turns build/icon.png into build/icon.icns via sips+iconutil.

const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const SIZE = 1024
const BUILD_DIR = join(__dirname, '..', 'build')
const OUT = join(BUILD_DIR, 'icon.png')

// A dark rounded tile holding "</>" with a graphite brush stroke beneath it:
// code on top, sketch underneath — the whole idea of the app in one mark.
const SVG = `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#33333a"/>
      <stop offset="1" stop-color="#18181a"/>
    </linearGradient>
    <linearGradient id="brush" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6f7887"/>
      <stop offset="1" stop-color="#aab2bf"/>
    </linearGradient>
    <filter id="soft" x="-25%" y="-60%" width="150%" height="220%">
      <feDropShadow dx="0" dy="7" stdDeviation="11" flood-color="#000000" flood-opacity="0.38"/>
    </filter>
  </defs>

  <rect x="64" y="64" width="896" height="896" rx="206" fill="url(#bg)"/>
  <rect x="64.5" y="64.5" width="895" height="895" rx="205.5"
        fill="none" stroke="#ffffff" stroke-opacity="0.08"/>

  <text x="512" y="592" text-anchor="middle"
        font-family="'SF Mono', Menlo, Consolas, monospace"
        font-size="372" font-weight="600" letter-spacing="-8"
        fill="#f5f5f7">&lt;/&gt;</text>

  <g transform="rotate(-2 512 700)" filter="url(#soft)">
    <rect x="286" y="672" width="452" height="56" rx="28" fill="url(#brush)"/>
  </g>
</svg>`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: ${SIZE}px; height: ${SIZE}px;
               background: transparent; overflow: hidden; }
  svg { display: block; }
</style></head><body>${SVG}</body></html>`

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
  })

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  // Let the monospace font shape before we grab the frame.
  await new Promise((r) => setTimeout(r, 700))

  const image = await win.webContents.capturePage()
  const size = image.getSize()
  if (size.width !== SIZE || size.height !== SIZE) {
    console.error(`[icon] unexpected capture size ${size.width}x${size.height}`)
  }

  mkdirSync(BUILD_DIR, { recursive: true })
  writeFileSync(OUT, image.toPNG())
  console.log(`[icon] wrote ${OUT} (${size.width}x${size.height})`)
  app.quit()
})
