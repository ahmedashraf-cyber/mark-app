import { EXTRAS } from './TagPanel'

const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00.000'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms  = Math.floor((s % 1) * 1000)
  return `${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
}

const TEAM_STYLE = {
  home: { color: '#0A84FF', bg: 'rgba(10,132,255,0.15)', label: 'Home' },
  away: { color: '#FF453A', bg: 'rgba(255,69,58,0.15)',  label: 'Away' },
}

export default function TaggedEventsList({ tags, onSeek, onEdit }) {
  if (!tags || tags.length === 0) return (
    <div style={{
      padding: '14px 20px',
      fontSize: 12, color: 'var(--t-3)', textAlign: 'center',
      borderTop: '1px solid var(--b-1)',
      fontStyle: 'italic',
    }}>
      No events tagged yet — press an event key to start
    </div>
  )

  return (
    <div style={{
      borderTop: '1px solid var(--b-1)',
      maxHeight: 200,
      overflowY: 'auto',
      background: 'var(--bg)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 16px', borderBottom: '1px solid var(--b-1)',
        background: 'var(--bg-2)', position: 'sticky', top: 0, zIndex: 2,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-3)', letterSpacing: 1 }}>
          TAGGED EVENTS
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: 'var(--p2)', fontFamily: 'JetBrains Mono, monospace',
        }}>
          {tags.length} {tags.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {[...tags].sort((a, b) => (a.videoTimeSec || 0) - (b.videoTimeSec || 0)).map((tag, i) => {
          const team = TEAM_STYLE[tag.team]
          const extraLabels = (tag.extras || [])
            .map(eid => EXTRAS.find(e => e.id === eid)?.label)
            .filter(Boolean)

          return (
            <div
              key={tag.id || i}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 16px',
                borderBottom: '1px solid var(--b-1)',
                transition: 'background .1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {/* Timestamp — clickable */}
              <button
                onClick={() => onSeek?.(tag.videoTimeSec || 0)}
                title="Seek to this event"
                style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700,
                  color: 'var(--p2)', background: 'rgba(232,89,12,0.1)',
                  border: '1px solid rgba(232,89,12,0.25)', borderRadius: 6,
                  padding: '2px 7px', cursor: 'pointer', flexShrink: 0,
                  transition: 'background .1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(232,89,12,0.2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(232,89,12,0.1)'}
              >
                {fmt(tag.videoTimeSec)}
              </button>

              {/* Event key badge */}
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
                background: tag.isMissing ? '#BF5AF2' : 'var(--p2)',
                color: '#fff', borderRadius: 5, padding: '1px 6px', flexShrink: 0,
              }}>
                {tag.triggeredKey}
              </span>

              {/* Event name */}
              <span style={{
                fontSize: 12, fontWeight: 600, color: 'var(--t-1)',
                flexShrink: 0,
              }}>
                {tag.triggeredEventLabel}
              </span>

              {/* Team badge */}
              {team && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: team.color, background: team.bg,
                  border: `1px solid ${team.color}44`,
                  borderRadius: 5, padding: '1px 7px', flexShrink: 0,
                }}>
                  {team.label}
                </span>
              )}

              {/* Extras pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
                {extraLabels.map((label, j) => (
                  <span key={j} style={{
                    fontSize: 10, color: 'var(--t-2)',
                    background: 'var(--bg-3)', border: '1px solid var(--b-2)',
                    borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap',
                  }}>
                    {label}
                  </span>
                ))}
              </div>

              {/* Edit button */}
              <button
                onClick={() => onEdit?.(tag)}
                title="Edit this event"
                style={{
                  flexShrink: 0, width: 26, height: 26,
                  borderRadius: 6, border: '1px solid var(--b-2)',
                  background: 'var(--bg-3)', color: 'var(--t-3)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all .1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--b-1)'; e.currentTarget.style.color = 'var(--t-1)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--t-3)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
