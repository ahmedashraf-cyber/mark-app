import { useState, useRef } from 'react'

export default function ErrorTimeline({ errors, videoDuration, onSeek, currentTime, onDragStart }) {
  const trackRef = useRef(null)

  // dragPct is the scrubber position (0–1) while the user is dragging.
  // It is ONLY used for the visual position — the video is not touched until
  // pointer-up. null means "not dragging; use currentTime prop instead."
  const [dragPct, setDragPct] = useState(null)

  if (!videoDuration || videoDuration === 0) return null

  const typeColors = {
    wrong_event:   '#FF453A',
    wrong_player:  '#FF9F0A',
    confused_with: '#0A84FF',
    missing_event: '#BF5AF2',
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  function pctFromClientX(clientX) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  function handlePointerDown(e) {
    e.preventDefault()

    // Freeze parent's onTimeUpdate so the lagging video position cannot
    // overwrite the drag visual while the pointer is held down.
    onDragStart?.()
    setDragPct(pctFromClientX(e.clientX))

    // Capture the prop values now — closures below must not go stale
    // if the component re-renders mid-drag.
    const dur  = videoDuration
    const seek = onSeek

    // Why window-level listeners instead of onPointerMove/onPointerUp props:
    // React delegates events to the root container. When the pointer leaves the
    // track div, React stops firing the element's handlers. Attaching directly
    // to window guarantees we receive every move and the final release regardless
    // of where the pointer ends up, without needing setPointerCapture or any
    // spec quirks around implicit capture release before pointerup.
    function onMove(ev) {
      setDragPct(pctFromClientX(ev.clientX))
    }

    function onUp(ev) {
      cleanup()
      seek?.(pctFromClientX(ev.clientX) * dur)
      setDragPct(null)
    }

    function onCancel() {
      cleanup()
      setDragPct(null)
    }

    function cleanup() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup',   onUp)
      window.removeEventListener('pointercancel', onCancel)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  // During drag: show the drag position.
  // Otherwise: show the actual video position from the parent prop.
  const progressPct = dragPct !== null
    ? dragPct * 100
    : Math.min(100, (currentTime / videoDuration) * 100)

  return (
    <div
      ref={trackRef}
      style={{ position: 'relative', height: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
      onPointerDown={handlePointerDown}
    >

      {/* Track */}
      <div style={{
        position: 'absolute', left: 0, right: 0,
        height: 4, background: 'var(--bg-3)', borderRadius: 4,
      }}>
        {/* Progress fill */}
        <div style={{
          position: 'absolute', left: 0, width: `${progressPct}%`,
          height: '100%', background: 'var(--b-2)', borderRadius: 4,
        }} />
      </div>

      {/* Error markers */}
      {errors.map((err, i) => {
        const pct = Math.min(100, ((err.videoTimeSec || 0) / videoDuration) * 100)
        const color = typeColors[err.errorType] || 'var(--p2)'
        return (
          <div
            key={i}
            title={`${err.triggeredEventLabel || err.errorType} at ${formatTime(err.videoTimeSec || 0)}`}
            onPointerDown={e => e.stopPropagation()}
            onClick={() => onSeek?.(err.videoTimeSec || 0)}
            style={{
              position: 'absolute',
              left: `${pct}%`,
              transform: 'translateX(-50%)',
              width: 12, height: 12,
              borderRadius: '50%',
              background: color,
              border: '2px solid rgba(0,0,0,0.5)',
              cursor: 'pointer',
              zIndex: 2,
              transition: 'transform .1s',
              boxShadow: `0 0 6px ${color}88`,
            }}
            onMouseEnter={e => e.target.style.transform = 'translateX(-50%) scale(1.5)'}
            onMouseLeave={e => e.target.style.transform = 'translateX(-50%) scale(1)'}
          />
        )
      })}

      {/* Playhead */}
      <div style={{
        position: 'absolute',
        left: `${progressPct}%`,
        transform: 'translateX(-50%)',
        width: 3, height: 20,
        background: 'var(--t-1)',
        borderRadius: 2, zIndex: 3,
        pointerEvents: 'none',
      }} />

    </div>
  )
}
