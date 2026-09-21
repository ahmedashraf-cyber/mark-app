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

import { toleranceFor, ERROR_VERDICTS, countErrors, computeScore } from '../config/comparisonConfig'
import { classifyEventModuleSplit, MODULES_SPLIT } from './defectTypes'

// ── Optimal assignment (Jonker-Volgenant / shortest augmenting path) ─────────
// Handles non-square cost matrices (more rows than cols or vice versa).
// Returns array of [rowIdx, colIdx] pairs — only finite-cost assignments.
// Unmatched rows/cols are simply omitted from the result.
function hungarian(costMatrix) {
  const numRows = costMatrix.length
  if (numRows === 0) return []
  const numCols = costMatrix[0].length
  if (numCols === 0) return []

  const INF = 1e15

  // Work on the transpose if more cols than rows (algorithm works on rows ≥ cols)
  const transposed = numCols > numRows
  const C    = transposed ? costMatrix[0].map((_, j) => costMatrix.map(r => r[j])) : costMatrix
  const rows = transposed ? numCols : numRows
  const cols = transposed ? numRows : numCols

  // u[i] = row potentials (1-indexed), v[j] = col potentials (1-indexed)
  const u    = new Array(rows + 1).fill(0)
  const v    = new Array(cols + 1).fill(0)
  const rowOf= new Array(cols + 1).fill(0)  // rowOf[j] = row assigned to col j (1-indexed, 0=unassigned)
  const colOf= new Array(rows + 1).fill(0)  // colOf[i] = col assigned to row i (1-indexed, 0=unassigned)

  for (let i = 1; i <= rows; i++) {
    rowOf[0] = i
    let j0 = 0
    const dist = new Array(cols + 1).fill(INF)
    const prev = new Array(cols + 1).fill(-1)
    const done = new Array(cols + 1).fill(false)

    do {
      done[j0] = true
      const i0 = rowOf[j0]
      let delta = INF, j1 = -1
      for (let j = 1; j <= cols; j++) {
        if (!done[j]) {
          // safe access: i0 is always a valid row index (1..rows) because rowOf is seeded with i
          const cost = (i0 >= 1 && i0 <= rows && j >= 1 && j <= cols)
            ? (C[i0-1][j-1] ?? INF) : INF
          const cur = cost - u[i0] - v[j]
          if (cur < dist[j]) { dist[j] = cur; prev[j] = j0 }
          if (dist[j] < delta) { delta = dist[j]; j1 = j }
        }
      }
      if (j1 === -1 || delta >= INF) break  // no finite augmenting path
      for (let j = 0; j <= cols; j++) {
        if (done[j]) { u[rowOf[j]] += delta; v[j] -= delta }
        else dist[j] -= delta
      }
      j0 = j1
    } while (rowOf[j0] !== 0)

    // Augment along the path
    let j = j0
    while (j !== 0 && prev[j] !== -1) {
      rowOf[j] = rowOf[prev[j]]
      colOf[rowOf[j]] = j
      j = prev[j]
    }
  }

  // Collect finite-cost assignments
  const result = []
  for (let j = 1; j <= cols; j++) {
    if (rowOf[j] === 0) continue
    const ri = rowOf[j] - 1  // 0-indexed row
    const ci = j - 1          // 0-indexed col
    if (transposed) {
      if (costMatrix[ci]?.[ri] < INF) result.push([ci, ri])
    } else {
      if (costMatrix[ri]?.[ci] < INF) result.push([ri, ci])
    }
  }
  return result
}

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Does this event carry a usable time-from-half-start? */
function hasHalfStart(ev) {
  const raw = ev.time_from_half_start_ms
  if (raw === '' || raw === null || raw === undefined) return false
  const v = parseInt(raw)
  return !isNaN(v) && v >= 0
}

