// Tornado event shortcuts — same keys used in collection app
// In MARK, pressing these keys tags an ERROR on that event type

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

// Navigation shortcuts (same as collection app)
export const NAV_SHORTCUTS = {
  ArrowRight: { action: 'forward',      ms: 600  },
  ArrowLeft:  { action: 'backward',     ms: 600  },
  ' ':        { action: 'playpause',    ms: 0    },
}
export const NAV_SHIFT_SHORTCUTS = {
  ArrowRight: { action: 'forward',      ms: 200  },
  ArrowLeft:  { action: 'backward',     ms: 200  },
}

// Map key to event for fast lookup
export const KEY_TO_EVENT = Object.fromEntries(
  TORNADO_EVENTS.map(e => [e.key.toUpperCase(), e])
)
