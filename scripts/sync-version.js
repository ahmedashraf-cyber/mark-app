/**
 * sync-version.js
 * ──────────────
 * Single source of truth: package.json version → everywhere else.
 *
 * Files updated:
 *   src-tauri/tauri.conf.json  "version" field + "title" field
 *   src-tauri/Cargo.toml       version field
 *   src/hooks/useUpdateCheck.js CURRENT_VERSION constant
 *   src-tauri/src/bridge_script.js BRIDGE_VERSION constant
 *
 * Run by:
 *   npm run sync-version          (before any build)
 *   The GitHub Actions workflow step "Sync version to tauri.conf.json"
 *
 * Exits 1 and prints a clear message if any version is missing or the
 * three required files (package.json, tauri.conf.json, Cargo.toml) do not
 * all end up on the same version.  The CI build step is configured with
 * `shell: pwsh` so a non-zero exit code fails the build.
 */

'use strict'
const fs   = require('fs')
const path = require('path')

// ── Read source of truth ──────────────────────────────────────────────────
const pkgPath = 'package.json'
const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const version = pkg.version
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[sync-version] FATAL: package.json has no valid semver version (got: ${version})`)
  process.exit(1)
}

// ── tauri.conf.json ───────────────────────────────────────────────────────
// tauri.conf.json is written by editors and tools as a mix of literal Unicode
// characters and JSON Unicode escapes (e.g. the em-dash may appear as either
// the 3-byte UTF-8 sequence \xe2\x80\x94 or as the 6-char escape \u2014).
// We read the raw text, do both replacements, and write back.
const confPath = path.join('src-tauri', 'tauri.conf.json')
if (fs.existsSync(confPath)) {
  let conf = fs.readFileSync(confPath, 'utf8')

  // 1. Update the top-level "version" field.
  const prevVersion = (conf.match(/"version":\s*"([^"]+)"/) || [])[1]
  conf = conf.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`)

  // 2. Update the window title — match EITHER the literal em-dash (U+2014,
  //    three UTF-8 bytes) OR the JSON Unicode escape \u2014, so the regex
  //    works regardless of how the file was last saved.
  //    Pattern: "title": "MARK <anything> — Review App"   (em-dash either form)
  //    We always write it back with the literal character so the file stays
  //    human-readable and the same regex keeps working on the next run.
  const emDashAny = /(?:\u2014|\\u2014)/  // matches literal U+2014 or the 6-char escape
  const titleRx   = new RegExp(
    `("title":\\s*"MARK )[^"]*?(?:${emDashAny.source}) Review App(")`
  )
  if (titleRx.test(conf)) {
    conf = conf.replace(titleRx, `$1${version} \u2014 Review App$2`)
  } else {
    // Title field is missing entirely or the pattern has changed — add/fix it
    // by regenerating from the bundle section, but don't silently ignore it.
    console.warn('[sync-version] WARN: window title pattern not found in tauri.conf.json — ' +
      'the title field may be missing or in an unexpected format. ' +
      'Expected: "title": "MARK <version> \u2014 Review App"')
  }

  fs.writeFileSync(confPath, conf)
  if (prevVersion !== version)
    console.log(`[sync-version] tauri.conf.json ${prevVersion} → v${version}`)
  else
    console.log(`[sync-version] tauri.conf.json already at v${version}`)
}

// ── useUpdateCheck.js — CURRENT_VERSION ──────────────────────────────────
const hookPath = path.join('src', 'hooks', 'useUpdateCheck.js')
if (fs.existsSync(hookPath)) {
  let hook   = fs.readFileSync(hookPath, 'utf8')
  const prev = (hook.match(/export const CURRENT_VERSION = '([^']*)'/) || [])[1]
  hook = hook.replace(
    /export const CURRENT_VERSION = '[^']*'.*/,
    `export const CURRENT_VERSION = '${version}' // synced from package.json by scripts/sync-version.js`
  )
  const found = /export const CURRENT_VERSION = '([^']*)'/.exec(hook)
  if (!found) {
    console.error('[sync-version] ERROR: CURRENT_VERSION not found after replacement — ' +
      'the pattern no longer matches useUpdateCheck.js. Fix before releasing.')
    process.exitCode = 1
  } else {
    fs.writeFileSync(hookPath, hook)
    if (prev !== version)
      console.log(`[sync-version] useUpdateCheck CURRENT_VERSION ${prev} → v${version}`)
  }
}

// ── Cargo.toml ────────────────────────────────────────────────────────────
const cargoPath = path.join('src-tauri', 'Cargo.toml')
if (fs.existsSync(cargoPath)) {
  let cargo = fs.readFileSync(cargoPath, 'utf8')
  const prev = (cargo.match(/^version\s*=\s*"([^"]+)"/m) || [])[1]
  cargo = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)
  fs.writeFileSync(cargoPath, cargo)
  if (prev !== version)
    console.log(`[sync-version] Cargo.toml ${prev} → v${version}`)
}

// ── bridge_script.js — BRIDGE_VERSION ─────────────────────────────────────
const bridgePath = path.join('src-tauri', 'src', 'bridge_script.js')
if (fs.existsSync(bridgePath)) {
  let br   = fs.readFileSync(bridgePath, 'utf8')
  const prev = (br.match(/const BRIDGE_VERSION = '([^']+)'/) || [])[1]
  br = br.replace(/const BRIDGE_VERSION = '[^']+'/, `const BRIDGE_VERSION = '${version}'`)
  fs.writeFileSync(bridgePath, br)
  if (prev !== version)
    console.log(`[sync-version] BRIDGE_VERSION ${prev} → v${version}`)
}

// ── Three-way consistency check ───────────────────────────────────────────
// Fail the build immediately and loudly if the three canonical version
// locations differ after our writes.  This catches: a hand-edit of one file,
// a merge conflict that partially resolved, or a future refactor that breaks
// one of the write paths above.
const checks = [
  { label: 'package.json',          read: () => JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version },
  { label: 'tauri.conf.json',       read: () => JSON.parse(fs.readFileSync(confPath, 'utf8')).version },
  { label: 'Cargo.toml',            read: () => (fs.readFileSync(cargoPath,'utf8').match(/^version\s*=\s*"([^"]+)"/m)||[])[1] },
]
const mismatches = checks
  .map(c => ({ ...c, actual: c.read() }))
  .filter(c => c.actual !== version)

if (mismatches.length) {
  console.error('\n[sync-version] BUILD FAILURE: version mismatch after sync!')
  console.error(`  Expected: ${version}`)
  mismatches.forEach(c => console.error(`  ${c.label}: ${c.actual}`))
  console.error('\nFix: ensure package.json has the correct version, then re-run `node scripts/sync-version.js`.\n')
  process.exit(1)
}

// Also check window title
const confFinal = fs.readFileSync(confPath, 'utf8')
const conf2 = JSON.parse(confFinal)
const titleActual = conf2?.app?.windows?.[0]?.title
const expectedTitle = `MARK ${version} \u2014 Review App`
if (titleActual !== expectedTitle) {
  console.error(`[sync-version] BUILD FAILURE: window title mismatch!`)
  console.error(`  Expected: ${expectedTitle}`)
  console.error(`  Got:      ${titleActual}`)
  process.exit(1)
}

console.log(`[sync-version] ✓ All versions consistent at v${version}`)
console.log(`[sync-version] ✓ Window title: "${expectedTitle}"`)
