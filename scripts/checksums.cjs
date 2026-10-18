// Writes SHA-256 checksums for the distributables in release/ so a download can
// be verified before opening:
//
//     npm run dist && npm run checksums
//     shasum -a 256 -c "release/SHA256SUMS.txt"
//
// Output is the standard `<hash>  <name>` format that `shasum`/`sha256sum`
// both accept, one line per .dmg (and .zip, if one is ever produced).

const { createHash } = require('node:crypto')
const { createReadStream, readdirSync, writeFileSync, statSync } = require('node:fs')
const { join } = require('node:path')

const RELEASE_DIR = join(__dirname, '..', 'release')
const EXTENSIONS = ['.dmg', '.zip']

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

function human(bytes) {
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

async function main() {
  let entries
  try {
    entries = readdirSync(RELEASE_DIR)
  } catch {
    console.error(`[checksums] no release/ directory — run \`npm run dist\` first`)
    process.exit(1)
  }

  const files = entries
    .filter((name) => EXTENSIONS.includes(name.slice(name.lastIndexOf('.'))))
    .sort()
    .map((name) => join(RELEASE_DIR, name))

  if (files.length === 0) {
    console.error(`[checksums] no ${EXTENSIONS.join('/')} artifacts in release/ — run \`npm run dist\` first`)
    process.exit(1)
  }

  const lines = []
  console.log('[checksums] SHA-256')
  for (const file of files) {
    const digest = await sha256(file)
    const name = file.slice(file.lastIndexOf('/') + 1)
    const size = statSync(file).size
    lines.push(`${digest}  ${name}`)
    console.log(`  ${digest}  ${name}  (${human(size)})`)
  }

  const out = join(RELEASE_DIR, 'SHA256SUMS.txt')
  writeFileSync(out, lines.join('\n') + '\n')
  console.log(`[checksums] wrote ${out}`)
}

main().catch((err) => {
  console.error('[checksums] failed:', err.message)
  process.exit(1)
})
