/**
 * shortcuts.js — single source of truth for MARK's tagging keys & video nav.
 * ============================================================================
 *
 * WHAT THIS FILE IS
 *   Every taggable event, its keyboard key, and the video playback controls
 *   live here. Two other modules read from this file and MUST stay consistent
 *   with it:
 *     • EventsSidebar.jsx — renders the on-screen key labels. (It keeps its own
 *       LEFT/RIGHT arrays for layout, so when a key changes here, change it
 *       there too — the labels are display-only and won't auto-sync.)
 *     • ReviewPage.jsx    — the keyboard handler, which looks events up via the
 *       KEY_TO_EVENT map exported at the bottom.
 *
 * TORNADO_EVENTS — one entry per taggable event. Field meanings:
 *   • key        Keyboard shortcut (uppercase letter / digit). `null` = the
 *                event has no shortcut and can only be tagged by mouse click.
 *   • id         Stable internal id (snake_case). Used everywhere in code and
 *                stored on saved tags — NEVER rename without a data migration.
 *   • label      Human-readable name shown in the UI.
 *   • mouse      true  → mouse-click event (rendered as a clickable card).
 *                false → keyboard event.
 *   • sheetEvent Canonical name in the error-correction taxonomy sheet
 *                (src/data/tagging_scenarios.js). This is the join key the
 *                TagPanel uses to look up which error types / corrections /
 *                extras apply. `null` = the event isn't in the taxonomy, so the
 *                tag panel shows no sheet-derived error options for it.
 *
 * KEY-MAP HISTORY (so the current letters aren't surprising)
 *   v7.3.3 reshuffled 7 keys at the owner's request and REMOVED the standalone
 *   "Missing Event" feature so its old `Q` could go to Pass (First time):
 *     Leg Stretch M→U · Tackle K→A · Pass Recovery N→P · Goal Keeper G→K ·
 *     Pressure P→G · Pass (First time) U→Q · Separation L→J.
 *   There are intentionally no duplicate keys — guard this when editing.
 */
export const TORNADO_EVENTS = [
  // ── Keyboard events ──────────────────────────────────────────────────────────
  { key: 'E', id: 'pass',              label: 'Pass',              mouse: false, sheetEvent: 'Pass' },
  { key: 'S', id: 'shot',              label: 'Shot',              mouse: false, sheetEvent: 'Shot' },
  { key: 'D', id: 'dribble',           label: 'Dribble',           mouse: false, sheetEvent: 'Dribble' },
  { key: 'W', id: 'reception',         label: 'Reception',         mouse: false, sheetEvent: 'Reception' },
  { key: 'T', id: 'miscontrol',        label: 'Miscontrol',        mouse: false, sheetEvent: 'Miscontrol' },
  { key: 'G', id: 'pressure',          label: 'Pressure',          mouse: false, sheetEvent: null },
  { key: '0', id: 'fifty_fifty',       label: 'Fifty Fifty',       mouse: false, sheetEvent: 'Fifty fifty' },
  { key: 'O', id: 'out',               label: 'Out',               mouse: false, sheetEvent: null },
  { key: 'X', id: 'foul_committed',    label: 'Foul Committed',    mouse: false, sheetEvent: 'Foul committed' },
  { key: 'C', id: 'shield',            label: 'Shield',            mouse: false, sheetEvent: 'Shield' },
  { key: 'B', id: 'block',             label: 'Block',             mouse: false, sheetEvent: 'Block' },
  { key: 'V', id: 'interception',      label: 'Interception',      mouse: false, sheetEvent: 'Interception' },
  { key: 'A', id: 'tackle',            label: 'Tackle',            mouse: false, sheetEvent: 'Tackle' },
  { key: 'R', id: 'ball_recovery',     label: 'Ball Recovery',     mouse: false, sheetEvent: 'Ball recovery' },
  { key: 'F', id: 'clearance',         label: 'Clearance',         mouse: false, sheetEvent: 'Clearance' },
  { key: 'H', id: 'hold_up_duel',      label: 'Hold Up Duel',      mouse: false, sheetEvent: 'Hold up duel' },
  { key: 'Y', id: 'positioning_duel',  label: 'Positioning Duel',  mouse: false, sheetEvent: 'Positioning duel' },
  { key: 'J', id: 'separation_duel',   label: 'Separation Duel',   mouse: false, sheetEvent: 'Separation duel' },
  { key: 'U', id: 'leg_stretch_duel',  label: 'Leg Stretch Duel',  mouse: false, sheetEvent: 'Leg stretch duel' },
  { key: 'K', id: 'goal_keeper',       label: 'Goal Keeper',       mouse: false, sheetEvent: 'Goal Keeper' },
  { key: 'I', id: 'pass_interception',  label: 'Pass Interception',  mouse: false, sheetEvent: 'Pass interception' },
  { key: 'P', id: 'pass_recovery',      label: 'Pass Recovery',       mouse: false, sheetEvent: 'Pass recovery' },
  { key: 'Q', id: 'pass_first_time',    label: 'Pass (First time)',   mouse: false, sheetEvent: 'Pass (First time)' },
  // ── Mouse-click events (no keyboard shortcut) ─────────────────────────────
  { key: null, id: 'card',              label: 'Card',              mouse: true,  sheetEvent: 'Card' },
  { key: null, id: 'error',             label: 'Error',             mouse: true,  sheetEvent: null },
  { key: null, id: 'own_goal_against',  label: 'Own Goal Against',  mouse: true,  sheetEvent: null },
  { key: null, id: 'stoppage',          label: 'Stoppage',          mouse: true,  sheetEvent: null },
  { key: null, id: 'substitution',      label: 'Substitution',      mouse: true,  sheetEvent: null },
  { key: null, id: 'tactical_shift',    label: 'Tactical Shift',    mouse: true,  sheetEvent: null },
  { key: null, id: 'formation',         label: 'Formation',         mouse: true,  sheetEvent: null },
  { key: null, id: 'camera_off',        label: 'Camera Off',        mouse: true,  sheetEvent: null },
  { key: null, id: 'camera_on',         label: 'Camera On',         mouse: true,  sheetEvent: null },
]

// ── Video navigation shortcuts (matches collection app exactly) ───────────────
// ↑ Play / Pause
// → Fast Forward 400ms
// ← Fast Backward 400ms
// Shift + → Slow Forward 40ms
// Shift + ← Slow Backward 40ms
// 0 Reset speed to 1x ← NOTE: 0 is also Fifty Fifty event key
// + / = Increase speed +0.25 (max 2x)
// - / _ Decrease speed -0.25 (min 0.25x)

export const SPEED_MIN = 0.25
export const SPEED_MAX = 2.00
export const SPEED_STEP = 0.25

export const NAV_SHORTCUTS = {
  ArrowUp:    { action: 'playpause', ms: 0 },
  ArrowRight: { action: 'forward',   ms: 400 },
  ArrowLeft:  { action: 'backward',  ms: 400 },
}
export const NAV_SHIFT_SHORTCUTS = {
  ArrowRight: { action: 'forward',  ms: 40 },
  ArrowLeft:  { action: 'backward', ms: 40 },
}

// Map key to event for fast lookup (keyboard events only)
export const KEY_TO_EVENT = Object.fromEntries(
  TORNADO_EVENTS
    .filter(e => e.key !== null)
    .map(e => [e.key.toUpperCase(), e])
)
