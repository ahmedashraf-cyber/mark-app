/**
 * drillSession.js — an in-progress quiz attempt
 * ============================================================================
 * DRILL only.
 *
 * Persisted to localStorage after every clip so closing MARK mid-quiz does not
 * lose the attempt. Three things have to survive a restart:
 *
 *   the clip ORDER — shuffled once at start and stored. Re-shuffling on resume
 *   would show clips twice and skip others.
 *
 *   the elapsed TIME — stored as accumulated milliseconds rather than a start
 *   timestamp, because the timer pauses while MARK is closed. A start-time
 *   subtraction would silently consume the whole limit overnight.
 *
 *   the 24h WINDOW — measured from when the attempt began, not from the last
 *   save. Past it the attempt is void and counts as a failed attempt, so
 *   closing MARK cannot be used to park a quiz indefinitely.
 */
import { DRILL_LS_KEY, RESUME_WINDOW_MS, SESSION_STATUS, newId } from '../config/drillConfig'

/** Fisher-Yates. Order is generated ONCE and then persisted. */
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function createSession({ quiz, clips, trainee, attemptNumber = 1 }) {
  const order = shuffle(clips.map(c => Number(c.clip_index)))
  return {
    result_id: newId('res'),
    quiz_id: quiz.quiz_id,
    quiz_version: Number(quiz.quiz_version || 1),
    quiz_name: quiz.quiz_name,
    time_limit_min: Number(quiz.time_limit_min || 0),
    pass_mark_percent: Number(quiz.pass_mark_percent || 0),
    scope_event_ids: String(quiz.scope_event_ids || '').split('|').filter(Boolean),
    trainee_hr_code: trainee?.hrCode || '',
    trainee_email: trainee?.email || '',
    attempt_number: attemptNumber,
    started_at: Date.now(),         // for the 24h window
    elapsed_ms: 0,                  // accumulated; the timer pauses when closed
    order,                          // clip_index values, in the order to show
    position: 0,                    // how far through `order`
    tags: {},                       // clip_index -> [tagged events]
    clip_times: {},                 // clip_index -> ms spent on it
    status: SESSION_STATUS.IN_PROGRESS,
  }
}

export function saveSession(s) {
  try { localStorage.setItem(DRILL_LS_KEY, JSON.stringify(s)) } catch {}
}

export function clearSession() {
  try { localStorage.removeItem(DRILL_LS_KEY) } catch {}
}

/**
 * Load an in-progress attempt.
 * → { session } | { expired: session } | null
 * An expired attempt is returned rather than dropped, because it still has to
 * be recorded as a failed attempt instead of vanishing.
 */
export function loadSession() {
  let s
  try { s = JSON.parse(localStorage.getItem(DRILL_LS_KEY) || 'null') } catch { return null }
  if (!s || !s.result_id) return null
  if (Date.now() - Number(s.started_at || 0) > RESUME_WINDOW_MS) {
    return { expired: { ...s, status: SESSION_STATUS.VOID } }
  }
  return { session: s }
}

export function remainingMs(s) {
  const limit = Number(s.time_limit_min || 0) * 60_000
  if (!limit) return Infinity
  return Math.max(0, limit - Number(s.elapsed_ms || 0))
}

export function isOutOfTime(s) {
  return remainingMs(s) <= 0
}

/** clip_index values the trainee never reached. */
export function unreachedClipIndexes(s) {
  return s.order.slice(s.position)
}

/**
 * Shape the attempt for drillScoring.scoreAttempt.
 * Only clips the trainee actually reached appear in tagByClip — a clip they
 * never saw must not be credited as a correct "no event".
 */
export function toScoringInput(s, clipRows, keyRows) {
  const keyByClip = {}
  keyRows.forEach(r => {
    const ci = Number(r.clip_index)
    // Pass the RAW sheet row through. scoreClip reads answer_event_code,
    // answer_team, answer_video_time_ms and answer_attr_* itself.
    //
    // This used to rename them to event_code / video_time_ms / attrs here,
    // which meant scoreClip found undefined for every code and 0 for every
    // timestamp — so no key ever matched a trainee tag by code, everything
    // fell through to the wrong-event path, and delta_ms came out as the
    // trainee's raw time because it was measured against zero. Normalising in
    // two places is what caused it; now only scoreClip does it.
    ;(keyByClip[ci] = keyByClip[ci] || []).push(r)
  })

  const reached = new Set(s.order.slice(0, s.position))
  const tagByClip = {}
  Object.entries(s.tags || {}).forEach(([ci, evs]) => {
    if (!reached.has(Number(ci))) return
    tagByClip[Number(ci)] = evs
  })
  // a reached clip left deliberately empty must still be present, as an empty
  // array — that is how "no event" is distinguished from never reaching it
  reached.forEach(ci => { if (!tagByClip[ci]) tagByClip[ci] = [] })

  return { clips: clipRows, keyByClip, tagByClip }
}
