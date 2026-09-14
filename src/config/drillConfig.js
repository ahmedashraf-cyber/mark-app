/**
 * drillConfig.js — DRILL mode configuration
 * ============================================================================
 * DRILL only. Scout, Audit, TAG and Comparison never import this file.
 *
 * DRILL is a training/assessment mode: trainees tag short video clips and are
 * scored against a trainer-provided answer key.
 */

// ── Roles (Supervisors tab, column C) ────────────────────────────────────────
// Creators must ALSO be @hudl.com (checked separately via useInternalUser).
// Trainees are matched by substring so both 'Offline Data Collector' and
// 'Offline Data Collector (Part)' qualify, and they may be any email domain —
// requiring @hudl.com of trainees would lock every trainee out.
export const DRILL_CREATOR_ROLES = ['Batch Supervisor', 'Batch Coordinator']
export const DRILL_TRAINEE_ROLE_SUBSTRING = 'Collector'

// ── Source sheet for people (same one HR-code login reads) ───────────────────
export const PEOPLE_SHEET_ID  = '1bErhs3yQiJMl6PXRJFgH512wLgfm2dM6Cpj2owimLuw'
export const PEOPLE_TAB_NAMES = ['Supervisor', 'Supervisors', 'supervisors', 'SUPERVISORS']
// Supervisors tab layout: A=HR code, B=Name, C=Role, D=Email, E=Password
export const PEOPLE_COL = { hrCode: 0, name: 1, role: 2, email: 3, password: 4 }

// ── DRILL spreadsheet ────────────────────────────────────────────────────────
// Created automatically on first quiz. The ID is stored in Firestore at
// mark_config/drill so every install resolves the same spreadsheet, and a lock
// prevents two simultaneous creators producing two spreadsheets.
// The spreadsheet a creator made and shared with the service account as Editor.
// MARK cannot create this itself — a service account has no Drive storage quota
// and so can never own a file. Verified working: six tabs, read and write.
// A value in Firestore at mark_config/drill overrides this.
export const DRILL_SHEET_ID_DEFAULT = '1Pu1FsD0rPqRo4ydzMBTJgv5V8KnB601GkStd7eGV7gY'
export const DRILL_SPREADSHEET_NAME = 'MARK — DRILL'
export const DRILL_CONFIG_DOC       = 'drill'          // mark_config/drill

export const TAB_QUIZZES       = 'quizzes'
export const TAB_CLIPS         = 'quiz_clips'
export const TAB_ANSWERS       = 'quiz_answers'
export const TAB_SESSIONS      = 'quiz_sessions'
export const TAB_ANSWERS_GIVEN = 'quiz_answers_given'
export const TAB_TRAINEE_LOG   = 'trainee_sessions'
export const TAB_ASSIGNMENTS   = 'quiz_assignments'

// ── Firestore mirror collections ─────────────────────────────────────────────
export const FS_QUIZZES  = 'drill_quizzes'
export const FS_SESSIONS = 'drill_sessions'
export const FS_ANSWERS  = 'drill_answers'
export const FS_REQUESTS = 'drill_retake_requests'

// ── Scoring ──────────────────────────────────────────────────────────────────
// Flat window for every event type. Deliberately NOT per-event like
// comparisonConfig — a trainee tagging a 10s clip has no half-start reference,
// and the same 2s rule now applies in Comparison too.
export const DRILL_TOLERANCE_MS = 2000
export const DRILL_SCORING_VERSION = '1'

// Every mistake costs the same. Score is per EVENT, not per clip, so a
// multi-event clip can score partially.
export const DRILL_VERDICTS = [
  'correct',
  'missed',            // key had an event, trainee tagged nothing
  'not_needed_event',  // key had NO event, trainee tagged something
  'wrong_event',
  'wrong_team',
  'wrong_timestamp',   // right event + team, more than DRILL_TOLERANCE_MS off
  'wrong_extra',       // right event + team + timing, extras not an exact match
]
export const DRILL_ERROR_VERDICTS = DRILL_VERDICTS.filter(v => v !== 'correct')

export function computeDrillScore(counts) {
  const correct = counts.correct || 0
  const errors  = DRILL_ERROR_VERDICTS.reduce((s, v) => s + (counts[v] || 0), 0)
  const total   = correct + errors
  if (total === 0) return null
  return Math.round((correct / total) * 1000) / 10
}

// ── Session rules ────────────────────────────────────────────────────────────
export const RESUME_WINDOW_MS   = 24 * 60 * 60 * 1000  // 24h from START, then void
export const TIMER_WARNING_MIN  = 5                    // amber warning threshold
export const DRILL_LS_KEY       = 'mark_drill_session' // in-progress session

