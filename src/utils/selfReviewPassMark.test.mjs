// The pass mark: who may change it, and proof that a refused change writes NOTHING. Uses the real capabilities() function
// with fake sheet calls, so the permission rule under test is the app's real one.
import fs from 'node:fs'
import { isValidPassMark, readPassMark, assertCanEditPassMark, setPassMark, PassMarkError, defaultDeps } from './selfReviewPassMark.js'
import { capabilities } from '../hooks/useAdmin.js'
import { PERMISSIONS } from './adminSheet.js'
import { PEOPLE_SHEET_ID } from '../config/drillConfig.js'
import { SELF_REVIEW_CONFIG_SPREADSHEET_ID, PASS_MARK_KEY } from '../config/selfReviewDashboardConfig.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + d + ']' : ''}`) }
const J = JSON.stringify
const COPY = 'COPY-PEOPLE-SPREADSHEET-ID'

// a fake People spreadsheet: one config tab, one log tab, and call recording
function world({ config = [['key', 'value'], ['minimum_version', '7.12.30']], role = { role: 'Batch Manager', source: 'sheet', offline: false, accessOverrides: null }, access = { __status: 'ok' }, failLog = false, dropWrites = false } = {}) {
  const st = { config: (config || []).map(r => [...r]), log: [], calls: [], writes: 0 }
  const note = (k, id) => st.calls.push({ k, id })
  const deps = {
    spreadsheetId: COPY,
    readRange: async (id, range) => { note('read', id); if (range.startsWith('config')) { if (config === null) throw new Error('Read failed (400) on config!A1:B100'); return st.config.map(r => [...r]) } return [] },
    writeRange: async (id, range, v) => { note('write', id); st.writes++; if (dropWrites) return; const row = Number(/B(\d+)$/.exec(range)[1]); st.config[row - 1][1] = v[0][0] },
    appendRows: async (id, tab, v) => { note('append', id); if (tab === 'role_changes') { if (failLog) throw new Error('log down'); st.log.push(...v); return } st.writes++; if (!dropWrites) st.config.push(...v) },
    ensureTab: async (id) => { note('ensure', id) },
    // models the real resolveRole: a call carrying an HR-code is an HR-code login, which only collectors may use
    resolveRole: async (who) => { note('resolveRole'); st.asked = who; const r = typeof role === 'function' ? role() : role
      if (who && who.hrCode && r && r.role && !/Collector/.test(r.role)) return { role: null, source: 'sheet', reason: 'Please sign in with your email and password.' }
      return r },
    fetchRoleAccess: async () => { note('fetchRoleAccess'); return access },
    capabilities,
    now: () => new Date('2026-11-03T10:00:00.000Z'),
  }
  return { st, deps }
}
const actor = { email: 'manager@example.com', hrCode: '', bootstrapAdmin: false }
const refused = async (p, code) => { try { await p; return false } catch (e) { return e instanceof PassMarkError && (!code || e.code === code) } }

console.log('the permission keys exist and default correctly')
ok('both keys are in the Role Access matrix, appended last', PERMISSIONS.slice(-2).map(p => p.key).join() === 'selfReviewDashboard,selfReviewPassMark')
ok('every role may see the dashboard by default (the role decides the scope, not this key)', ['Batch Manager', 'Batch Supervisor', 'Batch Coordinator', 'Offline Quality Reviewer', 'Offline Quality Team Leader', 'Training Supporter', 'Offline Data Collector', 'Offline Data Collector (Part)'].every(r => capabilities(r).selfReviewDashboard === true))
ok('only the Batch Manager may edit the pass mark by default', capabilities('Batch Manager').selfReviewPassMark === true && ['Batch Supervisor', 'Batch Coordinator', 'Offline Quality Reviewer', 'Offline Quality Team Leader', 'Training Supporter', 'Offline Data Collector', 'Offline Data Collector (Part)'].every(r => capabilities(r).selfReviewPassMark === false))
ok('an unknown role gets neither', capabilities('Nobody').selfReviewDashboard === false && capabilities('Nobody').selfReviewPassMark === false && capabilities(null).selfReviewPassMark === false)
ok('the Role Access matrix can switch the dashboard off for a role', capabilities('Batch Supervisor', { selfReviewDashboard: false }).selfReviewDashboard === false)
ok('...and can grant the pass-mark edit to another role', capabilities('Batch Supervisor', { selfReviewPassMark: true }).selfReviewPassMark === true)

console.log('validation')
ok('50 to 100 in steps of 5 is valid, as a number or text', [50, 55, 85, 100, '85', ' 90 '].every(isValidPassMark))
ok('everything else is not', [49, 101, 87, 85.5, '', ' ', 'abc', null, undefined, NaN, -5, 0, '85%'].every(v => !isValidPassMark(v)))

