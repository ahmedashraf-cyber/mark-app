/**
 * drillScoring.js — score a quiz attempt
 * ============================================================================
 * DRILL only. Pure functions, no I/O, so it can be reasoned about and tested
 * in isolation. This produces the number that gates someone's onboarding, so
 * every rule below is explicit rather than implied.
 *
 * SCORING IS PER EVENT, NOT PER CLIP. A clip may hold several events with no
 * cap, so a clip can score partially — two events, one right, is half.
 *
 *   score = correct / (correct + every error) * 100
 *
 * Extras therefore count against the trainee: 45 right, 10 missed, 5 wrong and
 * 3 not-needed gives 45/63, not 45/60.
 *
 * MATCHING. Events within a clip are matched in three passes, because a naive
 * pairing gives the wrong verdict when a clip holds two events:
 *   1. same event_code within DRILL_TOLERANCE_MS, optimally by |delta|
 *   2. leftovers paired across codes  -> wrong_event (they tagged the wrong thing)
 *   3. remaining key events           -> missed
 *      remaining trainee events       -> not_needed_event
 *
 * ATTRIBUTES ARE AN EXACT MATCH. The trainee's selections must equal the
 * trainer's, no more and no less. Volunteering a value the trainer left
 * untouched is wrong. (This overrides the original brief, which said to ignore
 * anything the trainer left empty.)
 */
import { DRILL_TOLERANCE_MS, DRILL_ATTR_COLUMNS, DRILL_VERDICTS , msToClock
} from '../config/drillConfig'

/** Optimal assignment by brute force. Clips hold a handful of events, so the
 *  permutation count is trivial and this is exactly optimal — no need to pull
 *  in the Hungarian implementation from the comparison engine. */
function bestPairing(keys, tags, cost) {
  const n = keys.length, m = tags.length
  if (!n || !m) return []
  // guard: 6! = 720, fine. Beyond that fall back to greedy.
  if (Math.min(n, m) > 6) {
    const used = new Set(), out = []
    keys.forEach((k, ki) => {
      let best = -1, bestC = Infinity
      tags.forEach((t, ti) => {
        if (used.has(ti)) return
        const c = cost(k, t)
        if (c < bestC) { bestC = c; best = ti }
      })
      if (best >= 0 && bestC < Infinity) { used.add(best); out.push([ki, best]) }
    })
    return out
  }
  const idx = tags.map((_, i) => i)
  let bestSet = [], bestTotal = Infinity
  const perms = []
  ;(function permute(arr, cur) {
    if (!arr.length) { perms.push(cur); return }
    arr.forEach((v, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)], [...cur, v]))
  })(idx, [])
  perms.forEach(p => {
    let total = 0
    const pairs = []
    for (let ki = 0; ki < Math.min(n, p.length); ki++) {
      const c = cost(keys[ki], tags[p[ki]])
      if (c === Infinity) { total = Infinity; break }
      total += c
      pairs.push([ki, p[ki]])
    }
    if (total < bestTotal) { bestTotal = total; bestSet = pairs }
  })
  return bestTotal === Infinity ? [] : bestSet
}

function attrsOf(row, prefix) {
  const out = {}
  DRILL_ATTR_COLUMNS.forEach(c => { out[c] = String(row?.[prefix + c] ?? row?.attrs?.[c] ?? '') })
  return out
}

/** Which attribute groups differ. Exact match both ways. */
function attrDiff(keyAttrs, tagAttrs) {
  const differed = []
  DRILL_ATTR_COLUMNS.forEach(c => {
    // order-insensitive: a multi-select is stored pipe-joined, and the order the
    // trainer clicked in must not decide whether a trainee is wrong
    const norm = v => String(v || '').split('|').filter(Boolean).sort().join('|')
    if (norm(keyAttrs[c]) !== norm(tagAttrs[c])) differed.push(c.replace('attr_', ''))
  })
  return differed
}

/**
 * Score one clip.
 *   keyEvents  [{ answer_event_code, answer_team, answer_video_time_ms, answer_attr_* }]
 *   tagEvents  [{ event_code, team, video_time_ms, attrs:{attr_*} }]
 * → { rows[], counts{} }
 */
