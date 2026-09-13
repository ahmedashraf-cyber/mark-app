/**
 * ClipTagger.jsx — tag events on a single short clip
 * ============================================================================
 * Used by BOTH sides: the trainer building the answer key, and the trainee
 * taking the quiz. Identical player and identical tagging, because the player
 * controls are now the same for both (full pause / scrub / frame step) and a
 * trainee must never be scored against a flow they did not have.
 *
 * It reuses fieldExtras as DATA — FIELD_EVENTS, OPTIONS, GROUP_TO_ATTR_COL —
 * so a tagged event comes out in exactly the shape tag_events uses and the
 * scoring comparison needs no translation. fieldExtras is NOT modified, and
 * FieldPage is untouched.
 *
 * Differences from TAG collection, both deliberate:
 *   - scope limits which events appear
 *   - pressure_start does not open a pair here; there is no pressure_end on a
 *     10-second clip, so the open-state machinery is bypassed
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { FIELD_EVENTS, EVENT_BY_ID } from '../utils/fieldExtras'
import { GROUP_TO_ATTR_COL } from '../config/fieldConfig'
import { DRILL_ATTR_COLUMNS } from '../config/drillConfig'

const FRAME = 1 / 25   // one frame at 25fps

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '00:00.000'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 1000)
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`
}

/** Groups an event asks for, resolving the variant form down to a flat list. */
export function groupsFor(eventId) {
  const def = EVENT_BY_ID[eventId]
  if (!def) return []
  if (def.groups) return def.groups
  // variant events (pass) branch on inferred type. In DRILL the trainer picks
  // the type explicitly, so offer the union of every variant's groups and let
  // the required flags drive what must be filled.
  if (def.variants?.variants?.length) {
    const seen = new Set()
    const out = []
    def.variants.variants.forEach(v => (v.groups || []).forEach(g => {
      if (seen.has(g.id)) return
      seen.add(g.id); out.push(g)
    }))
    return out
  }
  return []
}

/** Turn a staged tag into the attr_* shape tag_events / quiz_answers use. */
export function toAttrRow(eventId, selections) {
  const row = Object.fromEntries(DRILL_ATTR_COLUMNS.map(c => [c, '']))
  Object.entries(selections || {}).forEach(([groupId, codes]) => {
    const col = GROUP_TO_ATTR_COL[groupId]
    if (!col) return
    const list = Array.isArray(codes) ? codes : [codes]
    const clean = list.filter(Boolean)
    if (clean.length) row[col] = clean.join('|')
  })
  return row
}

