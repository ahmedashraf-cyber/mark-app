// Tornado event shortcuts — same keys used in collection app
export const TORNADO_EVENTS = [
  { key: 'S', id: 'half_start',     label: 'Half Start' },
  { key: 'E', id: 'pass',           label: 'Pass' },
  { key: 'Q', id: 'pass_flight',    label: 'Pass (Flight)' },
  { key: 'D', id: 'dribble',        label: 'Dribble' },
  { key: 'T', id: 'miscontrol',     label: 'Miscontrol' },
  { key: 'W', id: 'reception',      label: 'Reception' },
  { key: 'B', id: 'block',          label: 'Block' },
  { key: 'R', id: 'ball_recovery',  label: 'Ball Recovery' },
  { key: 'F', id: 'clearance',      label: 'Clearance' },
  { key: 'G', id: 'goal_keeper',    label: 'Goal Keeper' },
  { key: 'A', id: 'tackle',         label: 'Tackle' },
  { key: 'V', id: 'interception',   label: 'Interception' },
  { key: 'X', id: 'foul_committed', label: 'Foul Committed' },
  { key: 'O', id: 'out',            label: 'Out' },
  { key: 'C', id: 'shield',         label: 'Shield' },
  { key: 'Z', id: 'shot',           label: 'Shot' },
]

// Y key = Missing Event (MARK-only)
export const MISSING_EVENT_KEY = 'Y'

// ── Video navigation shortcuts (matches collection app exactly) ───────────────
//   ↑            Play / Pause
//   →            Fast Forward  400ms
//   ←            Fast Backward 400ms
//   Shift + →    Slow Forward   40ms
//   Shift + ←    Slow Backward  40ms
//   0            Reset speed to 1x
//   + / =        Increase speed +0.25 (max 2x)
//   - / _        Decrease speed -0.25 (min 0.25x)

export const SPEED_MIN  = 0.25
export const SPEED_MAX  = 2.00
export const SPEED_STEP = 0.25

export const NAV_SHORTCUTS = {
  ArrowUp:    { action: 'playpause', ms: 0   },
  ArrowRight: { action: 'forward',   ms: 400 },
  ArrowLeft:  { action: 'backward',  ms: 400 },
}
export const NAV_SHIFT_SHORTCUTS = {
  ArrowRight: { action: 'forward',   ms: 40 },
  ArrowLeft:  { action: 'backward',  ms: 40 },
}

// Map key to event for fast lookup
export const KEY_TO_EVENT = Object.fromEntries(
  TORNADO_EVENTS.map(e => [e.key.toUpperCase(), e])
)
