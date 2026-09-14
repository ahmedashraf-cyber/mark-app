/**
 * DrillResultsPage.jsx — what a trainee sees after an attempt
 * ============================================================================
 * DRILL only.
 *
 * ON A PASS: score, time taken, and the full clip-by-clip breakdown with their
 * answer beside the correct one, and the clip playable inline.
 *
 * ON A FAIL: the score, and nothing else.
 *
 * That asymmetry is the point. Retakes are allowed, so showing a failing
 * trainee every correct answer would let them score 100% next time without
 * having learnt anything, and the pass mark would gate nothing.
 */
import { useState } from 'react'
import { clipUrl as driveClipUrl } from '../utils/drillDrive'
import { EVENT_BY_ID } from '../utils/fieldExtras'
import { fmtTime } from '../components/ClipTagger'

const VERDICT_STYLE = {
  correct:          { c:'#30D158', label:'correct' },
  missed:           { c:'#FF453A', label:'missed' },
  not_needed_event: { c:'#FF9500', label:'nothing to tag' },
  wrong_event:      { c:'#FF453A', label:'wrong event' },
  wrong_team:       { c:'#BF5AF2', label:'wrong team' },
  wrong_timestamp:  { c:'#64D2FF', label:'timing off' },
  wrong_extra:      { c:'#FF9F0A', label:'wrong detail' },
}

function EventLine({ code, team, ms, attrs }) {
  if (!code) return <span style={{ color:'var(--t-3)' }}>nothing</span>
  const detail = Object.values(attrs || {}).filter(Boolean).join(' · ')
  return (
    <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11 }}>
      {EVENT_BY_ID[code]?.label || code}
      {team ? ` · ${team}` : ''}
      {ms !== '' && ms != null ? ` · ${fmtTime(Number(ms) / 1000)}` : ''}
      {detail ? ` · ${detail}` : ''}
    </span>
  )
}