export default function ClipTagger({
  clipUrl,
  scopeIds,             // event ids the quiz covers
  instruction,          // shown to the tagger
  events,               // already-tagged events for this clip
  onAdd,                // (event) => void
  onRemove,             // (index) => void
  onNext,               // () => void  — explicit, because a clip may hold 2+
  nextLabel = 'Next clip',
  showTimestamps = true,
  headerRight = null,
}) {
  const videoRef = useRef(null)
  const [time,     setTime]     = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing,  setPlaying]  = useState(true)
  const [pending,  setPending]  = useState(null)   // { eventId, at, selections }
  const [err,      setErr]      = useState('')

  const scoped = FIELD_EVENTS.filter(e => scopeIds.includes(e.id))

  // reset when the clip changes
  useEffect(() => {
    setPending(null); setErr(''); setTime(0); setPlaying(true)
  }, [clipUrl])

  const onTimeUpdate = () => setTime(videoRef.current?.currentTime || 0)
  const onLoaded = () => {
    setDuration(videoRef.current?.duration || 0)
    videoRef.current?.play().catch(() => {})
  }

  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return
    if (v.paused) { v.play().catch(() => {}); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }, [])

  const step = useCallback(delta => {
    const v = videoRef.current; if (!v) return
    v.pause(); setPlaying(false)
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
    setTime(v.currentTime)
  }, [])

  // Start a tag at the CURRENT time, frozen now — so time spent choosing
  // attributes afterwards does not drift the recorded timestamp.
  function beginTag(eventId) {
    const def = EVENT_BY_ID[eventId]
    if (!def) return
    const at = videoRef.current?.currentTime || 0
    const groups = groupsFor(eventId)
    videoRef.current?.pause(); setPlaying(false)
    setErr('')
    if (!groups.length) {
      commit({ eventId, at, selections: {} })
      return
    }
    setPending({ eventId, at, selections: {} })
  }

  function pick(groupId, code, selectType) {
    setPending(p => {
      if (!p) return p
      const cur = p.selections[groupId] || []
      let next
      if (selectType === 'multi') {
        next = cur.includes(code) ? cur.filter(c => c !== code) : [...cur, code]
      } else {
        next = cur.includes(code) ? [] : [code]
      }
      return { ...p, selections: { ...p.selections, [groupId]: next } }
    })
  }

  function commit(tag) {
    const groups = groupsFor(tag.eventId)
    const missing = groups.filter(g =>
      g.required && !(tag.selections[g.id] || []).length).map(g => g.label)
    if (missing.length) { setErr('Still needed: ' + missing.join(', ')); return }
    onAdd({
      event_code: tag.eventId,
      label: EVENT_BY_ID[tag.eventId]?.label || tag.eventId,
      video_time_ms: Math.round(tag.at * 1000),
      selections: tag.selections,
      attrs: toAttrRow(tag.eventId, tag.selections),
    })
    setPending(null); setErr('')
  }

  // keyboard: event hotkeys, space to play/pause, arrows to step
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const k = e.key.toUpperCase()

      if (e.code === 'Space') { e.preventDefault(); togglePlay(); return }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); step(e.shiftKey ? -1 : -FRAME); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ?  1 :  FRAME); return }

      if (pending) {
        if (e.key === 'Escape') { setPending(null); setErr(''); return }
        if (e.key === 'Enter')  { e.preventDefault(); commit(pending); return }
        // option toggle keys within the pending groups
        for (const g of groupsFor(pending.eventId)) {
          const hit = (g.options || []).find(o => o.toggleKey === k)
          if (hit) { e.preventDefault(); pick(g.id, hit.code, g.selectType); return }
        }
        return
      }

      if (e.key === 'Enter') { e.preventDefault(); onNext?.(); return }
      const hit = scoped.find(ev => (ev.hotkey || '').toUpperCase() === k)
      if (hit) { e.preventDefault(); beginTag(hit.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, scoped, togglePlay, step, onNext])

  const btn = (active) => ({
    padding:'7px 11px', fontSize:11, fontWeight:600, borderRadius:6, cursor:'pointer',
    background: active ? 'rgba(232,89,12,0.15)' : 'var(--bg-3)',
    border:`1px solid ${active ? 'var(--p2)' : 'var(--b-1)'}`,
    color: active ? 'var(--p2)' : 'var(--t-2)',
  })

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

      {/* instruction */}
      {instruction ? (
        <div style={{ background:'rgba(232,89,12,0.08)', border:'1px solid rgba(232,89,12,0.25)',
          borderRadius:8, padding:'10px 14px', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:13, color:'var(--t-1)', flex:1 }}>{instruction}</span>
          {headerRight}
        </div>
      ) : headerRight}

      {/* video */}
      <div style={{ position:'relative', background:'#000', borderRadius:10, overflow:'hidden' }}>
        <video ref={videoRef} src={clipUrl} loop muted playsInline
          onTimeUpdate={onTimeUpdate} onLoadedMetadata={onLoaded}
          onClick={togglePlay}
          style={{ width:'100%', display:'block', maxHeight:'42vh', cursor:'pointer' }}/>
      </div>

      {/* transport */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <button onClick={togglePlay} style={{ ...btn(false), width:60 }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => step(-FRAME)} style={btn(false)} title="Shift for 1s">◀ frame</button>
        <button onClick={() => step(FRAME)}  style={btn(false)} title="Shift for 1s">frame ▶</button>
        <input type="range" min="0" max={duration || 0} step="0.001" value={time}
          onChange={e => {
            const v = videoRef.current; if (!v) return
            v.pause(); setPlaying(false)
            v.currentTime = parseFloat(e.target.value); setTime(v.currentTime)
          }}
          style={{ flex:1, accentColor:'var(--p2)' }}/>
        {showTimestamps && (
          <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:12,
            color:'var(--p2)', width:92, textAlign:'right' }}>{fmtTime(time)}</span>
        )}
      </div>
      <div style={{ fontSize:10, color:'var(--t-3)' }}>
        Space play/pause · ← → step one frame · Shift + ← → one second · Enter for {nextLabel.toLowerCase()}
      </div>

      {/* attribute capture for a pending tag */}
      {pending ? (
        <div className="card" style={{ padding:16, border:'1px solid var(--p2)' }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:12 }}>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--p2)' }}>
              {EVENT_BY_ID[pending.eventId]?.label}
            </span>
            <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'var(--t-3)' }}>
              at {fmtTime(pending.at)}
            </span>
            <div style={{ flex:1 }}/>
            <button onClick={() => { setPending(null); setErr('') }}
              style={{ background:'none', border:'none', color:'var(--t-3)',
                fontSize:11, cursor:'pointer' }}>Cancel (Esc)</button>
          </div>

          {groupsFor(pending.eventId).map(g => (
            <div key={g.id} style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
                marginBottom:6, textTransform:'uppercase' }}>
                {g.label}{g.required && <span style={{ color:'#FF453A' }}> *</span>}
                <span style={{ opacity:0.6, textTransform:'none', letterSpacing:0 }}>
                  {' '}{g.selectType === 'multi' ? '(any)' : '(one)'}
                </span>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {(g.options || []).map(o => {
                  const on = (pending.selections[g.id] || []).includes(o.code)
                  return (
                    <button key={o.code} onClick={() => pick(g.id, o.code, g.selectType)}
                      style={btn(on)}>
                      {o.label}
                      {o.toggleKey && <span style={{ opacity:0.5, marginLeft:5,
                        fontFamily:'JetBrains Mono,monospace' }}>{o.toggleKey}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {err && <div style={{ fontSize:11, color:'#FF453A', marginBottom:10 }}>{err}</div>}

          <button className="btn-orange" style={{ width:'100%', padding:'10px 0', fontSize:12 }}
            onClick={() => commit(pending)}>
            Save this event (Enter)
          </button>
        </div>
      ) : (
        /* event buttons */
        <div className="card" style={{ padding:16 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
            marginBottom:8, textTransform:'uppercase' }}>Tag an event</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {scoped.map(e => (
              <button key={e.id} onClick={() => beginTag(e.id)} style={btn(false)}>
                {e.label}
                {e.hotkey && <span style={{ opacity:0.5, marginLeft:5,
                  fontFamily:'JetBrains Mono,monospace' }}>{e.hotkey}</span>}
              </button>
            ))}
          </div>
          {!scoped.length && (
            <div style={{ fontSize:11, color:'#FF453A' }}>
              No events in scope — go back and tick at least one.
            </div>
          )}
        </div>
      )}

      {/* what has been tagged on this clip */}
      <div className="card" style={{ padding:16 }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:10 }}>
          <span style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
            textTransform:'uppercase' }}>Tagged on this clip</span>
          <span style={{ fontSize:11, color: events.length ? 'var(--p2)' : 'var(--t-3)' }}>
            {events.length}
          </span>
        </div>
        {!events.length ? (
          <div style={{ fontSize:11, color:'var(--t-3)', lineHeight:1.5 }}>
            Nothing tagged. If this clip genuinely has no event, leave it empty and
            press {nextLabel.toLowerCase()} — that records “no event” as the answer.
          </div>
        ) : (
          events.map((ev, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10,
              padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize:12, fontWeight:600, color:'var(--t-1)', minWidth:110 }}>
                {ev.label}
              </span>
              {showTimestamps && (
                <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11,
                  color:'var(--p2)' }}>{fmtTime(ev.video_time_ms / 1000)}</span>
              )}
              <span style={{ flex:1, fontSize:10, color:'var(--t-3)',
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {Object.values(ev.attrs || {}).filter(Boolean).join(' · ') || '—'}
              </span>
              <button onClick={() => onRemove(i)}
                style={{ background:'none', border:'none', color:'#FF453A',
                  fontSize:11, cursor:'pointer' }}>remove</button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
