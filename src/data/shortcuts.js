// Tornado event shortcuts — same keys used in collection app
// MARK 4.1.0 — added Pass Interception (I) and Card (mouse) per official taxonomy.
// `sheetEvent` maps each MARK event to its canonical name in the error-correction sheet
// (so ErrorTagModal can look up which error types / corrections apply to it).
// `sheetEvent: null` means the event isn't part of the error-correction taxonomy.
export const TORNADO_EVENTS = [
  // ── Keyboard events ──────────────────────────────────────────────────────────
  { key: 'E', id: 'pass',              label: 'Pass',              mouse: false, sheetEvent: 'Pass' },
  { key: 'S', id: 'shot',              label: 'Shot',              mouse: false, sheetEvent: 'Shot' },
  { key: 'D', id: 'dribble',           label: 'Dribble',           mouse: false, sheetEvent: 'Dribble' },
  { key: 'W', id: 'reception',         label: 'Reception',         mouse: false, sheetEvent: 'Reception' },
  { key: 'T', id: 'miscontrol',        label: 'Miscontrol',        mouse: false, sheetEvent: 'Miscontrol' },
  { key: 'P', id: 'pressure',          label: 'Pressure',          mouse: false, sheetEvent: null },
  { key: '0', id: 'fifty_fifty',       label: 'Fifty Fifty',       mouse: false, sheetEvent: 'Fifty fifty' },
  { key: 'O', id: 'out',               label: 'Out',               mouse: false, sheetEvent: null },
  { key: 'X', id: 'foul_committed',    label: 'Foul Committed',    mouse: false, sheetEvent: 'Foul committed' },
  { key: 'C', id: 'shield',            label: 'Shield',            mouse: false, sheetEvent: 'Shield' },
  { key: 'B', id: 'block',             label: 'Block',             mouse: false, sheetEvent: 'Block' },
  { key: 'V', id: 'interception',      label: 'Interception',      mouse: false, sheetEvent: 'Interception' },
  { key: 'K', id: 'tackle',            label: 'Tackle',            mouse: false, sheetEvent: 'Tackle' },
  { key: 'R', id: 'ball_recovery',     label: 'Ball Recovery',     mouse: false, sheetEvent: 'Ball recovery' },
  { key: 'F', id: 'clearance',         label: 'Clearance',         mouse: false, sheetEvent: 'Clearance' },
  { key: 'H', id: 'hold_up_duel',      label: 'Hold Up Duel',      mouse: false, sheetEvent: 'Hold up duel' },
  { key: 'Y', id: 'positioning_duel',  label: 'Positioning Duel',  mouse: false, sheetEvent: 'Positioning duel' },
  { key: 'L', id: 'separation_duel',   label: 'Separation Duel',   mouse: false, sheetEvent: 'Separation duel' },
  { key: 'M', id: 'leg_stretch_duel',  label: 'Leg Stretch Duel',  mouse: false, sheetEvent: 'Leg stretch duel' },
  { key: 'G', id: 'goal_keeper',       label: 'Goal Keeper',       mouse: false, sheetEvent: 'Goal Keeper' },
  { key: 'I', id: 'pass_interception',  label: 'Pass Interception',  mouse: false, sheetEvent: 'Pass interception' },
  { key: 'N', id: 'pass_recovery',      label: 'Pass Recovery',       mouse: false, sheetEvent: 'Pass recovery' },
  { key: 'U', id: 'pass_first_time',    label: 'Pass (First time)',   mouse: false, sheetEvent: 'Pass (First time)' },
  // ── Mouse-click events (no keyboard shortcut) ─────────────────────────────
  { key: null, id: 'card',              label: 'Card',              mouse: true,  sheetEvent: 'Card' },
  { key: null, id: 'error',             label: 'Error',             mouse: true,  sheetEvent: null },
  { key: null, id: 'own_goal_against',  label: 'Own Goal Against',  mouse: true,  sheetEvent: null },
  { key: null, id: 'stoppage',          label: 'Stoppage',          mouse: true,  sheetEvent: null },
  { key: null, id: 'substitution',      label: 'Substitution',      mouse: true,  sheetEvent: null },
  { key: null, id: 'tactical_shift',    label: 'Tactical Shift',    mouse: true,  sheetEvent: null },
  { key: null, id: 'formation',         label: 'Formation',         mouse: true,  sheetEvent: null },
]

// Q key = Missing Event (MARK-only)
export const MISSING_EVENT_KEY = 'Q'

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