/**
 * Compact attribute summary for the detail table.
 *
 * Returns { short, full }. `short` strips the group prefix from each code —
 * SIDE_RIGHT becomes RIGHT — because the column header already says which side
 * it belongs to and the width is tight. `full` keeps group=value for the
 * tooltip, so nothing is hidden, only shortened.
 *
 * These land on the IN-MEMORY detail rows only. DETAIL_COLUMNS is untouched, so
 * the sheet writer ignores them and existing sheet data is unaffected.
 */
function attrSummary(ev) {
  if (!ev) return { short: '', full: '' }
  const shorts = [], fulls = []
  Object.keys(ev).filter(k => k.startsWith('attr_')).forEach(k => {
    const raw = String(ev[k] ?? '').trim()
    if (!raw) return
    const group = k.replace(/^attr_/, '')
    const vals = raw.split('|').map(x => x.trim()).filter(Boolean)
    shorts.push(vals.map(v => v.includes('_') ? v.slice(v.indexOf('_') + 1) : v).join('+'))
    fulls.push(group + '=' + vals.join('+'))
  })
  return { short: shorts.join(', '), full: fulls.join('  ·  ') }
}

/**
 * Pick ONE time origin for the whole comparison, used by both sides.
 *
 * Time from half start is preferred — half start is tagged at roughly the same
 * moment in both sessions, so it cancels out any difference in how much
 * pre-kickoff footage each video contains.
 *
 * But it is only usable when BOTH sides have it. Previously each event chose
 * its own origin and fell back to video_time_ms independently, with no check
 * that the two agreed — so a model measured from kickoff was compared against
 * a collector measured from video start. With six minutes of warm-up in the
 * file that is a 360,000 ms gap on every pair, far past any tolerance, and the
 * entire run collapses to missing + extra with nothing aligned.
 *
 * The detail rows render video_time_ms, which is why the timestamps looked
 * 84 ms apart on screen while the matcher saw minutes.
 */
function chooseTimeSource(modelEvents, collEvents) {
  const modelHas = modelEvents.length > 0 && modelEvents.every(hasHalfStart)
  const collHas  = collEvents.length  > 0 && collEvents.every(hasHalfStart)
  if (modelHas && collHas) return 'half_start'
  return 'video_time'
}

function alignTimeWith(ev, source) {
  if (source === 'half_start' && hasHalfStart(ev)) {
    return { ms: parseInt(ev.time_from_half_start_ms), source: 'half_start' }
  }
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
 * }
 *
 * Events are plain objects with fields matching EVENT_COLUMNS.
 * Returns: { detailRows, verdictCounts, score, moduleStats, videoMatchStatus, modelEventCount, collectorEventCount }
 */
