import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
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

// A tag's display name. Scout passes error tags (triggeredEventLabel /
// errorType); FIELD passes collected events (eventLabel). This component was
// written for Scout, so FIELD bars rendered empty.
function tagName(tag) {
  return tag?.eventLabel || tag?.triggeredEventLabel || tag?.errorType || ''
}

function DetailPanel({ tag, onEdit, onDelete, onClose, readOnly = false, onRetry = null }) {
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
        {tagName(tag)}
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
        {onRetry && (tag._status === 'failed' || tag._status === 'unconfirmed') && (
          <button onClick={() => onRetry(tag)} style={{
            padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid rgba(255,214,10,0.5)', background: 'rgba(255,214,10,0.1)',
            color: '#FFD60A', fontSize: 11, fontWeight: 600,
          }}>Retry save</button>
        )}
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
        {tagName(tag)}
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
const CARD_W = 100
const GAP = 10

/** How a not-yet-confirmed event looks in the bar. Scout tags never carry _status. */
const STATUS_LOOK = {
  pending:     { border: '1.5px dashed var(--p2)', bg: null,                       label: 'saving…',       color: 'var(--p2)', opacity: 0.75 },
  failed:      { border: '1.5px solid #FF453A',    bg: 'rgba(255,69,58,0.14)',     label: '⚠ not saved',   color: '#FF453A',   opacity: 1 },
  unconfirmed: { border: '1.5px dashed #FFD60A',   bg: 'rgba(255,214,10,0.10)',    label: 'not confirmed', color: '#FFD60A',   opacity: 1 },
}

/**
 * One card in the bar. Memoised so a highlight or "past" change re-renders only the
 * handful of cards whose own props changed, not all N of them.
 */
const EventSlot = memo(function EventSlot({ tag, fieldMode, isSelected, isPast, isHot, onCardClick, onCommentClick }) {
  const extras = tag.extras || []
  const look = tag._status ? STATUS_LOOK[tag._status] : null
  return (
    <div
      data-event-id={fieldMode ? tag.id : undefined}
      data-highlight={isHot ? '1' : undefined}
      data-status={tag._status || undefined}
      onClick={() => onCardClick(tag)}
      onContextMenu={(e) => { e.preventDefault(); onCommentClick(tag) }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 3, cursor: 'pointer', flexShrink: 0,
        width: CARD_W,
        opacity: look ? look.opacity : (isPast ? 1 : 0.4),
        transition: 'opacity .2s',
      }}
    >
      <div style={{ display: 'flex', gap: 2, minHeight: 7 }}>
        {extras.map((eid, i) => (
          <div key={eid} style={{
            width: 5, height: 5, borderRadius: '50%',
            background: getDotColor(i),
          }}/>
        ))}
      </div>
      <div
        title={tagName(tag) + (tag.comment ? ' — ' + tag.comment : '')}
        style={{
          padding: '4px 8px',
          borderRadius: 5,
          border: isSelected
            ? '1.5px solid var(--p2)'
            : isHot
              ? '1.5px solid #FFD60A'
              : look
                ? look.border
                : tag.comment
                  ? '1.5px solid #30D158'
                  : '1.5px solid var(--b-2)',
          background: isSelected ? 'var(--p2)' : isHot ? 'rgba(255,214,10,0.14)' : (look && look.bg) || 'var(--bg-2)',
          color: isSelected ? '#fff' : 'var(--t-1)',
          fontSize: 11, fontWeight: isSelected || isHot ? 700 : 500,
          fontFamily: 'DM Sans, sans-serif',
          whiteSpace: 'nowrap',
          width: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textAlign: 'center',
          boxShadow: isSelected ? '0 0 8px rgba(232,89,12,0.5)' : isHot ? '0 0 8px rgba(255,214,10,0.55)' : 'none',
          transition: 'all .12s',
        }}
        // full name on hover, for when the bar is too narrow to show
        // it — the bar already truncates with an ellipsis
        title={tagName(tag)}>
        {tagName(tag)}
      </div>
      <div style={{ fontSize: 9, color: look ? look.color : 'var(--t-3)', fontFamily: 'JetBrains Mono, monospace' }}>
        {fmt(tag.videoTimeSec)}{look ? ' · ' + look.label : ''}
      </div>
    </div>
  )
})

