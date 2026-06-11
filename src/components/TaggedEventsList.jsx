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
function DetailPanel({ tag, onEdit, onDelete, onClose, readOnly = false }) {
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
        {!readOnly && (
          <>
            <button onClick={() => onEdit(tag)} style={{
              padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--b-2)', background: 'var(--bg-3)',
              color: 'var(--t-2)', fontSize: 11, fontWeight: 600,
            }}>Edit</button>
            <button onClick={() => onDelete(tag)} style={{
              padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid rgba(255,69,58,0.4)', background: 'rgba(255,69,58,0.08)',
              color: '#FF453A', fontSize: 11, fontWeight: 600,
            }}>Delete</button>
          </>
        )}
        <button onClick={onClose} style={{
          padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
          border: '1px solid var(--b-2)', background: 'transparent',
          color: 'var(--t-3)', fontSize: 11,
        }}>✕</button>
      </div>
    </div>
  )
}

// ── Comment Box ──────────────────────────────────────────────────────────────
function CommentBox({ tag, onSave, onClose }) {
  const [text, setText] = useState(tag.comment || '')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
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
      display: 'flex', alignItems: 'center', gap: 10,
      animation: 'slideDown .15s ease',
    }}>
      <span style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700,
        background: 'var(--p2)', color: '#fff',
        borderRadius: 5, padding: '2px 7px', flexShrink: 0,
      }}>{tag.triggeredKey || '•'}</span>
      <span style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 13, color: 'var(--t-1)', flexShrink: 0 }}>
        {tag.triggeredEventLabel}
      </span>
      <input
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') { onSave(tag.id, text); onClose() }
          if (e.key === 'Escape') { onClose() }
        }}
        placeholder="Add a note… (Enter to save)"
        style={{
          flex: 1, padding: '5px 10px', borderRadius: 6,
          border: '1px solid var(--b-2)', background: 'var(--bg-3)',
          color: 'var(--t-1)', fontSize: 12, fontFamily: 'DM Sans, sans-serif',
          outline: 'none',
        }}
      />
      <button onClick={() => { onSave(tag.id, text); onClose() }} style={{
        padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
        border: '1px solid rgba(48,209,88,0.4)', background: 'rgba(48,209,88,0.1)',
        color: '#30D158', fontSize: 11, fontWeight: 600, flexShrink: 0,
      }}>Save</button>
      {text && <button onClick={() => { onSave(tag.id, ''); onClose() }} style={{
        padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
        border: '1px solid rgba(255,69,58,0.3)', background: 'rgba(255,69,58,0.08)',
        color: '#FF453A', fontSize: 11, fontWeight: 600, flexShrink: 0,
      }}>Clear</button>}
      <button onClick={onClose} style={{
        padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
        border: '1px solid var(--b-2)', background: 'transparent',
        color: 'var(--t-3)', fontSize: 11, flexShrink: 0,
      }}>✕</button>
    </div>
  )
}

