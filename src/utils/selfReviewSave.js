/**
 * selfReviewSave.js: how a Self-Review result is saved, and how the save lock behaves. Pure orchestration: the lock store and the
 * sheet are passed in, so every branch is tested without Firebase or Google.
 * ============================================================================
 * THE LOCK PROTECTS ROWS, NOT ITSELF. A lock that has no rows behind it protects nothing and must never block a save.
 *
 *   no lock             -> create it (pending), read, append, mark saved.
 *   a lock exists       -> READ THE SHEET FIRST. Only a successful read may decide anything:
 *                            the request completed in time, HTTP 200, a JSON reply, the header exactly right, a FULL read (no row limit).
 *                            Any read error, timeout or header mismatch -> outcome 'blocked': NO takeover, NO append, the lock untouched,
 *                            the error shown.
 *                          then
 *        rows for this half exist   -> the half IS saved. A lock not marked 'saved' is repaired. Outcome 'already_saved'.
 *        no rows, status failed / saved / a pending lock older than STALE_PENDING_MS
 *                                   -> orphan: TAKE OVER (transaction; the lock must still be exactly what we read). Save.
 *        no rows, pending and fresh -> another save may be in flight: outcome 'in_progress' (Retry), no takeover.
 *   before EVERY append: read again (strict). If rows for the half have appeared, do not append. A failed read means no append.
 *   append fails -> the lock is marked 'failed' with the full error (best effort). Nothing was written, so a retry is allowed.
 *   the append reached the sheet but the answer was lost -> the retry finds the rows, repairs the lock, and appends NOTHING.
 */
export const STALE_PENDING_MS = 5 * 60 * 1000

const safely = async fn => { try { await fn() } catch { /* best effort: the sheet is the truth, the lock is only a guard */ } }
const earliest = runs => [...runs].sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)))[0]
/** Rows for this half exist, so the half IS saved: make the lock say so (best effort) and report it. */
async function repairLock(lockStore, lockId, lock, state, now) {
  const first = earliest(state.runs)
  const needs = !lock || lock.status !== 'saved'
  if (needs) await safely(() => lockStore.update(lockId, { status: 'saved', run_id: first.runId, saved_at: new Date(now()).toISOString(), repaired_from: lock ? lock.status : 'missing' }))
  return { outcome: 'already_saved', runId: first.runId, repaired: needs }
}

/**
 * deps: { lockStore, sheet: { readHalfState, verifyHeader, appendRows }, now?: () => ms }
 * -> { outcome: 'saved' | 'already_saved' | 'in_progress' | 'blocked' | 'failed' | 'lock_error', ... }
 */
export async function saveHalf({ lockStore, sheet, now = () => Date.now() }, { hrCode, matchId, half, buildRows }) {
  const lockId = `${hrCode}_${matchId}_${half}`
  const newRun = () => { const ms = now(); return { runId: `${hrCode}_${matchId}_${half}_${ms}`, savedAt: new Date(ms).toISOString() } }
  const base = { hr_code: hrCode, match_id: matchId, half }

  let lock
  try { lock = await lockStore.get(lockId) } catch (error) { return { outcome: 'lock_error', error } }

  let run = null, tookOver = null
  for (let pass = 0; pass < 3 && !run; pass++) {
    if (lock) {
      let state
      try { state = await sheet.readHalfState(hrCode, matchId, half) }
      catch (error) { return { outcome: 'blocked', error } }                       // THE CONDITION: no clean read, no decision
      if (state.runs.length) return repairLock(lockStore, lockId, lock, state, now)
      const stamp = lock.updated_ms ?? lock.created_ms
      const age = stamp == null ? Infinity : now() - stamp
      if (lock.status === 'pending' && age < STALE_PENDING_MS) return { outcome: 'in_progress', lock }
      const next = newRun()
      try {
        await lockStore.takeOver(lockId, { status: lock.status, run_id: lock.run_id }, {
          ...base, status: 'pending', run_id: next.runId, attempts: (lock.attempts || 1) + 1,
          previous_status: lock.status, previous_run_id: lock.run_id ?? null, previous_error: lock.error ?? null,
        })
        run = next; tookOver = lock.status
      } catch (error) {
        if (error && error.code === 'changed') { try { lock = await lockStore.get(lockId) } catch (e) { return { outcome: 'lock_error', error: e } } continue }
        return { outcome: 'lock_error', error }
      }
    } else {
      const next = newRun()
      try { await lockStore.create(lockId, { ...base, status: 'pending', run_id: next.runId, attempts: 1 }); run = next }
      catch (error) {
        if (error && error.code === 'exists') { try { lock = await lockStore.get(lockId) } catch (e) { return { outcome: 'lock_error', error: e } } continue }
        return { outcome: 'lock_error', error }
      }
    }
  }
  if (!run) return { outcome: 'in_progress', lock }

  const rows = buildRows(run.runId, run.savedAt)
  try {
    const state = await sheet.readHalfState(hrCode, matchId, half)                 // last look before writing: strict, again
    if (state.runs.length) return repairLock(lockStore, lockId, { status: 'pending' }, state, now)
    await sheet.verifyHeader()
    await sheet.appendRows(rows)
  } catch (error) {
    await safely(() => lockStore.update(lockId, { status: 'failed', error: String(error && error.message || error), failed_at: new Date(now()).toISOString() }))
    return { outcome: 'failed', error, runId: run.runId, tookOver }
  }
  await safely(() => lockStore.update(lockId, { status: 'saved', saved_at: new Date(now()).toISOString() }))
  return { outcome: 'saved', runId: run.runId, savedAt: run.savedAt, count: rows.length, tookOver }
}

/**
 * Retry for a lock the person was told "didn't finish" about. Same rules: a strict read decides; no read, no append.
 * -> { outcome: 'saved' | 'already_saved' | 'no_lock' | 'blocked' | 'failed' | 'lock_error' }
 */
export async function retryPending({ lockStore, sheet, now = () => Date.now() }, { hrCode, matchId, half, buildRows }) {
  const lockId = `${hrCode}_${matchId}_${half}`
  let lock
  try { lock = await lockStore.get(lockId) } catch (error) { return { outcome: 'lock_error', error } }
  if (!lock) return { outcome: 'no_lock' }
  let state
  try { state = await sheet.readHalfState(hrCode, matchId, half) } catch (error) { return { outcome: 'blocked', error } }
  if (state.runs.length) return repairLock(lockStore, lockId, lock, state, now)
  const ms = now()
  const runId = lock.run_id || `${hrCode}_${matchId}_${half}_${ms}`
  const savedAt = new Date(ms).toISOString()
  try {
    await sheet.verifyHeader()
    await sheet.appendRows(buildRows(runId, savedAt))
  } catch (error) {
    await safely(() => lockStore.update(lockId, { status: 'failed', error: String(error && error.message || error), failed_at: new Date(now()).toISOString() }))
    return { outcome: 'failed', error, runId }
  }
  await safely(() => lockStore.update(lockId, { status: 'saved', saved_at: new Date(now()).toISOString() }))
  return { outcome: 'saved', runId, savedAt }
}
