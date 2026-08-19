/**
 * FieldTimeline.jsx — two-lane event timeline for Field collection mode.
 *
 * Renders collected events as markers in two horizontal lanes:
 *   • Home lane (top, blue)
 *   • Away lane (bottom, orange)
 *   • Unassigned lane (middle, grey) — for events collected before team is set
 *
 * Markers are colored by event type (stable 12-color palette keyed on eventId).
 * Clicking a marker seeks video and fires onSelect(event).
 * Overlap: markers within 0.8% of each other are jittered vertically by ±3px
 * per cluster rank — keeps them visually distinct without zoom.
 *
 * Props:
 *   events         — collected event array (each has videoTimeSec, eventId, eventLabel, team)
 *   videoDuration  — video duration in seconds
 *   videoRef       — ref to <video> element
 *   currentTime    — current video time in seconds
 *   playing        — boolean
 *   muted          — boolean
 *   onSeek(t)      — seek to t seconds
 *   onTogglePlay   — toggle playback
 *   onToggleMute   — toggle mute
 *   onSelect(ev)   — called when marker clicked
 *   onDragStart    — called at drag start (gates parent onTimeUpdate)
 */
import { useState, useRef } from 'react'

// ── Stable event-type color palette ───────────────────────────────────────────
const EVENT_COLORS = {
  pass:             '#0A84FF',
  pass_first_time:  '#0A84FF',
  pass_interception:'#64D2FF',
  pass_recovery:    '#5AC8FA',
  reception:        '#30D158',
  shot:             '#FF453A',
  dribble:          '#FF9F0A',
  miscontrol:       '#FFD60A',
  fifty_fifty:      '#BF5AF2',
  ball_recovery:    '#30D158',
  block:            '#FF6B6B',
  clearance:        '#4CD964',
  interception:     '#64D2FF',
  tackle:           '#FF9500',
  foul_committed:   '#FF3B30',
  goal_keeper:      '#FFCC00',
  pressure:         '#FF6EC7',
  hold_up_duel:     '#AC8E68',
  positioning_duel: '#AC8E68',
  separation_duel:  '#AC8E68',
  leg_stretch_duel: '#AC8E68',
  out:              '#8E8E93',
  card:             '#FF3B30',
  half_start:       '#30D158',
  half_end:         '#FF453A',
  default:          '#E8590C',
}

function eventColor(eventId) {
  return EVENT_COLORS[eventId] || EVENT_COLORS.default
}

const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m  = Math.floor(s / 60)
  const sc = Math.floor(s % 60)
  return `${m}:${String(sc).padStart(2,'0')}`
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
    </svg>
  )
}

