// Run: node scripts/verify-release-bundle.test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { verifyBundle, PINNED, FORBIDDEN, TAB_NAME } from './verify-release-bundle.mjs'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + d + ']' : ''}`) }
const HTML = '<!doctype html><html><head><meta charset="UTF-8" /></head><body></body></html>'
const GOOD_JS = `const a="${PINNED.results.id}",b="${PINNED.people.id}",c="${PINNED.old.id}",t="${TAB_NAME}";`
function make(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'))
  fs.mkdirSync(path.join(d, 'assets'))
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body)
  return d
}
const good = (extra = '') => make({ 'index.html': HTML, 'assets/App-abc.js': GOOD_JS + extra })
const failedNames = r => r.checks.filter(c => !c.ok).map(c => c.name)

let r = verifyBundle(good())
ok('a correct bundle passes every check', r.ok && r.checks.every(c => c.ok), failedNames(r).join(' | '))
ok('the pinned ids are the ones the project uses today (results 1l3tYw…, People 1bErhs…, old 1XGVp4…)', PINNED.results.id.startsWith('1l3tYwre') && PINNED.people.id.startsWith('1bErhs3y') && PINNED.old.id.startsWith('1XGVp4o7'))

r = verifyBundle(make({ 'index.html': HTML, 'assets/a.js': GOOD_JS.replace(PINNED.results.id, 'X'.repeat(44)) }))
ok('the RESULTS spreadsheet id missing fails (the save would point somewhere else)', !r.ok && failedNames(r).some(n => /results spreadsheet id/.test(n)))
r = verifyBundle(make({ 'index.html': HTML, 'assets/a.js': GOOD_JS.replace(PINNED.people.id, 'Y'.repeat(44)) }))
ok('the PEOPLE spreadsheet id missing fails', !r.ok && failedNames(r).some(n => /People spreadsheet id/.test(n)))
r = verifyBundle(good(`;x="${PINNED.old.id}"`))
ok('the OLD spreadsheet id appearing a SECOND time fails (something else points at the old spreadsheet again)', !r.ok && failedNames(r).some(n => /OLD spreadsheet id/.test(n)))
ok('...but the old id appearing once, or not at all, does not fail by itself', verifyBundle(make({ 'index.html': HTML, 'assets/a.js': GOOD_JS.replace(PINNED.old.id, 'Z'.repeat(44)) })).ok)
for (const f of FORBIDDEN) {
  r = verifyBundle(good(`;t="${f.text}"`))
  ok(`a test string fails the release: ${f.what} (${f.text.slice(0, 16)}…)`, !r.ok && failedNames(r).some(n => n.includes('no test string')))
}
r = verifyBundle(make({ 'index.html': HTML, 'assets/a.js': GOOD_JS.replace(TAB_NAME, 'Other Tab') }))
ok('the results tab name missing fails', !r.ok && failedNames(r).some(n => /tab name/.test(n)))
r = verifyBundle(make({ 'index.html': '<html><head></head></html>', 'assets/a.js': GOOD_JS }))
ok('an index.html with no UTF-8 declaration fails (the division-sign question)', !r.ok && failedNames(r).some(n => /UTF-8/.test(n)))
r = verifyBundle('/nonexistent/dist')
ok('a missing build folder fails with a clear message', !r.ok && /run the build first/.test(r.checks[0].detail))
r = verifyBundle(make({ 'index.html': HTML }))
ok('a build with no JavaScript fails', !r.ok && failedNames(r).some(n => /JavaScript/.test(n)))
r = verifyBundle(good(`;t="${FORBIDDEN[0].text}"`), { allowTest: true })
ok('--allow-test (a deliberate TEST build) tolerates the test strings, says so, and still requires the real ids', r.ok && r.info.some(i => /TEST BUILD/.test(i)))
r = verifyBundle(make({ 'index.html': HTML, 'assets/a.js': `x="${FORBIDDEN[0].text}"` }), { allowTest: true })
ok('...but a test build with no real ids at all still fails', !r.ok)
r = verifyBundle(good(`;z="${'1' + 'Q'.repeat(43)}"`))
ok('an unknown 44-character id is only LISTED as information, never a failure', r.ok && r.info.some(i => /other 44-character id/.test(i)))

// the command line: exit code and output
const run = args => { try { return { code: 0, out: execFileSync('node', ['scripts/verify-release-bundle.mjs', ...args], { encoding: 'utf8' }) } } catch (e) { return { code: e.status, out: String(e.stdout) } } }
let c = run(['--dist', good()])
ok('the command exits 0 and prints PASS for a correct bundle', c.code === 0 && /RESULT: PASS/.test(c.out))
c = run(['--dist', good(`;x="${FORBIDDEN[1].text}"`)])
ok('the command exits 1 and prints "do NOT package" for a bad bundle', c.code === 1 && /do NOT package/.test(c.out) && /FAIL/.test(c.out))
c = run(['--dist', '/nonexistent'])
ok('the command exits 1 for a missing folder', c.code === 1)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
