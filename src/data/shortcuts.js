// Tornado event shortcuts — same keys used in collection app
export const TORNADO_EVENTS = [
  // ── Keyboard events ──────────────────────────────────────────────────────────
  { key: 'E', id: 'pass',              label: 'Pass',              mouse: false },
  { key: 'S', id: 'shot',              label: 'Shot',              mouse: false },
  { key: 'D', id: 'dribble',           label: 'Dribble',           mouse: false },
  { key: 'W', id: 'reception',         label: 'Reception',         mouse: false },
  { key: 'T', id: 'miscontrol',        label: 'Miscontrol',        mouse: false },
  { key: 'P', id: 'pressure',          label: 'Pressure',          mouse: false },
  { key: '0', id: 'fifty_fifty',       label: 'Fifty Fifty',       mouse: false },
  { key: 'O', id: 'out',               label: 'Out',               mouse: false },
  { key: 'X', id: 'foul_committed',    label: 'Foul Committed',    mouse: false },
  { key: 'C', id: 'shield',            label: 'Shield',            mouse: false },
  { key: 'B', id: 'block',             label: 'Block',             mouse: false },
  { key: 'V', id: 'interception',      label: 'Interception',      mouse: false },
  { key: 'K', id: 'tackle',            label: 'Tackle',            mouse: false },
  { key: 'R', id: 'ball_recovery',     label: 'Ball Recovery',     mouse: false },
  { key: 'F', id: 'clearance',         label: 'Clearance',         mouse: false },
  { key: 'H', id: 'hold_up_duel',      label: 'Hold Up Duel',      mouse: false },
  { key: 'Y', id: 'positioning_duel',  label: 'Positioning Duel',  mouse: false },
  { key: 'L', id: 'separation_duel',   label: 'Separation Duel',   mouse: false },
  { key: 'M', id: 'leg_stretch_duel',  label: 'Leg Stretch Duel',  mouse: false },
  { key: 'G', id: 'goal_keeper',       label: 'Goal Keeper',       mouse: false },
  // ── Mouse-click events (no keyboard shortcut) ─────────────────────────────
  { key: null, id: 'error',            label: 'Error',             mouse: true  },
  { key: null, id: 'own_goal_against', label: 'Own Goal Against',  mouse: true  },
  { key: null, id: 'stoppage',         label: 'Stoppage',          mouse: true  },
  { key: null, id: 'substitution',     label: 'Substitution',      mouse: true  },
  { key: null, id: 'tactical_shift',   label: 'Tactical Shift',    mouse: true  },
  { key: null, id: 'formation',        label: 'Formation',         mouse: true  },
]

// Q key = Missing Event (MARK-only)
export const MISSING_EVENT_KEY = 'Q'

// ── Video navigation shortcuts (matches collection app exactly) ───────────────
//   ↑            Play / Pause
//   →            Fast Forward  400ms
//   ←            Fast Backward 400ms
//   Shift + →    Slow Forward   40ms
//   Shift + ←    Slow Backward  40ms
//   0            Reset speed to 1x  ← NOTE: 0 is also Fifty Fifty event key
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

// Map key to event for fast lookup (keyboard events only)
export const KEY_TO_EVENT = Object.fromEntries(
  TORNADO_EVENTS
    .filter(e => e.key !== null)
    .map(e => [e.key.toUpperCase(), e])
)
