// Excalidraw loads its fonts (and locale bundles) at runtime from a URL, not
// from the JS bundle. A packaged app runs off file:// with no network, so those
// assets must be shipped locally and pointed at via window.EXCALIDRAW_ASSET_PATH.
//
// This copies them out of node_modules into the renderer's public/ directory,
// which Vite serves verbatim in dev and copies into out/renderer/ for the build.
// Running before every dev/build keeps the two in sync with the installed
// version, instead of committing 13 MB of woff2 files to the repo.

const fs = require('node:fs')
const path = require('node:path')

const pkgRoot = path.join(__dirname, '..', 'node_modules', '@excalidraw', 'excalidraw')
const src = path.join(pkgRoot, 'dist', 'prod')
const dest = path.join(__dirname, '..', 'src', 'renderer', 'public', 'excalidraw')
const stampPath = path.join(dest, '.version')

const version = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version

const upToDate =
  !process.env.FORCE_ASSETS &&
  fs.existsSync(stampPath) &&
  fs.readFileSync(stampPath, 'utf8').trim() === version

if (upToDate) {
  console.log(`[assets] Excalidraw ${version} assets already in place`)
  process.exit(0)
}

if (!fs.existsSync(src)) {
  console.error(`[assets] ${src} not found — run "npm install" first`)
  process.exit(1)
}

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

// fonts  → the drawing fonts; locales → i18n bundles Excalidraw fetches lazily.
fs.rmSync(dest, { recursive: true, force: true })
for (const dir of ['fonts', 'locales']) {
  copyDir(path.join(src, dir), path.join(dest, dir))
}
fs.writeFileSync(stampPath, `${version}\n`)

console.log(`[assets] Excalidraw ${version} fonts + locales synced to src/renderer/public/excalidraw`)
