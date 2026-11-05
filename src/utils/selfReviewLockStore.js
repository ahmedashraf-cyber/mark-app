/**
 * selfReviewLockStore.js: the Firestore side of the Self-Review save lock (mark_self_review_locks/<HR>_<match>_<half>).
 * ============================================================================
 * The Firestore functions are PASSED IN (fs), so this is tested against an in-memory fake with real transaction behaviour.
 * Three guarantees:
 *   create   : fails with code 'exists' if the lock is already there (two sessions cannot both create it)
 *   takeOver : replaces a lock ONLY if it is still exactly what the caller looked at (same status and run_id); otherwise
 *              code 'changed', and the caller looks again. Two sessions cannot both take over the same orphan.
 *   update   : a plain patch (status saved / failed), best effort for the caller
 * Times come back as milliseconds (created_ms, updated_ms) so staleness can be judged without Firestore types.
 */
const toMs = t => (t == null ? null : typeof t === 'number' ? t : typeof t.toMillis === 'function' ? t.toMillis() : null)

export function makeLockStore(fs, db, collection) {
  const ref = id => fs.doc(db, collection, id)
  const withMs = d => ({ ...d, created_ms: toMs(d.created_at), updated_ms: toMs(d.updated_at) })
  const err = (code, message) => Object.assign(new Error(message), { code })
  return {
    async get(id) {
      const snap = await fs.getDoc(ref(id))
      return snap.exists() ? withMs(snap.data()) : null
    },
    async create(id, data) {
      await fs.runTransaction(db, async tx => {
        const snap = await tx.get(ref(id))
        if (snap.exists()) throw err('exists', 'lock exists')
        tx.set(ref(id), { ...data, created_at: fs.serverTimestamp(), updated_at: fs.serverTimestamp(), saved_at: null })
      })
    },
    async takeOver(id, expected, data) {
      await fs.runTransaction(db, async tx => {
        const snap = await tx.get(ref(id))
        if (!snap.exists()) { tx.set(ref(id), { ...data, created_at: fs.serverTimestamp(), updated_at: fs.serverTimestamp(), saved_at: null }); return }
        const d = snap.data()
        if (d.status !== expected.status || (d.run_id ?? null) !== (expected.run_id ?? null)) throw err('changed', 'lock changed')
        // a fresh document for the new attempt; the first attempt's created_at is kept, the previous outcome is recorded in data
        tx.set(ref(id), { ...data, created_at: d.created_at ?? fs.serverTimestamp(), updated_at: fs.serverTimestamp(), taken_over_at: fs.serverTimestamp(), saved_at: null })
      })
    },
    async update(id, patch) {
      await fs.updateDoc(ref(id), { ...patch, updated_at: fs.serverTimestamp() })
    },
  }
}
