/**
 * savedHalfStore.js: Tag's own copy of a saved half (Firestore). READS ONLY.
 * The events of a saved half are loaded from Firestore (mark_collected_events), not from the sheet: the sheet row of an
 * event flattens its attributes and, for the goal-keeper Save variants, has already lost the body state. A save does not
 * delete these documents, so they are still there.
 */
import { db } from '../firebase/config'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { firestoreOwnerAllows } from './ownerMatch'
import { SavedHalfError } from './savedHalfSheet'

const byTime = (a, b) => (a.videoTimeSec || 0) - (b.videoTimeSec || 0)
const seqOf = e => Number(e?.event_seq) || 0

/** Firestore's event count per session, for the start-screen list. Best effort: a session that cannot be read has no entry. */
export async function fetchTotalEvents(sessionIds) {
  const out = new Map()
  await Promise.all(sessionIds.map(async id => {
    try { const s = await getDoc(doc(db, 'mark_field_sessions', id)); if (s.exists() && s.data().totalEvents != null) out.set(id, Number(s.data().totalEvents)) } catch { /* leave it out */ }
  }))
  return out
}

/**
 * → { fsDoc, events }.  Refuses (SavedHalfError) if Firestore's session record contradicts who is opening it, or if Firestore
 * holds no events for the session. The sheet row has ALREADY decided that this half is the person's (ownerMatch); this is a second
 * look at Firestore's own copy of the owner, and it follows the same order:
 *   - the record has a collectorEmail  -> it must equal the signed-in email (the HR-code is not consulted);
 *   - no email, and the sheet matched by HR-code (matchedBy 'hr') -> the record's collectorHrCode must match theirs;
 *   - no email, matched by email on the sheet row -> allowed (the record only carries the HR-code typed at the time).
 * identity: { email, hrCode } from the signed-in account.
 */
export async function loadSavedHalfData(sessionId, { identity, matchedBy }) {
  const [sd, ed] = await Promise.all([
    getDoc(doc(db, 'mark_field_sessions', sessionId)),
    getDocs(query(collection(db, 'mark_collected_events'), where('sessionId', '==', sessionId))),
  ])
  const fsDoc = sd.exists() ? sd.data() : null
  if (!firestoreOwnerAllows(fsDoc, identity, matchedBy)) throw new SavedHalfError('forbidden', 'This half belongs to another collector.')
  const events = ed.docs.map(d => ({ ...d.data(), _docId: d.id })).filter(e => e.sessionId === sessionId)
    .sort((a, b) => seqOf(a) - seqOf(b) || byTime(a, b))
  if (!events.length)
    throw new SavedHalfError('nocopy', 'MARK\'s own copy of this half\'s events was not found, so it cannot be reopened here. The half saved in the sheet is untouched.')
  return { fsDoc, events: events.sort(byTime) }
}
