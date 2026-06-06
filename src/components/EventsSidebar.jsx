import { MISSING_EVENT_KEY } from '../data/shortcuts'

// ── LEFT: Offense events ──────────────────────────────────────────────────────
const LEFT_EVENTS = [
  { key: 'E',    label: 'Pass',            id: 'pass' },
  { key: 'S',    label: 'Shot',            id: 'shot' },
  { key: 'D',    label: 'Dribble',         id: 'dribble' },
  { key: 'W',    label: 'Reception',       id: 'reception' },
  { key: 'T',    label: 'Miscontrol',      id: 'miscontrol' },
  { key: 'P',    label: 'Pressure',        id: 'pressure' },
  { key: '0',    label: 'Fifty Fifty',     id: 'fifty_fifty' },
  { key: 'O',    label: 'Out',             id: 'out' },
  { key: 'X',    label: 'Foul Committed',  id: 'foul_committed' },
  { key: 'C',    label: 'Shield',          id: 'shield' },
  // Mouse-click events
  { key: null,   label: 'Error',           id: 'error' },
  { key: null,   label: 'Own Goal Against',id: 'own_goal_against' },
  { key: null,   label: 'Stoppage',        id: 'stoppage' },
  { key: null,   label: 'Substitution',    id: 'substitution' },
  { key: null,   label: 'Tactical Shift',  id: 'tactical_shift' },
  { key: null,   label: 'Formation',       id: 'formation' },
]

// ── RIGHT: Defense events ─────────────────────────────────────────────────────
const RIGHT_EVENTS = [
  { key: 'B',    label: 'Block',            id: 'block' },
  { key: 'V',    label: 'Interception',     id: 'interception' },
  { key: 'K',    label: 'Tackle',           id: 'tackle' },
  { key: 'R',    label: 'Ball Recovery',    id: 'ball_recovery' },
  { key: 'F',    label: 'Clearance',        id: 'clearance' },
  { key: 'H',    label: 'Hold Up Duel',     id: 'hold_up_duel' },
  { key: 'Y',    label: 'Positioning Duel', id: 'positioning_duel' },
  { key: 'L',    label: 'Separation Duel',  id: 'separation_duel' },
  { key: 'M',    label: 'Leg Stretch Duel', id: 'leg_stretch_duel' },
  { key: 'G',    label: 'Goal Keeper',      id: 'goal_keeper' },
]

const MISSING = { key: MISSING_EVENT_KEY, label: 'Missing Event' }

function EventRow({ ev, active, onClick }) {
  const isMouseOnly = ev.key === null
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 10px',
        borderBottom: '1px solid var(--b-1)',
        background: active ? 'rgba(232,89,12,0.15)' : 'transparent',
        cursor: isMouseOnly ? 'pointer' : 'default',
        transition: 'background .1s',
      }}
      onMouseEnter={e => { if (isMouseOnly) e.currentTarget.style.background = 'rgba(232,89,12,0.08)' }}
      onMouseLeave={e => { if (isMouseOnly && !active) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        fontSize: 12,
        color: active ? 'var(--p2)' : isMouseOnly ? 'var(--t-3)' : 'var(--t-2)',
        fontWeight: active ? 700 : 400,
        fontFamily: 'DM Sans, sans-serif',
      }}>
        {ev.label}
      </span>
      {ev.key !== null ? (
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11, fontWeight: 700,
          color: active ? 'var(--p2)' : 'var(--t-3)',
          background: active ? 'rgba(232,89,12,0.15)' : 'var(--bg-3)',
          border: `1px solid ${active ? 'rgba(232,89,12,0.4)' : 'var(--b-2)'}`,
          borderRadius: 4, padding: '1px 6px',
          minWidth: 20, textAlign: 'center',
        }}>
          {ev.key}
        </span>
      ) : (
        <span style={{
          fontSize: 9, color: 'var(--t-3)', fontStyle: 'italic',
          opacity: 0.6,
        }}>
          click
        </span>
      )}
    </div>
  )
}

export default function EventsSidebar({ side, activeKey, onMouseEvent }) {
  const events = side === 'left' ? LEFT_EVENTS : RIGHT_EVENTS
  const activeUpper = activeKey ? activeKey.toUpperCase() : null

  return (
    <div style={{
      width: 165,
      flexShrink: 0,
      background: 'var(--bg-2)',
      borderLeft: side === 'right' ? '1px solid var(--b-1)' : 'none',
      borderRight: side === 'left' ? '1px solid var(--b-1)' : 'none',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid var(--b-1)',
        fontSize: 10, fontWeight: 700,
        color: 'var(--t-3)', letterSpacing: 1,
        textTransform: 'uppercase',
      }}>
        {side === 'left' ? 'Offense' : 'Defense'}
      </div>

      {/* Events */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {events.map(ev => (
          <EventRow
            key={ev.id}
            ev={ev}
            active={ev.key !== null && activeUpper === ev.key}
            onClick={ev.key === null ? () => onMouseEvent?.(ev) : undefined}
          />
        ))}

        {/* Missing event — only on left sidebar */}
        {side === 'left' && (
          <>
            <div style={{ height: 1, background: 'rgba(232,89,12,0.3)', margin: '4px 0' }}/>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 10px',
              background: activeUpper === MISSING.key ? 'rgba(191,90,242,0.15)' : 'transparent',
            }}>
              <span style={{
                fontSize: 12,
                color: activeUpper === MISSING.key ? '#BF5AF2' : 'var(--t-2)',
                fontWeight: activeUpper === MISSING.key ? 700 : 400,
              }}>
                {MISSING.label}
              </span>
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700,
                color: activeUpper === MISSING.key ? '#BF5AF2' : 'var(--t-3)',
                background: activeUpper === MISSING.key ? 'rgba(191,90,242,0.15)' : 'var(--bg-3)',
                border: `1px solid ${activeUpper === MISSING.key ? 'rgba(191,90,242,0.4)' : 'var(--b-2)'}`,
                borderRadius: 4, padding: '1px 6px', minWidth: 20, textAlign: 'center',
              }}>
                {MISSING.key}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
