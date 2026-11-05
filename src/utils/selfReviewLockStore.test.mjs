// The real lock store (selfReviewLockStore.js) against an in-memory Firestore: serialised transactions, Timestamp-like values.
import { makeLockStore } from './selfReviewLockStore.js'
import { saveHalf } from './selfReviewSave.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 240) + ']' : ''}`) }
const J = JSON.stringify
let CLOCK = 1_800_000_000_000
const TS = ms => ({ toMillis: () => ms, __ts: true })
const SERVER = { __server: true }

function fakeFirestore() {
  const docs = new Map(); let chain = Promise.resolve(); const log = []
  const ref = (db, col, id) => ({ path: `${col}/${id}` })
  const stamp = v => (v && v.__server ? TS(CLOCK) : v)
  const stampAll = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, stamp(v)]))
  const fs = {
    doc: ref, serverTimestamp: () => SERVER,
    getDoc: async r => { await Promise.resolve(); return { exists: () => docs.has(r.path), data: () => ({ ...docs.get(r.path) }) } },
    updateDoc: async (r, patch) => { log.push(['update', r.path]); if (!docs.has(r.path)) throw new Error('no document'); docs.set(r.path, { ...docs.get(r.path), ...stampAll(patch) }) },
    runTransaction: (_db, fn) => { const run = chain.then(async () => { const writes = []; const tx = { get: async r => ({ exists: () => docs.has(r.path), data: () => ({ ...docs.get(r.path) }) }), set: (r, d) => writes.push([r.path, stampAll(d)]) }; await fn(tx); for (const [p, d] of writes) docs.set(p, d); log.push(['tx', writes.length]) }); chain = run.catch(() => {}); return run },
  }
  return { fs, docs, log }
}
const ID = 'T-001_1000001_1H', COL = 'mark_self_review_locks'
const mk = () => { const f = fakeFirestore(); return { ...f, store: makeLockStore(f.fs, {}, COL) } }

