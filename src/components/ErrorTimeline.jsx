import { useState, useRef } from 'react'

const TYPE_COLORS = {
  wrong_event:   '#FF453A',
  wrong_player:  '#FF9F0A',
  confused_with: '#0A84FF',
  missing_event: '#BF5AF2',
}

const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m  = Math.floor(s / 60)
  const sc = Math.floor(s % 60)
  const ms = Math.floor((s % 1) * 1000)
  return `${m}:${sc.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
}

function SpeakerIcon({ muted }) {
  return muted ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/>
      <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/>
      <path d="M15.54 8.46a5 5 0 010 7.07" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M19.07 4.93a10 10 0 010 14.14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

export default function ErrorTimeline({
  errors, videoDuration, currentTime, playing, muted,
  onSeek, onSyncSeek, onTogglePlay, onToggleMute, onDragStart,
}) {
  const trackRef = useRef(null)

  // dragPct drives the VISUAL position during drag only.
  // null = not dragging, use currentTime prop instead.
  // The video is NOT seeked during drag — only on pointer-up (one clean seek).
  const [dragPct,   setDragPct]   = useState(null)
  const [hovering,  setHovering]  = useState(false)
  const [hoverPct,  setHoverPct]  = useState(0)
  const [hoverTime, setHoverTime] = useState(0)
  const [tooltip,   setTooltip]   = useState(null)

  const duration   = videoDuration || 0
  const isDragging = dragPct !== null

  // During drag: ball follows cursor exactly (local state, no React re-render lag)
  // After release: ball is at the seeked position (from currentTime prop)
  const progressPct = isDragging
    ? dragPct * 100
    : duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  function pctFromPointer(e) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  function handlePointerDown(e) {
    if (!duration) return
    e.preventDefault()
    trackRef.current.setPointerCapture(e.pointerId)
    // Tell parent to freeze onTimeUpdate — prevents video's lagging position
    // from overwriting currentTime state while dragging
    onDragStart?.()
    setDragPct(pctFromPointer(e))
  }

  function handlePointerMove(e) {
    const pct = pctFromPointer(e)
    setHoverPct(pct)
    setHoverTime(pct * duration)
    // Visual-only update — no video seek during move.
    // Avoids stacked rapid seeks that confuse WebView2.
    if (!trackRef.current?.hasPointerCapture(e.pointerId)) return
    setDragPct(pct)
  }

  function handlePointerUp(e) {
    if (!trackRef.current?.hasPointerCapture(e.pointerId)) return
    const pct = pctFromPointer(e)
    trackRef.current.releasePointerCapture(e.pointerId)
    // Seek first, THEN clear dragPct.
    // React 19 batches setCurrentTime(t) (inside onSeek) and setDragPct(null)
    // into one render — ball lands at correct position with no snap-back frame.
    const t = pct * duration
    onSeek?.(t)       // seekTo in parent — sets video + state
    onSyncSeek?.(t)   // Firestore — syncs collection app
    setDragPct(null)
  }

  const thumbSize = isDragging ? 16 : hovering ? 14 : 10
  const trackH    = isDragging || hovering ? 5 : 3

  const btnStyle = {
    flexShrink: 0, width: 28, height: 28,
    borderRadius: 8, border: '1px solid var(--b-2)',
    background: 'var(--bg-3)', color: 'var(--t-1)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background .12s',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>

      {/* Play / Pause */}
      <button onClick={onTogglePlay} style={btnStyle}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--b-1)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-3)'}>
        {playing ? (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
            <rect x="0" y="0" width="3.5" height="12" rx="1" fill="currentColor"/>
            <rect x="6.5" y="0" width="3.5" height="12" rx="1" fill="currentColor"/>
          </svg>
        ) : (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
            <path d="M1 1l8 5-8 5V1z" fill="currentColor"/>
          </svg>
        )}
      </button>

      {/* Mute toggle */}
      <button onClick={onToggleMute} title={muted ? 'Unmute MARK audio' : 'Mute MARK audio'}
        style={{ ...btnStyle, color: muted ? 'var(--p2)' : 'var(--t-3)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--b-1)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-3)'}>
        <SpeakerIcon muted={muted} />
      </button>

      {/* Current time */}
      <span className="mono" style={{ fontSize: 11, color: 'var(--t-2)', flexShrink: 0, minWidth: 72, textAlign: 'right' }}>
        {fmt(isDragging ? hoverTime : currentTime)}
      </span>

      {/* Track */}
      <div
        ref={trackRef}
        style={{
          flex: 1, position: 'relative', height: 28,
          display: 'flex', alignItems: 'center',
          cursor: !duration ? 'default' : isDragging ? 'grabbing' : 'pointer',
          userSelect: 'none', touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => { if (!isDragging) { setHovering(false); setTooltip(null) } }}
      >
        {/* Rail */}
        <div style={{
          position: 'absolute', left: 0, right: 0,
          height: trackH, background: 'var(--bg-3)', borderRadius: 99,
          transition: isDragging ? 'none' : 'height .12s', overflow: 'visible',
        }}>

          {/* Orange fill */}
          <div style={{
            position: 'absolute', left: 0, width: `${progressPct}%`,
            height: '100%', background: 'var(--p2)', borderRadius: 99, opacity: 0.9,
            transition: isDragging ? 'none' : 'width .05s',
          }}/>

          {/* Hover ghost */}
          {(hovering || isDragging) && duration > 0 && (
            <div style={{
              position: 'absolute', left: 0, width: `${hoverPct * 100}%`,
              height: '100%', background: 'rgba(232,89,12,0.22)',
              borderRadius: 99, pointerEvents: 'none',
            }}/>
          )}

          {/* Error markers */}
          {errors.map((err, i) => {
            const pct   = duration > 0 ? Math.min(100, ((err.videoTimeSec || 0) / duration) * 100) : 0
            const color = TYPE_COLORS[err.errorType] || 'var(--p2)'
            return (
              <div key={i}
                title={`${err.triggeredEventLabel || err.errorType} @ ${fmt(err.videoTimeSec || 0)}`}
                onMouseEnter={e => { e.stopPropagation(); setTooltip({ x: pct, label: `${err.triggeredEventLabel || err.errorType} · ${fmt(err.videoTimeSec || 0)}` }) }}
                onMouseLeave={() => setTooltip(null)}
                onClick={e => { e.stopPropagation(); onSeek?.(err.videoTimeSec || 0); onSyncSeek?.(err.videoTimeSec || 0) }}
                onPointerDown={e => e.stopPropagation()}
                style={{
                  position: 'absolute', left: `${pct}%`, top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 8, height: 8, borderRadius: '50%',
                  background: color, border: '1.5px solid rgba(0,0,0,0.6)',
                  zIndex: 3, cursor: 'pointer', boxShadow: `0 0 5px ${color}99`,
                }}
              />
            )
          })}

          {/* Playhead thumb */}
          {duration > 0 && (
            <div style={{
              position: 'absolute',
              left: `${progressPct}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: thumbSize, height: thumbSize,
              borderRadius: '50%', background: '#fff',
              border: '2px solid var(--p2)', zIndex: 4,
              pointerEvents: 'none',
              transition: isDragging ? 'none' : 'width .12s, height .12s',
              boxShadow: isDragging ? '0 0 12px rgba(232,89,12,0.8)' : '0 0 8px rgba(232,89,12,0.5)',
            }}/>
          )}
        </div>

        {/* Hover / drag time tooltip */}
        {(hovering || isDragging) && duration > 0 && (
          <div style={{
            position: 'absolute', left: `${hoverPct * 100}%`, bottom: 24,
            transform: 'translateX(-50%)', background: 'var(--bg-2)',
            border: '1px solid var(--b-2)', borderRadius: 6, padding: '3px 7px',
            fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
            color: 'var(--t-1)', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
          }}>
            {fmt(hoverTime)}
          </div>
        )}

        {/* Error marker tooltip */}
        {tooltip && (
          <div style={{
            position: 'absolute', left: `${tooltip.x}%`, bottom: 24,
            transform: 'translateX(-50%)', background: 'var(--bg-2)',
            border: '1px solid var(--b-2)', borderRadius: 6, padding: '3px 8px',
            fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
            color: 'var(--t-1)', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 11,
          }}>
            {tooltip.label}
          </div>
        )}
      </div>

      {/* Duration */}
      <span className="mono" style={{ fontSize: 11, color: 'var(--t-3)', flexShrink: 0, minWidth: 72 }}>
        {fmt(duration)}
      </span>

    </div>
  )
}
