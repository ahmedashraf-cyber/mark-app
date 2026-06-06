import { useState, useRef } from 'react'

export default function ErrorTimeline({ errors, videoDuration, onSeek, currentTime, onDragStart }) {
  const trackRef = useRef(null)
  // W3C spec: pointer capture is implicitly released BEFORE pointerup fires,
  // so hasPointerCapture() always returns false inside handlePointerUp.
  // We use our own ref to track drag state instead.
  const isDraggingRef = useRef(false)

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

  function pctFromPointer(e) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  function handlePointerDown(e) {
    e.preventDefault()
    trackRef.current.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    // Tell parent to freeze onTimeUpdate so the video's lagging position
    // cannot overwrite currentTime state while we are dragging.
    onDragStart?.()
    setDragPct(pctFromPointer(e))
  }

  function handlePointerMove(e) {
    if (!isDraggingRef.current) return
    // Visual-only update — no video seek during drag.
    // This avoids stacked rapid seeks that confuse WebView2.
    setDragPct(pctFromPointer(e))
  }

  function handlePointerUp(e) {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    const pct = pctFromPointer(e)

    // Seek first, then clear dragPct.
    // React 19 batches both setCurrentTime(t) (from onSeek inside the parent)
    // and setDragPct(null) into one render, so the ball lands at the correct
    // final position with no intermediate snap-back frame.
    onSeek?.(pct * videoDuration)
    setDragPct(null)
  }

  function handlePointerCancel() {
    isDraggingRef.current = false
    setDragPct(null)
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
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
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
