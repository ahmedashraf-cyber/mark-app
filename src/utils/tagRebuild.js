/**
 * tagRebuild.js: rebuild Tag's in-memory collection state from a list of SAVED events.
 * ============================================================================
 * PURE. Used when a saved half is reopened. A live Tag session builds this state one event at a time as keys are
 * pressed; a reopened one has only the events, so the state is rebuilt from them:
 *
 *   nextSeq      the highest saved event_seq. FieldPage sets its counter to it and adds 1 per new event, so a new event
 *                never reuses a saved number (and so a pair_id, which is built from the opener's event_seq, never collides)
 *   openPairs    { openerEventId: { pairId, openVideoTimeMs, eventSeq, docId } }  an opener (shot, stoppage, pressure start)
 *                with no closer yet, so the closer can still be tagged and inherit its pair_id and duration
 *   openStates   { openerEventId: { team, videoTimeSec } }  the "something is open" badge and the team a closer inherits
 *   possession   replayed through the REAL applyFlip, in event_seq order
 *
 * What is NOT trusted: the stored pair_status. The opener's 'complete' is written best-effort after the closer commits and
 * can have failed, so a stale 'incomplete' on a pair that WAS closed would resurrect a pair that is not open. Open pairs
 * are found from the events themselves: an opener with no later closer.
 *
 * What is derived elsewhere and needs nothing here: the possession phase and "my team" are computed from the events on
 * every render (FieldPage's `chain` and `mineTeam`).
 */
import { EVENT_BY_ID, applyFlip as realApplyFlip } from './fieldExtras'

const seqOf = e => { const n = Number(e?.event_seq); return Number.isFinite(n) ? n : 0 }
const msOf  = e => e?.video_time_ms != null ? Number(e.video_time_ms) : Math.round(Number(e?.videoTimeSec || 0) * 1000)

/** Commit order: event_seq, then video time, then id, so the result never depends on the order the events arrived in. */
export const inCommitOrder = events => [...(events || [])].sort((a, b) =>
  seqOf(a) - seqOf(b) || msOf(a) - msOf(b) || String(a?.id).localeCompare(String(b?.id)))

export function rebuildFromEvents(events, { eventById = EVENT_BY_ID, applyFlip = realApplyFlip } = {}) {
  const ordered = inCommitOrder(events)
  let maxSeq = 0
  const open = new Map()                      // opener event id -> the opener event
  let possession = { team: null, certain: false }

  for (const e of ordered) {
    maxSeq = Math.max(maxSeq, seqOf(e))
    const def = eventById[e.eventId]
    if (def?.openState) open.set(def.id, e)                // the newest opener of a kind replaces an older unclosed one,
    if (def?.closesEventId) open.delete(def.closesEventId) // exactly as the live commit does with openPairsRef
    // possession: the same two lines commitEvent runs after building each event
    const next = applyFlip(e.eventId, e, possession)
    possession = (e.eventId === 'half_start' && e.team) ? { team: null, certain: false } : next
  }

  const openPairs = {}, openStates = {}
  for (const [id, e] of open) {
    openPairs[id]  = {
      pairId: e.pair_id || `${String(e.sessionId || '').slice(0, 8)}_${seqOf(e)}`,
      openVideoTimeMs: msOf(e), eventSeq: seqOf(e), docId: e.id,
    }
    openStates[id] = { team: e.team || null, videoTimeSec: Number(e.videoTimeSec ?? msOf(e) / 1000) }
  }
  return { nextSeq: maxSeq, openPairs, openStates, possession }
}