console.log('create')
{
  const { store, docs } = mk()
  ok('get on a missing lock is null', await store.get(ID) === null)
  await store.create(ID, { hr_code: 'T-001', match_id: '1000001', half: '1H', status: 'pending', run_id: 'R1', attempts: 1 })
  const d = await store.get(ID)
  ok('create writes the lock with server timestamps, saved_at null, and get returns the times as milliseconds', d.status === 'pending' && d.run_id === 'R1' && d.created_ms === CLOCK && d.updated_ms === CLOCK && d.saved_at === null)
  let code = null; try { await store.create(ID, { status: 'pending', run_id: 'R2' }) } catch (e) { code = e.code }
  ok('a second create fails with code "exists" and does not overwrite', code === 'exists' && docs.get(`${COL}/${ID}`).run_id === 'R1')
  const both = mk(); const res = await Promise.allSettled([both.store.create(ID, { status: 'pending', run_id: 'A' }), both.store.create(ID, { status: 'pending', run_id: 'B' })])
  ok('two creates at the same moment: exactly one wins', res.filter(r => r.status === 'fulfilled').length === 1 && res.filter(r => r.status === 'rejected' && r.reason.code === 'exists').length === 1)
}
console.log('takeOver')
{
  const { store, docs } = mk()
  CLOCK = 1_800_000_000_000
  await store.create(ID, { hr_code: 'T-001', status: 'pending', run_id: 'R1', attempts: 1 })
  await store.update(ID, { status: 'failed', error: 'boom' })
  CLOCK += 600_000
  await store.takeOver(ID, { status: 'failed', run_id: 'R1' }, { hr_code: 'T-001', status: 'pending', run_id: 'R2', attempts: 2, previous_status: 'failed', previous_run_id: 'R1', previous_error: 'boom' })
  const d = await store.get(ID)
  ok('takeOver replaces the lock with the new attempt and keeps the first attempt\'s created_at', d.run_id === 'R2' && d.status === 'pending' && d.attempts === 2 && d.created_ms === 1_800_000_000_000 && d.updated_ms === CLOCK, J(d))
  ok('...records the previous status, run id and error, and a takeover time; the old "error" field is gone', d.previous_status === 'failed' && d.previous_run_id === 'R1' && d.previous_error === 'boom' && d.taken_over_at && !('error' in docs.get(`${COL}/${ID}`)))
  let code = null; try { await store.takeOver(ID, { status: 'failed', run_id: 'R1' }, { status: 'pending', run_id: 'R3' }) } catch (e) { code = e.code }
  ok('takeOver is REFUSED ("changed") when the lock is no longer what the caller looked at', code === 'changed' && (await store.get(ID)).run_id === 'R2')
  const m = mk(); await m.store.takeOver(ID, { status: 'failed', run_id: 'X' }, { status: 'pending', run_id: 'N' })
  ok('takeOver of a lock that has vanished simply creates it', (await m.store.get(ID)).run_id === 'N')
  const race = mk(); await race.store.create(ID, { status: 'failed', run_id: 'R1' })
  const r = await Promise.allSettled([1, 2].map(i => race.store.takeOver(ID, { status: 'failed', run_id: 'R1' }, { status: 'pending', run_id: `W${i}` })))
  ok('two takeovers of the same orphan at once: exactly one wins, the other gets "changed"', r.filter(x => x.status === 'fulfilled').length === 1 && r.filter(x => x.status === 'rejected' && x.reason.code === 'changed').length === 1)
}
console.log('update')
{
  const { store } = mk(); await store.create(ID, { status: 'pending', run_id: 'R1' }); CLOCK += 1000
  await store.update(ID, { status: 'saved' })
  const d = await store.get(ID)
  ok('update patches the fields and refreshes updated_at', d.status === 'saved' && d.run_id === 'R1' && d.updated_ms === CLOCK)
  let msg = ''; try { await mk().store.update(ID, { status: 'saved' }) } catch (e) { msg = e.message }
  ok('update of a missing lock throws (the caller treats the lock as best effort)', /no document/.test(msg))
}
console.log('timestamps')
{
  const { store, docs } = mk()
  docs.set(`${COL}/${ID}`, { status: 'pending', run_id: 'OLD', created_at: TS(5000) })
  const d = await store.get(ID)
  ok('a lock written by v7.12.8 (created_at only, no updated_at) reads back with created_ms and a null updated_ms', d.created_ms === 5000 && d.updated_ms === null)
  docs.set(`${COL}/${ID}`, { status: 'pending', run_id: 'OLD', created_at: null })
  ok('a lock with no usable time reads back with null times (the save logic treats that as stale)', (await store.get(ID)).created_ms === null)
}
console.log('end to end: the real store under the real save logic')
{
  const { store, docs } = mk(); CLOCK = 1_800_000_000_000
  docs.set(`${COL}/${ID}`, { hr_code: 'T-001', match_id: '1000001', half: '1H', status: 'failed', run_id: 'R0', error: 'Unexpected token <', created_at: TS(CLOCK - 3_600_000) })
  const rows = []
  const sheet = { readHalfState: async () => ({ runs: rows.length ? [{ runId: rows[0][0], savedAt: 'x' }] : [] }), verifyHeader: async () => {}, appendRows: async r => { rows.push(...r) } }
  const out = await saveHalf({ lockStore: store, sheet, now: () => CLOCK }, { hrCode: 'T-001', matchId: '1000001', half: '1H', buildRows: (id, at) => [[id, at], [id, at]] })
  const d = docs.get(`${COL}/${ID}`)
  ok('a "failed" lock written like the real one is taken over and the half saved once; the Firestore document ends "saved" with the story kept', out.outcome === 'saved' && rows.length === 2 && d.status === 'saved' && d.previous_status === 'failed' && d.previous_error === 'Unexpected token <' && d.attempts === 2, J([out.outcome, d]))
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
