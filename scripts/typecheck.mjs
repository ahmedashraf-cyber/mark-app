#!/usr/bin/env node
/**
 * typecheck.mjs — `tsc --checkJs` as a RATCHET.
 *
 * The code base is untyped JavaScript. A normal `tsc` run reports 145 errors (non-strict) and
 * cannot pass today, and hiding them with `@ts-nocheck` would only conceal them. So the current
 * errors are committed in typecheck-baseline.json and this script fails on any error that is NOT
 * in that baseline — the count can go down but never up. Errors are keyed by file + TS code +
 * message (not line number) so unrelated edits do not churn the baseline.
 *
 *   node scripts/typecheck.mjs           check against the baseline (CI)
 *   node scripts/typecheck.mjs --update  rewrite the baseline (only after FIXING errors; review the diff)
 *
 * Interim workaround: FieldPage.jsx has an orphaned `)}` (a syntax error TypeScript refuses to
 * look past — it skips ALL semantic checking while one exists). The check therefore runs on a
 * temporary copy of the repo with that one line removed. When the real fix lands the patch
 * silently becomes a no-op, and this block can be deleted.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const BASELINE = join(ROOT, 'typecheck-baseline.json')
const update = process.argv.includes('--update')

// ── run tsc on a temp copy ────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'mark-tsc-'))
let out
try {
  cpSync(join(ROOT, 'src'), join(tmp, 'src'), { recursive: true })
  cpSync(join(ROOT, 'tsconfig.json'), join(tmp, 'tsconfig.json'))
  cpSync(join(ROOT, 'package.json'), join(tmp, 'package.json'))
  symlinkSync(join(ROOT, 'node_modules'), join(tmp, 'node_modules'), 'junction')

  const fp = join(tmp, 'src/pages/FieldPage.jsx')
  if (existsSync(fp)) {
    const s = readFileSync(fp, 'utf8')
    const orphan = "                    {saveMatchError}\n                  </div>\n                )}\n"
    if (s.includes(orphan)) writeFileSync(fp, s.replace(orphan, "                    {saveMatchError}\n                  </div>\n"))
  }
  const tsc = join(ROOT, 'node_modules/typescript/bin/tsc')
  const r = spawnSync(process.execPath, [tsc, '-p', join(tmp, 'tsconfig.json'), '--pretty', 'false'], { cwd: tmp, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  out = (r.stdout || '') + (r.stderr || '')
} finally { rmSync(tmp, { recursive: true, force: true }) }

// ── normalise: "file(line,col): error TSnnnn: message" → "file|TSnnnn|message" ─
const found = new Map()
let unparsed = 0
for (const line of out.split(/\r?\n/)) {
  if (!line.trim()) continue
  const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)
  if (!m) { if (/error TS/.test(line)) unparsed++; continue }
  const key = `${m[1].replace(/\\/g, '/')}|${m[4]}|${m[5].slice(0, 160)}`
  found.set(key, (found.get(key) || 0) + 1)
}
if (unparsed) { console.error(`✗ ${unparsed} tsc line(s) could not be parsed — refusing to pass blindly`); process.exit(1) }
if (/error TS(1\d{3}|18003)/.test(out) && found.size === 0) { console.error(out.slice(0, 1500)); process.exit(1) }

const total = [...found.values()].reduce((a, b) => a + b, 0)
if (update) {
  const obj = Object.fromEntries([...found.entries()].sort())
  writeFileSync(BASELINE, JSON.stringify({ _comment: 'Known type errors (file|code|message → count). May only shrink. See scripts/typecheck.mjs.', errors: obj }, null, 1) + '\n')
  console.log(`baseline written: ${found.size} distinct / ${total} total errors`)
  process.exit(0)
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).errors : {}
const added = [], fixed = []
for (const [k, n] of found) { const b = base[k] || 0; if (n > b) added.push([k, n - b]) }
for (const [k, b] of Object.entries(base)) { const n = found.get(k) || 0; if (n < b) fixed.push([k, b - n]) }

const baseTotal = Object.values(base).reduce((a, b) => a + b, 0)
console.log(`type check: ${total} error(s) now, ${baseTotal} in the baseline`)
if (fixed.length) console.log(`  ${fixed.reduce((a, [, n]) => a + n, 0)} baseline error(s) are fixed — run \`node scripts/typecheck.mjs --update\` to lock that in`)
if (added.length) {
  console.error(`\n✗ ${added.reduce((a, [, n]) => a + n, 0)} NEW type error(s):`)
  for (const [k, n] of added) { const [f, c, msg] = k.split('|'); console.error(`  ${f}  ${c}: ${msg}${n > 1 ? `  (x${n})` : ''}`) }
  process.exit(1)
}
console.log('✓ no new type errors')
