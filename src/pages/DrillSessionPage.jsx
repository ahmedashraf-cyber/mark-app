/**
 * DrillSessionPage.jsx — a trainee taking a quiz
 * ============================================================================
 * DRILL only.
 *
 * Streaming only, no download option. Each clip is buffered before it plays
 * and the next is pre-buffered while the current one is being tagged, so
 * advancing is instant.
 *
 * Forward only — no returning to a clip already passed.
 * Leaving a clip empty records "no event", which is a valid answer.
 * Advancing is explicit (Enter or the button) because a clip may hold 2+
 * events and a single tag cannot signal that the trainee is finished.
 *
 * The timer starts when the FIRST clip plays, not when Start is pressed, so
 * buffering does not eat into the limit. It is stored as accumulated elapsed
 * time rather than a start timestamp, because it pauses while MARK is closed.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import ClipTagger from '../components/ClipTagger'
import { clipUrl as driveClipUrl } from '../utils/drillDrive'
import {
  saveSession, clearSession, remainingMs, isOutOfTime,
} from '../utils/drillSession'
import { TIMER_WARNING_MIN, SESSION_STATUS } from '../config/drillConfig'

/* ── progress: one segment per clip round an arc, countdown ring outside ── */
function ProgressDial({ total, done, remainingMs: rem, limitMs, warning }) {
  const R = 54, C = 2 * Math.PI * R
  const frac = limitMs ? Math.max(0, Math.min(1, rem / limitMs)) : 1
  const ringColor = warning ? '#FF9500' : 'var(--p2)'
  const mins = Math.floor(rem / 60000)
  const secs = Math.floor((rem % 60000) / 1000)

  // segments sit on an inner arc, one per clip, so the trainee can see the
  // shape of what is left rather than reading a number
  const segs = []
  const maxSeg = Math.min(total, 60)          // beyond 60 the segments merge
  for (let i = 0; i < maxSeg; i++) {
    const a0 = (i / maxSeg) * 2 * Math.PI - Math.PI / 2 + 0.012
    const a1 = ((i + 1) / maxSeg) * 2 * Math.PI - Math.PI / 2 - 0.012
    const r = 40
    const filled = i < Math.round((done / total) * maxSeg)
    segs.push(
      <path key={i}
        d={`M ${64 + r * Math.cos(a0)} ${64 + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${64 + r * Math.cos(a1)} ${64 + r * Math.sin(a1)}`}
        stroke={filled ? 'var(--p2)' : 'var(--b-2)'} strokeWidth="5"
        fill="none" strokeLinecap="round"/>
    )
  }

  return (
    <div style={{ position:'relative', width:128, height:128, flexShrink:0 }}>
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--b-2)" strokeWidth="4"/>
        <circle cx="64" cy="64" r={R} fill="none" stroke={ringColor} strokeWidth="4"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)} strokeLinecap="round"
          style={{ transform:'rotate(-90deg)', transformOrigin:'50% 50%',
                   transition:'stroke-dashoffset 1s linear, stroke .4s' }}/>
        {segs}
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center' }}>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:19, fontWeight:800,
          color: warning ? '#FF9500' : 'var(--t-1)', lineHeight:1 }}>
          {limitMs ? `${mins}:${String(secs).padStart(2,'0')}` : '∞'}
        </div>
        <div style={{ fontSize:9, color:'var(--t-3)', marginTop:3, letterSpacing:0.5 }}>
          {done} / {total}
        </div>
      </div>
    </div>
  )
}

