// The Self-Review save and its lock. An in-memory lock store with real transaction behaviour, and a fake sheet whose strict read,
// header check and append can each be made to fail. SYNTHETIC ids only.
import { saveHalf, retryPending, STALE_PENDING_MS } from './selfReviewSave.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 260) + ']' : ''}`) }
const J = JSON.stringify
const HR = 'T-001', MATCH = '1000001', HALF = '1H', LOCK_ID = `${HR}_${MATCH}_${HALF}`
const clock = { t: 1_800_000_000_000 }
const now = () => clock.t
const tick = () => Promise.resolve()

// ---- fake lock store: documents in a Map; create / takeOver are serialised like Firestore transactions ----
function makeStore(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, { ...v }]))
  const calls = []
  let chain = Promise.resolve()
  const tx = fn => { const run = chain.then(fn); chain = run.catch(() => {}); return run }
  const err = (code, m) => Object.assign(new Error(m), { code })
  const withMs = d => ({ ...d, created_ms: d.created_ms ?? null, updated_ms: d.updated_ms ?? null })
  const store = {
    docs, calls, failUpdate: null, failGet: false,
    async get(id) { calls.push(['get', id]); await tick(); if (store.failGet) throw new Error('firestore offline'); return docs.has(id) ? withMs(docs.get(id)) : null },
    create(id, data) { calls.push(['create', id]); return tx(async () => { await tick(); if (docs.has(id)) throw err('exists', 'lock exists'); docs.set(id, { ...data, created_ms: now(), updated_ms: now() }) }) },
    takeOver(id, expected, data) { calls.push(['takeOver', id, expected]); return tx(async () => { await tick(); const d = docs.get(id)
      if (!d) { docs.set(id, { ...data, created_ms: now(), updated_ms: now() }); return }
      if (d.status !== expected.status || (d.run_id ?? null) !== (expected.run_id ?? null)) throw err('changed', 'lock changed')
      docs.set(id, { ...data, created_ms: d.created_ms, updated_ms: now(), taken_over: true }) }) },
    async update(id, patch) { calls.push(['update', id, patch.status]); await tick(); if (store.failUpdate && store.failUpdate(patch)) throw new Error('lock update failed'); docs.set(id, { ...docs.get(id), ...patch, updated_ms: now() }) },
  }
  return store
}
// ---- fake sheet: rows is the tab's content as [runId, hr, match, half, savedAt] ----
function makeSheet(rows = []) {
  const sh = { rows: rows.map(r => [...r]), calls: [], readFail: null, appendFail: null, loseReply: false, headerFail: null }
  sh.readHalfState = async (hr, match, half) => { sh.calls.push('read'); await tick()
    if (sh.readFail) throw new Error(sh.readFail)
    const runs = new Map(); for (const r of sh.rows) if (r[1] === hr && r[2] === match && r[3] === half && !runs.has(r[0])) runs.set(r[0], r[4])
    return { rowsRead: sh.rows.length, runs: [...runs].map(([runId, savedAt]) => ({ runId, savedAt })) } }
  sh.verifyHeader = async () => { sh.calls.push('header'); await tick(); if (sh.headerFail) throw new Error(sh.headerFail) }
  sh.appendRows = async rows => { sh.calls.push('append'); await tick()
    if (sh.appendFail && !sh.loseReply) throw new Error(sh.appendFail)
    for (const r of rows) sh.rows.push([r[0], r[2], r[3], r[4], r[1]])
    if (sh.appendFail && sh.loseReply) throw new Error(sh.appendFail) }                 // written, but the answer never arrived
  return sh
}
const buildRows = (n = 3) => (runId, savedAt) => Array.from({ length: n }, () => [runId, savedAt, HR, MATCH, HALF])
const runSave = (store, sheet, o = {}) => saveHalf({ lockStore: store, sheet, now }, { hrCode: HR, matchId: MATCH, half: HALF, buildRows: buildRows(o.n ?? 3) })
const appends = sh => sh.calls.filter(c => c === 'append').length
const rowsFor = sh => sh.rows.filter(r => r[1] === HR && r[2] === MATCH && r[3] === HALF)
const lockOf = st => st.docs.get(LOCK_ID)
const OLD = clock.t - 60 * 60 * 1000