export default function FieldTimeline({
  events, videoDuration, videoRef, currentTime,
  playing, muted,
  onSeek, onTogglePlay, onToggleMute, onSelect, onDragStart,
}) {
  const trackRef = useRef(null)
  const [dragPct,   setDragPct]   = useState(null)
  const [hovering,  setHovering]  = useState(false)
  const [hoverPct,  setHoverPct]  = useState(0)
  const [hoverTime, setHoverTime] = useState(0)
  const [tooltip,   setTooltip]   = useState(null)

  const onSeekRef = useRef(onSeek)
  const videoRefRef = useRef(videoRef)
  onSeekRef.current = onSeek
  videoRefRef.current = videoRef

  const duration = videoDuration || 0

  function getLiveDuration() {
    const d = videoRefRef.current?.current?.duration
    return isFinite(d) && d > 0 ? d : 0
  }
  function pctFromClientX(clientX) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || !rect.width) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  function handlePointerDown(e) {
    if (!duration) return
    e.preventDefault()
    onDragStart?.()
    setDragPct(pctFromClientX(e.clientX))
    function onMove(ev) { const p = pctFromClientX(ev.clientX); setDragPct(p); setHoverPct(p); setHoverTime(p * getLiveDuration()) }
    function onUp(ev) {
      cleanup()
      const t = pctFromClientX(ev.clientX) * getLiveDuration()
      if (getLiveDuration() === 0) return
      onSeekRef.current?.(t); setDragPct(null)
    }
    function onCancel() { cleanup(); setDragPct(null) }
    function cleanup() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const isDragging  = dragPct !== null
  const progressPct = isDragging ? dragPct * 100
    : duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const thumbSize   = isDragging ? 16 : hovering ? 14 : 10
  const trackH      = isDragging || hovering ? 5 : 3

  const btnStyle = {
    flexShrink:0, width:28, height:28, borderRadius:8,
    border:'1px solid var(--b-2)', background:'var(--bg-3)', color:'var(--t-1)',
    cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
    transition:'background .12s',
  }

  // ── Split events into lanes ────────────────────────────────────────────────
  const homeEvents       = events.filter(e => e.team === 'home')
  const awayEvents       = events.filter(e => e.team === 'away')
  const unassignedEvents = events.filter(e => !e.team || e.team === 'none')

  // ── Overlap jitter — cluster events within 0.8% and offset vertically ─────
  function jitter(evList) {
    if (!evList.length || duration === 0) return evList.map(e => ({ ...e, _jitter: 0 }))
    const sorted = [...evList].sort((a, b) => (a.videoTimeSec||0) - (b.videoTimeSec||0))
    const result = []
    let cluster = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
      const pctDiff = Math.abs(((sorted[i].videoTimeSec||0) - (sorted[i-1].videoTimeSec||0)) / duration * 100)
      if (pctDiff < 0.8) { cluster.push(sorted[i]) }
      else {
        cluster.forEach((ev, idx) => result.push({ ...ev, _jitter: (idx - (cluster.length-1)/2) * 4 }))
        cluster = [sorted[i]]
      }
    }
    cluster.forEach((ev, idx) => result.push({ ...ev, _jitter: (idx - (cluster.length-1)/2) * 4 }))
    return result
  }

  const homeJ  = jitter(homeEvents)
  const awayJ  = jitter(awayEvents)
  const unJ    = jitter(unassignedEvents)

  function LaneMarkers({ evList, laneColor }) {
    if (!evList.length || duration === 0) return null
    return evList.map((ev, i) => {
      const pct   = Math.min(100, ((ev.videoTimeSec || 0) / duration) * 100)
      const color = eventColor(ev.eventId)
      return (
        <div key={ev.id || i}
          title={`${ev.eventLabel} @ ${fmt(ev.videoTimeSec || 0)}`}
          onClick={e => { e.stopPropagation(); onSeekRef.current?.(ev.videoTimeSec || 0); onSelect?.(ev) }}
          onMouseEnter={e => { e.stopPropagation(); setTooltip({ x: pct, label: `${ev.eventLabel} · ${fmt(ev.videoTimeSec || 0)}` }) }}
          onMouseLeave={() => setTooltip(null)}
          onPointerDown={e => e.stopPropagation()}
          style={{
            position:'absolute', left:`${pct}%`, top:'50%',
            transform:`translate(-50%, calc(-50% + ${ev._jitter || 0}px))`,
            width:8, height:8, borderRadius:'50%',
            background:color, border:`1.5px solid rgba(0,0,0,0.5)`,
            cursor:'pointer', zIndex:3,
            boxShadow:`0 0 4px ${color}88`,
            transition:'transform .1s',
          }}
        />
      )
    })
  }

  function Lane({ label, color, evList, height }) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8, height }}>
        <div style={{ width:36, fontSize:9, fontWeight:700, color, textAlign:'right',
          letterSpacing:0.5, flexShrink:0, textTransform:'uppercase' }}>
          {label}
        </div>
        <div style={{ flex:1, position:'relative', height:'100%' }}>
          {/* Lane rail */}
          <div style={{ position:'absolute', top:'50%', left:0, right:0, height:2,
            transform:'translateY(-50%)', background:'rgba(255,255,255,0.06)', borderRadius:99 }} />
          {/* Lane fill up to playhead */}
          <div style={{ position:'absolute', top:'50%', left:0, width:`${progressPct}%`,
            height:2, transform:'translateY(-50%)',
            background:`${color}30`, borderRadius:99 }} />
          <LaneMarkers evList={evList} laneColor={color} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding:'6px 0' }}>
      {/* ── Transport row ─────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
        <button onClick={onTogglePlay} style={btnStyle}
          onMouseEnter={e=>e.currentTarget.style.background='var(--b-1)'}
          onMouseLeave={e=>e.currentTarget.style.background='var(--bg-3)'}>
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
        <button onClick={onToggleMute} style={{ ...btnStyle, color:muted?'var(--p2)':'var(--t-3)' }}
          onMouseEnter={e=>e.currentTarget.style.background='var(--b-1)'}
          onMouseLeave={e=>e.currentTarget.style.background='var(--bg-3)'}>
          <SpeakerIcon muted={muted} />
        </button>
        <span className="mono" style={{ fontSize:11, color:'var(--t-2)', flexShrink:0, minWidth:54, textAlign:'right' }}>
          {isDragging ? fmt(hoverTime) : fmt(currentTime)}
        </span>

        {/* Scrub track (single line for the playhead + drag) */}
        <div ref={trackRef} style={{
          flex:1, position:'relative', height:28,
          display:'flex', alignItems:'center',
          cursor:!duration?'default':isDragging?'grabbing':'pointer',
          userSelect:'none', touchAction:'none',
        }}
          onPointerDown={handlePointerDown}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => { if (!isDragging) setHovering(false) }}
          onMouseMove={e => { const p = pctFromClientX(e.clientX); setHoverPct(p); const d = videoRefRef.current?.current?.duration; setHoverTime(p*(isFinite(d)&&d>0?d:0)) }}
        >
          <div style={{ position:'absolute', left:0, right:0, height:trackH,
            background:'var(--bg-3)', borderRadius:99,
            transition:isDragging?'none':'height .12s', overflow:'visible' }}>
            <div style={{ position:'absolute', left:0, width:`${progressPct}%`,
              height:'100%', background:'var(--p2)', borderRadius:99, opacity:0.9,
              transition:isDragging?'none':'width .05s' }}/>
            {duration > 0 && (
              <div style={{ position:'absolute', left:`${progressPct}%`, top:'50%',
                transform:'translate(-50%,-50%)',
                width:thumbSize, height:thumbSize,
                borderRadius:'50%', background:'#fff',
                border:'2px solid var(--p2)', zIndex:4,
                pointerEvents:'none',
                transition:isDragging?'none':'width .12s, height .12s',
                boxShadow:isDragging?'0 0 12px rgba(232,89,12,0.8)':'0 0 8px rgba(232,89,12,0.5)',
              }}/>
            )}
            {(hovering||isDragging) && duration>0 && (
              <div style={{ position:'absolute', left:0, width:`${hoverPct*100}%`,
                height:'100%', background:'rgba(232,89,12,0.15)', borderRadius:99, pointerEvents:'none' }}/>
            )}
            {(hovering||isDragging) && duration>0 && (
              <div style={{ position:'absolute', left:`${hoverPct*100}%`, bottom:22,
                transform:'translateX(-50%)', background:'var(--bg-2)',
                border:'1px solid var(--b-2)', borderRadius:6, padding:'2px 6px',
                fontSize:10, fontFamily:'JetBrains Mono,monospace', color:'var(--t-1)',
                pointerEvents:'none', whiteSpace:'nowrap', zIndex:10 }}>
                {fmt(hoverTime)}
              </div>
            )}
          </div>
        </div>
        <span className="mono" style={{ fontSize:11, color:'var(--t-3)', flexShrink:0, minWidth:54 }}>
          {duration>0 ? fmt(duration) : '--:--'}
        </span>
      </div>

      {/* ── Two-lane markers area ─────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:0 }}>
        {/* Lane labels column */}
        <div style={{ width:36 }} />
        {/* Lanes */}
        <div style={{ flex:1, position:'relative' }}>
          {/* Shared tooltip */}
          {tooltip && (
            <div style={{ position:'absolute', left:`${tooltip.x}%`, bottom:'100%',
              transform:'translateX(-50%)', background:'var(--bg-2)',
              border:'1px solid var(--b-2)', borderRadius:6, padding:'3px 8px',
              fontSize:10, fontFamily:'JetBrains Mono,monospace', color:'var(--t-1)',
              pointerEvents:'none', whiteSpace:'nowrap', zIndex:20, marginBottom:4 }}>
              {tooltip.label}
            </div>
          )}
        </div>
      </div>
      <Lane label="Home" color="#0A84FF"  evList={homeJ}  height={22} />
      {unJ.length > 0 && <Lane label="—" color="#636366" evList={unJ} height={16} />}
      <Lane label="Away" color="#E8590C" evList={awayJ}  height={22} />

      {/* ── Event type legend ─────────────────────────────────────────────── */}
      {events.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 10px', marginTop:4, paddingLeft:44 }}>
          {[...new Map(events.map(e => [e.eventId, e.eventLabel])).entries()].map(([id, label]) => (
            <div key={id} style={{ display:'flex', alignItems:'center', gap:4 }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:eventColor(id), flexShrink:0 }}/>
              <span style={{ fontSize:9, color:'var(--t-3)' }}>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
