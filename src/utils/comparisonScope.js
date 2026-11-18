/**
 * comparisonScope.js — rescore a SUBSET of a comparison's detail rows
 * ============================================================================
 * View-only. The engine's result, the scores tab and comparison_detail are
 * never touched; this only recomputes what the score cards display when the
 * Event filter narrows the comparison to some event types.
 *
 * It uses the engine's own computeScore and reproduces the engine's tally from
 * the rows, so the arithmetic cannot drift from it:
 *
 *   denominator  every row with a model event behind it — all rows except
 *                extra_event, which the model never tagged
 *   numerator    the sum of error_weight over non-correct rows. error_weight
 *                already counts each differing attribute, and is 0 for
 *                wrong_side, which is recorded but not scored.
 *
 * Proven identical in the test: rescoring the FULL row set gives back exactly
 * the engine's score, verdict counts and module stats.
 */
import { computeScore } from '../config/comparisonConfig'
import { MODULES_SPLIT } from './defectTypes'

/**
 * The line under the score card. Every figure is the SAME one the score uses: `shown` is what the cards display (the engine's
 * result, or the result rescored for the Event filter), so "scored errors" is the number inside the percentage. The collector
 * total is the whole session; when the model covers only some event types the split is shown, so a long collector list is not
 * mistaken for extras.
 */
export function summaryLine(shown, result) {
  const oos = result.outOfScopeCount || 0
  const parts = [
    `Model: ${shown.modelEventCount} events`,
    `Collector: ${result.collectorEventCount} events${oos > 0 ? ` (${result.scopedCollectorEventCount} compared, ${oos} out of scope)` : ''}`,
    `${shown.errorUnits} scored errors`,
  ]
  const ws = shown.verdictCounts?.wrong_side || 0
  if (ws > 0) parts.push(`${ws} wrong side excluded from the score`)
  return parts.join(' · ')
}

/** The Event filter's own rule: a row matches on either side's event. */
export const rowMatchesEvents = (row, events) =>
  !events || !events.length ||
  events.includes(row.model_event_code) || events.includes(row.collector_event_code)

/**
 * verdictKeys: the engine's verdict names, so every count starts at 0 and a
 * card for a verdict that no longer appears shows 0 rather than blank.
 */
export function scoreRows(rows, verdictKeys = []) {
  const verdictCounts = Object.fromEntries(verdictKeys.map(k => [k, 0]))
  const moduleStats = {}
  MODULES_SPLIT.forEach(m => { moduleStats[m] = { correct: 0, errors: 0, events: 0 } })
  let errorUnits = 0, modelEvents = 0

  rows.forEach(r => {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1
    // the engine's module tally: error_weight, or 1 when absent
    const w = Number(r.error_weight || 1)
    if (r.verdict !== 'extra_event') modelEvents++
    if (r.verdict !== 'correct') errorUnits += w

    const st = moduleStats[r.event_module]
    if (!st) return
    if (r.verdict === 'correct') { st.correct++; st.events++ }
    else if (r.verdict === 'extra_event') { st.errors += w }   // no model event behind it
    else { st.errors += w; st.events++ }
  })
  MODULES_SPLIT.forEach(m => { moduleStats[m].score = computeScore(moduleStats[m].errors, moduleStats[m].events) })

  return {
    verdictCounts, errorUnits, moduleStats,
    score: computeScore(errorUnits, modelEvents),
    modelEventCount: modelEvents,
  }
}