export function compare(sessA, eventsA, sessB, eventsB, config) {
  const { modelSessionId, runId } = config

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

  // ── Stage 3: Align (Hungarian optimal assignment) ─────────────────────────
  const INF = 1e15

  // ONE origin for both sides, decided once. Deciding per event — and never
  // checking the two agreed — is what collapsed whole runs to missing+extra.
  const timeSource = chooseTimeSource(modelEvents, collEvents)
  const alignTime  = ev => alignTimeWith(ev, timeSource)

  // Build cost matrix: rows = model events, cols = collector events
  const costs = modelEvents.map(mEv => {
    const tol = toleranceFor(mEv.event_code)
    const mT  = alignTime(mEv)
    return collEvents.map(cEv => {
      // ALIGNMENT CRITERIA: TIMESTAMP ONLY.
      //
      // Neither event_code nor team gates a pair. Alignment answers one
      // question — "did both sides record something at this moment?" — and
      // everything about WHAT happened is judged afterwards. So a tackle logged
      // as a positioning_duel at the same instant is one wrong_event, not one
      // missing plus one extra.
      const cT    = alignTime(cEv)
      const delta = Math.abs(mT.ms - cT.ms)
      if (delta > tol) return INF

      // Cost ordering matters. CODE_PENALTY exceeds the largest delta that can
      // survive the tolerance gate, so a same-code candidate ALWAYS beats a
      // different-code one however much closer the latter sits. Without that, a
      // mis-coded event 50ms away would steal the pairing from the correct code
      // 1.5s away and manufacture a missing+extra out of a clean match.
      const CODE_PENALTY = 1e6
      const codeCost = (cEv.event_code === mEv.event_code) ? 0 : CODE_PENALTY
      // Team is only a 0.1 nudge, to settle two otherwise identical candidates.
      const teamBonus = (mEv.team === cEv.team) ? 0 : 0.1
      return codeCost + delta + teamBonus
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
  let errorUnits = 0
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

    // ── Attribute comparison ──────────────────────────────────────────────
    // This used to be wrapped in:
    //     if (mEv.groups || mEv.attr_extras || mEv.attr_outcome)
    // `groups` is not a field on a sheet row at all, so the gate only opened
    // when the model happened to populate extras or outcome. A separation_duel
    // carries attr_direction and nothing else, so the whole block was skipped
    // and attrs_differed came out empty — which is why wrong_extra was 0 on
    // every run ever recorded.
    //
    // There is no reason to gate it: the per-column check below already skips
    // any attribute the model left blank.
    const attrsDiffered = []
    const attrCols = Object.keys(mEv).filter(k => k.startsWith('attr_'))
    let attrVerdict = null
    for (const col of attrCols) {
      const mVal = String(mEv[col] ?? '').trim()
      const cVal = String(cEv[col] ?? '').trim()
      // Model blank means the model did not specify it, so it is not assessed.
      // A collector value there is extra detail, not an error.
      if (mVal === '') continue
      // Multi-select values are pipe-joined; order must not matter.
      const mSet = mVal.split('|').map(x => x.trim()).filter(Boolean).sort().join('|')
      const cSet = cVal.split('|').map(x => x.trim()).filter(Boolean).sort().join('|')
      if (mSet === cSet) continue
      attrsDiffered.push(col.replace('attr_', ''))
      // wrong_extra outranks missing_extra: a wrong value is worse than an
      // absent one, so one wrong value sets the verdict for the pair.
      if (cSet === '') { if (attrVerdict === null) attrVerdict = 'missing_extra' }
      else attrVerdict = 'wrong_extra'
    }

    // ── Verdict, most severe first ────────────────────────────────────────
    //   wrong_side > wrong_timestamp > wrong_extra > missing_extra > correct
    // One row per pair; attrs_differed lists every attribute that differs, so
    // nothing is lost by reporting a single verdict.
    const codeDiffers = cEv.event_code !== mEv.event_code
    const teamDiffers  = !!(mEv.team && cEv.team && mEv.team !== cEv.team)
    const timeDrifted  = delta > tol * 0.5 && delta <= tol

    // ── Verdict, most severe first ────────────────────────────────────────
    //   wrong_event > wrong_timestamp > wrong_extra/missing_extra > wrong_side
    //
    // NOTE ON ORDER — this departs from the hierarchy as written, deliberately.
    // wrong_side is no longer scored, so placing it ABOVE the attribute faults
    // would let it erase them: get the team wrong and your three wrong
    // attributes would vanish from the score with it. Scored faults therefore
    // outrank the unscored one, and wrong_side becomes the verdict only when
    // nothing scoreable is wrong. Nothing is lost either way, because every
    // fault is listed in attrs_differed regardless of which one names the row.
    let verdict = 'correct'
    if (codeDiffers)        verdict = 'wrong_event'
    else if (timeDrifted)   verdict = 'wrong_timestamp'
    else if (attrVerdict)   verdict = attrVerdict
    else if (teamDiffers)   verdict = 'wrong_side'

    // Faults that did not win the verdict are still recorded, so a feedback
    // session can see everything that was wrong with one event.
    if (codeDiffers && verdict !== 'wrong_event') attrsDiffered.unshift('event_code')
    if (teamDiffers && verdict !== 'wrong_side')  attrsDiffered.push('team')

    // ── How many errors this one pair represents ──────────────────────────
    // An attribute fault costs ONE ERROR PER ATTRIBUTE, so an event with three
    // wrong attributes is three errors, not one. Team and timestamp faults cost
    // one each, because there is only one of each to get wrong.
    //
    // The pair still produces ONE detail row carrying the most severe verdict,
    // with every difference listed in attrs_differed — the weight is what the
    // score uses, the row is what you read.
    //
    // When the verdict is wrong_side or wrong_timestamp the attribute
    // differences are recorded but NOT charged: the pair is already counted
    // once for the more severe fault, and charging both would mean a single
    // mis-set team costs more than the team error itself.
    // wrong_side carries weight 0: recorded for feedback, never scored. A
    // collector who tagged the right event at the right moment with the right
    // detail but picked the wrong team made a metadata slip, not a collection
    // error.
    const errorWeight =
      (verdict === 'correct' || verdict === 'wrong_side') ? 0
      : (verdict === 'wrong_extra' || verdict === 'missing_extra')
        // one error per differing attribute; event_code and team entries in
        // attrsDiffered are annotations, not attribute faults, so they are
        // excluded from the count
        ? Math.max(1, attrsDiffered.filter(a => a !== 'event_code' && a !== 'team').length)
        : 1

    // OCCURRENCES here — one per pair — so the score card reports what actually
    // happened. Conflating this with the score's error units was a mistake:
    // wrong_side has weight 0, so it stopped appearing on the card at all, and
    // an event with three wrong attributes showed as three wrong_extra events
    // rather than one event with three faults.
    verdictCounts[verdict] = (verdictCounts[verdict] || 0) + 1
    // Error UNITS accumulate separately: per attribute for attribute faults,
    // zero for wrong_side, one for everything else.
    errorUnits += errorWeight

    detailRows.push({
      run_id:                runId,
      model_session_id:      modelSess.session_id,
      collector_session_id:  collectorSess.session_id,
      match_id:              modelSess.match_id || '',
      half:                  modelSess.half     || '',
      collector_hr_code:     collectorSess.collector_hr_code || '',
      event_code:            mEv.event_code,
      // separate sides, so the table can show and compare them independently
      model_event_code:      mEv.event_code,
      collector_event_code:  cEv.event_code,
      model_attrs:           attrSummary(mEv).short,
      model_attrs_full:      attrSummary(mEv).full,
      collector_attrs:       attrSummary(cEv).short,
      collector_attrs_full:  attrSummary(cEv).full,
      verdict,
      model_video_time_ms:   mEv.video_time_ms    || '',
      collector_video_time_ms: cEv.video_time_ms  || '',
      delta_ms:              String(delta),
      model_team:            mEv.team || '',
      collector_team:        cEv.team || '',
      model_shape:           mEv.model_shape || '',
      attrs_differed:        attrsDiffered.join('|'),
      error_weight:          String(errorWeight),
      override_verdict: '', override_by: '', override_at_iso: '', resolution_status: '',
    })
  }

  // Unmatched model events → missing
  for (let mi = 0; mi < modelEvents.length; mi++) {
    if (matchedModelIdxs.has(mi)) continue
    const mEv = modelEvents[mi]
    verdictCounts.missing_event++
    errorUnits += 1   // one missing event is one error
    detailRows.push({
      run_id: runId, model_session_id: modelSess.session_id,
      collector_session_id: collectorSess.session_id,
      match_id: modelSess.match_id || '', half: modelSess.half || '',
      collector_hr_code: collectorSess.collector_hr_code || '',
      event_code: mEv.event_code, verdict: 'missing_event',
      model_event_code: mEv.event_code, collector_event_code: '',
      model_attrs: attrSummary(mEv).short, model_attrs_full: attrSummary(mEv).full,
      collector_attrs: '', collector_attrs_full: '',
      model_video_time_ms: mEv.video_time_ms || '', collector_video_time_ms: '',
      delta_ms: '', model_team: mEv.team || '', collector_team: '',
      error_weight: '1',   // one missing event is one error
      model_shape: mEv.model_shape || '', attrs_differed: '',
      override_verdict: '', override_by: '', override_at_iso: '', resolution_status: '',
    })
  }

  // Unmatched collector events → extra
  for (let ci = 0; ci < collEvents.length; ci++) {
    if (matchedCollectorIdxs.has(ci)) continue
    const cEv = collEvents[ci]
    verdictCounts.extra_event++
    errorUnits += 1   // one extra event is one error
    detailRows.push({
      run_id: runId, model_session_id: modelSess.session_id,
      collector_session_id: collectorSess.session_id,
      match_id: modelSess.match_id || '', half: modelSess.half || '',
      collector_hr_code: collectorSess.collector_hr_code || '',
      event_code: cEv.event_code, verdict: 'extra_event',
      model_event_code: '', collector_event_code: cEv.event_code,
      model_attrs: '', model_attrs_full: '',
      collector_attrs: attrSummary(cEv).short, collector_attrs_full: attrSummary(cEv).full,
      model_video_time_ms: '', collector_video_time_ms: cEv.video_time_ms || '',
      delta_ms: '', model_team: '', collector_team: cEv.team || '',
      error_weight: '1',   // one extra event is one error
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
  // score = 100 - errors/modelEvents. The denominator is the model answer's
  // event count, never correct+errors — the old formula let a collector's
  // extras enlarge their own denominator and soften the penalty.
  const correct = verdictCounts.correct
  // errorUnits already excludes wrong_side (weight 0) and counts attribute
  // faults per attribute, so it is the figure the formula needs. countErrors on
  // the occurrence counts would charge one per event and re-include wrong_side.
  const errors  = errorUnits
  const score   = computeScore(errors, modelEvents.length)

  // ── Stage 6: Module breakdown ─────────────────────────────────────────────
  // Every detail row is stamped with its module and then tallied. Classifying
  // the ROWS rather than the model events separately is what makes the numbers
  // reconcile: each row is counted exactly once, so summing correct across
  // modules necessarily equals the overall correct count.
  //
  // extra_event rows are the one asymmetry — the collector tagged something the
  // model does not have, so they are errors in the numerator but contribute no
  // model event to the denominator. That is deliberate: extras must not inflate
  // what the collector was expected to tag.
  detailRows.forEach(r => { r.event_module = classifyEventModuleSplit(r.event_code) })

  const moduleStats = {}
  MODULES_SPLIT.forEach(mod => { moduleStats[mod] = { correct: 0, errors: 0, events: 0 } })
  detailRows.forEach(r => {
    const st = moduleStats[r.event_module]
    if (!st) return
    // error_weight is 1 for everything except an attribute fault, where it is
    // the number of attributes that differ. Using it here keeps the module
    // error counts in step with the overall count.
    const w = Number(r.error_weight || 1)
    if (r.verdict === 'correct') { st.correct++; st.events++ }
    else if (r.verdict === 'extra_event') { st.errors += w }   // no model event behind it
    else { st.errors += w; st.events++ }
  })
  MODULES_SPLIT.forEach(mod => {
    const st = moduleStats[mod]
    // Same formula as Overall, so the two agree when the model answer covers a
    // single module. st.events IS the model event count for this module:
    // correct and non-extra errors each have a model event behind them, extras
    // do not and are excluded from it by the tally above.
    // events === 0 means the model covers nothing here, so the score is
    // unknown, NOT zero — null becomes '' in the sheet and "no data" in the UI.
    st.score = computeScore(st.errors, st.events)
  })

  return {
    detailRows,
    verdictCounts,
    errorUnits,
    score,
    moduleStats,
    videoMatchStatus: videoMatchStatus(modelSess, collectorSess),
    modelEventCount:     modelEvents.length,
    collectorEventCount: collEvents.length,
  }
}