export function scoreClip(clipIndex, keyEvents, tagEvents) {
  const rows = []
  const keys = (keyEvents || []).map(k => ({
    code:  k.answer_event_code,
    team:  String(k.answer_team || ''),
    at:    Number(k.answer_video_time_ms || 0),
    attrs: attrsOf(k, 'answer_'),
    raw:   k,
  }))
  const tags = (tagEvents || []).map(t => ({
    code:  t.event_code,
    team:  String(t.team || ''),
    at:    Number(t.video_time_ms || 0),
    attrs: attrsOf(t, 'trainee_'),
    raw:   t,
  }))

  // A clip whose answer is "no event", answered with nothing, is a single
  // correct mark — it tests whether they can recognise absence, which is a
  // real skill and a real failure mode in collection.
  if (!keys.length && !tags.length) {
    rows.push({ clip_index: clipIndex, event_index: 0, verdict: 'correct',
      faults: [], key: null, tag: null, delta_ms: '' })
    return { rows, counts: tally(rows) }
  }

  const usedK = new Set(), usedT = new Set()

  // pass 1 — same code, inside tolerance
  const byCode = {}
  keys.forEach((k, i) => { (byCode[k.code] = byCode[k.code] || { k: [], t: [] }).k.push(i) })
  tags.forEach((t, i) => { (byCode[t.code] = byCode[t.code] || { k: [], t: [] }).t.push(i) })

  Object.values(byCode).forEach(({ k: kis, t: tis }) => {
    if (!kis.length || !tis.length) return
    const subK = kis.map(i => keys[i]), subT = tis.map(i => tags[i])
    const pairs = bestPairing(subK, subT,
      (a, b) => Math.abs(a.at - b.at) <= DRILL_TOLERANCE_MS
        ? Math.abs(a.at - b.at) : Infinity)
    pairs.forEach(([a, b]) => {
      const ki = kis[a], ti = tis[b]
      if (usedK.has(ki) || usedT.has(ti)) return
      usedK.add(ki); usedT.add(ti)
      const K = keys[ki], T = tags[ti]
      const delta = Math.abs(K.at - T.at)
      const faults = []
      if (K.team && T.team && K.team !== T.team) faults.push('wrong_team')
      if (delta > DRILL_TOLERANCE_MS) faults.push('wrong_timestamp')
      const differed = attrDiff(K.attrs, T.attrs)
      if (differed.length) faults.push('wrong_extra')
      // Precedence for the single scored verdict; every fault is kept for the
      // results screen because you asked to see all of them.
      const verdict = faults.length
        ? (faults.includes('wrong_team') ? 'wrong_team'
          : faults.includes('wrong_timestamp') ? 'wrong_timestamp' : 'wrong_extra')
        : 'correct'
      rows.push({ clip_index: clipIndex, event_index: rows.length, verdict, faults,
        key: K, tag: T, delta_ms: delta, attrs_differed: differed.join('|') })
    })
  })

  // pass 2 — leftovers paired up. Pairing rather than splitting matters: a
  // trainee who tags the right event six seconds late has made ONE mistake, and
  // recording it as missed + not_needed_event would charge them twice.
  // Same code out of tolerance is a timing fault; a different code is a
  // genuinely wrong identification.
  const leftK = keys.map((_, i) => i).filter(i => !usedK.has(i))
  const leftT = tags.map((_, i) => i).filter(i => !usedT.has(i))
  const crossPairs = bestPairing(
    leftK.map(i => keys[i]), leftT.map(i => tags[i]),
    (a, b) => Math.abs(a.at - b.at))
  crossPairs.forEach(([a, b]) => {
    const ki = leftK[a], ti = leftT[b]
    if (usedK.has(ki) || usedT.has(ti)) return
    usedK.add(ki); usedT.add(ti)
    const K = keys[ki], T = tags[ti]
    const sameCode = K.code === T.code
    const delta = Math.abs(K.at - T.at)
    const faults = sameCode ? ['wrong_timestamp'] : ['wrong_event']
    // a wrong-code pair may also differ on team or attributes; surface those
    // on the results screen even though the scored verdict stays wrong_event
    if (!sameCode) {
      if (K.team && T.team && K.team !== T.team) faults.push('wrong_team')
    }
    const differed = sameCode ? attrDiff(K.attrs, T.attrs) : []
    if (differed.length) faults.push('wrong_extra')
    rows.push({ clip_index: clipIndex, event_index: rows.length,
      verdict: sameCode ? 'wrong_timestamp' : 'wrong_event',
      faults, key: K, tag: T, delta_ms: delta,
      attrs_differed: differed.join('|') })
  })

  // pass 3 — what is left over on each side
  keys.forEach((K, i) => {
    if (usedK.has(i)) return
    rows.push({ clip_index: clipIndex, event_index: rows.length, verdict: 'missed',
      faults: ['missed'], key: K, tag: null, delta_ms: '', attrs_differed: '' })
  })
  tags.forEach((T, i) => {
    if (usedT.has(i)) return
    rows.push({ clip_index: clipIndex, event_index: rows.length,
      verdict: 'not_needed_event', faults: ['not_needed_event'],
      key: null, tag: T, delta_ms: '', attrs_differed: '' })
  })

  return { rows, counts: tally(rows) }
}

function tally(rows) {
  const c = Object.fromEntries(DRILL_VERDICTS.map(v => [v, 0]))
  rows.forEach(r => { c[r.verdict] = (c[r.verdict] || 0) + 1 })
  return c
}

/**
 * Score a whole attempt.
 *   clips       [{ clip_index, is_no_event, ... }]
 *   keyByClip   { clipIndex: [keyEvent] }
 *   tagByClip   { clipIndex: [tagEvent] }   — missing key = never reached
 * → { rows, counts, scorePercent, passed, totalEvents }
 */
export function scoreAttempt({ clips, keyByClip, tagByClip, passMarkPercent }) {
  let rows = []
  clips.forEach(c => {
    const ci = Number(c.clip_index)
    const answered = Object.prototype.hasOwnProperty.call(tagByClip, ci)
    // A clip the trainee never reached — time ran out — is not the same as one
    // they looked at and left empty. Unreached clips are missed, never
    // credited as a correct "no event".
    if (!answered && !(keyByClip[ci] || []).length) {
      rows.push({ clip_index: ci, event_index: 0, verdict: 'missed',
        faults: ['missed'], key: null, tag: null, delta_ms: '',
        attrs_differed: '', unreached: true })
      return
    }
    const { rows: r } = scoreClip(ci, keyByClip[ci] || [], answered ? (tagByClip[ci] || []) : [])
    rows = rows.concat(r.map(x => ({ ...x, unreached: !answered })))
  })

  const counts = tally(rows)
  const correct = counts.correct || 0
  const errors  = DRILL_VERDICTS.filter(v => v !== 'correct')
    .reduce((s, v) => s + (counts[v] || 0), 0)
  const total = correct + errors
  const scorePercent = total ? Math.round((correct / total) * 1000) / 10 : null
  return {
    rows, counts, totalEvents: total, scorePercent,
    passed: scorePercent !== null && scorePercent >= Number(passMarkPercent || 0),
  }
}
