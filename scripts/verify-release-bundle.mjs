#!/usr/bin/env node
/**
 * verify-release-bundle.mjs: does the BUILT web bundle point at the right spreadsheets?
 * ============================================================================
 * Run after `vite build`, before the installer is packaged (CI does; it is also the manual gate before every release draft):
 *     node scripts/verify-release-bundle.mjs [--dist dist] [--allow-test]
 * Exit 0 = every check passed. Exit 1 = at least one failed: DO NOT PACKAGE.
 *
 * The expected ids are PINNED HERE, deliberately not imported from the source: a check that compares the bundle with the very
 * constants that produced it can never fail. If a spreadsheet legitimately changes, change it here too, in the same commit.
 *
 * It checks the web bundle (what goes inside the installer), not the compiled executable.
 *   1. the Mark Field Collected Data spreadsheet (where Self-Review results live) is in the bundle
 *   2. the People spreadsheet is in the bundle
 *   3. the OLD Data Stability Tracker / Sampled Halves spreadsheet appears exactly once: its Sampled Halves read. A second
 *      appearance means something else (a save?) has been pointed at it again.
 *   4. NO test id and NO test build variable: a release must not carry a spreadsheet COPY (--allow-test relaxes this for a
 *      deliberate TEST build only, and the output then says TEST BUILD)
 *   5. the results tab name is present, and index.html declares UTF-8
 * It also LISTS any other 44-character spreadsheet-looking id it finds, as information (never a failure).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PINNED = {
  results: { id: '1l3tYwre5ik0nMbBS562tge0Ch4MHKcuXTuNdPaEoTec', what: 'Mark Field Collected Data (Self-Review results)' },
  people: { id: '1bErhs3yQiJMl6PXRJFgH512wLgfm2dM6Cpj2owimLuw', what: 'People spreadsheet (roles, access, pass mark)' },
  old: { id: '1XGVp4o7xu8mwPkhEamz-d1aiWYCkkhR-ffTlVQCcsrM', what: 'old Data Stability Tracker / Sampled Halves' },
}
export const FORBIDDEN = [
  { text: '1AoR7M9idNG7WUS7SQIaqmsdDN_Syxmar4Ic--8092mI', what: 'the test COPY of Mark Field Collected Data' },
  { text: '1LZsK1gUAlRrS_4ke4zhV57GwnDzECR4fIEnvE9_hTfo', what: 'the test COPY of the People spreadsheet' },
  { text: 'COPY-PEOPLE', what: 'a test placeholder id' },
  { text: 'VITE_SELF_REVIEW_CONFIG_SHEET_ID', what: 'the test-build variable (a release build inlines it away)' },
  { text: 'VITE_FIELD_SHEET_ID', what: 'the test-build variable (a release build inlines it away)' },
]
export const TAB_NAME = 'Collector Self Review'

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(js|mjs|html|css|json)$/i.test(e.name)) out.push(p)
  }
  return out
}
const count = (hay, needle) => { let n = 0, i = hay.indexOf(needle); while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length) } return n }

/** -> { ok, checks: [{ ok, name, detail }], info: [...] } */
export function verifyBundle(dist, { allowTest = false } = {}) {
  const checks = [], info = []
  const add = (ok, name, detail = '') => checks.push({ ok, name, detail })
  if (!fs.existsSync(dist) || !fs.statSync(dist).isDirectory()) {
    add(false, 'the build folder exists', `"${dist}" was not found: run the build first`)
    return { ok: false, checks, info }
  }
  const files = walk(dist)
  const js = files.filter(f => /\.(js|mjs)$/i.test(f))
  add(js.length > 0, 'the build contains JavaScript', `${js.length} file(s) in ${dist}`)
  const text = files.map(f => fs.readFileSync(f, 'utf8')).join('\n')
  const n = s => count(text, s)

  add(n(PINNED.results.id) >= 1, `the results spreadsheet id is in the bundle: ${PINNED.results.what}`, `${n(PINNED.results.id)} occurrence(s)`)
  add(n(PINNED.people.id) >= 1, `the People spreadsheet id is in the bundle: ${PINNED.people.what}`, `${n(PINNED.people.id)} occurrence(s)`)
  const old = n(PINNED.old.id)
  add(old <= 1, `the OLD spreadsheet id appears at most once (its Sampled Halves read): ${PINNED.old.what}`, `${old} occurrence(s)${old > 1 ? ': something else may point at the old spreadsheet again' : old === 0 ? ' (the Sampled Halves read has moved? check)' : ''}`)
  for (const f of FORBIDDEN) {
    const c = n(f.text)
    if (allowTest) info.push(`TEST BUILD: ${f.what} ${c ? 'is' : 'is not'} in the bundle (${c})`)
    else add(c === 0, `no test string in the bundle: ${f.what}`, c ? `FOUND ${c}x: ${f.text.slice(0, 18)}…` : 'none')
  }
  add(n(TAB_NAME) >= 1, `the results tab name "${TAB_NAME}" is in the bundle`, `${n(TAB_NAME)} occurrence(s)`)
  const index = files.find(f => /index\.html$/i.test(f))
  add(!!index && /<meta[^>]*charset=["']?utf-8/i.test(fs.readFileSync(index, 'utf8')), 'index.html declares UTF-8', index ? '' : 'index.html not found')

  const known = new Set([PINNED.results.id, PINNED.people.id, PINNED.old.id, ...FORBIDDEN.map(f => f.text)])
  const others = new Set((text.match(/(?<![A-Za-z0-9_-])1[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g) || []).filter(x => !known.has(x)))
  if (others.size) info.push(`${others.size} other 44-character id(s) in the bundle (other spreadsheets or folders the app uses): ${[...others].slice(0, 8).map(x => `${x.slice(0, 6)}…${x.slice(-4)}`).join(', ')}${others.size > 8 ? ', …' : ''}`)
  return { ok: checks.every(c => c.ok), checks, info }
}

// fileURLToPath handles Windows drive letters and spaces; comparing URL paths by hand does not
const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = process.argv.slice(2)
  const dist = args.includes('--dist') ? args[args.indexOf('--dist') + 1] : 'dist'
  const allowTest = args.includes('--allow-test')
  const r = verifyBundle(dist, { allowTest })
  console.log(`Release bundle check${allowTest ? ' (TEST BUILD: test strings allowed)' : ''}: ${dist}`)
  for (const c of r.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  [${c.detail}]` : ''}`)
  for (const i of r.info) console.log(`  info  ${i}`)
  console.log(r.ok ? 'RESULT: PASS: the bundle points where it should.' : 'RESULT: FAIL: do NOT package this build.')
  process.exit(r.ok ? 0 : 1)
}
