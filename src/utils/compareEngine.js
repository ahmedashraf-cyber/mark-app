/**
 * compareEngine.js — pure symmetric comparison engine
 * ============================================================================
 * FIELD / Comparison only. No UI dependency. No Scout/Audit imports.
 *
 * compare(sessionA, eventsA, sessionB, eventsB, config)
 *   → { detailRows, verdictCounts, score, videoMatchStatus }
 *
 * Direction is an argument (config.modelSessionId), not an assumption.
 * The same function serves:
 *   - Scoring:   collector vs approved model answer
 *   - Consensus: two collector sessions (no model)
 *   - Agreement: any two sessions
 *
 * Algorithm: Hungarian optimal assignment (Jonker-Volgenant via munkres-js
 * polyfill embedded below — no external dependency, keeps bundle clean).
 *
 * Alignment key: time_from_half_start_ms when both sessions have it;
 *                falls back to video_time_ms.
 *
 * wrong_side: matched on event_code + timestamp first, team evaluated as attribute.
 * model_shape: carried into detail rows for analysis, never scored.
 */

import { toleranceFor, ERROR_VERDICTS } from '../config/comparisonConfig'

// ── Minimal Hungarian algorithm (O(n³)) ───────────────────────────────────────
// Solves the assignment problem: given cost matrix, find minimum-cost
// one-to-one assignment. Returns array of [rowIdx, colIdx] pairs.
function hungarian(costMatrix) {
  const n = costMatrix.length
  if (n === 0) return []
  const m = costMatrix[0].length
  const INF = 1e18

  // Pad to square
  const size = Math.max(n, m)
  const C = []
  for (let i = 0; i < size; i++) {
    C.push([])
    for (let j = 0; j < size; j++) {
      C[i].push(i < n && j < m ? costMatrix[i][j] : INF)
    }
  }

  const u = new Array(size + 1).fill(0)
  const v = new Array(size + 1).fill(0)
  const p = new Array(size + 1).fill(0)  // assignment: col → row
  const way = new Array(size + 1).fill(0)

  for (let i = 1; i <= size; i++) {
    p[0] = i
    let j0 = 0
    const minVal = new Array(size + 1).fill(INF)
    const used   = new Array(size + 1).fill(false)
    do {
      used[j0] = true
      let i0 = p[j0], delta = INF, j1 = -1
      for (let j = 1; j <= size; j++) {
        if (!used[j]) {
          const cur = C[i0-1][j-1] - u[i0] - v[j]
          if (cur < minVal[j]) { minVal[j] = cur; way[j] = j0 }
          if (minVal[j] < delta) { delta = minVal[j]; j1 = j }
        }
      }
      for (let j = 0; j <= size; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta }
        else minVal[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0)
  }

  const result = []
  for (let j = 1; j <= size; j++) {
    if (p[j] !== 0 && p[j] <= n && j <= m) result.push([p[j]-1, j-1])
  }
  return result
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function alignTime(ev) {
  // Prefer time_from_half_start_ms (integer string) when available
  if (ev.time_from_half_start_ms !== '' && ev.time_from_half_start_ms !== null &&
      ev.time_from_half_start_ms !== undefined) {
    const v = parseInt(ev.time_from_half_start_ms)
    if (!isNaN(v) && v >= 0) return { ms: v, source: 'half_start' }
  }
  // Fall back to video_time_ms
  const v = parseInt(ev.video_time_ms || 0)
  return { ms: isNaN(v) ? 0 : v, source: 'video_time' }
}

function videoMatchStatus(sessA, sessB) {
  const sizeA = sessA.video_size_bytes, sizeB = sessB.video_size_bytes
  const durA  = sessA.video_duration_ms,  durB  = sessB.video_duration_ms

  if (!sizeA || !sizeB || !durA || !durB) return 'unknown'

  const durDiff  = Math.abs(parseInt(durA) - parseInt(durB))
  const sizeDiff = Math.abs(parseInt(sizeA) - parseInt(sizeB))

  if (durDiff > 5000) return 'duration_mismatch'   // >5s different cut
  if (sizeDiff > 0)   return 'size_mismatch'        // re-encode
  return 'ok'
}

// ── Main engine ───────────────────────────────────────────────────────────────
/**
 * compare(sessA, eventsA, sessB, eventsB, config)
 *
 * config: {
 *   modelSessionId: string,   // which session is "model" (direction argument)
 *   runId: string,
 *   scopeEventIds: string[],  // from model session; restricts both sides
 * }
 *
 * Events are plain objects with fields matching EVENT_COLUMNS.
 * Returns: { detailRows, verdictCounts, score, videoMatchStatus, excludedCollectorCount }
 */
export function compare(sessA, eventsA, sessB, eventsB, config) {
  const { modelSessionId, runId, scopeEventIds } = config

  // Identify model vs collector — normalise both sides
  const sidA = sessA.session_id || sessA.sessionId || ''
  const sidB = sessB.session_id || sessB.sessionId || ''
  if (!modelSessionId) throw new Error('compare(): config.modelSessionId is required')
  if (sidA !== modelSessionId && sidB !== modelSessionId)
    throw new Error(`compare(): modelSessionId "${modelSessionId}" matches neither sessA ("${sidA}") nor sessB ("${sidB}")`)

  const isAModel      = sidA === modelSessionId
  const modelSess     = isAModel ? sessA : sessB
  const collectorSess = isAModel ? sessB : sessA
  let   modelEvents   = isAModel ? [...eventsA] : [...eventsB]
  let   collEvents    = isAModel ? [...eventsB] : [...eventsA]

  // ── Stage 2: Scope ─────────────────────────────────────────────────────────
  const scope = new Set(scopeEventIds || [])
  const totalCollectorBefore = collEvents.length
  if (scope.size > 0) {
    modelEvents = modelEvents.filter(e => scope.has(e.event_code))
    collEvents  = collEvents.filter(e => scope.has(e.event_code))
  }
  const excludedCollectorCount = totalCollectorBefore - collEvents.length

  // ── Stage 3: Align (Hungarian optimal assignment) ─────────────────────────
  const INF = 1e15

  // Build cost matrix: rows = model events, cols = collector events
  const costs = modelEvents.map(mEv => {
    const tol = toleranceFor(mEv.event_code)
    const mT  = alignTime(mEv)
    return collEvents.map(cEv => {
      // Must be same event_code
      if (cEv.event_code !== mEv.event_code) return INF
      const cT   = alignTime(cEv)
      // Only pair if both use same alignment source, or fall back gracefully
      const delta = Math.abs(mT.ms - cT.ms)
      if (delta > tol) return INF
      // Cost: timestamp delta. Tie-break: same team slightly cheaper
      const teamBonus = (mEv.team === cEv.team) ? 0 : 0.1
      return delta + teamBonus
    })
  })

  const assignments = modelEvents.length > 0 && collEvents.length > 0
    ? hungarian(costs)
    : []

  // Filter out infinite-cost assignments (outside tolerance)
  const validPairs = assignments.filter(([mi, ci]) => costs[mi]?.[ci] < INF)

  const matchedModelIdxs     = new Set(validPairs.map(([mi]) => mi))
  const matchedCollectorIdxs = new Set(validPairs.map(([,ci]) => ci))

  // ── Stage 4: Classify ─────────────────────────────────────────────────────
  const detailRows = []
  const verdictCounts = {
    correct:0, missing_event:0, extra_event:0,
    wrong_side:0, wrong_timestamp:0, wrong_extra:0, missing_extra:0, not_needed_extra:0,
  }

  // Matched pairs
  for (const [mi, ci] of validPairs) {
    const mEv = modelEvents[mi]
    const cEv = collEvents[ci]
    const mT  = alignTime(mEv)
    const cT  = alignTime(cEv)
    const delta = Math.abs(mT.ms - cT.ms)
    const tol   = toleranceFor(mEv.event_code)

    let verdict = 'correct'

    // Team mismatch (after matching on code+timestamp)
    if (mEv.team && cEv.team && mEv.team !== cEv.team) {
      verdict = 'wrong_side'
    }
    // Timestamp within tolerance but meaningful drift
    else if (delta > tol * 0.5 && delta <= tol) {
      verdict = 'wrong_timestamp'
    }

    // Attribute comparison — only groups model actually populated
    const attrsDiffered = []
    if (mEv.groups || mEv.attr_extras || mEv.attr_outcome) {
      const attrCols = Object.keys(mEv).filter(k => k.startsWith('attr_'))
      for (const col of attrCols) {
        const mVal = mEv[col] || ''
        const cVal = cEv[col] || ''
        if (mVal === '') continue  // model didn't populate — skip
        if (mVal !== cVal) {
          attrsDiffered.push(col.replace('attr_', ''))
          if (verdict === 'correct' || verdict === 'wrong_timestamp') {
            verdict = cVal === '' ? 'missing_extra' : 'wrong_extra'
          }
        }
      }
    }

    verdictCounts[verdict] = (verdictCounts[verdict] || 0) + 1

    detailRows.push({
      run_id:                runId,
      model_session_id:      modelSess.session_id,
      collector_session_id:  collectorSess.session_id,
      match_id:              modelSess.match_id || '',
      half:                  modelSess.half     || '',
      collector_hr_code:     collectorSess.collector_hr_code || '',
      event_code:            mEv.event_code,
      verdict,
      model_video_time_ms:   mEv.video_time_ms    || '',
      collector_video_time_ms: cEv.video_time_ms  || '',
      delta_ms:              String(delta),
      model_team:            mEv.team || '',
      collector_team:        cEv.team || '',
      model_shape:           mEv.model_shape || '',
      attrs_differed:        attrsDiffered.join('|'),
      override_verdict: '', override_by: '', override_at_iso: '', resolution_status: '',
    })
  }

  // Unmatched model events → missing
  for (let mi = 0; mi < modelEvents.length; mi++) {
    if (matchedModelIdxs.has(mi)) continue
    const mEv = modelEvents[mi]
    verdictCounts.missing_event++
    detailRows.push({
      run_id: runId, model_session_id: modelSess.session_id,
      collector_session_id: collectorSess.session_id,
      match_id: modelSess.match_id || '', half: modelSess.half || '',
      collector_hr_code: collectorSess.collector_hr_code || '',
      event_code: mEv.event_code, verdict: 'missing_event',
      model_video_time_ms: mEv.video_time_ms || '', collector_video_time_ms: '',
      delta_ms: '', model_team: mEv.team || '', collector_team: '',
      model_shape: mEv.model_shape || '', attrs_differed: '',
      override_verdict: '', override_by: '', override_at_iso: '', resolution_status: '',
    })
  }

  // Unmatched collector events → extra
  for (let ci = 0; ci < collEvents.length; ci++) {
    if (matchedCollectorIdxs.has(ci)) continue
    const cEv = collEvents[ci]
    verdictCounts.extra_event++
    detailRows.push({
      run_id: runId, model_session_id: modelSess.session_id,
      collector_session_id: collectorSess.session_id,
      match_id: modelSess.match_id || '', half: modelSess.half || '',
      collector_hr_code: collectorSess.collector_hr_code || '',
      event_code: cEv.event_code, verdict: 'extra_event',
      model_video_time_ms: '', collector_video_time_ms: cEv.video_time_ms || '',
      delta_ms: '', model_team: '', collector_team: cEv.team || '',
      model_shape: '', attrs_differed: '',
      override_verdict: '', override_by: '', override_at_iso: '', resolution_status: '',
    })
  }

  // Sort detail rows: model_video_time_ms asc, then collector_video_time_ms asc
  detailRows.sort((a, b) => {
    const aMs = parseInt(a.model_video_time_ms || a.collector_video_time_ms || 0)
    const bMs = parseInt(b.model_video_time_ms || b.collector_video_time_ms || 0)
    return aMs - bMs
  })

  // ── Stage 5: Score ────────────────────────────────────────────────────────
  const correct = verdictCounts.correct
  const errors  = [...ERROR_VERDICTS].reduce((s, v) => s + (verdictCounts[v] || 0), 0)
  const total   = correct + errors
  const score   = total > 0 ? Math.round((correct / total) * 1000) / 10 : null

  return {
    detailRows,
    verdictCounts,
    score,
    videoMatchStatus: videoMatchStatus(modelSess, collectorSess),
    excludedCollectorCount,
    modelEventCount:     modelEvents.length,
    collectorEventCount: collEvents.length,
  }
}
