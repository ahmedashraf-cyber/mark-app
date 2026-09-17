/**
 * comparisonConfig.js — comparison engine configuration
 * ============================================================================
 * FIELD / Comparison only. Scout and Audit never import this file.
 *
 * TOLERANCE_CONFIG_VERSION: bump when any tolerance value changes.
 * ALGORITHM_VERSION: bump when matching algorithm changes.
 * Both are written to the scores tab so historical runs stay reproducible.
 */

export const TOLERANCE_CONFIG_VERSION = '2'
// 2: alignment no longer requires team to match. Pairs form on event_code and
// timestamp alone, with team evaluated afterwards as wrong_side — so an
// inverted home/away mapping yields ~22 wrong_side instead of 1000+
// missing+extra. Scope filtering was removed at the same time.
//
// This MUST be bumped whenever alignment changes, or the duplicate-run guard
// (which keys on it) shows an old run scored by different rules instead of
// re-scoring, and the sheet cannot distinguish the two.
export const ALGORITHM_VERSION        = '6'  // Hungarian, team-agnostic alignment

// ── Per-event-type tolerance in milliseconds ──────────────────────────────────
// Events not listed use DEFAULT_TOLERANCE_MS.
// To change: update the value AND bump TOLERANCE_CONFIG_VERSION.
// Flat 2000ms for every event type. Was per-event (pressure 3000, shot 1000,
// pass 1500); changed on request so Comparison and DRILL judge timing the same
// way. TOLERANCE_CONFIG_VERSION is bumped to 2 so runs scored under the old
// per-event windows stay identifiable rather than silently reinterpreted.
export const EVENT_TOLERANCES_V1_UNUSED = {
  half_start:    500,   // near-exact — click at the whistle
  half_end:      500,
  pressure_start:3000,  // judgement call — "when does pressure start" is subjective
  pressure_end:  3000,
  shot:          1000,  // visible moment of contact
  end_shot:      1000,
  pass:          1500,
  pass_first_time:1500,
  pass_recovery: 1500,
  foul_committed:1500,
  out:           1000,  // ball crossing line is clear
  card:          2000,
  goal_keeper:   2000,
  tackle:        2000,
  interception:  2000,
  ball_recovery: 2000,
}
export const DEFAULT_TOLERANCE_MS = 2000

// Flat window: every event type now uses DEFAULT_TOLERANCE_MS.
export const EVENT_TOLERANCES = {}

export function toleranceFor(eventCode) {
  return EVENT_TOLERANCES[eventCode] ?? DEFAULT_TOLERANCE_MS
}

// ── Scoring formula ───────────────────────────────────────────────────────────
//
//   score = 100 - (total_errors / total_model_events) * 100
//
// The denominator is ALWAYS the model answer's event count. It never moves with
// what the collector did, so two collectors on the same half are measured
// against the same yardstick. An extra event is one error in the numerator and
// contributes nothing to the denominator — it cannot dilute itself.
//
// Every error type carries equal weight.
//
// This replaced three different formulas: a dead copy here, an inline
// correct/(correct+errors) in the engine, and a third correct/events variant
// for the modules. That is why Overall and Pressure disagreed. One function
// now, used by both.
export const ERROR_VERDICTS = new Set([
  'missing_event', 'extra_event', 'wrong_side',
  'wrong_timestamp', 'wrong_extra', 'missing_extra', 'not_needed_extra',
])

export function countErrors(verdictCounts) {
  return [...ERROR_VERDICTS].reduce((s, v) => s + (verdictCounts[v] || 0), 0)
}

/**
 * score = 100 - errors/modelEvents, floored at 0, one decimal.
 * Returns null when modelEvents is 0 — unknown, not zero. Extras can push
 * errors past modelEvents, which would go negative; a collector cannot do
 * worse than every event wrong, so it floors.
 */
export function computeScore(errors, modelEvents) {
  if (!modelEvents) return null
  const pct = 100 - (errors / modelEvents) * 100
  return Math.max(0, Math.round(pct * 10) / 10)
}

// ── Sheet tab names for comparison output ─────────────────────────────────────
export const TAB_COMPARISON_DETAIL = 'comparison_detail'
export const TAB_SCORES            = 'scores'

// ── comparison_detail columns ─────────────────────────────────────────────────
export const DETAIL_COLUMNS = [
  'run_id',
  'model_session_id',
  'collector_session_id',
  'match_id',
  'half',
  'collector_hr_code',
  'event_code',
  'verdict',                    // correct/missing_event/extra_event/wrong_side/wrong_timestamp/wrong_extra/missing_extra
  'model_video_time_ms',        // empty on extra_event rows
  'model_time_readable',        // MM:SS.mmm; empty when model_video_time_ms is empty
  'collector_video_time_ms',    // empty on missing_event rows
  'collector_time_readable',    // MM:SS.mmm; empty when collector_video_time_ms is empty
  'delta_ms',                   // abs difference; empty when one side missing
  'model_team',
  'collector_team',
  'model_shape',                // pressure code from model; never scored
  'attrs_differed',             // pipe-separated group names that differed
  // Arbitration columns (schema only — UI not yet built)
  'override_verdict',
  'override_by',
  'override_at_iso',
  'resolution_status',          // pending / upheld_collector / upheld_model / dismissed
  // APPENDED for the module breakdown. Derived from classifyEventModuleSplit,
  // so Pressure is its own module rather than sitting inside C. Lets the sheet
  // answer "which Pressure events do most collectors miss" as a filter.
  'event_module',               // A | B | C | D | TO | PRESSURE
  // How many errors this row represents. 1 for everything except an attribute
  // fault, where it is the number of attributes that differ — so an event with
  // three wrong attributes costs three errors while still being one row.
  'error_weight',
]

// ── scores columns ─────────────────────────────────────────────────────────────
export const SCORES_COLUMNS = [
  'run_id',
  'run_timestamp_iso',
  'match_id',
  'half',
  'collector_hr_code',
  'model_session_id',
  'model_version',
  'model_source',
  'collector_session_id',
  'tolerance_config_version',
  'algorithm_version',
  // Retained for column position only: existing rows have values and removing
  // it would shift every later column. New runs write '' — scope no longer
  // exists in the engine.
  'scope_event_ids',
  'total_model_events',
  'total_collector_events',
  'total_scoped_collector_events',
  'correct',
  'missing_event',
  'extra_event',
  'wrong_side',
  'wrong_timestamp',
  'wrong_extra',
  'missing_extra',
  'not_needed_extra',
  'score',                      // 0-100 one decimal
  'video_match_status',         // ok / size_mismatch / duration_mismatch / unknown
  // APPENDED for the module breakdown. `score` above is unchanged and remains
  // the OVERALL figure across all modules — not an average of the six below.
  // A module with no model events writes '' rather than 0, so "no data" stays
  // distinguishable from a genuine zero.
  'a_score',        'a_correct',        'a_events',
  'b_score',        'b_correct',        'b_events',
  'c_score',        'c_correct',        'c_events',
  'd_score',        'd_correct',        'd_events',
  'to_score',       'to_correct',       'to_events',
  'pressure_score', 'pressure_correct', 'pressure_events',
]
