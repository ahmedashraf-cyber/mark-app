// The halvesCompare permission: the capability key, the Role Access column, and what an Admin save does to a tab that has FEWER
// columns than PERMISSIONS (the real tab today is role + 17 permissions). SYNTHETIC data only.
import { capabilities, ALL_ROLES, ROLE } from '../hooks/useAdmin.js'
import { PERMISSIONS, ACCESS_HEADER, loadRoleAccess, saveRoleAccess } from './adminSheet.js'
import { fetchRoleAccess } from './sheetRole.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 260) + ']' : ''}`) }
const J = JSON.stringify
const SIX = [ROLE.MANAGER, ROLE.SUPERVISOR, ROLE.COORDINATOR, ROLE.QUALITY_REVIEWER, ROLE.QUALITY_TL, ROLE.TRAINING_SUPPORTER]
// what the access page refuses to show without: both halves of the rule
const bothOn = c => !!(c && c.halvesCompare && c.comparison)

console.log('the capability key')
ok('halvesCompare is OFF by default for every one of the 8 roles, an unknown role and an empty role', [...ALL_ROLES, 'Nobody', '', null, undefined].every(r => capabilities(r).halvesCompare === false))
ok('comparison stays on for exactly the six roles by default (so switching halvesCompare on is what turns the button on)', SIX.every(r => capabilities(r).comparison === true) && [ROLE.COLLECTOR, ROLE.COLLECTOR_PART].every(r => capabilities(r).comparison === false))
ok('an override of 1 switches it on for each of the six roles, and only for the role it is given to', SIX.every(r => capabilities(r, { halvesCompare: true }).halvesCompare === true) && capabilities(ROLE.COLLECTOR, { halvesCompare: false }).halvesCompare === false)
ok('an override of 0 keeps it off; a role row with the key absent or blank (undefined) keeps the default (off)', SIX.every(r => capabilities(r, { halvesCompare: false }).halvesCompare === false && capabilities(r, { comparison: true }).halvesCompare === false && capabilities(r, {}).halvesCompare === false))
ok('a non-boolean value in an override is ignored, not coerced', capabilities(ROLE.MANAGER, { halvesCompare: 'yes' }).halvesCompare === false && capabilities(ROLE.MANAGER, { halvesCompare: 1 }).halvesCompare === false)
ok('the full-access account (built exactly as useAuth builds it: every boolean true) gets it too', (() => { const b = capabilities('Batch Manager', null), o = { ...b }; Object.keys(o).forEach(k => { if (typeof o[k] === 'boolean') o[k] = true }); return o.halvesCompare === true })())
ok('the rule needs BOTH: halvesCompare on with comparison switched OFF is not enough, and comparison on without halvesCompare is not either', bothOn(capabilities(ROLE.SUPERVISOR, { halvesCompare: true })) === true && bothOn(capabilities(ROLE.SUPERVISOR, { halvesCompare: true, comparison: false })) === false && bothOn(capabilities(ROLE.SUPERVISOR, { comparison: true })) === false)
ok('switching halvesCompare on changes NO other capability', (() => { const a = capabilities(ROLE.SUPERVISOR), b = capabilities(ROLE.SUPERVISOR, { halvesCompare: true }); return Object.keys(a).every(k => k === 'halvesCompare' || a[k] === b[k]) })())

console.log('\nthe Admin column')
const OLD19 = ['scout','audit','tag','tagEditor','drillCreate','drillTake','comparison','modelAnswer','quizManage','quizAssign','drillDashboards','admin','hrCodeLogin','insights','selfReview','viewOwnHalves','viewAnyHalves','selfReviewDashboard','selfReviewPassMark']
ok('halvesCompare is appended LAST: the 19 existing columns keep their order', J(PERMISSIONS.map(p => p.key)) === J([...OLD19, 'halvesCompare']) && ACCESS_HEADER[ACCESS_HEADER.length - 1] === 'halvesCompare' && ACCESS_HEADER.length === 21)
ok('every column the Admin screen can write is a key capabilities() knows (otherwise the sheet value would be ignored)', PERMISSIONS.every(p => p.key in capabilities(ROLE.MANAGER)), J(PERMISSIONS.filter(p => !(p.key in capabilities(ROLE.MANAGER))).map(p => p.key)))
ok('column keys are unique', new Set(PERMISSIONS.map(p => p.key)).size === PERMISSIONS.length)

