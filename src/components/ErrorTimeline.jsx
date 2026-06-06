import { useRef, useState, useCallback, useEffect } from 'react'

const TYPE_COLORS = {
  wrong_event:   '#FF453A',
  wrong_player:  '#FF9F0A',
  confused_with: '#0A84FF',
  missing_event: '#BF5AF2',
}

const formatTime = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms  = Math.floor((s % 1) * 1000)
  return `${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
}

export default function ErrorTimeline({
  errors, videoDuration, currentTime, playing, onSeek, onTogglePlay
}) {
  const trackRef   = useRef(null)
  const dragging   = useRef(false)
  const [hovering, setHovering]     = useState(false)
  const [hoverPct, setHoverPct]     = useState(0)
  const [hoverTime, setHoverTime]   = useState(0)
  const [tooltip, setTooltip]       = useState(null) // { x, label }

  const duration = videoDuration || 0
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  const pctFromEvent = useCallback((e) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }, [])

  const seekFromEvent = useCallback((e) => {
    const pct = pctFromEvent(e)
    onSeek && onSeek(pct * duration)
  }, [pctFromEvent, duration, onSeek])

  // Mouse down on track → start drag
  const onMouseDown = useCallback((e) => {
    if (!duration) return
    e.preventDefault()
    dragging.current = true
    seekFromEvent(e)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [seekFromEvent, duration])

  const onMouseMove = useCallback((e) => {
    if (!dragging.current) return
    seekFromEvent(e)
  }, [seekFromEvent])

  const onMouseUp = useCallback((e) => {
    dragging.current = false
    seekFromEvent(e)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }, [seekFromEvent])

  // Hover tracking on track
  const onTrackMouseMove = useCallback((e) => {
    const pct = pctFromEvent(e)
    setHoverPct(pct)
    setHoverTime(pct * duration)
  }, [pctFromEvent, duration])

  // Cleanup on unmount
  useEffect(() => () => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }, [])

  const thumbLeft = `${progress * 100}%`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* === Main scrubber row === */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 0',
      }}>

        {/* Play / pause button */}
        <button
          onClick={onTogglePlay}
          style={{
            flexShrink: 0, width: 28, height: 28,
            borderRadius: 8, border: '1px solid var(--b-2)',
            background: 'var(--bg-3)', color: 'var(--t-1)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .12s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--b-1)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-3)'}
        >
          {playing ? (
            /* Pause icon */
            <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
              <rect x="0" y="0" width="3.5" height="12" rx="1" fill="currentColor"/>
              <rect x="6.5" y="0" width="3.5" height="12" rx="1" fill="currentColor"/>
            </svg>
          ) : (
            /* Play icon */
            <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
              <path d="M1 1l8 5-8 5V1z" fill="currentColor"/>
            </svg>
          )}
        </button>

        {/* Current time */}
        <span className="mono" style={{
          fontSize: 11, color: 'var(--t-2)', flexShrink: 0, minWidth: 72, textAlign: 'right',
        }}>
          {formatTime(currentTime)}
        </span>

        {/* Track area */}
        <div
          ref={trackRef}
          style={{
            flex: 1, position: 'relative', height: 28,
            display: 'flex', alignItems: 'center',
            cursor: duration ? 'pointer' : 'default',
          }}
          onMouseDown={onMouseDown}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => { setHovering(false); setTooltip(null) }}
          onMouseMove={onTrackMouseMove}
        >
          {/* Track background */}
          <div style={{
            position: 'absolute', left: 0, right: 0,
            height: hovering ? 5 : 3,
            background: 'var(--bg-3)',
            borderRadius: 99,
            transition: 'height .12s',
            overflow: 'visible',
          }}>

            {/* Buffered / filled portion */}
            <div style={{
              position: 'absolute', left: 0,
              width: `${progress * 100}%`,
              height: '100%',
              background: 'var(--p2)',
              borderRadius: 99,
              opacity: 0.9,
            }}/>

            {/* Hover ghost progress */}
            {hovering && duration > 0 && (
              <div style={{
                position: 'absolute', left: 0,
                width: `${hoverPct * 100}%`,
                height: '100%',
                background: 'rgba(232,89,12,0.25)',
                borderRadius: 99,
                pointerEvents: 'none',
              }}/>
            )}

            {/* Error markers */}
            {errors.map((err, i) => {
              const pct = duration > 0
                ? Math.min(100, ((err.videoTimeSec || 0) / duration) * 100)
                : 0
              const color = TYPE_COLORS[err.errorType] || 'var(--p2)'
              return (
                <div
                  key={i}
                  title={`${err.triggeredEventLabel || err.errorType} @ ${formatTime(err.videoTimeSec || 0)}`}
                  onMouseEnter={(e) => {
                    e.stopPropagation()
                    setTooltip({ x: pct, label: `${err.triggeredEventLabel || err.errorType} · ${formatTime(err.videoTimeSec || 0)}` })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={(e) => { e.stopPropagation(); onSeek && onSeek(err.videoTimeSec || 0) }}
                  style={{
                    position: 'absolute',
                    left: `${pct}%`,
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 8, height: 8,
                    borderRadius: '50%',
                    background: color,
                    border: '1.5px solid rgba(0,0,0,0.6)',
                    zIndex: 3,
                    cursor: 'pointer',
                    boxShadow: `0 0 5px ${color}99`,
                    transition: 'transform .1s',
                  }}
                  onMouseDown={e => e.stopPropagation()}
                />
              )
            })}

            {/* Playhead thumb */}
            {duration > 0 && (
              <div style={{
                position: 'absolute',
                left: thumbLeft,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: hovering ? 14 : 10,
                height: hovering ? 14 : 10,
                borderRadius: '50%',
                background: '#fff',
                border: '2px solid var(--p2)',
                zIndex: 4,
                pointerEvents: 'none',
                transition: 'width .12s, height .12s',
                boxShadow: '0 0 8px rgba(232,89,12,0.5)',
              }}/>
            )}
          </div>

          {/* Hover time tooltip */}
          {hovering && duration > 0 && (
            <div style={{
              position: 'absolute',
              left: `${hoverPct * 100}%`,
              bottom: 24,
              transform: 'translateX(-50%)',
              background: 'var(--bg-2)',
              border: '1px solid var(--b-2)',
              borderRadius: 6,
              padding: '3px 7px',
              fontSize: 10,
              fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--t-1)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 10,
            }}>
              {formatTime(hoverTime)}
            </div>
          )}

          {/* Error marker tooltip */}
          {tooltip && (
            <div style={{
              position: 'absolute',
              left: `${tooltip.x}%`,
              bottom: 24,
              transform: 'translateX(-50%)',
              background: 'var(--bg-2)',
              border: '1px solid var(--b-2)',
              borderRadius: 6,
              padding: '3px 8px',
              fontSize: 10,
              fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--t-1)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 11,
            }}>
              {tooltip.label}
            </div>
          )}
        </div>

        {/* Total duration */}
        <span className="mono" style={{
          fontSize: 11, color: 'var(--t-3)', flexShrink: 0, minWidth: 72,
        }}>
          {formatTime(duration)}
        </span>

      </div>
    </div>
  )
}