console.log('a normal save')
{
  const st = makeStore(), sh = makeSheet()
  const r = await runSave(st, sh)
  ok('no lock: saved, 3 rows appended once, lock created pending then marked saved', r.outcome === 'saved' && r.count === 3 && appends(sh) === 1 && rowsFor(sh).length === 3 && lockOf(st).status === 'saved' && lockOf(st).run_id === r.runId && lockOf(st).attempts === 1, J([r.outcome, lockOf(st)]))
  ok('the rows carry the lock\'s run id', rowsFor(sh).every(x => x[0] === r.runId))
  ok('a second save of the same half is "already saved" and appends nothing', (await runSave(st, sh)).outcome === 'already_saved' && appends(sh) === 1 && rowsFor(sh).length === 3)
}

console.log('\nYOUR CASE: the first save failed, the lock is "failed", the tab has no rows')
{
  const st = makeStore({ [LOCK_ID]: { hr_code: HR, match_id: MATCH, half: HALF, status: 'failed', run_id: 'OLDRUN', error: 'Unexpected token <', attempts: 1, created_ms: OLD, updated_ms: OLD } }), sh = makeSheet()
  const r = await runSave(st, sh)
  ok('the lock is TAKEN OVER and the half is saved: no more "already saved by another session"', r.outcome === 'saved' && r.tookOver === 'failed' && rowsFor(sh).length === 3 && appends(sh) === 1, J(r))
  ok('the lock now carries the new run id, attempts 2, and the previous outcome (status, run id, error text) for the record', lockOf(st).status === 'saved' && lockOf(st).run_id !== 'OLDRUN' && lockOf(st).attempts === 2 && lockOf(st).previous_status === 'failed' && lockOf(st).previous_run_id === 'OLDRUN' && lockOf(st).previous_error === 'Unexpected token <', J(lockOf(st)))
  ok('the rows use the NEW run id, not the failed one', rowsFor(sh).every(x => x[0] === r.runId && x[0] !== 'OLDRUN'))
}
console.log('\nTHE 7.12.99 TEST LOCK: "saved", but its rows went to a copy, so the real tab has none')
{
  const st = makeStore({ [LOCK_ID]: { status: 'saved', run_id: 'COPYRUN', attempts: 1, created_ms: OLD, updated_ms: OLD, saved_at: 'x' } }), sh = makeSheet()
  const r = await runSave(st, sh)
  ok('a "saved" lock with NO rows behind it does not block: taken over, saved once', r.outcome === 'saved' && r.tookOver === 'saved' && rowsFor(sh).length === 3 && lockOf(st).previous_status === 'saved')
}
console.log('\na lock WITH rows behind it still blocks (it is protecting something)')
{
  const st = makeStore({ [LOCK_ID]: { status: 'saved', run_id: 'REAL', attempts: 1, created_ms: OLD, updated_ms: OLD } }), sh = makeSheet([['REAL', HR, MATCH, HALF, '2026-10-20T10:00:00.000Z']])
  const before = J(lockOf(st)); const r = await runSave(st, sh)
  ok('saved lock + rows: already saved, nothing appended, lock untouched, no takeover', r.outcome === 'already_saved' && !r.repaired && appends(sh) === 0 && J(lockOf(st)) === before && !st.calls.some(c => c[0] === 'takeOver'))
}
{
  const st = makeStore({ [LOCK_ID]: { status: 'failed', run_id: 'LOST', error: 'timeout', attempts: 1, created_ms: OLD, updated_ms: OLD } }), sh = makeSheet([1, 2, 3].map(() => ['LOST', HR, MATCH, HALF, '2026-10-20T10:00:00.000Z']))
  const r = await runSave(st, sh)
  ok('"failed" lock but the rows ARE there (the append reached the sheet, the reply was lost): already saved, lock REPAIRED to saved, and NOTHING appended', r.outcome === 'already_saved' && r.repaired && lockOf(st).status === 'saved' && lockOf(st).run_id === 'LOST' && lockOf(st).repaired_from === 'failed' && appends(sh) === 0 && rowsFor(sh).length === 3)
}
{
  const st = makeStore({ [LOCK_ID]: { status: 'pending', run_id: 'P', created_ms: clock.t - 10_000, updated_ms: clock.t - 10_000 } }), sh = makeSheet([['P', HR, MATCH, HALF, '2026-10-20T10:00:00.000Z']])
  const r = await runSave(st, sh)
  ok('"pending" lock with rows (the save worked, only the final lock update was lost): repaired, nothing appended', r.outcome === 'already_saved' && r.repaired && lockOf(st).status === 'saved' && appends(sh) === 0)
}
{
  const st = makeStore({ [LOCK_ID]: { status: 'failed', run_id: 'F', created_ms: OLD, updated_ms: OLD } }), sh = makeSheet([['OTHER-HALF', HR, MATCH, '2H', 'x'], ['OTHER-HR', 'T-002', MATCH, HALF, 'x'], ['OTHER-MATCH', HR, '999', HALF, 'x']])
  ok('rows for ANOTHER half, collector or match do not count as this half being saved: takeover allowed', (await runSave(st, sh)).outcome === 'saved' && rowsFor(sh).length === 3)
}