// ── a fake Google Sheets API holding the People spreadsheet ────────────────────────────────────────────────────────────
globalThis.window = { __TAURI_INTERNALS__: { invoke: async () => 'TOKEN' } }
const realFetch = globalThis.fetch
function world(tab) {
  const store = { role_access: tab.map(r => r.slice()), role_changes: [['timestamp', 'by', 'a', 'b', 'key', 'old', 'new']] }
  const writes = [], log = []
  const colNo = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
  globalThis.fetch = async (url, o = {}) => {
    const u = decodeURIComponent(String(url)), method = (o.method || 'GET').toUpperCase(); log.push(method + ' ' + u.replace(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+/, ''))
    const json = b => ({ ok: true, status: 200, json: async () => b, text: async () => J(b) })
    if (u.includes('?fields=sheets.properties.title')) return json({ sheets: Object.keys(store).map(t => ({ properties: { title: t } })) })
    let m = /\/values\/([^!]+)!A1:Z40$/.exec(u); if (m && method === 'GET') return json({ values: store[m[1]].map(r => r.slice(0, 26)) })
    m = /\/values\/([^!]+)!A1:Z1$/.exec(u); if (m && method === 'GET') return json({ values: store[m[1]].slice(0, 1) })
    m = /\/values\/([^!]+)!A1\?valueInputOption=RAW$/.exec(u); if (m && method === 'PUT') { const vals = JSON.parse(o.body).values; writes.push({ tab: m[1], values: vals })
      vals.forEach((row, i) => { store[m[1]][i] = store[m[1]][i] || []; row.forEach((v, j) => { store[m[1]][i][j] = v }) }); return json({}) }
    m = /\/values\/([^!]+)!A:A:append/.exec(u); if (m && method === 'POST') { JSON.parse(o.body).values.forEach(r => store[m[1]].push(r)); return json({}) }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'unexpected ' + method + ' ' + u }
  }
  return { store, writes, log }
}
const seedFromAdminPage = stored => { const seed = {}; ALL_ROLES.forEach(r => { const base = capabilities(r); seed[r] = {}; PERMISSIONS.forEach(p => { seed[r][p.key] = stored[r] && p.key in stored[r] ? stored[r][p.key] : !!base[p.key] }) }); return seed }   // the same loop AdminPage.jsx runs
const tabFor = (keys, mutate) => { const rows = ALL_ROLES.map(r => [r, ...keys.map(k => { const v = mutate ? mutate(r, k) : null; return v ?? (capabilities(r)[k] ? '1' : '0') })]); return [['role', ...keys], ...rows] }

