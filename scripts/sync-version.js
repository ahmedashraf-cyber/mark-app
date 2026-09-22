const fs = require('fs')
const path = require('path')

const pkg     = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = pkg.version

const confPath = path.join('src-tauri', 'tauri.conf.json')
let conf = fs.readFileSync(confPath, 'utf8')

// Update version field
conf = conf.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`)

// Update window title
conf = conf.replace(/"title":\s*"MARK [^"]*— Review App"/, `"title": "MARK ${version} — Review App"`)

fs.writeFileSync(confPath, conf)
console.log(`[sync-version] tauri.conf.json updated → v${version}`)

// ── CURRENT_VERSION in useUpdateCheck ──────────────────────────────────────
// This was bumped by hand and drifted: package.json reached 7.9.7 while the
// constant still said 7.8.89, so every user was compared against a version
// nine releases old and told to update when already current. Deriving it from
// package.json on every build makes that impossible.
const hookPath = path.join('src', 'hooks', 'useUpdateCheck.js')
if (fs.existsSync(hookPath)) {
  let hook = fs.readFileSync(hookPath, 'utf8')
  const before = hook
  hook = hook.replace(
    /export const CURRENT_VERSION = '[^']*'.*/,
    `export const CURRENT_VERSION = '${version}' // synced from package.json by scripts/sync-version.js`)
  if (hook !== before) {
    fs.writeFileSync(hookPath, hook)
    console.log(`[sync-version] useUpdateCheck CURRENT_VERSION → v${version}`)
  } else {
    console.warn('[sync-version] WARNING: could not find CURRENT_VERSION to sync')
  }
}
