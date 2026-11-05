/**
 * selfReviewDashboardConfig.js: the ONE place that says where Self-Review results live.
 * ============================================================================
 * Self-Review saves its results to, and the Self-Review dashboard reads them from, the "Collector Self Review" tab of the
 * "Mark Field Collected Data" spreadsheet (FIELD_SHEET_ID). The old copy of this tab sits in the Sampled Halves spreadsheet
 * and is no longer read or written.
 *
 * Nothing else may hold this spreadsheet id or tab name as a literal. selfReviewSheet.js and the dashboard both import them
 * from here.
 */
import { FIELD_SHEET_ID } from './fieldConfig.js'
import { PEOPLE_SHEET_ID } from './drillConfig.js'

export const SELF_REVIEW_RESULTS_SPREADSHEET_ID = FIELD_SHEET_ID
export const SELF_REVIEW_RESULTS_TAB = 'Collector Self Review'

// The authoritative 19-column header (v7.12.9+). A tab that has not been written to since then still has the 17-column
// header, so the dashboard accepts either, exactly, and nothing else.
export const SELF_REVIEW_HEADER = [
  'run_id','saved_at_iso','collector_hr_code','match_id','half',
  'score_percent','trainer_rows','matched','missed','collector_only',
  'status','event','trainer_time','collector_time','delta_s',
  'trainer_error_type','collector_error_type',
  'wrong_event','collector_event',
]
export const SELF_REVIEW_HEADER_LEGACY = SELF_REVIEW_HEADER.slice(0, 17)

// ── Pass mark ───────────────────────────────────────────────────────────────
// Stored in the existing key/value `config` tab of the People spreadsheet (the same tab that holds minimum_version).
// A build can point this at a COPY of that spreadsheet with VITE_SELF_REVIEW_CONFIG_SHEET_ID, so a test installer never
// touches production. A normal build leaves it unset and uses the real People spreadsheet.
// The variable is read by its STATIC NAME so Vite replaces just that one value (or `undefined`). Never write `import.meta.env && ...`
// here: a bare reference to import.meta.env makes Vite embed the whole environment object in the bundle. (Outside Vite, as in the unit
// tests, import.meta.env does not exist: the try/catch turns that into "not set".)
const fromBuild = (() => { try { return import.meta.env.VITE_SELF_REVIEW_CONFIG_SHEET_ID } catch { return undefined } })()
export const SELF_REVIEW_CONFIG_SPREADSHEET_ID = fromBuild || PEOPLE_SHEET_ID
export const PASS_MARK_KEY = 'self_review_pass_mark'
export const PASS_MARK_DEFAULT = 85
export const PASS_MARK_OPTIONS = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]
export const PASS_MARK_AMBER_BAND = 10          // within this many points below the pass mark = amber

// A run's stored score must agree with its own counts to within this many points (the app stores one decimal)
export const SCORE_CHECK_TOLERANCE = 0.1
// "vs earlier" is only meaningful when the reviews in view span at least this many days (two weeks)
export const TREND_DELTA_MIN_SPAN_DAYS = 14

// Two reads closer together than this share one network call (protects the Sheets quota). Every filter change still asks.
export const DASH_MIN_READ_GAP_MS = 5000