console.log('reading: never silent about a problem')
{
  let r = await readPassMark(world().deps)
  ok('never set: the default 85, no notice (a normal state)', r.value === 85 && r.source === 'default' && r.notice === '')
  r = await readPassMark(world({ config: [['key', 'value'], [PASS_MARK_KEY, '90']] }).deps)
  ok('a stored 90 is read as 90', r.value === 90 && r.source === 'config' && r.notice === '')
  r = await readPassMark(world({ config: [['key', 'value'], [' ' + PASS_MARK_KEY + ' ', ' 75 ']] }).deps)
  ok('spaces around the key and value are tolerated', r.value === 75)
  r = await readPassMark(world({ config: [['key', 'value'], [PASS_MARK_KEY, '87']] }).deps)
  ok('an invalid stored value shows 85 WITH a notice that names the bad value', r.value === 85 && /"87"/.test(r.notice) && /not valid/.test(r.notice), J(r))
  r = await readPassMark(world({ config: [['key', 'value'], [PASS_MARK_KEY, '']] }).deps)
  ok('a blank stored value is treated as not set', r.value === 85 && r.notice === '')
  r = await readPassMark(world({ config: null }).deps)
  ok('a config tab that does not exist yet is a normal state: 85, no notice', r.value === 85 && r.notice === '')
  const down = world().deps; down.readRange = async () => { throw new Error('Read failed (403) on config!A1:B100') }
  r = await readPassMark(down)
  ok('a failed read shows 85 WITH a notice (not silently)', r.value === 85 && /could not be read/.test(r.notice) && /403/.test(r.notice), J(r))
}

console.log('writing: the Batch Manager, live')
{
  const w = world({ config: [['key', 'value'], ['minimum_version', '7.12.30']] })
  const res = await setPassMark(90, actor, w.deps)
  ok('a first-time write appends the key and reads it back', res.value === 90 && res.oldValue === '' && w.st.config.some(r => r[0] === PASS_MARK_KEY && r[1] === '90'))
  ok('the change is logged to role_changes with the key, the old value (blank) and the new value', w.st.log.length === 1 && w.st.log[0][1] === 'manager@example.com' && w.st.log[0][4] === PASS_MARK_KEY && w.st.log[0][5] === '' && w.st.log[0][6] === '90' && w.st.log[0][0] === '2026-11-03T10:00:00.000Z', J(w.st.log))
  ok('minimum_version (the other config key) is untouched', w.st.config.find(r => r[0] === 'minimum_version')[1] === '7.12.30')
  const res2 = await setPassMark(70, actor, w.deps)
  ok('a second write updates the same row in place, and logs the old value 90', res2.oldValue === '90' && w.st.config.filter(r => r[0] === PASS_MARK_KEY).length === 1 && w.st.config.find(r => r[0] === PASS_MARK_KEY)[1] === '70' && w.st.log[1][5] === '90' && w.st.log[1][6] === '70')
  ok('the value is stored as text and validated: "85" works', (await setPassMark('85', actor, w.deps)).value === 85)
  ok('EVERY call went to the injected spreadsheet id, never the real People spreadsheet (copy safety)', w.st.calls.filter(c => c.id).every(c => c.id === COPY) && !w.st.calls.some(c => c.id === PEOPLE_SHEET_ID))
  const lf = world({ failLog: true }); const r3 = await setPassMark(95, actor, lf.deps)
  ok('if only the log line fails, the change still stands and says it was not logged', r3.value === 95 && r3.logged === false && lf.st.config.some(r => r[0] === PASS_MARK_KEY && r[1] === '95'))
}

console.log('the question asked of resolveRole is the one the login asks')
{
  let w = world(); await setPassMark(90, { email: 'manager@example.com', hrCode: 'A-024', bootstrapAdmin: false }, w.deps)
  ok('a staff member is looked up by email ONLY, even if an HR-code is also known (else a real Batch Manager is refused)', J(w.st.asked) === '{"email":"manager@example.com"}', J(w.st.asked))
  w = world({ role: { role: 'Offline Data Collector', source: 'sheet', offline: false, accessOverrides: null } })
  ok('a person with no email is looked up by HR-code only', await refused(setPassMark(90, { email: '', hrCode: 'A-073' }, w.deps), 'DENIED') && J(w.st.asked) === '{"hrCode":"A-073"}', J(w.st.asked))
}

