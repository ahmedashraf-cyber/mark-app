/**
 * DrillReviewPage.jsx — a trainee reviewing their own attempts
 * ============================================================================
 * DRILL only. Reachable ONLY once the trainee has passed the quiz — before
 * that the answers stay hidden, or a failing trainee could read the key and
 * ace the retake. Once passed, every attempt is reviewable including the
 * failed ones, which is where the learning is.
 *
 * Playback is a plain <video controls loop> rather than ClipTagger: review
 * needs watching, not tagging, and rendering a tagger the trainee must not
 * interact with would be worse than a second player.
 */
import { useState, useEffect, useMemo } from 'react'
import { clipUrl as driveClipUrl } from '../utils/drillDrive'
import { DRILL_ATTR_COLUMNS } from '../config/drillConfig'
import { attemptCsv, download } from '../utils/drillExport'

const V = {
  correct:          { c:'#30D158', label:'Correct' },
  missed:           { c:'#FF453A', label:'Missed' },
  not_needed_event: { c:'#FF9500', label:'Nothing to tag here' },
  wrong_event:      { c:'#FF453A', label:'Wrong event' },
  wrong_team:       { c:'#BF5AF2', label:'Wrong team' },
  wrong_timestamp:  { c:'#64D2FF', label:'Timing off' },
  wrong_extra:      { c:'#FF9F0A', label:'Wrong detail' },
}

function Attrs({ row, prefix }) {
  const vals = DRILL_ATTR_COLUMNS
    .map(a => [a.replace(/^attr_/, ''), row?.[prefix + a]])
    .filter(([, v]) => v)
  if (!vals.length) return <span style={{ color:'var(--t-3)' }}>—</span>
  return (
    <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:10 }}>
      {vals.map(([k, v]) => `${k}=${v}`).join('  ')}
    </span>
  )
}