console.log('\nan Admin save on a tab with FEWER columns than PERMISSIONS (role + 17: no selfReviewDashboard, selfReviewPassMark, halvesCompare)')
{
  const keys17 = OLD19.filter(k => !['selfReviewDashboard', 'selfReviewPassMark'].includes(k))
  // make the sheet's values distinctive, so a shift would show: e.g. Training Supporter has tagEditor ON, Coordinator has insights OFF
  const original = tabFor(keys17, (r, k) => (r === ROLE.TRAINING_SUPPORTER && k === 'tagEditor' ? '1' : r === ROLE.COORDINATOR && k === 'insights' ? '0' : null))
  const w = world(original)
  const stored = await loadRoleAccess()
  const seed = seedFromAdminPage(stored)
  await saveRoleAccess(seed, 'tester')
  const w1 = w.writes.find(x => x.tab === 'role_access'), header = w1.values[0], rows = w1.values.slice(1)
  ok('the header is written BY NAME in PERMISSIONS order, 21 columns, halvesCompare last', J(header) === J(ACCESS_HEADER), J(header))
  ok('it is ONE block starting at A1 (header + the 8 roles), nothing written anywhere else on the tab', w.writes.filter(x => x.tab === 'role_access').length === 1 && rows.length === 8)
  const orig = Object.fromEntries(original.slice(1).map(r => [r[0], Object.fromEntries(original[0].slice(1).map((k, i) => [k, r[i + 1]]))]))
  const now = Object.fromEntries(rows.map(r => [r[0], Object.fromEntries(header.slice(1).map((k, i) => [k, r[i + 1]]))]))
  ok('every one of the 17 existing columns keeps the SAME VALUE for the SAME role, by name (8 roles x 17 columns = 136 cells)', ALL_ROLES.every(r => keys17.every(k => now[r][k] === orig[r][k])), J(ALL_ROLES.flatMap(r => keys17.filter(k => now[r][k] !== orig[r][k]).map(k => r + '.' + k))))
  ok('the two hand-set oddities survived: Training Supporter tagEditor 1, Coordinator insights 0', now[ROLE.TRAINING_SUPPORTER].tagEditor === '1' && now[ROLE.COORDINATOR].insights === '0')
  ok('the three NEW columns are filled from the code defaults: selfReviewDashboard/selfReviewPassMark as the app already behaves, halvesCompare 0 for everyone', ALL_ROLES.every(r => now[r].halvesCompare === '0' && now[r].selfReviewDashboard === (capabilities(r).selfReviewDashboard ? '1' : '0') && now[r].selfReviewPassMark === (capabilities(r).selfReviewPassMark ? '1' : '0')))
  ok('each role keeps its own row (column A names unchanged, one per role)', J(rows.map(r => r[0])) === J(ALL_ROLES))
  ok('the change is logged (one role_changes row), as before', w.store.role_changes.length === 2 && /role_access/.test(w.store.role_changes[1].join('|')))

  console.log('\n...then the Batch Manager switches the button on for the six roles in Role Access, and saves')
  const seed2 = seedFromAdminPage(await loadRoleAccess())
  SIX.forEach(r => { seed2[r].halvesCompare = true })
  await saveRoleAccess(seed2, 'tester')
  const read = await fetchRoleAccess()          // exactly what the app reads at the next sign-in
  ok('what the app reads next: status ok, halvesCompare 1 for the six roles, 0 for both collector roles', read.__status === 'ok' && SIX.every(r => read[r].halvesCompare === true) && [ROLE.COLLECTOR, ROLE.COLLECTOR_PART].every(r => read[r].halvesCompare === false), J(Object.fromEntries(ALL_ROLES.map(r => [r, read[r]?.halvesCompare]))))
  const eff = r => capabilities(r, read[r])
  ok('...so the effective button access is ON for all six and OFF for the collectors', SIX.every(r => bothOn(eff(r))) && [ROLE.COLLECTOR, ROLE.COLLECTOR_PART].every(r => !bothOn(eff(r))))
  ok('...and switching Comparison off for one of them in the same matrix switches the button off for that role only', (() => { const s3 = seedFromAdminPage(read.__status ? { ...Object.fromEntries(ALL_ROLES.map(r => [r, read[r]])) } : {}); s3[ROLE.QUALITY_TL].comparison = false; return !bothOn(capabilities(ROLE.QUALITY_TL, s3[ROLE.QUALITY_TL])) && bothOn(capabilities(ROLE.QUALITY_REVIEWER, s3[ROLE.QUALITY_REVIEWER])) })())
}

console.log('\nthe same save when the tab\'s columns are in a DIFFERENT ORDER from PERMISSIONS, and when halvesCompare is already there')
{
  const shuffled = ['insights', 'scout', 'comparison', 'tag', 'audit', 'viewOwnHalves', 'admin', 'drillTake']
  const original = tabFor(shuffled, (r, k) => (r === ROLE.SUPERVISOR && k === 'scout' ? '0' : null))
  const w = world(original); const seed = seedFromAdminPage(await loadRoleAccess()); await saveRoleAccess(seed, 't')
  const out = w.writes[0].values, h = out[0], now = Object.fromEntries(out.slice(1).map(r => [r[0], Object.fromEntries(h.slice(1).map((k, i) => [k, r[i + 1]]))]))
  ok('values follow their NAME, not their position: Supervisor scout is still 0 although scout moved from column C to column B', now[ROLE.SUPERVISOR].scout === '0' && J(h) === J(ACCESS_HEADER))
  const w2 = world([['role', 'comparison', 'halvesCompare'], ...ALL_ROLES.map(r => [r, '1', SIX.includes(r) ? '1' : '0'])]); const s2 = seedFromAdminPage(await loadRoleAccess())
  ok('a tab that ALREADY has halvesCompare (set by hand or by an earlier save) is read by name and its 1s survive a save', SIX.every(r => s2[r].halvesCompare === true) && (await saveRoleAccess(s2, 't'), w2.writes[0].values.slice(1).filter(r => SIX.includes(r[0])).every(r => r[ACCESS_HEADER.indexOf('halvesCompare')] === '1')))
}
globalThis.fetch = realFetch
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
