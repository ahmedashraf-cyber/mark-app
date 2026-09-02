/**
 * comparisonConfig.js — comparison engine configuration
 * ============================================================================
 * FIELD / Comparison only. Scout and Audit never import this file.
 *
 * TOLERANCE_CONFIG_VERSION: bump when any tolerance value changes.
 * ALGORITHM_VERSION: bump when matching algorithm changes.
 * Both are written to the scores tab so historical runs stay reproducible.
 */

export const TOLERANCE_CONFIG_VERSION = '1'
export const ALGORITHM_VERSION        = '1'  // Hungarian optimal assignment

// ── Per-event-type tolerance in milliseconds ──────────────────────────────────
// Events not listed use DEFAULT_TOLERANCE_MS.
// To change: update the value AND bump TOLERANCE_CONFIG_VERSION.
export const EVENT_TOLERANCES = {
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

export function toleranceFor(eventCode) {
  return EVENT_TOLERANCES[eventCode] ?? DEFAULT_TOLERANCE_MS
}

// ── Scoring formula ───────────────────────────────────────────────────────────
// Matches Scout's formula: score = correct / total_model_events * 100
// Verdicts that count as errors (denominator = correct + all errors):
export const ERROR_VERDICTS = new Set([
  'missing_event', 'extra_event', 'wrong_side',
  'wrong_timestamp', 'wrong_extra', 'missing_extra', 'not_needed_extra',
])

export function computeScore(verdictCounts) {
  const correct = verdictCounts.correct || 0
  const errors  = [...ERROR_VERDICTS].reduce((s, v) => s + (verdictCounts[v] || 0), 0)
  const total   = correct + errors
  if (total === 0) return null
  return Math.round((correct / total) * 1000) / 10  // one decimal place
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
  'collector_video_time_ms',    // empty on missing_event rows
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
]
