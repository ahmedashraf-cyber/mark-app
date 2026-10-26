#!/usr/bin/env node
/**
 * run-tests.mjs — runs the repository's script-style tests and fails if any fails.
 *
 * These tests existed before there was a test runner. They are plain Node scripts that print
 * their results, so this wrapper only (1) bundles the ones whose sources use extensionless
 * imports (fine for Vite, not for raw Node), (2) runs each in its own process and (3) turns a
 * non-zero exit code into a failing `npm test`. Their contents are not changed by it.
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'

// bundle: true  → source imports "./x" without an extension, so it must be bundled first
const TESTS = [
  { file: 'src/utils/phaseChain.test.mjs',      bundle: true  },   // phase/chain rules engine (Tag mode)
  { file: 'src/utils/defectTypes.parity.mjs',   bundle: false },   // Scout classification must not drift
]

const dir = mkdtempSync(join(tmpdir(), 'mark-tests-'))
let failed = 0
try {
  for (const t of TESTS) {
    let entry = t.file
    if (t.bundle) {
      entry = join(dir, basename(t.file))
      await build({ entryPoints: [t.file], bundle: true, platform: 'node', format: 'esm', outfile: entry, logLevel: 'error' })
    }
    console.log(`\n▶ ${t.file}`)
    const r = spawnSync(process.execPath, [entry], { stdio: 'inherit' })
    if (r.status !== 0) { failed++; console.error(`✗ FAILED (exit ${r.status}): ${t.file}`) }
    else console.log(`✓ passed: ${t.file}`)
  }
} finally { rmSync(dir, { recursive: true, force: true }) }

console.log(failed ? `\n${failed} test file(s) FAILED` : `\nall ${TESTS.length} test files passed`)
process.exit(failed ? 1 : 0)