export default function DrillResultsPage({ result, quiz, clipRows, onDone, onRequestRetake }) {
  const [openClip, setOpenClip] = useState(null)
  const [clipSrc,  setClipSrc]  = useState('')

  const { scorePercent, passed, counts, totalEvents, rows, timeTakenMs } = result
  const clipByIndex = Object.fromEntries(clipRows.map(c => [Number(c.clip_index), c]))

  const byClip = {}
  rows.forEach(r => { (byClip[r.clip_index] = byClip[r.clip_index] || []).push(r) })

  async function openInline(ci) {
    if (openClip === ci) { setOpenClip(null); return }
    setOpenClip(ci)
    const c = clipByIndex[ci]
    if (!c) return
    try { setClipSrc(await driveClipUrl(c.drive_file_id)) } catch { setClipSrc('') }
  }

  const mins = Math.floor((timeTakenMs || 0) / 60000)
  const secs = Math.floor(((timeTakenMs || 0) % 60000) / 1000)
  const scoreColor = passed ? '#30D158' : '#FF453A'

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', color:'var(--t-1)', overflow:'hidden' }}>

      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 16px', gap:12 }}>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800,
          color:'var(--p2)', letterSpacing:1.5, background:'rgba(232,89,12,0.12)',
          padding:'2px 8px', borderRadius:4 }}>DRILL</div>
        <span style={{ fontSize:12, fontWeight:600 }}>{quiz?.quiz_name}</span>
        <div style={{ flex:1 }}/>
        <button onClick={onDone} style={{ background:'none', border:'none',
          color:'var(--t-3)', fontSize:11, cursor:'pointer' }}>Done</button>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:24,
        maxWidth:860, margin:'0 auto', width:'100%' }}>

        {/* score */}
        <div className="card" style={{ padding:28, textAlign:'center', marginBottom:14,
          border:`1px solid ${scoreColor}44` }}>
          <div style={{ fontSize:10, fontWeight:800, letterSpacing:1.5,
            color:'var(--t-3)', textTransform:'uppercase', marginBottom:10 }}>
            Attempt {result.attemptNumber || 1}
          </div>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'center', gap:6 }}>
            <span style={{ fontSize:64, fontWeight:900, color:scoreColor, lineHeight:1 }}>
              {scorePercent ?? '—'}
            </span>
            <span style={{ fontSize:22, color:'var(--t-3)' }}>%</span>
          </div>
          <div style={{ fontSize:15, fontWeight:700, color:scoreColor, marginTop:10 }}>
            {passed ? 'Passed' : 'Not passed'}
          </div>
          <div style={{ fontSize:11, color:'var(--t-3)', marginTop:8, lineHeight:1.6 }}>
            pass mark {quiz?.pass_mark_percent}% · {totalEvents} events scored
            {timeTakenMs != null && <> · {mins}m {secs}s taken</>}
            {result.status === 'timed_out' && <><br/>Time ran out — clips you did not reach count as missed.</>}
          </div>
        </div>

        {/* breakdown, pass only */}
        {passed ? (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:14 }}>
              {['correct','missed','wrong_event','wrong_extra'].map(v => (
                <div key={v} className="card" style={{ padding:12, textAlign:'center' }}>
                  <div style={{ fontSize:20, fontWeight:900, color:VERDICT_STYLE[v].c }}>
                    {counts[v] || 0}
                  </div>
                  <div style={{ fontSize:9, color:'var(--t-3)', marginTop:2 }}>
                    {VERDICT_STYLE[v].label.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding:16 }}>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>Clip by clip</div>
              <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:12 }}>
                Click a clip to watch it again.
              </div>
              {Object.keys(byClip).map(Number).sort((a,b)=>a-b).map(ci => {
                const c = clipByIndex[ci]
                const rs = byClip[ci]
                const allOk = rs.every(r => r.verdict === 'correct')
                return (
                  <div key={ci} style={{ borderBottom:'1px solid rgba(255,255,255,0.05)',
                    padding:'10px 0' }}>
                    <div onClick={() => openInline(ci)}
                      style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
                      <span style={{ width:26, fontSize:10, color:'var(--t-3)',
                        fontFamily:'JetBrains Mono,monospace' }}>{ci + 1}</span>
                      <span style={{ flex:1, fontSize:12, color:'var(--t-2)' }}>
                        {c?.video_filename || `clip ${ci + 1}`}
                      </span>
                      <span style={{ fontSize:10, fontWeight:700,
                        color: allOk ? '#30D158' : '#FF453A' }}>
                        {allOk ? 'all correct' : `${rs.filter(r => r.verdict !== 'correct').length} wrong`}
                      </span>
                    </div>

                    {c?.instruction && (
                      <div style={{ fontSize:10, color:'var(--t-3)', marginLeft:36, marginTop:3 }}>
                        “{c.instruction}”
                      </div>
                    )}

                    {rs.map((r, i) => {
                      const st = VERDICT_STYLE[r.verdict] || { c:'var(--t-3)', label:r.verdict }
                      return (
                        <div key={i} style={{ marginLeft:36, marginTop:6, fontSize:11 }}>
                          <span style={{ display:'inline-block', minWidth:104,
                            fontSize:9, fontWeight:700, color:st.c,
                            background:st.c + '1A', padding:'2px 7px', borderRadius:4 }}>
                            {st.label}
                          </span>
                          <div style={{ marginLeft:4, marginTop:4, display:'flex',
                            flexDirection:'column', gap:2 }}>
                            <div>
                              <span style={{ color:'var(--t-3)', fontSize:10 }}>you: </span>
                              <EventLine code={r.tag?.event_code} team={r.tag?.team}
                                ms={r.tag?.video_time_ms} attrs={r.tag?.attrs}/>
                            </div>
                            <div>
                              <span style={{ color:'var(--t-3)', fontSize:10 }}>correct: </span>
                              <EventLine code={r.key?.event_code} team={r.key?.team}
                                ms={r.key?.video_time_ms} attrs={r.key?.attrs}/>
                            </div>
                            {r.delta_ms !== '' && r.delta_ms != null && r.verdict === 'wrong_timestamp' && (
                              <div style={{ fontSize:10, color:'#64D2FF' }}>
                                {(Number(r.delta_ms) / 1000).toFixed(2)}s out
                              </div>
                            )}
                            {r.attrs_differed && (
                              <div style={{ fontSize:10, color:'#FF9F0A' }}>
                                differs on: {String(r.attrs_differed).split('|').join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {openClip === ci && clipSrc && (
                      <video src={clipSrc} controls loop autoPlay muted
                        style={{ width:'100%', marginTop:10, borderRadius:8,
                          maxHeight:'32vh', background:'#000' }}/>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="card" style={{ padding:24 }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>
              The answers stay hidden until you pass
            </div>
            <div style={{ fontSize:12, color:'var(--t-3)', lineHeight:1.7, marginBottom:18 }}>
              You can retake this quiz, so showing you the correct answers now would
              make the next attempt meaningless. Ask a trainer to approve a retake and
              try again — once you pass, you get the full breakdown of every clip.
            </div>
            <button className="btn-orange" style={{ width:'100%', padding:'12px 0', fontSize:13 }}
              onClick={onRequestRetake}>
              Request a retake
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
