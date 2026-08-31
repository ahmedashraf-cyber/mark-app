/**
 * fieldConfig.js — FIELD mode configuration constants
 * Single source of truth for all FIELD-specific config.
 * Scout and Audit never import this file.
 */

// ── Google Sheet target ────────────────────────────────────────────────────────
// The spreadsheet ID from the URL:
// https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit
export const FIELD_SHEET_ID = '1l3tYwre5ik0nMbBS562tge0Ch4MHKcuXTuNdPaEoTec'

// Tab name to write to (must match the actual sheet tab name exactly)
export const FIELD_SHEET_TAB = 'Sheet1'

// ── Schema version ─────────────────────────────────────────────────────────────
// Bump this when columns are added, removed or reordered.
// The comparison tool reads this to detect format changes.
export const FIELD_SCHEMA_VERSION = '2'

// ── Column definitions — stable, ordered ──────────────────────────────────────
// NEVER reorder. Adding a column = bump FIELD_SCHEMA_VERSION.
export const FIELD_COLUMNS = [
  'schema_version',
  // Session identity
  'session_id',
  'match_id',
  'half',
  'collector_hr_code',
  // Event identity
  'event_id',
  'event_label',
  // Timing
  'video_time_ms',
  'video_time_readable',
  // Team
  'team',
  'team_source',
  // Pass type inference
  'inferred_type',
  'type_source',
  // Attribute groups (up to 6 group slots, each as code)
  'group_1_id',
  'group_1_codes',
  'group_2_id',
  'group_2_codes',
  'group_3_id',
  'group_3_codes',
  'group_4_id',
  'group_4_codes',
  'group_5_id',
  'group_5_codes',
  'group_6_id',
  'group_6_codes',
  // Legacy flat extras (for backward compat with v1 events)
  'extras_flat',
  // Possession
  'possession_certain',
  'miscommunication_team',
  // Session metadata (repeated every row)
  'video_filename',
  'video_duration_sec',
  'collector_email',
  'export_timestamp_iso',
  'mark_version',
  // Collection timing
  'collection_start_wall_iso',
  'collection_end_wall_iso',
  'collection_elapsed_raw_ms',
  'collection_events_per_min',
  'collection_incomplete',
  // Flags
  'flags',
]

// ── Match ID validation ────────────────────────────────────────────────────────
// Must be all digits, 6-8 characters (covers real match IDs)
export function validateMatchId(val) {
  if (!val) return 'Match ID is required'
  if (!/^\d+$/.test(val)) return 'Match ID must contain digits only'
  if (val.length < 6 || val.length > 8) return 'Match ID must be 6-8 digits'
  return null  // valid
}

// ── localStorage key ───────────────────────────────────────────────────────────
export const FIELD_LS_KEY = 'mark_field_sessions'