console.log('\npending locks: fresh ones are respected, stale ones are not')
{
  const mk = ms => makeStore({ [LOCK_ID]: { status: 'pending', run_id: 'P', created_ms: ms, updated_ms: ms } })
  let st = mk(clock.t - 60_000), sh = makeSheet(); let r = await runSave(st, sh)
  ok('a pending lock 1 minute old with no rows: IN PROGRESS (another save may be mid-flight): no takeover, no append, lock untouched', r.outcome === 'in_progress' && appends(sh) === 0 && !st.calls.some(c => c[0] === 'takeOver') && lockOf(st).run_id === 'P')
  st = mk(clock.t - (STALE_PENDING_MS - 1)); sh = makeSheet(); r = await runSave(st, sh)
  ok('one millisecond inside 5 minutes: still in progress', r.outcome === 'in_progress')
  st = mk(clock.t - STALE_PENDING_MS); sh = makeSheet(); r = await runSave(st, sh)
  ok('exactly 5 minutes: stale, taken over, saved', r.outcome === 'saved' && r.tookOver === 'pending' && rowsFor(sh).length === 3)
  st = mk(clock.t - 3 * 60 * 60 * 1000); sh = makeSheet(); r = await runSave(st, sh)
  ok('3 hours old: taken over', r.outcome === 'saved')
  st = makeStore({ [LOCK_ID]: { status: 'pending', run_id: 'P' } }); sh = makeSheet(); r = await runSave(st, sh)
  ok('a pending lock with no readable time at all is treated as stale (the sheet already proved there are no rows)', r.outcome === 'saved')
}

console.log('\nTHE CONDITION: a takeover needs a clean full read. No clean read = no takeover, no append, the lock untouched, the error shown')
{
  const reads = [
    ['a read error (network)', 'Could not reach Google Sheets while reading the "Collector Self Review" tab of spreadsheet 1l3tYw…oTec: offline'],
    ['a timeout', 'Google Sheets did not answer within 30 s while reading the "Collector Self Review" tab of spreadsheet 1l3tYw…oTec'],
    ['a non-200 answer', 'Google Sheets answered HTTP 403 Forbidden while reading the "Collector Self Review" tab of spreadsheet 1l3tYw…oTec: The caller does not have permission'],
    ['a reply that is not JSON', 'Google Sheets answered HTTP 200 while reading the "Collector Self Review" tab of spreadsheet 1l3tYw…oTec, but the reply was not JSON: <html>'],
    ['a header mismatch', 'The "Collector Self Review" tab\'s header row is not the one Self-Review writes (19 columns, or the older 17), so it cannot be checked safely.'],
  ]
  for (const status of ['failed', 'saved', 'pending']) {
    for (const [what, msg] of reads) {
      const st = makeStore({ [LOCK_ID]: { status, run_id: 'X', error: 'e', attempts: 1, created_ms: OLD, updated_ms: OLD } }), sh = makeSheet(); sh.readFail = msg
      const before = J(lockOf(st)); const r = await runSave(st, sh)
      ok(`${status} lock, ${what}: BLOCKED with the error; no takeover, no append, no header write, lock unchanged`,
        r.outcome === 'blocked' && r.error.message === msg && !st.calls.some(c => c[0] === 'takeOver' || c[0] === 'create' || c[0] === 'update') && appends(sh) === 0 && !sh.calls.includes('header') && J(lockOf(st)) === before && sh.rows.length === 0, J([r.outcome, st.calls.map(c => c[0])]))
    }
  }
  const st = makeStore({ [LOCK_ID]: { status: 'failed', run_id: 'X', attempts: 1, created_ms: OLD, updated_ms: OLD } }), sh = makeSheet(); sh.readFail = 'down'
  await runSave(st, sh); sh.readFail = null
  const r = await runSave(st, sh)
  ok('...and once the sheet can be read again, the very next save takes over and succeeds', r.outcome === 'saved' && rowsFor(sh).length === 3)
}
{
  // no lock yet, and the sheet can be read for the lock decision but NOT right before the append
  const st = makeStore(), sh = makeSheet(); sh.readFail = 'Google Sheets did not answer within 30 s while reading'
  const r = await runSave(st, sh)
  ok('no lock + the last-moment read fails: NO append; the lock is marked failed with the error; the error is shown', r.outcome === 'failed' && appends(sh) === 0 && lockOf(st).status === 'failed' && /did not answer/.test(lockOf(st).error) && sh.rows.length === 0)
  sh.readFail = null
  const again = await runSave(st, sh)
  ok('...and the retry (clean read) takes the failed lock over and saves once', again.outcome === 'saved' && rowsFor(sh).length === 3 && appends(sh) === 1)
}

