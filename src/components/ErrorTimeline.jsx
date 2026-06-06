import { useRef, useState, useEffect } from 'react'

const TYPE_COLORS = {
  wrong_event:   '#FF453A',
  wrong_player:  '#FF9F0A',
  confused_with: '#0A84FF',
  missing_event: '#BF5AF2',
}

const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms  = Math.floor((s % 1) * 1000)
  return `${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
}

// Speaker icon — muted vs unmuted
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
  onSeek, onSyncSeek, onTogglePlay, onToggleMute,
}) {
  const trackRef    = useRef(null)
  const dragging    = useRef(false)
  const durRef      = useRef(videoDuration || 0)
  const onSeekRef   = useRef(onSeek)
  const onSyncRef   = useRef(onSyncSeek)

  // Keep refs current so drag handlers never go stale
  useEffect(() => { durRef.current = videoDuration || 0 }, [videoDuration])
  useEffect(() => { onSeekRef.current = onSeek }, [onSeek])
  useEffect(() => { onSyncRef.current = onSyncSeek }, [onSyncSeek])

  const [hovering,  setHovering]  = useState(false)
  const [hoverPct,  setHoverPct]  = useState(0)
  const [hoverTime, setHoverTime] = useState(0)
  const [tooltip,   setTooltip]   = useState(null)

  const duration = videoDuration || 0
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  // ── Drag logic using refs only — never goes stale ─────────────────────────
  function getPct(e) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  function applySeek(e) {
    const pct = getPct(e)
    const t   = pct * durRef.current
    onSeekRef.current?.(t)       // move MARK's video immediately
    onSyncRef.current?.(t)       // push to collection app
  }

  useEffect(() => {
    function onMove(e) {
      if (!dragging.current) return
      applySeek(e)
    }
    function onUp(e) {
      if (!dragging.current) return
      dragging.current = false
      applySeek(e)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    // Store on window so they're always the same reference
    window.__markOnMove = onMove
    window.__markOnUp   = onUp
  }, []) // runs once — safe because we use refs inside

  function handleMouseDown(e) {
    if (!duration) return
    e.preventDefault()
    dragging.current = true
    applySeek(e)
    window.addEventListener('mousemove', window.__markOnMove)
    window.addEventListener('mouseup',   window.__markOnUp)
  }

  function handleTrackMouseMove(e) {
    const pct = getPct(e)
    setHoverPct(pct)
    setHoverTime(pct * duration)
  }

  // Cleanup on unmount
  useEffect(() => () => {
    window.removeEventListener('mousemove', window.__markOnMove)
    window.removeEventListener('mouseup',   window.__markOnUp)
  }, [])

  const thumbLeft = `${progress * 100}%`
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
      <button
        onClick={onTogglePlay}
        style={btnStyle}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--b-1)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-3)'}
      >
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
      <button
        onClick={onToggleMute}
        title={muted ? 'Unmute MARK audio' : 'Mute MARK audio'}
        style={{ ...btnStyle, color: muted ? 'var(--p2)' : 'var(--t-3)' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--b-1)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-3)'}
      >
        <SpeakerIcon muted={muted} />
      </button>

      {/* Current time */}
      <span className="mono" style={{ fontSize: 11, color: 'var(--t-2)', flexShrink: 0, minWidth: 72, textAlign: 'right' }}>
        {fmt(currentTime)}
      </span>

      {/* Track */}
      <div
        ref={trackRef}
        style={{ flex: 1, position: 'relative', height: 28, display: 'flex', alignItems: 'center', cursor: duration ? 'pointer' : 'default' }}
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => { setHovering(false); setTooltip(null) }}
        onMouseMove={handleTrackMouseMove}
      >
        {/* Track bg */}
        <div style={{
          position: 'absolute', left: 0, right: 0,
          height: hovering ? 5 : 3,
          background: 'var(--bg-3)', borderRadius: 99,
          transition: 'height .12s', overflow: 'visible',
        }}>
          {/* Orange fill */}
          <div style={{
            position: 'absolute', left: 0, width: `${progress * 100}%`,
            height: '100%', background: 'var(--p2)', borderRadius: 99, opacity: 0.9,
          }}/>

          {/* Hover ghost */}
          {hovering && duration > 0 && (
            <div style={{
              position: 'absolute', left: 0, width: `${hoverPct * 100}%`,
              height: '100%', background: 'rgba(232,89,12,0.25)', borderRadius: 99, pointerEvents: 'none',
            }}/>
          )}

          {/* Error markers */}
          {errors.map((err, i) => {
            const pct   = duration > 0 ? Math.min(100, ((err.videoTimeSec || 0) / duration) * 100) : 0
            const color = TYPE_COLORS[err.errorType] || 'var(--p2)'
            return (
              <div
                key={i}
                title={`${err.triggeredEventLabel || err.errorType} @ ${fmt(err.videoTimeSec || 0)}`}
                onMouseEnter={e => { e.stopPropagation(); setTooltip({ x: pct, label: `${err.triggeredEventLabel || err.errorType} · ${fmt(err.videoTimeSec || 0)}` }) }}
                onMouseLeave={() => setTooltip(null)}
                onClick={e => { e.stopPropagation(); onSeekRef.current?.(err.videoTimeSec || 0); onSyncRef.current?.(err.videoTimeSec || 0) }}
                onMouseDown={e => e.stopPropagation()}
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
              position: 'absolute', left: thumbLeft, top: '50%',
              transform: 'translate(-50%, -50%)',
              width: hovering || dragging.current ? 14 : 10,
              height: hovering || dragging.current ? 14 : 10,
              borderRadius: '50%', background: '#fff',
              border: '2px solid var(--p2)', zIndex: 4,
              pointerEvents: 'none',
              transition: 'width .12s, height .12s',
              boxShadow: '0 0 8px rgba(232,89,12,0.5)',
            }}/>
          )}
        </div>

        {/* Hover time tooltip */}
        {hovering && duration > 0 && (
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
