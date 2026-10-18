// Renders the .dmg Finder-window art to build/dmg-background.png (1x) and
// build/dmg-background@2x.png (2x).
//
// The art is a vector SVG so it stays crisp at any scale, and it is rasterised
// with Electron's own compositor — no ImageMagick / librsvg / design tools.
// Run it with:
//
//     npm run dmg:art
//
// electron-builder picks up the pair automatically: when a @2x sibling exists
// next to the background, dmg-builder runs `tiffutil -cathidpicheck` over the
// two files so Finder shows a retina-correct window.
//
// The sprite positions here must line up with `dmg.contents` in
// electron-builder.yml: the app sits at (145,190) and the Applications link at
// (395,190) in a 540x380 window, which is what the arrow below points between.

const { app, BrowserWindow, screen } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

// Logical design size, in CSS pixels. Keep in sync with `dmg.window` in
// electron-builder.yml.
const W = 540
const H = 380

const arg = process.argv.find((a) => a.startsWith('--scale='))
const PX = arg ? Number(arg.split('=')[1]) : 2
if (PX !== 1 && PX !== 2) {
  console.error(`[dmg-art] unsupported --scale=${PX} (expected 1 or 2)`)
  process.exit(1)
}

const BUILD_DIR = join(__dirname, '..', 'build')
const OUT = join(BUILD_DIR, PX === 2 ? 'dmg-background@2x.png' : 'dmg-background.png')
const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"

// Dark graphite window matching the app's own palette (see src/renderer/src/
// index.css): a soft vertical ramp, a slate glow behind the drop targets, the
// wordmark and tagline, then a slightly hand-drawn arrow pointing from the app
// to the Applications folder.
const art = (cssW, cssH) => `
<svg width="${cssW}" height="${cssH}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b2b2f"/>
      <stop offset="0.55" stop-color="#1d1d1f"/>
      <stop offset="1" stop-color="#141416"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#8b94a3" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#8b94a3" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="arc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8b94a3" stop-opacity="0.12"/>
      <stop offset="0.5" stop-color="#aab2bf" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#8b94a3" stop-opacity="0.12"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="${W / 2}" cy="196" rx="252" ry="122" fill="url(#glow)"/>

  <text x="${W / 2}" y="57" text-anchor="middle" font-family="${FONT}"
        font-size="24" font-weight="600" letter-spacing="0.3" fill="#f5f5f7">Code Canvas</text>
  <text x="${W / 2}" y="79" text-anchor="middle" font-family="${FONT}"
        font-size="12.5" fill="#98989d">A code editor you can draw on</text>

  <path d="M 206 183 Q 270 206 330 184" fill="none"
        stroke="url(#arc)" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M 320 175 L 333 185 L 319 195" fill="none"
        stroke="#aab2bf" stroke-opacity="0.5" stroke-width="2.2"
        stroke-linecap="round" stroke-linejoin="round"/>

  <text x="${W / 2}" y="323" text-anchor="middle" font-family="${FONT}"
        font-size="11.5" fill="#8e8e93" fill-opacity="0.9">Drag Code Canvas into Applications</text>
</svg>`

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  // capturePage() always returns the OS-scaled bitmap, so ask for a window
  // small enough that (window x displayScale) lands on the pixel size we want.
  const displayScale = screen.getPrimaryDisplay().scaleFactor || 1
  const cssW = Math.round((W * PX) / displayScale)
  const cssH = Math.round((H * PX) / displayScale)

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: ${cssW}px; height: ${cssH}px;
               background: transparent; overflow: hidden; }
  svg { display: block; }
</style></head><body>${art(cssW, cssH)}</body></html>`

  const win = new BrowserWindow({
    width: cssW,
    height: cssH,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
  })

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  // Let the system font shape before grabbing the frame.
  await new Promise((r) => setTimeout(r, 700))

  const image = await win.webContents.capturePage()
  const size = image.getSize()
  const expected = { width: W * PX, height: H * PX }
  if (size.width !== expected.width || size.height !== expected.height) {
    console.error(
      `[dmg-art] expected ${expected.width}x${expected.height} but captured ${size.width}x${size.height} ` +
        `(displayScale=${displayScale}, window=${cssW}x${cssH})`
    )
    app.exit(1)
    return
  }

  mkdirSync(BUILD_DIR, { recursive: true })
  writeFileSync(OUT, image.toPNG())
  console.log(`[dmg-art] wrote ${OUT} (${size.width}x${size.height})`)
  app.quit()
})