console.log('\nappend fails -> retry succeeds; append fails -> no duplicate rows')
{
  const st = makeStore(), sh = makeSheet(); sh.appendFail = 'Google Sheets answered HTTP 502 while appending to the "Collector Self Review" tab of spreadsheet 1l3tYw…oTec: Bad Gateway'
  const r1 = await runSave(st, sh)
  ok('the append is rejected: outcome failed, the full error kept in the lock, status failed, NO rows written', r1.outcome === 'failed' && /HTTP 502/.test(lockOf(st).error) && lockOf(st).status === 'failed' && sh.rows.length === 0)
  sh.appendFail = null
  const r2 = await runSave(st, sh)
  ok('RETRY SUCCEEDS: the half is saved, 3 rows, once', r2.outcome === 'saved' && rowsFor(sh).length === 3 && appends(sh) === 2 && lockOf(st).status === 'saved')
  ok('the lock remembers the failed first attempt', lockOf(st).previous_status === 'failed' && /HTTP 502/.test(lockOf(st).previous_error) && lockOf(st).attempts === 2)
  ok('NO DUPLICATE ROWS: exactly one run, three rows', new Set(rowsFor(sh).map(x => x[0])).size === 1 && rowsFor(sh).length === 3)
}
{
  const st = makeStore(), sh = makeSheet(); sh.appendFail = 'network dropped'; sh.loseReply = true
  const r1 = await runSave(st, sh)
  ok('the append REACHED the sheet but the answer was lost: the save is reported failed (we cannot know), the lock is "failed", the rows ARE there', r1.outcome === 'failed' && lockOf(st).status === 'failed' && rowsFor(sh).length === 3)
  sh.appendFail = null; sh.loseReply = false
  const r2 = await runSave(st, sh)
  ok('the retry finds those rows and appends NOTHING: already saved, lock repaired, still exactly 3 rows, one run', r2.outcome === 'already_saved' && r2.repaired && appends(sh) === 1 && rowsFor(sh).length === 3 && lockOf(st).status === 'saved')
  ok('...and pressing Save a third time changes nothing', (await runSave(st, sh)).outcome === 'already_saved' && rowsFor(sh).length === 3)
}
{
  const st = makeStore(), sh = makeSheet(); sh.headerFail = 'header check failed'
  const r = await runSave(st, sh)
  ok('the header check fails: nothing is appended, the lock is failed, and a retry after the header is fixed saves once', r.outcome === 'failed' && appends(sh) === 0 && (sh.headerFail = null, (await runSave(st, sh)).outcome === 'saved') && rowsFor(sh).length === 3)
}
{
  const st = makeStore(), sh = makeSheet(); sh.appendFail = 'boom'; st.failUpdate = p => p.status === 'failed'
  const r1 = await runSave(st, sh)
  ok('even the "mark failed" update fails (offline): the lock stays pending, and the person is told it failed', r1.outcome === 'failed' && lockOf(st).status === 'pending' && sh.rows.length === 0)
  sh.appendFail = null
  ok('a retry within 5 minutes is told "in progress" (no takeover, no append)', (await runSave(st, sh)).outcome === 'in_progress' && sh.rows.length === 0)
  clock.t += STALE_PENDING_MS + 1
  ok('after 5 minutes the stale pending lock self-heals: taken over, saved once', (await runSave(st, sh)).outcome === 'saved' && rowsFor(sh).length === 3)
}

