import { useState, useEffect, useRef, useMemo } from 'react'
import { EXTRAS, GK_EXTRAS, GK_WRONG_EXTRAS } from './TagPanel'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2,'0')}`
}

// Get label for any extra id (general, GK, or GK wrong)
function getExtraLabel(id) {
  const all = [
    ...EXTRAS,
    ...GK_EXTRAS,
    ...(Object.values(GK_WRONG_EXTRAS || {}).flat()),
  ]
  return all.find(e => e.id === id)?.label || id
}

// Dot color — each extra category gets a distinct color from our palette
const DOT_COLORS = [
  '#E8590C', // orange — primary
  '#0A84FF', // blue
  '#30D158', // green
  '#FFD60A', // yellow
  '#FF453A', // red
  '#BF5AF2', // purple
  '#FF9F0A', // amber
  '#64D2FF', // cyan
]
function getDotColor(index) {
  return DOT_COLORS[index % DOT_COLORS.length]
}

// ── Detail Panel (slides down from top bar) ───────────────────────────────────
function DetailPanel({ tag, onEdit, onDelete, onClose }) {
  const extras = tag.extras || []

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 200,
      background: 'rgba(10,10,18,0.97)', backdropFilter: 'blur(8px)',
      borderBottom: '1px solid var(--b-1)',
      padding: '10px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
      animation: 'slideDown .15s ease',
    }}>
      {/* Event badge */}
      <span style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700,
        background: tag.isMissing ? '#BF5AF2' : 'var(--p2)', color: '#fff',
        borderRadius: 5, padding: '2px 7px', flexShrink: 0,
      }}>
        {tag.triggeredKey || '•'}
      </span>
      <span style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 13, color: 'var(--t-1)', flexShrink: 0 }}>
        {tag.triggeredEventLabel}
      </span>

      {/* Extras as pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, flex: 1, minWidth: 0 }}>
        {extras.map((eid, i) => (
          <span key={eid} style={{
            fontSize: 10, fontWeight: 600,
            color: getDotColor(i),
            background: `${getDotColor(i)}18`,
            border: `1px solid ${getDotColor(i)}44`,
            borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap',
          }}>
            {getExtraLabel(eid)}
          </span>
        ))}
        {extras.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--t-3)', fontStyle: 'italic' }}>No extras</span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button onClick={() => onEdit(tag)} style={{
          padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
          border: '1px solid var(--b-2)', background: 'var(--bg-3)',
          color: 'var(--t-2)', fontSize: 11, fontWeight: 600,
          transition: 'all .1s',
        }}>Edit</button>
        <button onClick={() => onDelete(tag)} style={{
          padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
          border: '1px solid rgba(255,69,58,0.4)', background: 'rgba(255,69,58,0.08)',
          color: '#FF453A', fontSize: 11, fontWeight: 600,
          transition: 'all .1s',
        }}>Delete</button>
        <button onClick={onClose} style={{
          padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
          border: '1px solid var(--b-2)', background: 'transparent',
          color: 'var(--t-3)', fontSize: 11,
        }}>✕</button>
      </div>
    </div>
  )
}

// ── Timeline Row ──────────────────────────────────────────────────────────────
function TimelineRow({ label, tags, videoDuration, currentTime, selectedId, onCardClick }) {
  const rowRef = useRef(null)

  // Auto-scroll to card closest to currentTime
  useEffect(() => {
    if (!rowRef.current || tags.length === 0 || !videoDuration) return
    const closest = tags.reduce((prev, curr) =>
      Math.abs(curr.videoTimeSec - currentTime) < Math.abs(prev.videoTimeSec - currentTime) ? curr : prev
    )
    const pct = closest.videoTimeSec / videoDuration
    const row = rowRef.current
    const targetX = pct * row.scrollWidth - row.clientWidth / 2
    row.scrollTo({ left: Math.max(0, targetX), behavior: 'smooth' })
  }, [currentTime, videoDuration])

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      borderBottom: '1px solid var(--b-1)',
      minHeight: 56,
    }}>
      {/* Team label */}
      <div style={{
        width: 110, flexShrink: 0,
        padding: '0 12px',
        fontSize: 11, fontWeight: 800, color: 'var(--t-1)',
        fontFamily: 'Inter, sans-serif',
        borderRight: '1px solid var(--b-1)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        letterSpacing: 0.2,
        background: 'linear-gradient(90deg, var(--bg-2), transparent)',
      }}>
        {label}
      </div>

      {/* Scrollable timeline */}
      <div
        ref={rowRef}
        style={{
          flex: 1, position: 'relative',
          overflowX: 'auto', overflowY: 'visible',
          height: 56,
          scrollbarWidth: 'none',
        }}
      >
        {/* The line */}
        <div style={{
          position: 'absolute',
          left: 0, right: 0,
          top: '65%',
          height: 1,
          background: 'var(--b-2)',
          minWidth: '100%',
        }}/>

        {/* Cards */}
        {tags.map(tag => {
          const pct = videoDuration > 0 ? (tag.videoTimeSec / videoDuration) * 100 : 0
          const extras = tag.extras || []
          const isSelected = tag.id === selectedId

          return (
            <div
              key={tag.id}
              onClick={() => onCardClick(tag)}
              style={{
                position: 'absolute',
                left: `${pct}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                cursor: 'pointer',
                zIndex: isSelected ? 10 : 5,
              }}
            >
              {/* Dots above card */}
              {extras.length > 0 && (
                <div style={{
                  display: 'flex', gap: 2, marginBottom: 3,
                  position: 'absolute', top: -14,
                  left: '50%', transform: 'translateX(-50%)',
                }}>
                  {extras.map((eid, i) => (
                    <div key={eid} style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: getDotColor(i),
                      boxShadow: `0 0 3px ${getDotColor(i)}88`,
                    }}/>
                  ))}
                </div>
              )}

              {/* Card */}
              <div style={{
                padding: '3px 8px',
                borderRadius: 5,
                border: isSelected
                  ? '1.5px solid var(--p2)'
                  : '1.5px solid var(--b-2)',
                background: isSelected
                  ? 'var(--p2)'
                  : 'var(--bg-2)',
                color: isSelected ? '#fff' : 'var(--t-1)',
                fontSize: 11, fontWeight: isSelected ? 700 : 500,
                fontFamily: 'DM Sans, sans-serif',
                whiteSpace: 'nowrap',
                boxShadow: isSelected ? '0 0 8px rgba(232,89,12,0.5)' : 'none',
                transition: 'all .12s',
              }}>
                {tag.triggeredEventLabel}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TaggedEventsList({
  tags, videoDuration, currentTime, matchName,
  onEdit, onDelete,
}) {
  const [selectedTag, setSelectedTag] = useState(null)

  // Parse team names from matchName — split on ' vs '
  const [homeTeam, awayTeam] = useMemo(() => {
    if (!matchName) return ['Home', 'Away']
    const parts = matchName.split(' vs ')
    return [parts[0]?.trim() || 'Home', parts[1]?.trim() || 'Away']
  }, [matchName])

  const homeTags = (tags || []).filter(t => t.team === 'home')
  const awayTags = (tags || []).filter(t => t.team === 'away')

  function handleCardClick(tag) {
    setSelectedTag(prev => prev?.id === tag.id ? null : tag)
  }

  function handleEdit(tag) {
    setSelectedTag(null)
    onEdit(tag)
  }

  function handleDelete(tag) {
    setSelectedTag(null)
    onDelete(tag)
  }

  return (
    <div style={{
      background: 'var(--bg)',
      borderTop: '1px solid var(--b-1)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Detail panel — slides down when card selected */}
      {selectedTag && (
        <DetailPanel
          tag={selectedTag}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onClose={() => setSelectedTag(null)}
        />
      )}

      {/* Home row */}
      <TimelineRow
        label={homeTeam}
        tags={homeTags}
        videoDuration={videoDuration}
        currentTime={currentTime}
        selectedId={selectedTag?.id}
        onCardClick={handleCardClick}
      />

      {/* Away row */}
      <TimelineRow
        label={awayTeam}
        tags={awayTags}
        videoDuration={videoDuration}
        currentTime={currentTime}
        selectedId={selectedTag?.id}
        onCardClick={handleCardClick}
      />

      {/* Empty state */}
      {tags.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 11, color: 'var(--t-3)', fontStyle: 'italic' }}>
            No events tagged yet
          </span>
        </div>
      )}
    </div>
  )
}