export default function DrillReviewPage({ quiz, sessions, answersGiven, clips, onBack }) {
  // newest attempt first in the picker, but numbered as the trainee knows them
  const attempts = useMemo(() => (sessions || [])
    .filter(s => s.quiz_id === quiz.quiz_id && String(s.is_test_run) !== '1')
    .sort((a, b) => Number(b.attempt_number || 0) - Number(a.attempt_number || 0)), [sessions, quiz])

  const [resultId, setResultId] = useState(attempts[0]?.result_id || '')
  const [clipPos,  setClipPos]  = useState(0)
  const [url,      setUrl]      = useState('')

  const session = attempts.find(s => s.result_id === resultId) || attempts[0]

  const clipRows = useMemo(() => (clips || [])
    .filter(c => c.quiz_id === quiz.quiz_id)
    .sort((a, b) => Number(a.clip_index) - Number(b.clip_index)), [clips, quiz])

  const rowsByClip = useMemo(() => {
    const out = {}
    ;(answersGiven || []).filter(r => r.result_id === session?.result_id).forEach(r => {
      ;(out[String(r.clip_index)] = out[String(r.clip_index)] || []).push(r)
    })
    return out
  }, [answersGiven, session?.result_id])

  const clip = clipRows[clipPos]
  const rows = clip ? (rowsByClip[String(clip.clip_index)] || []) : []

  // load the clip on navigation; autoplay is handled by the element
  useEffect(() => {
    if (!clip) return
    let alive = true
    setUrl('')
    driveClipUrl(clip.drive_file_id).then(u => { if (alive) setUrl(u) }).catch(() => {})
    return () => { alive = false }
  }, [clip?.drive_file_id])

  useEffect(() => { setClipPos(0) }, [resultId])

  if (!attempts.length) return (
    <Shell quiz={quiz} onBack={onBack}>
      <div className="card" style={{ padding:24, fontSize:13, color:'var(--t-3)' }}>
        No attempts recorded for this quiz yet.
      </div>
    </Shell>
  )

  const counts = {}
  Object.values(rowsByClip).flat().forEach(r => { counts[r.verdict] = (counts[r.verdict] || 0) + 1 })
  const passed = String(session?.passed) === '1'

  return (
    <Shell quiz={quiz} onBack={onBack}>
      {/* attempt picker */}
      <div className="card" style={{ padding:16, marginBottom:12 }}>
        <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
          textTransform:'uppercase', marginBottom:8 }}>Attempt</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {attempts.map(a => {
            const on = a.result_id === session?.result_id
            const ok = String(a.passed) === '1'
            return (
              <button key={a.result_id} onClick={() => setResultId(a.result_id)}
                style={{ padding:'8px 12px', fontSize:11, borderRadius:7, cursor:'pointer',
                  textAlign:'left', lineHeight:1.5,
                  background: on ? 'rgba(232,89,12,0.14)' : 'var(--bg-3)',
                  border:`1px solid ${on ? 'var(--p2)' : 'var(--b-1)'}`,
                  color: on ? 'var(--t-1)' : 'var(--t-2)' }}>
                <div style={{ fontWeight:700 }}>
                  Attempt {a.attempt_number}
                  <span style={{ color: ok ? '#30D158' : '#FF453A', marginLeft:8 }}>
                    {a.score_percent}% {ok ? 'passed' : 'failed'}
                  </span>
                </div>
                <div style={{ fontSize:9, color:'var(--t-3)' }}>
                  {a.finished_at ? new Date(a.finished_at).toLocaleString() : '—'}
                  {a.total_time_taken_readable ? ' · ' + a.total_time_taken_readable : ''}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* attempt summary */}
      <div className="card" style={{ padding:16, marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:12, marginBottom:10 }}>
          <span style={{ fontSize:30, fontWeight:900,
            color: passed ? '#30D158' : '#FF453A' }}>{session?.score_percent}%</span>
          <span style={{ fontSize:13, fontWeight:700, color: passed ? '#30D158' : '#FF453A' }}>
            {passed ? 'Passed' : 'Not passed'}
          </span>
          <span style={{ fontSize:11, color:'var(--t-3)' }}>
            pass mark {quiz.pass_mark_percent}% · {session?.total_time_taken_readable || '—'} taken
            {session?.status === 'timed_out' && ' · time ran out'}
          </span>
          <div style={{ flex:1 }}/>
          <button onClick={() => {
              const csv = attemptCsv({ quiz, session, answersGiven, clips })
              download(csv.filename, csv.text).catch(() => {})
            }}
            style={{ padding:'6px 12px', fontSize:11, background:'transparent',
              border:'1px solid var(--b-1)', borderRadius:6, color:'var(--t-2)',
              cursor:'pointer' }}>
            Download CSV
          </button>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {Object.keys(V).filter(v => counts[v]).map(v => (
            <span key={v} style={{ fontSize:10, fontWeight:700, padding:'3px 9px',
              borderRadius:5, color:V[v].c, background:V[v].c + '18' }}>
              {counts[v]} {V[v].label.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display:'flex', gap:14 }}>
        {/* clip list */}
        <div style={{ width:150, flexShrink:0 }}>
          <div className="card" style={{ padding:8, maxHeight:460, overflowY:'auto' }}>
            {clipRows.map((c, i) => {
              const rs = rowsByClip[String(c.clip_index)] || []
              const allOk = rs.length > 0 && rs.every(r => r.verdict === 'correct')
              const on = i === clipPos
              return (
                <div key={c.clip_index} onClick={() => setClipPos(i)}
                  style={{ padding:'7px 8px', borderRadius:6, cursor:'pointer', marginBottom:2,
                    display:'flex', alignItems:'center', gap:7,
                    background: on ? 'rgba(232,89,12,0.14)' : 'transparent' }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0,
                    background: !rs.length ? 'var(--b-2)' : allOk ? '#30D158' : '#FF453A' }}/>
                  <span style={{ fontSize:11, color: on ? 'var(--t-1)' : 'var(--t-2)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {c.video_filename}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* the clip */}
        <div style={{ flex:1, minWidth:0 }}>
          {!clip ? (
            <div className="card" style={{ padding:24, color:'var(--t-3)' }}>No clips.</div>
          ) : (
            <>
              <div className="card" style={{ padding:14, marginBottom:10 }}>
                <div style={{ fontSize:12, fontWeight:700, marginBottom:3 }}>
                  {clip.video_filename}
                  <span style={{ fontSize:10, color:'var(--t-3)', fontWeight:400, marginLeft:8 }}>
                    clip {clipPos + 1} of {clipRows.length}
                    {String(clip.is_no_event) === '1' && ' · no event expected'}
                  </span>
                </div>
                {clip.instruction && (
                  <div style={{ fontSize:11, color:'var(--t-3)' }}>“{clip.instruction}”</div>
                )}
              </div>

              {url ? (
                <video key={url} src={url} controls loop autoPlay muted
                  style={{ width:'100%', borderRadius:10, background:'#000',
                    maxHeight:'40vh', marginBottom:10 }}/>
              ) : (
                <div style={{ height:180, borderRadius:10, background:'var(--bg-3)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:12, color:'var(--t-3)', marginBottom:10 }}>Loading clip…</div>
              )}

              {!rows.length ? (
                <div className="card" style={{ padding:16, fontSize:12, color:'var(--t-3)' }}>
                  You did not reach this clip — time ran out before it.
                </div>
              ) : rows.map((r, i) => {
                const v = V[r.verdict] || { c:'var(--t-3)', label:r.verdict }
                const noEventOk = r.verdict === 'correct' && !r.correct_event_code && !r.trainee_event_code
                return (
                  <div key={i} className="card" style={{ padding:14, marginBottom:8,
                    borderLeft:`3px solid ${v.c}` }}>
                    <div style={{ fontSize:11, fontWeight:800, color:v.c, marginBottom:8 }}>
                      {noEventOk ? 'Correctly identified — no event' : v.label}
                    </div>

                    {noEventOk ? (
                      <div style={{ fontSize:11, color:'var(--t-3)' }}>
                        This clip had nothing to tag and you tagged nothing.
                      </div>
                    ) : (
                      <div style={{ display:'grid', gridTemplateColumns:'70px 1fr', gap:'6px 10px',
                        fontSize:11 }}>
                        <span style={{ color:'var(--t-3)' }}>You</span>
                        <span>
                          {r.trainee_event_code
                            ? <>
                                <b>{r.trainee_event_code}</b>
                                {r.trainee_team ? ' · ' + r.trainee_team : ''}
                                {r.trainee_video_time_readable ? ' · ' + r.trainee_video_time_readable : ''}
                                <br/><Attrs row={r} prefix="trainee_"/>
                              </>
                            : <span style={{ color:'var(--t-3)' }}>tagged nothing</span>}
                        </span>
                        <span style={{ color:'var(--t-3)' }}>Correct</span>
                        <span>
                          {r.correct_event_code
                            ? <>
                                <b>{r.correct_event_code}</b>
                                {r.correct_team ? ' · ' + r.correct_team : ''}
                                {r.correct_video_time_readable ? ' · ' + r.correct_video_time_readable : ''}
                                <br/><Attrs row={r} prefix="correct_"/>
                              </>
                            : <span style={{ color:'var(--t-3)' }}>no event expected here</span>}
                        </span>
                      </div>
                    )}

                    {r.verdict === 'wrong_timestamp' && r.delta_ms && (
                      <div style={{ fontSize:11, color:'#64D2FF', marginTop:8 }}>
                        {(Number(r.delta_ms) / 1000).toFixed(2)}s away from the correct moment
                        {' '}— the window is 2s.
                      </div>
                    )}
                    {r.verdict === 'wrong_extra' && r.attrs_differed && (
                      <div style={{ fontSize:11, color:'#FF9F0A', marginTop:8 }}>
                        Differs on: {String(r.attrs_differed).split('|').join(', ')}
                      </div>
                    )}
                    {r.verdict === 'missed' && r.correct_video_time_readable && (
                      <div style={{ fontSize:11, color:'#FF453A', marginTop:8 }}>
                        You should have tagged <b>{r.correct_event_code}</b> at
                        {' '}{r.correct_video_time_readable}.
                      </div>
                    )}
                    {r.clip_time_taken_readable && (
                      <div style={{ fontSize:9, color:'var(--t-3)', marginTop:8 }}>
                        You spent {r.clip_time_taken_readable} on this clip
                      </div>
                    )}
                  </div>
                )
              })}

              <div style={{ display:'flex', gap:8, marginTop:10 }}>
                <button disabled={clipPos === 0} onClick={() => setClipPos(p => p - 1)}
                  style={{ flex:1, padding:'10px 0', fontSize:12, background:'transparent',
                    border:'1px solid var(--b-1)', borderRadius:7,
                    color: clipPos === 0 ? 'var(--b-2)' : 'var(--t-2)',
                    cursor: clipPos === 0 ? 'default' : 'pointer' }}>
                  ← Previous
                </button>
                <button disabled={clipPos >= clipRows.length - 1}
                  onClick={() => setClipPos(p => p + 1)}
                  style={{ flex:1, padding:'10px 0', fontSize:12, background:'transparent',
                    border:'1px solid var(--b-1)', borderRadius:7,
                    color: clipPos >= clipRows.length - 1 ? 'var(--b-2)' : 'var(--t-2)',
                    cursor: clipPos >= clipRows.length - 1 ? 'default' : 'pointer' }}>
                  Next →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Shell>
  )
}

function Shell({ quiz, onBack, children }) {
  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', color:'var(--t-1)', overflow:'hidden' }}>
      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 16px', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none',
          color:'var(--t-3)', cursor:'pointer', fontSize:11, padding:'4px 8px' }}>← Back</button>
        <div style={{ width:1, height:20, background:'var(--b-1)' }}/>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800,
          color:'var(--p2)', letterSpacing:1.5, background:'rgba(232,89,12,0.12)',
          padding:'2px 8px', borderRadius:4 }}>REVIEW</div>
        <span style={{ fontSize:12, fontWeight:600 }}>{quiz?.quiz_name}</span>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:18, maxWidth:1000,
        margin:'0 auto', width:'100%' }}>{children}</div>
    </div>
  )
}
