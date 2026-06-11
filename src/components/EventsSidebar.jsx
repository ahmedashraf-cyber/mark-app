import { MISSING_EVENT_KEY } from '../data/shortcuts'

const LEFT_EVENTS = [
  { key: 'E',    label: 'Pass',              id: 'pass' },
  { key: 'I',    label: 'Pass Interception', id: 'pass_interception' },
  { key: 'N',    label: 'Pass Recovery',     id: 'pass_recovery' },
  { key: 'U',    label: 'Pass (First time)', id: 'pass_first_time' },
  { key: 'S',    label: 'Shot',              id: 'shot' },
  { key: 'D',    label: 'Dribble',         id: 'dribble' },
  { key: 'W',    label: 'Reception',       id: 'reception' },
  { key: 'T',    label: 'Miscontrol',      id: 'miscontrol' },
  { key: '0',    label: 'Fifty Fifty',     id: 'fifty_fifty' },
  { key: 'O',    label: 'Out',             id: 'out' },
  { key: 'X',    label: 'Foul Committed',  id: 'foul_committed' },
  { key: 'C',    label: 'Shield',          id: 'shield' },
  { key: null,   label: 'Card',            id: 'card' },
  { key: null,   label: 'Error',           id: 'error' },
  { key: null,   label: 'Own Goal Against',id: 'own_goal_against' },
  { key: null,   label: 'Stoppage',        id: 'stoppage' },
  { key: null,   label: 'Substitution',    id: 'substitution' },
  { key: null,   label: 'Tactical Shift',  id: 'tactical_shift' },
  { key: null,   label: 'Formation',       id: 'formation' },
]

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
  { key: 'P',    label: 'Pressure',         id: 'pressure' },
]

const MISSING = { key: MISSING_EVENT_KEY, label: 'Missing Event' }

function EventCard({ ev, active, onClick }) {
  const isMouseOnly = ev.key === null
  return (
    <div
      onClick={onClick}
      className={`event-card ${active ? 'active' : ''} ${isMouseOnly ? 'mouse-only' : ''}`}
      style={{ cursor: isMouseOnly || active ? 'pointer' : 'default' }}
    >
      <span style={{
        fontSize: 12,
        color: active ? 'var(--p2)' : isMouseOnly ? 'var(--t-3)' : 'var(--t-2)',
        fontWeight: active ? 700 : 400,
        fontFamily: 'DM Sans, sans-serif',
        letterSpacing: active ? 0.1 : 0,
        transition: 'color 0.15s ease, font-weight 0.1s ease',
      }}>
        {ev.label}
      </span>
      {ev.key !== null ? (
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10, fontWeight: 700,
          color: active ? 'var(--p2)' : 'var(--t-3)',
          background: active ? 'rgba(232,89,12,0.18)' : 'var(--bg-3)',
          border: `1px solid ${active ? 'rgba(232,89,12,0.45)' : 'var(--b-2)'}`,
          borderRadius: 4, padding: '1px 6px',
          minWidth: 20, textAlign: 'center',
          transition: 'all 0.15s ease',
          boxShadow: active ? '0 0 6px rgba(232,89,12,0.3)' : 'none',
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
      width: 168, flexShrink: 0,
      background: 'linear-gradient(180deg, var(--bg-2) 0%, rgba(10,10,18,0.95) 100%)',
      borderLeft:  side === 'right' ? '1px solid var(--b-1)' : 'none',
      borderRight: side === 'left'  ? '1px solid var(--b-1)' : 'none',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px 7px',
        borderBottom: '1px solid var(--b-1)',
        fontSize: 9, fontWeight: 800,
        color: side === 'left' ? 'var(--p2)' : '#0A84FF',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        fontFamily: 'Inter, sans-serif',
        background: side === 'left'
          ? 'rgba(232,89,12,0.06)'
          : 'rgba(10,132,255,0.06)',
      }}>
        {side === 'left' ? 'Offense' : 'Defense'}
      </div>

      {/* Events */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {events.map(ev => (
          <EventCard
            key={ev.id}
            ev={ev}
            active={ev.key !== null && activeUpper === ev.key}
            onClick={ev.key === null ? () => onMouseEvent?.(ev) : undefined}
          />
        ))}

        {/* Missing event — left sidebar only */}
        {side === 'left' && (
          <>
            <div style={{
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(191,90,242,0.3), transparent)',
              margin: '6px 10px',
            }}/>
            <div
              className={`event-card ${activeUpper === MISSING.key ? 'active' : ''}`}
              style={{
                cursor: 'default',
                ...(activeUpper === MISSING.key ? {
                  background: 'rgba(191,90,242,0.14)',
                  borderColor: 'rgba(191,90,242,0.35)',
                  boxShadow: '0 2px 12px rgba(191,90,242,0.2)',
                } : {}),
              }}
            >
              <span style={{
                fontSize: 12,
                color: activeUpper === MISSING.key ? '#BF5AF2' : 'var(--t-2)',
                fontWeight: activeUpper === MISSING.key ? 700 : 400,
                fontFamily: 'DM Sans, sans-serif',
                transition: 'color 0.15s ease',
              }}>
                {MISSING.label}
              </span>
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
                color: activeUpper === MISSING.key ? '#BF5AF2' : 'var(--t-3)',
                background: activeUpper === MISSING.key ? 'rgba(191,90,242,0.18)' : 'var(--bg-3)',
                border: `1px solid ${activeUpper === MISSING.key ? 'rgba(191,90,242,0.45)' : 'var(--b-2)'}`,
                borderRadius: 4, padding: '1px 6px', minWidth: 20, textAlign: 'center',
                transition: 'all 0.15s ease',
                boxShadow: activeUpper === MISSING.key ? '0 0 6px rgba(191,90,242,0.3)' : 'none',
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