// ── Video ────────────────────────────────────────────────────────────────────
// Container list kept only to flag an unusual extension in the clip list.
// There is no playability probe: every clip in the folder is included. The
// probe rejected sound mp4s whenever a request was slow, and silently dropping
// a good clip from an answer key is worse than letting a bad one through.
export const SUPPORTED_VIDEO_EXT   = ['mp4', 'mov', 'mkv']
export const VIDEO_MIME_PREFIXES   = ['video/']

// ── Sheet columns ────────────────────────────────────────────────────────────
export const QUIZZES_COLUMNS = [
  'quiz_id', 'quiz_name', 'drive_folder_id', 'scope_event_ids',
  'time_limit_min', 'pass_mark_percent', 'clip_count', 'assigned_hr_codes',
  'quiz_version', 'status', 'created_by', 'created_at', 'updated_at',
]

export const CLIPS_COLUMNS = [
  'quiz_id', 'quiz_version', 'clip_index', 'video_filename', 'drive_file_id',
  'instruction', 'expected_event_count', 'is_no_event', 'is_excluded',
  'is_missing', 'playable',
]

// attr_* names are IDENTICAL to tag_events so comparison code runs on both
// without translation.
export const DRILL_ATTR_COLUMNS = [
  'attr_team_side', 'attr_attacking_direction', 'attr_video', 'attr_height',
  'attr_body_part', 'attr_extras', 'attr_technique', 'attr_gk_body_state',
  'attr_outcome', 'attr_type', 'attr_miscommunication', 'attr_action',
  'attr_location', 'attr_launch', 'attr_side', 'attr_direction', 'attr_kind',
  'attr_paused',
]

export const ANSWERS_COLUMNS = [
  'quiz_id', 'quiz_version', 'clip_index', 'event_index',
  'answer_event_code', 'answer_team', 'answer_video_time_ms', 'answer_video_time_readable',
  ...DRILL_ATTR_COLUMNS.map(a => 'answer_' + a),
]

export const SESSIONS_COLUMNS = [
  'result_id', 'quiz_id', 'quiz_version', 'trainee_hr_code', 'trainee_email',
  'attempt_number', 'started_at', 'finished_at', 'score_percent', 'passed',
  'total_events', 'correct_count', 'missed_count', 'not_needed_count',
  'wrong_event_count', 'wrong_team_count', 'wrong_timestamp_count',
  'wrong_extra_count', 'total_time_taken_ms', 'total_time_taken_readable', 'is_test_run', 'status',
]

export const ANSWERS_GIVEN_COLUMNS = [
  'result_id', 'clip_index', 'event_index',
  'trainee_event_code', 'trainee_team', 'trainee_video_time_ms', 'trainee_video_time_readable',
  ...DRILL_ATTR_COLUMNS.map(a => 'trainee_' + a),
  'correct_event_code', 'correct_team', 'correct_video_time_ms', 'correct_video_time_readable',
  ...DRILL_ATTR_COLUMNS.map(a => 'correct_' + a),
  'verdict', 'delta_ms', 'attrs_differed', 'clip_time_taken_ms', 'clip_time_taken_readable',
]

export const ASSIGNMENTS_COLUMNS = [
  'quiz_id', 'trainee_hr_code', 'trainee_name', 'assigned_at', 'assigned_by',
  'attempts_granted', 'status',
]

export const TRAINEE_LOG_COLUMNS = [
  'trainee_hr_code', 'trainee_email', 'session_type', 'session_id_or_quiz_id',
  'session_date', 'match_id_or_quiz_name', 'scope', 'score_percent',
  'total_events_or_clips', 'correct_count', 'missed_count',
  'wrong_event_count', 'wrong_extra_count', 'time_taken_ms', 'time_taken_readable', 'version',
]

export const DRILL_TABS = [
  { name: TAB_QUIZZES,       columns: QUIZZES_COLUMNS },
  { name: TAB_CLIPS,         columns: CLIPS_COLUMNS },
  { name: TAB_ANSWERS,       columns: ANSWERS_COLUMNS },
  { name: TAB_SESSIONS,      columns: SESSIONS_COLUMNS },
  { name: TAB_ANSWERS_GIVEN, columns: ANSWERS_GIVEN_COLUMNS },
  { name: TAB_TRAINEE_LOG,   columns: TRAINEE_LOG_COLUMNS },
  { name: TAB_ASSIGNMENTS,   columns: ASSIGNMENTS_COLUMNS },
]

// ── Status values ────────────────────────────────────────────────────────────
export const QUIZ_STATUS    = { DRAFT: 'draft', PUBLISHED: 'published' }
export const SESSION_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED:   'completed',
  TIMED_OUT:   'timed_out',
  VOID:        'void',        // not resumed inside RESUME_WINDOW_MS
}
export const REQUEST_STATUS = {
  PENDING:  'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
}

export function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
