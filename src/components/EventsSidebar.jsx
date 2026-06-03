// Shows tornado event shortcuts on left and right sides during review
// Same layout concept as the collection app sidebars

import { TORNADO_EVENTS, MISSING_EVENT_KEY } from '../data/shortcuts'

// Split events into left (offense-ish) and right (defense-ish) columns
// Based on the tornado app sidebar grouping
const LEFT_EVENTS = [
  { key: 'S', label: 'Half Start',    id: 'half_start' },
  { key: 'E', label: 'Pass',          id: 'pass' },
  { key: 'Q', label: 'Pass (Flight)', id: 'pass_flight' },
  { key: 'D', label: 'Dribble',       id: 'dribble' },
  { key: 'T', label: 'Miscontrol',    id: 'miscontrol' },
  { key: 'W', label: 'Reception',     id: 'reception' },
  { key: 'Z', label: 'Shot',          id: 'shot' },
  { key: 'X', label: 'Foul',          id: 'foul_committed' },
  { key: 'O', label: 'Out',           id: 'out' },
  { key: 'C', label: 'Shield',        id: 'shield' },
]

const RIGHT_EVENTS = [
  { key: 'B', label: 'Block',         id: 'block' },
  { key: 'R', label: 'Ball Recovery', id: 'ball_recovery' },
  { key: 'F', label: 'Clearance',     id: 'clearance' },
  { key: 'G', label: 'Goal Keeper',   id: 'goal_keeper' },
  { key: 'A', label: 'Tackle',        id: 'tackle' },
  { key: 'V', label: 'Interception',  id: 'interception' },
]

const MISSING = { key: 'Y', label: 'Missing Event', id: 'missing_event' }

function EventRow({ ev, active }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '7px 10px',
      borderBottom: '1px solid var(--b-1)',
      background: active ? 'rgba(232,89,12,0.15)' : 'transparent',
      transition: 'background .1s',
    }}>
      <span style={{
        fontSize: 12,
        color: active ? 'var(--p2)' : 'var(--t-2)',
        fontWeight: active ? 700 : 400,
        fontFamily: 'DM Sans, sans-serif',
      }}>
        {ev.label}
      </span>
      <span style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        fontWeight: 700,
        color: active ? 'var(--p2)' : 'var(--t-3)',
        background: active ? 'rgba(232,89,12,0.15)' : 'var(--bg-3)',
        border: `1px solid ${active ? 'rgba(232,89,12,0.4)' : 'var(--b-2)'}`,
        borderRadius: 4,
        padding: '1px 6px',
        minWidth: 20,
        textAlign: 'center',
      }}>
        {ev.key}
      </span>
    </div>
  )
}

export default function EventsSidebar({ side, activeKey }) {
  const events = side === 'left' ? LEFT_EVENTS : RIGHT_EVENTS
  const activeUpper = activeKey ? activeKey.toUpperCase() : null

  return (
    <div style={{
      width: 160,
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
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--t-3)',
        letterSpacing: 1,
        textTransform: 'uppercase',
      }}>
        {side === 'left' ? 'Offense' : 'Defense'}
      </div>

      {/* Events */}
      <div style={{flex: 1, overflowY: 'auto'}}>
        {events.map(ev => (
          <EventRow key={ev.key} ev={ev} active={activeUpper === ev.key} />
        ))}

        {/* Missing event — only on left */}
        {side === 'left' && (
          <>
            <div style={{height: 1, background: 'rgba(232,89,12,0.3)', margin: '4px 0'}}/>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 10px',
              background: activeUpper === MISSING.key ? 'rgba(191,90,242,0.15)' : 'transparent',
            }}>
              <span style={{fontSize:12, color: activeUpper === MISSING.key ? '#BF5AF2' : 'var(--t-2)', fontWeight: activeUpper === MISSING.key ? 700 : 400}}>
                {MISSING.label}
              </span>
              <span style={{
                fontFamily:'JetBrains Mono,monospace', fontSize:11, fontWeight:700,
                color: activeUpper === MISSING.key ? '#BF5AF2' : 'var(--t-3)',
                background: activeUpper === MISSING.key ? 'rgba(191,90,242,0.15)' : 'var(--bg-3)',
                border: `1px solid ${activeUpper === MISSING.key ? 'rgba(191,90,242,0.4)' : 'var(--b-2)'}`,
                borderRadius:4, padding:'1px 6px', minWidth:20, textAlign:'center',
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