console.log('\ntwo sessions at once')
{
  const st = makeStore({ [LOCK_ID]: { status: 'failed', run_id: 'F', attempts: 1, created_ms: OLD, updated_ms: OLD } }), sh = makeSheet()
  const [a, b] = await Promise.all([runSave(st, sh), runSave(st, sh)])
  const outs = [a.outcome, b.outcome].sort()
  ok('both try to take over the same orphan: exactly ONE saves, the other is told in progress or already saved; the half is in the sheet ONCE', outs.includes('saved') && !(a.outcome === 'saved' && b.outcome === 'saved') && new Set(rowsFor(sh).map(x => x[0])).size === 1 && rowsFor(sh).length === 3, J([a.outcome, b.outcome, rowsFor(sh).length]))
}
{
  const st = makeStore(), sh = makeSheet()
  const [a, b] = await Promise.all([runSave(st, sh), runSave(st, sh)])
  ok('both create the lock at the same moment: exactly one saves, three rows, one run', [a, b].filter(x => x.outcome === 'saved').length === 1 && rowsFor(sh).length === 3 && new Set(rowsFor(sh).map(x => x[0])).size === 1, J([a.outcome, b.outcome]))
}
{
  // the lock changes between our read and our takeover (someone else got there first)
  const st = makeStore({ [LOCK_ID]: { status: 'failed', run_id: 'F', attempts: 1, created_ms: OLD, updated_ms: OLD } }), sh = makeSheet()
  const realTake = st.takeOver; st.takeOver = async (id, exp, data) => { st.docs.set(id, { status: 'pending', run_id: 'THEIRS', created_ms: clock.t, updated_ms: clock.t }); return realTake(id, exp, data) }
  const r = await runSave(st, sh)
  ok('the lock was changed under us: our takeover is refused, we look again, see a fresh pending lock and stand down (no append)', r.outcome === 'in_progress' && appends(sh) === 0 && lockOf(st).run_id === 'THEIRS')
}

console.log('\nthe lock store itself failing')
{
  const st = makeStore(); st.failGet = true; const sh = makeSheet()
  const r = await runSave(st, sh)
  ok('if the lock cannot even be read: a lock error, no sheet read, no append', r.outcome === 'lock_error' && sh.calls.length === 0 && appends(sh) === 0)
}

console.log('\nRetry (for a lock the person was told "didn\'t finish" about)')
{
  const rt = (st, sh) => retryPending({ lockStore: st, sheet: sh, now }, { hrCode: HR, matchId: MATCH, half: HALF, buildRows: buildRows(3) })
  let st = makeStore({ [LOCK_ID]: { status: 'pending', run_id: 'KEEP', created_ms: clock.t, updated_ms: clock.t } }), sh = makeSheet()
  let r = await rt(st, sh)
  ok('pending lock, no rows: re-appends under the SAME run id, once, and marks saved', r.outcome === 'saved' && r.runId === 'KEEP' && rowsFor(sh).length === 3 && rowsFor(sh).every(x => x[0] === 'KEEP') && lockOf(st).status === 'saved')
  st = makeStore({ [LOCK_ID]: { status: 'pending', run_id: 'KEEP', created_ms: clock.t, updated_ms: clock.t } }); sh = makeSheet([['KEEP', HR, MATCH, HALF, 'x']])
  r = await rt(st, sh)
  ok('the rows are already there: repaired, nothing appended', r.outcome === 'already_saved' && r.repaired && appends(sh) === 0 && lockOf(st).status === 'saved')
  st = makeStore({ [LOCK_ID]: { status: 'pending', run_id: 'KEEP', created_ms: clock.t, updated_ms: clock.t } }); sh = makeSheet(); sh.readFail = 'offline'
  r = await rt(st, sh)
  ok('the sheet cannot be read: BLOCKED, nothing appended, lock unchanged', r.outcome === 'blocked' && appends(sh) === 0 && lockOf(st).status === 'pending' && lockOf(st).run_id === 'KEEP')
  r = await rt(makeStore(), makeSheet())
  ok('no lock at all: "no lock", nothing appended', r.outcome === 'no_lock')
  st = makeStore({ [LOCK_ID]: { status: 'pending', run_id: 'KEEP', created_ms: clock.t, updated_ms: clock.t } }); sh = makeSheet(); sh.appendFail = 'boom'
  r = await rt(st, sh)
  ok('append fails on retry: reported, lock failed, no rows', r.outcome === 'failed' && lockOf(st).status === 'failed' && sh.rows.length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