// ── Timeline Row ──────────────────────────────────────────────────────────────
function TimelineRow({ label, tags, videoDuration, currentTime, selectedId, onCardClick, onCommentClick, homeTeam }) {
  const rowRef = useRef(null)

  // Auto-scroll to keep current position visible
  useEffect(() => {
    if (!rowRef.current || tags.length === 0) return
    const CARD_W = 112
    const GAP = 12
    const idx = tags.findIndex(t => t.videoTimeSec > currentTime)
    const targetIdx = idx === -1 ? tags.length - 1 : Math.max(0, idx - 1)
    const targetX = targetIdx * (CARD_W + GAP) - rowRef.current.clientWidth / 2 + CARD_W / 2
    rowRef.current.scrollTo({ left: Math.max(0, targetX), behavior: 'smooth' })
  }, [currentTime])

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      borderBottom: '1px solid var(--b-1)',
      minHeight: 76,
    }}>
      {/* Team badge */}
      <div style={{
        width: 120, flexShrink: 0,
        padding: '0 12px',
        display: 'flex', alignItems: 'center',
        borderRight: '1px solid var(--b-1)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '4px 10px',
          borderRadius: 8,
          background: 'var(--bg-3)',
          border: '1px solid var(--b-2)',
          width: '100%',
          transition: 'all 0.18s ease',
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: label === homeTeam ? '#0A84FF' : '#FF453A',
            boxShadow: `0 0 5px ${label === homeTeam ? 'rgba(10,132,255,0.6)' : 'rgba(255,69,58,0.6)'}`,
          }}/>
          <span style={{
            fontSize: 11, fontWeight: 800, color: 'var(--t-1)',
            fontFamily: 'Inter, sans-serif',
            letterSpacing: 0.1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {label}
          </span>
        </div>
      </div>

      {/* Scrollable timeline */}
      <div
        ref={rowRef}
        style={{
          flex: 1,
          overflowX: 'auto', overflowY: 'visible',
          height: 76,
          scrollbarWidth: 'none',
          display: 'flex', alignItems: 'center',
        }}
      >
        {/* Sequential cards — left to right in time order, fixed spacing */}
        <div style={{
          display: 'flex', alignItems: 'center',
          gap: 10, padding: '0 12px',
          minWidth: 'max-content', height: '100%',
        }}>
          {tags.map(tag => {
            const extras = tag.extras || []
            const isSelected = tag.id === selectedId
            const isPast = tag.videoTimeSec <= currentTime

            return (
              <div
                key={tag.id}
                onClick={() => onCardClick(tag)}
                onContextMenu={(e) => { e.preventDefault(); onCommentClick(tag) }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 3, cursor: 'pointer', flexShrink: 0,
                  opacity: isPast ? 1 : 0.4,
                  transition: 'opacity .2s',
                }}
              >
                {/* Dots above */}
                <div style={{ display: 'flex', gap: 2, minHeight: 7 }}>
                  {extras.map((eid, i) => (
                    <div key={eid} style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: getDotColor(i),
                    }}/>
                  ))}
                </div>
                {/* Card */}
                <div
                  title={tag.triggeredEventLabel + (tag.comment ? ' — ' + tag.comment : '')}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 5,
                    border: isSelected
                      ? '1.5px solid var(--p2)'
                      : tag.comment
                        ? '1.5px solid #30D158'
                        : '1.5px solid var(--b-2)',
                    background: isSelected ? 'var(--p2)' : 'var(--bg-2)',
                    color: isSelected ? '#fff' : 'var(--t-1)',
                    fontSize: 11, fontWeight: isSelected ? 700 : 500,
                    fontFamily: 'DM Sans, sans-serif',
                    whiteSpace: 'nowrap',
                    width: 90,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'center',
                    boxShadow: isSelected ? '0 0 8px rgba(232,89,12,0.5)' : 'none',
                    transition: 'all .12s',
                  }}>
                  {tag.triggeredEventLabel}
                </div>
                {/* Timestamp */}
                <div style={{ fontSize: 9, color: 'var(--t-3)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {fmt(tag.videoTimeSec)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TaggedEventsList({
  tags, videoDuration, currentTime, matchName,
  onEdit, onDelete, onSeek, readOnly = false,
}) {
  const [selectedTag, setSelectedTag] = useState(null)
  const [commentTag, setCommentTag] = useState(null)
  const [comments, setComments] = useState({}) // tagId -> comment string

  // Parse team names from matchName — split on ' vs '
  const [homeTeam, awayTeam] = useMemo(() => {
    if (!matchName) return ['Home', 'Away']
    const parts = matchName.split(' vs ')
    return [parts[0]?.trim() || 'Home', parts[1]?.trim() || 'Away']
  }, [matchName])

  const tagsWithComments = (tags || []).map(t => ({ ...t, comment: comments[t.id] || t.comment || '' }))
  const homeTags = tagsWithComments.filter(t => t.team === 'home')
  const awayTags = tagsWithComments.filter(t => t.team === 'away')

  function handleCardClick(tag) {
    setSelectedTag(prev => prev?.id === tag.id ? null : tag)
    // In readOnly mode, seek to the timestamp on click
    if (onSeek) onSeek(tag.videoTimeSec || 0)
  }

  function handleSaveComment(tagId, text) {
    setComments(prev => ({ ...prev, [tagId]: text }))
  }

  function handleEdit(tag) {
    if (readOnly) return
    setSelectedTag(null)
    onEdit(tag)
  }

  function handleDelete(tag) {
    if (readOnly) return
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
      {/* Comment box — slides down on right-click */}
      {commentTag && (
        <CommentBox
          tag={commentTag}
          onSave={handleSaveComment}
          onClose={() => setCommentTag(null)}
        />
      )}

      {/* Detail panel — slides down when card selected */}
      {selectedTag && !commentTag && (
        <DetailPanel
          tag={selectedTag}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onClose={() => setSelectedTag(null)}
          readOnly={readOnly}
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
        onCommentClick={(tag) => { setSelectedTag(null); setCommentTag(tag) }}
        homeTeam={homeTeam}
      />

      {/* Away row */}
      <TimelineRow
        label={awayTeam}
        tags={awayTags}
        videoDuration={videoDuration}
        currentTime={currentTime}
        selectedId={selectedTag?.id}
        onCardClick={handleCardClick}
        onCommentClick={(tag) => { setSelectedTag(null); setCommentTag(tag) }}
        homeTeam={homeTeam}
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
