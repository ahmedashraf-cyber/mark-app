/**
 * eventHighlight.js — which events sit at the video's current moment?
 * ============================================================================
 * Pure. The events array is already sorted by videoTimeSec (FieldPage keeps it
 * that way), so a binary search finds the neighbourhood in O(log n) and only
 * the handful of events inside the window are visited. FieldPage calls this at
 * most ~10 times a second and only commits state when the answer changes, so
 * playback never re-renders the events bar just because time passed.
 */

/** Events within this many seconds either side of the playhead are highlighted. */
export const EVENT_HIGHLIGHT_TOLERANCE_S = 0.5

/** First index whose videoTimeSec >= t (events sorted ascending). */
export function lowerBound(events, t) {
  let lo = 0, hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((events[mid].videoTimeSec || 0) < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Every event inside [t - tol, t + tol], plus which one is nearest (the one the
 * bar scrolls to). Several overlapping events are all returned.
 * Returns { ids: string[], nearestId: string|null }.
 */
export function findAtTime(events, t, tol = EVENT_HIGHLIGHT_TOLERANCE_S) {
  if (!events || !events.length || !isFinite(t)) return { ids: [], nearestId: null }
  let i = lowerBound(events, t - tol)
  const ids = []
  let nearestId = null, best = Infinity
  for (; i < events.length; i++) {
    const et = events[i].videoTimeSec || 0
    if (et > t + tol) break
    ids.push(events[i].id)
    const d = Math.abs(et - t)
    if (d < best) { best = d; nearestId = events[i].id }
  }
  return { ids, nearestId }
}

/** How many events are at or before t — the bar dims everything after it. */
export function pastCountAt(events, t) {
  if (!events || !events.length) return 0
  // upper bound: first index with videoTimeSec > t
  let lo = 0, hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((events[mid].videoTimeSec || 0) <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}