function TimelineRow({ label, tags, allTags, videoDuration, currentTime, selectedId, onCardClick, onCommentClick, homeTeam,
                       dotColor = null, fieldMode = false, highlightSet = null, scrollTargetId = null, pastCount = null, slotIndex = null }) {
  const rowRef = useRef(null)
  // One lookup per slot instead of tags.find() per slot: the old shape was
  // O(events²) on every render — 15 ms a tick at 1000 events.
  const tagById = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags])

  // LEGACY (Scout): re-centre on the playhead on every render. Unchanged.
  // FIELD opts out (fieldMode) and uses the highlight-driven scroll below.
  useEffect(() => {
    if (fieldMode) return
    if (!rowRef.current || allTags.length === 0) return
    const idx = allTags.findIndex(t => t.videoTimeSec > currentTime)
    const targetIdx = idx === -1 ? allTags.length - 1 : Math.max(0, idx - 1)
    const targetX = targetIdx * (CARD_W + GAP) - rowRef.current.clientWidth / 2 + CARD_W / 2
    rowRef.current.scrollTo({ left: Math.max(0, targetX), behavior: 'smooth' })
  }, [currentTime, allTags])

  // FIELD: scroll only when the highlighted event changes, and only if it is
  // not already in view.
  useEffect(() => {
    if (!fieldMode || !scrollTargetId || !rowRef.current || !slotIndex) return
    const idx = slotIndex.get(scrollTargetId)
    if (idx == null) return
    const el = rowRef.current
    const left = 12 + idx * (CARD_W + GAP)           // the slot strip has 12px padding
    if (left >= el.scrollLeft && left + CARD_W <= el.scrollLeft + el.clientWidth) return
    el.scrollTo({ left: Math.max(0, left - el.clientWidth / 2 + CARD_W / 2), behavior: 'smooth' })
  }, [scrollTargetId, fieldMode, slotIndex])

  const dot = dotColor || (label === homeTeam ? '#0A84FF' : '#FF453A')
  const dotGlow = dotColor ? 'rgba(142,142,147,0.6)' : (label === homeTeam ? 'rgba(10,132,255,0.6)' : 'rgba(255,69,58,0.6)')

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
            background: dot,
            boxShadow: `0 0 5px ${dotGlow}`,
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
        {/* Shared timeline slots — one slot per event in allTags, empty if not this team */}
        <div style={{
          display: 'flex', alignItems: 'center',
          gap: GAP, padding: '0 12px',
          minWidth: 'max-content', height: '100%',
        }}>
          {allTags.map((slot, slotI) => {
            const tag = tagById.get(slot.id)
            if (!tag) {
              return (
                <div key={slot.id} style={{ width: CARD_W, flexShrink: 0 }} />
              )
            }
            return (
              <EventSlot key={tag.id} tag={tag} fieldMode={fieldMode}
                isSelected={slot.id === selectedId}
                isPast={pastCount != null ? slotI < pastCount : slot.videoTimeSec <= currentTime}
                isHot={!!(highlightSet && highlightSet.has(tag.id))}
                onCardClick={onCardClick} onCommentClick={onCommentClick} />
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
// FIELD-only opt-in props. Scout passes none of them and renders exactly as before.
//   highlightIds / highlightNearestId — events at the playhead (also switches this
//                      list to the highlight-driven scroll instead of re-centring
//                      on every render)
//   pastCount        — how many events are at or before the playhead, instead of
//                      re-rendering on every tick with a raw currentTime
//   neutralLane      — a third "Match" row for events that belong to no team
//   onRetry          — retry an event that is failed / not confirmed
function TaggedEventsList({
  tags, videoDuration, currentTime, matchName,
  onEdit, onDelete, onSeek, readOnly = false,
  highlightIds, highlightNearestId = null, pastCount = null, neutralLane = false, onRetry = null,
}) {
  const [selectedTag, setSelectedTag] = useState(null)
  const [commentTag, setCommentTag] = useState(null)
  const [comments, setComments] = useState({}) // tagId -> comment string
  const fieldMode = highlightIds !== undefined

  // Parse team names from matchName — split on ' vs '
  const [homeTeam, awayTeam] = useMemo(() => {
    if (!matchName) return ['Home', 'Away']
    const parts = matchName.split(' vs ')
    return [parts[0]?.trim() || 'Home', parts[1]?.trim() || 'Away']
  }, [matchName])

  const tagsWithComments = useMemo(
    () => (tags || []).map(t => ({ ...t, comment: comments[t.id] || t.comment || '' })),
    [tags, comments])
  const homeTags = useMemo(() => tagsWithComments.filter(t => t.team === 'home'), [tagsWithComments])
  const awayTags = useMemo(() => tagsWithComments.filter(t => t.team === 'away'), [tagsWithComments])
  // Events with no team (Camera on/off, Stoppage, Half end, …). Only FIELD asks for
  // the lane; everywhere else they keep leaving a blank slot as they always did.
  const matchTags = useMemo(
    () => neutralLane ? tagsWithComments.filter(t => t.team !== 'home' && t.team !== 'away') : [],
    [tagsWithComments, neutralLane])
  const allTagsSorted = useMemo(
    () => [...tagsWithComments].sort((a, b) => (a.videoTimeSec || 0) - (b.videoTimeSec || 0)),
    [tagsWithComments])
  const highlightSet = useMemo(() => fieldMode ? new Set(highlightIds) : null, [fieldMode, highlightIds])
  const slotIndex = useMemo(() => new Map(allTagsSorted.map((t, i) => [t.id, i])), [allTagsSorted])

  function handleCardClick(tag) {
    setSelectedTag(prev => prev?.id === tag.id ? null : tag)
    // In readOnly mode, seek to the timestamp on click
    if (onSeek) onSeek(tag.videoTimeSec || 0)
  }
  // Stable identities (they read the latest handler through a ref), so a memoised
  // card is not re-rendered just because this component rendered.
  const clickRef = useRef(handleCardClick); clickRef.current = handleCardClick
  const stableCardClick = useCallback(t => clickRef.current(t), [])
  const stableCommentClick = useCallback(tag => { setSelectedTag(null); setCommentTag(tag) }, [])

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

  const rowProps = {
    allTags: allTagsSorted, videoDuration, currentTime, selectedId: selectedTag?.id,
    onCardClick: stableCardClick,
    onCommentClick: stableCommentClick,
    homeTeam, fieldMode, highlightSet, scrollTargetId: highlightNearestId, pastCount, slotIndex,
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
          onRetry={onRetry}
        />
      )}

      {/* Home row */}
      <TimelineRow label={homeTeam} tags={homeTags} {...rowProps} />

      {/* Match row — events with no team. Shown only when there is at least one. */}
      {neutralLane && matchTags.length > 0 && (
        <TimelineRow label="Match" tags={matchTags} dotColor="#8E8E93" {...rowProps} />
      )}

      {/* Away row */}
      <TimelineRow label={awayTeam} tags={awayTags} {...rowProps} />

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

export default memo(TaggedEventsList)