console.log('writing: refusals write NOTHING')
{
  const noWrites = w => w.st.writes === 0 && !w.st.calls.some(c => c.k === 'write' || c.k === 'append' || c.k === 'ensure')
  let w = world({ role: { role: 'Batch Supervisor', source: 'sheet', offline: false, accessOverrides: null } })
  ok('a Supervisor is rejected, and no write call was made', await refused(setPassMark(90, actor, w.deps), 'DENIED') && noWrites(w), J(w.st.calls))
  for (const role of ['Batch Coordinator', 'Offline Quality Reviewer', 'Offline Quality Team Leader', 'Training Supporter', 'Offline Data Collector', 'Offline Data Collector (Part)']) {
    w = world({ role: { role, source: 'sheet', offline: false, accessOverrides: null } })
    ok(`${role}: rejected, nothing written`, await refused(setPassMark(90, actor, w.deps), 'DENIED') && noWrites(w))
  }
  w = world({ role: { role: null, source: 'sheet', reason: 'not registered' } })
  ok('a person with no role is rejected', await refused(setPassMark(90, actor, w.deps), 'DENIED') && noWrites(w))
  w = world({ role: { role: 'Batch Manager', source: 'cache', offline: true, accessOverrides: null } })
  ok('a Batch Manager known only from the cache (sheet unreachable) is rejected as NOT_LIVE: a cached role may be stale', await refused(setPassMark(90, actor, w.deps), 'NOT_LIVE') && noWrites(w))
  w = world({ role: { role: 'Batch Manager', source: 'sheet', offline: true, accessOverrides: null } })
  ok('offline is rejected even if the source says sheet', await refused(setPassMark(90, actor, w.deps), 'NOT_LIVE') && noWrites(w))
  for (const status of ['network_error', 'http_403', 'http_500', undefined]) {
    w = world({ access: { __status: status } })
    ok(`the access matrix unreadable (${status}): rejected, because the defaults cannot be trusted`, await refused(setPassMark(90, actor, w.deps), 'NOT_LIVE') && noWrites(w))
  }
  w = world({ access: { __status: 'empty' } })
  ok('an empty matrix means the defaults genuinely apply: a Batch Manager is allowed', (await setPassMark(90, actor, w.deps)).value === 90)
  w = world({ role: { role: 'Batch Manager', source: 'sheet', offline: false, accessOverrides: { selfReviewPassMark: false } } })
  ok('a Batch Manager whose matrix cell is switched OFF is rejected (the matrix is honoured, live)', await refused(setPassMark(90, actor, w.deps), 'DENIED') && noWrites(w))
  w = world({ role: { role: 'Batch Supervisor', source: 'sheet', offline: false, accessOverrides: { selfReviewPassMark: true } } })
  ok('a Supervisor whose matrix cell is switched ON is allowed', (await setPassMark(90, { ...actor, email: 'sup@example.com' }, w.deps)).value === 90)
  w = world({ role: () => { throw new Error('boom') } })
  ok('a role lookup that throws is a refusal, not a crash and not a write', await refused(setPassMark(90, actor, w.deps), 'NOT_LIVE') && noWrites(w))
  w = world()
  ok('an invalid value is rejected before ANY check or call', await refused(setPassMark(87, actor, w.deps), 'INVALID') && w.st.calls.length === 0)
  ok('so is an out-of-range or non-numeric value', await refused(setPassMark(105, actor, w.deps), 'INVALID') && await refused(setPassMark('', actor, w.deps), 'INVALID') && w.st.calls.length === 0)
  w = world()
  ok('no identity at all is rejected without a lookup', await refused(setPassMark(90, { email: '', hrCode: '' }, w.deps), 'DENIED') && w.st.calls.length === 0 && await refused(setPassMark(90, undefined, w.deps), 'DENIED'))
  w = world({ dropWrites: true })
  ok('a write that does not read back is reported as NOT_SAVED, not as success', await refused(setPassMark(90, actor, w.deps), 'NOT_SAVED'))
}

console.log('the bootstrap full-access account')
{
  const w = world({ role: () => { throw new Error('the sheet must not be consulted') } })
  const res = await setPassMark(80, { email: 'boot@example.com', hrCode: '', bootstrapAdmin: true }, w.deps)
  ok('is honoured exactly as on screen, without a role lookup', res.value === 80 && !w.st.calls.some(c => c.k === 'resolveRole'))
  ok('...but only when the caller says so: the same email without the flag goes through the live check', await (async () => { const w2 = world({ role: { role: 'Offline Data Collector', source: 'sheet', offline: false, accessOverrides: null } }); return await refused(setPassMark(80, { email: 'boot@example.com', bootstrapAdmin: false }, w2.deps), 'DENIED') })())
}

console.log('where it points')
ok('a normal build points the pass mark at the real People spreadsheet', SELF_REVIEW_CONFIG_SPREADSHEET_ID === PEOPLE_SHEET_ID && defaultDeps.spreadsheetId === PEOPLE_SHEET_ID)
ok('the only way to repoint it is the build constant VITE_SELF_REVIEW_CONFIG_SHEET_ID', /VITE_SELF_REVIEW_CONFIG_SHEET_ID/.test(fs.readFileSync('src/config/selfReviewDashboardConfig.js', 'utf8')))
ok('the config reads the build variable by its STATIC name and never a bare import.meta.env (which would embed the whole environment in the bundle)', (() => { const code = fs.readFileSync('src/config/selfReviewDashboardConfig.js', 'utf8').replace(/\/\/.*$/gm, ''); return /import\.meta\.env\.VITE_SELF_REVIEW_CONFIG_SHEET_ID/.test(code) && !/import\.meta\.env(?!\.VITE_)/.test(code) })())
ok('the module holds no spreadsheet id literal', !/[0-9A-Za-z_-]{40,}/.test(fs.readFileSync('src/utils/selfReviewPassMark.js', 'utf8')))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