export default function DrillSessionPage({
  session: initial, clipRows, onFinish, onAbandon,
}) {
  const [session, setSession] = useState(initial)
  const [url,     setUrl]     = useState('')
  const [ready,   setReady]   = useState(false)
  const [started, setStarted] = useState(false)
  const [warned,  setWarned]  = useState(false)
  const tickRef     = useRef(null)
  const clipStartRef = useRef(null)

  const clipByIndex = Object.fromEntries(clipRows.map(c => [Number(c.clip_index), c]))
  const currentIdx  = session.order[session.position]
  const clip        = clipByIndex[currentIdx]
  const total       = session.order.length
  const limitMs     = Number(session.time_limit_min || 0) * 60_000
  const rem         = remainingMs(session)
  const warning     = limitMs > 0 && rem <= TIMER_WARNING_MIN * 60_000

  const tags = session.tags[currentIdx] || []

  // persist on every change — a crash must not lose the attempt
  useEffect(() => { saveSession(session) }, [session])

  // buffer the current clip, and pre-buffer the next so advancing is instant
  useEffect(() => {
    if (!clip) return
    let alive = true
    setReady(false)
    driveClipUrl(clip.drive_file_id).then(u => {
      if (!alive) return
      setUrl(u)
      const probe = document.createElement('video')
      probe.preload = 'auto'
      probe.muted = true
      probe.oncanplaythrough = () => { if (alive) setReady(true) }
      probe.onerror = () => { if (alive) setReady(true) }   // let it try anyway
      probe.src = u
    }).catch(() => { if (alive) setReady(true) })

    const nextIdx = session.order[session.position + 1]
    if (nextIdx != null && clipByIndex[nextIdx]) {
      driveClipUrl(clipByIndex[nextIdx].drive_file_id).then(u => {
        const pre = document.createElement('video')
        pre.preload = 'auto'; pre.muted = true; pre.src = u
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [clip?.drive_file_id, session.position])

  // the clock only runs once the first clip is actually playing
  useEffect(() => {
    if (!started || !limitMs) return
    tickRef.current = setInterval(() => {
      setSession(s => {
        const next = { ...s, elapsed_ms: Number(s.elapsed_ms || 0) + 1000 }
        if (remainingMs(next) <= 0) {
          clearInterval(tickRef.current)
          finish(next, SESSION_STATUS.TIMED_OUT)
          return next
        }
        return next
      })
    }, 1000)
    return () => clearInterval(tickRef.current)
  }, [started, limitMs])

  useEffect(() => {
    if (warning && !warned && limitMs) setWarned(true)
  }, [warning, warned, limitMs])

  const finish = useCallback((s, status) => {
    clearInterval(tickRef.current)
    clearSession()
    onFinish({ ...s, status, finished_at: Date.now() })
  }, [onFinish])

  function addTag(ev) {
    setSession(s => ({
      ...s,
      tags: { ...s.tags, [currentIdx]: [...(s.tags[currentIdx] || []), ev] },
    }))
  }
  function removeTag(i) {
    setSession(s => ({
      ...s,
      tags: { ...s.tags, [currentIdx]: (s.tags[currentIdx] || []).filter((_, j) => j !== i) },
    }))
  }

  function advance() {
    const spent = clipStartRef.current ? Date.now() - clipStartRef.current : null
    clipStartRef.current = Date.now()
    setSession(s => {
      const withTime = {
        ...s,
        clip_times: { ...s.clip_times, [currentIdx]: spent },
        // a reached clip left empty is a real answer — record the empty array
        tags: { ...s.tags, [currentIdx]: s.tags[currentIdx] || [] },
      }
      if (s.position + 1 >= total) {
        finish({ ...withTime, position: total }, SESSION_STATUS.COMPLETED)
        return { ...withTime, position: total }
      }
      return { ...withTime, position: s.position + 1 }
    })
  }

  // ── start gate: buffering must not eat the time limit ──
  if (!started) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'var(--bg)', color:'var(--t-1)' }}>
      <div className="card" style={{ padding:30, maxWidth:440, textAlign:'center' }}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>{session.quiz_name}</div>
        <div style={{ fontSize:12, color:'var(--t-3)', lineHeight:1.8, marginBottom:20 }}>
          {total} clips · {session.time_limit_min} minutes · pass {session.pass_mark_percent}%<br/>
          Attempt {session.attempt_number}<br/>
          <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11 }}>
            {session.scope_event_ids.join(', ')}
          </span>
        </div>
        <div style={{ fontSize:11, color:'var(--t-3)', lineHeight:1.6, marginBottom:20,
          textAlign:'left', background:'var(--bg-3)', borderRadius:8, padding:'12px 14px' }}>
          The clock starts when the first clip plays, not now.<br/>
          You cannot go back to a clip once you move on.<br/>
          If a clip has no event, leave it empty and move on — that is an answer.<br/>
          You have 24 hours to finish if you close MARK part way.
        </div>
        <button className="btn-orange" style={{ width:'100%', padding:'12px 0', fontSize:13 }}
          disabled={!ready}
          onClick={() => { setStarted(true); clipStartRef.current = Date.now() }}>
          {ready ? 'Start' : 'Buffering the first clip…'}
        </button>
        <button onClick={onAbandon} style={{ background:'none', border:'none',
          color:'var(--t-3)', fontSize:11, cursor:'pointer', marginTop:12 }}>
          Not now
        </button>
      </div>
    </div>
  )

  if (!clip) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'var(--bg)', color:'var(--t-3)', fontSize:13 }}>Scoring…</div>
  )

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', color:'var(--t-1)', overflow:'hidden' }}>

      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 16px', gap:12 }}>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800,
          color:'var(--p2)', letterSpacing:1.5, background:'rgba(232,89,12,0.12)',
          padding:'2px 8px', borderRadius:4 }}>DRILL</div>
        <span style={{ fontSize:12, fontWeight:600 }}>{session.quiz_name}</span>
        <div style={{ flex:1 }}/>
        {warning && (
          <span style={{ fontSize:11, fontWeight:700, color:'#FF9500' }}>
            under {TIMER_WARNING_MIN} minutes left
          </span>
        )}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:16 }}>
        <div style={{ display:'flex', gap:18, maxWidth:1060, margin:'0 auto', width:'100%' }}>

          <div style={{ flex:1, minWidth:0 }}>
            <ClipTagger
              clipUrl={url}
              scopeIds={session.scope_event_ids}
              instruction={clip.instruction}
              events={tags}
              onAdd={addTag}
              onRemove={removeTag}
              onNext={advance}
              nextLabel={session.position + 1 >= total ? 'Finish' : 'Next clip'}
            />
            <button className="btn-orange"
              style={{ width:'100%', padding:'12px 0', fontSize:13, marginTop:14 }}
              onClick={advance}>
              {session.position + 1 >= total
                ? 'Finish and see my score →'
                : `Next clip (${session.position + 2} of ${total}) →`}
            </button>
            <div style={{ fontSize:10, color:'var(--t-3)', textAlign:'center', marginTop:8 }}>
              {tags.length
                ? `${tags.length} event${tags.length === 1 ? '' : 's'} tagged on this clip`
                : 'Nothing tagged — moving on records “no event” as your answer'}
            </div>
          </div>

          <div style={{ width:150, flexShrink:0, display:'flex', flexDirection:'column',
            alignItems:'center', gap:14 }}>
            <ProgressDial total={total} done={session.position}
              remainingMs={rem} limitMs={limitMs} warning={warning}/>
            <div style={{ fontSize:10, color:'var(--t-3)', textAlign:'center', lineHeight:1.6 }}>
              clip {session.position + 1} of {total}<br/>
              {Object.values(session.tags).reduce((s, a) => s + a.length, 0)} events tagged
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
