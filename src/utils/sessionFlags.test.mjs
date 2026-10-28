// Pure-logic tests for sign-in session handling. Run: node scripts/run-one.mjs  (or bundle with esbuild like the other *.test.mjs)
import { decideStartup, readRemember, writeRemember, clearRemember, isFreshStart, markRunStarted, MAX_REMEMBER_MS, REMEMBER_KEY } from './sessionFlags.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail ? '   [' + detail + ']' : ''}`) }
const fakeStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m } }
const NOW = 1_800_000_000_000, DAY = 86_400_000

console.log('decideStartup')
ok('no user -> nothing to do', decideStartup({ uid: null, remember: null, now: NOW }).action === 'none')
ok('user with NO remember flag -> sign out (also what an old always-signed-in session becomes)', decideStartup({ uid: 'u1', remember: null, now: NOW }).action === 'signout')
ok('remembered, same user, fresh -> keep', decideStartup({ uid: 'u1', remember: { uid: 'u1', at: NOW - DAY }, now: NOW }).action === 'keep')
ok('flag belongs to a DIFFERENT user -> sign out', decideStartup({ uid: 'u2', remember: { uid: 'u1', at: NOW }, now: NOW }).action === 'signout')
ok('29 days old -> keep', decideStartup({ uid: 'u1', remember: { uid: 'u1', at: NOW - 29 * DAY }, now: NOW }).action === 'keep')
const exp = decideStartup({ uid: 'u1', remember: { uid: 'u1', at: NOW - 31 * DAY }, now: NOW })
ok('31 days old -> sign out, reason expired', exp.action === 'signout' && exp.reason === 'expired')
ok('exactly at the limit is still valid', decideStartup({ uid: 'u1', remember: { uid: 'u1', at: NOW - MAX_REMEMBER_MS }, now: NOW }).action === 'keep')

console.log('remember flag storage')
const ls = fakeStorage()
ok('nothing stored -> null', readRemember(ls) === null)
writeRemember('u1', NOW, ls); ok('write then read round-trips', JSON.stringify(readRemember(ls)) === JSON.stringify({ uid: 'u1', at: NOW }))
ok('the flag holds ONLY uid and time (never a password or token)', Object.keys(JSON.parse(ls.getItem(REMEMBER_KEY))).sort().join() === 'at,uid')
clearRemember(ls); ok('clear removes it', readRemember(ls) === null)
ls.setItem(REMEMBER_KEY, '{not json'); ok('corrupt value -> null, no throw', readRemember(ls) === null)
ls.setItem(REMEMBER_KEY, JSON.stringify({ uid: '', at: 5 })); ok('empty uid -> null', readRemember(ls) === null)
ls.setItem(REMEMBER_KEY, JSON.stringify({ uid: 'u1', at: 'x' })); ok('non-numeric time -> null', readRemember(ls) === null)
ok('storage that throws does not crash', (() => { try { writeRemember('u', 1, { setItem() { throw new Error('full') } }); clearRemember({ removeItem() { throw new Error('x') } }); return readRemember({ getItem() { throw new Error('x') } }) === null } catch { return false } })())

console.log('fresh start vs reload')
const ss = fakeStorage()
ok('no marker -> fresh start', isFreshStart(ss) === true)
markRunStarted(NOW, ss); ok('marker present -> a reload, not a start', isFreshStart(ss) === false)
const ss2 = fakeStorage(); ok('after a restart sessionStorage is empty -> fresh again', isFreshStart(ss2) === true)

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
