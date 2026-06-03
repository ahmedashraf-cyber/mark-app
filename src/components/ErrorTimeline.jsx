// Horizontal timeline showing all tagged errors for the current session
// Each error = colored marker at its timestamp position
// Click a marker to jump video to that timestamp

export default function ErrorTimeline({ errors, videoDuration, onSeek, currentTime }) {
  if (!videoDuration || videoDuration === 0) return null

  const typeColors = {
    wrong_event:   '#FF453A',
    wrong_player:  '#FF9F0A',
    confused_with: '#0A84FF',
    missing_event: '#BF5AF2',
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2,'0')}`
  }

  const progressPct = Math.min(100, (currentTime / videoDuration) * 100)

  return (
    <div style={{position:'relative', height:44, display:'flex', alignItems:'center'}}>

      {/* Track */}
      <div style={{
        position:'absolute', left:0, right:0,
        height:4, background:'var(--bg-3)', borderRadius:4,
      }}>
        {/* Progress */}
        <div style={{
          position:'absolute', left:0, width:`${progressPct}%`,
          height:'100%', background:'var(--b-2)', borderRadius:4,
        }}/>
      </div>

      {/* Error markers */}
      {errors.map((err, i) => {
        const pct = Math.min(100, ((err.videoTimeSec || 0) / videoDuration) * 100)
        const color = typeColors[err.errorType] || 'var(--p2)'
        return (
          <div
            key={i}
            title={`${err.triggeredEventLabel || err.errorType} at ${formatTime(err.videoTimeSec || 0)}`}
            onClick={() => onSeek && onSeek(err.videoTimeSec || 0)}
            style={{
              position:'absolute',
              left:`${pct}%`,
              transform:'translateX(-50%)',
              width:12, height:12,
              borderRadius:'50%',
              background: color,
              border:'2px solid rgba(0,0,0,0.5)',
              cursor:'pointer',
              zIndex:2,
              transition:'transform .1s',
              boxShadow:`0 0 6px ${color}88`,
            }}
            onMouseEnter={e => e.target.style.transform='translateX(-50%) scale(1.5)'}
            onMouseLeave={e => e.target.style.transform='translateX(-50%) scale(1)'}
          />
        )
      })}

      {/* Playhead */}
      <div style={{
        position:'absolute',
        left:`${progressPct}%`,
        transform:'translateX(-50%)',
        width:3, height:20,
        background:'var(--t-1)',
        borderRadius:2, zIndex:3,
      }}/>
    </div>
  )
}
