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
  // Distinguish "already correct" from "pattern no longer matches". The old
  // check warned on any no-op, so a correctly-synced file reported a failure —
  // which is exactly the kind of noise that makes a real warning ignorable.
  const found = /export const CURRENT_VERSION = '([^']*)'/.exec(hook)
  if (!found) {
    console.error('[sync-version] ERROR: CURRENT_VERSION not found — the pattern '
      + 'no longer matches useUpdateCheck.js. Fix this before releasing.')
    process.exitCode = 1
  } else if (hook !== before) {
    fs.writeFileSync(hookPath, hook)
    console.log(`[sync-version] useUpdateCheck CURRENT_VERSION → v${version}`)
  } else if (found[1] !== version) {
    console.error(`[sync-version] ERROR: CURRENT_VERSION is ${found[1]}, expected ${version}`)
    process.exitCode = 1
  }
}

// ── Cargo.toml ─────────────────────────────────────────────────────────────
// This drifted to 7.8.90 while package.json reached 7.9.10, and the drift was
// not cosmetic: ASAR_MARKER is built from CARGO_PKG_VERSION, and the Tag Once
// patcher skips when it finds its own marker. A frozen crate version therefore
// froze the marker, so Embed Bridge returned "already patched" forever and the
// collection app kept running an old bridge script. Syncing it here is what
// makes bridge updates reach Tag Once at all.
const cargoPath = path.join('src-tauri', 'Cargo.toml')
if (fs.existsSync(cargoPath)) {
  let cargo = fs.readFileSync(cargoPath, 'utf8')
  const before = (cargo.match(/^version\s*=\s*"([^"]+)"/m) || [])[1]
  cargo = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)
  fs.writeFileSync(cargoPath, cargo)
  if (before !== version) console.log(`[sync-version] Cargo.toml ${before} → v${version}`)
}

// ── bridge_script.js BRIDGE_VERSION ────────────────────────────────────────
// The second frozen version, and the second independent lock on bridge
// updates: line 3 of the bridge returns early when the already-running bridge
// reports the same BRIDGE_VERSION. Frozen at 7.8.89, that meant even a freshly
// injected script refused to start, logging "bridge already running". Both this
// and ASAR_MARKER had to move for a bridge change to take effect at all.
const bridgePath = path.join('src-tauri', 'src', 'bridge_script.js')
if (fs.existsSync(bridgePath)) {
  let br = fs.readFileSync(bridgePath, 'utf8')
  const before = (br.match(/const BRIDGE_VERSION = '([^']+)'/) || [])[1]
  br = br.replace(/const BRIDGE_VERSION = '[^']+'/, `const BRIDGE_VERSION = '${version}'`)
  fs.writeFileSync(bridgePath, br)
  if (before !== version) console.log(`[sync-version] BRIDGE_VERSION ${before} → v${version}`)
}
