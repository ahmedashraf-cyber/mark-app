/**
 * DrillDashboardPage.jsx — one quiz, all trainees
 * ============================================================================
 * DRILL only, creator role. Reads only; no writes.
 *
 * The per-clip table is the point of this screen. An error rate alone cannot
 * distinguish a hard moment from a wrong answer key, so each clip also shows
 * what most of the wrong answers actually were. Many trainees converging on
 * one answer indicts the key; scattered answers indict the clip. Different
 * problem, different fix.
 */
import { useState, useMemo } from 'react'
import {
  quizSummary, traineeRows, clipAnalysis, scoreByClipType,
} from '../utils/drillAnalytics'
import {
  quizSummaryCsv, clipAnalysisCsv, attemptCsv, download,
} from '../utils/drillExport'

const clock = ms => {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const t = Math.floor(n / 1000)
  return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s`
}
const pct = v => v == null ? '—' : v + '%'

const STATUS_COLOR = {
  'completed-passed': '#30D158',
  'completed-failed': '#FF453A',
  'in progress':      '#FFD60A',
  'not started':      'var(--t-3)',
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background:'var(--bg-3)', borderRadius:8, padding:'11px 12px' }}>
      <div style={{ fontSize:19, fontWeight:900, color: color || 'var(--t-1)' }}>{value}</div>
      <div style={{ fontSize:9, color:'var(--t-3)', marginTop:2, letterSpacing:0.5 }}>{label}</div>
      {sub && <div style={{ fontSize:9, color:'var(--t-3)', marginTop:1 }}>{sub}</div>}
    </div>
  )
}

export default function DrillDashboardPage({
  quiz, sessions, answersGiven, assignments, clips, onBack, onOpenTrainee,
}) {
  const [tab, setTab] = useState('trainees')
  const [sortBy, setSortBy] = useState('hrCode')
  const [sortDir, setSortDir] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const [openClip, setOpenClip] = useState(null)

  const quizId = quiz.quiz_id
  const summary = useMemo(() => quizSummary({ assignments, sessions, quizId }),
    [assignments, sessions, quizId])
  const rows = useMemo(() => traineeRows({ assignments, sessions, quizId }),
    [assignments, sessions, quizId])
  const analysis = useMemo(() => clipAnalysis({ answersGiven, sessions, clips, quizId }),
    [answersGiven, sessions, clips, quizId])
  const byType = useMemo(() => scoreByClipType({ answersGiven, sessions, clips, quizId }),
    [answersGiven, sessions, clips, quizId])

  const shown = useMemo(() => {
    const f = statusFilter === 'all' ? rows : rows.filter(r => r.status === statusFilter)
    const get = r => ({
      hrCode: r.hrCode, name: r.name, attempts: r.attempts,
      latestScore: r.latestScore ?? -1, bestScore: r.bestScore ?? -1,
      status: r.status, latestDate: r.latestDate,
      latestTimeMs: r.latestTimeMs ?? -1,
    }[sortBy])
    return [...f].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number') return (x - y) * sortDir
      return String(x).localeCompare(String(y)) * sortDir
    })
  }, [rows, statusFilter, sortBy, sortDir])

  const th = (key, label, align = 'left') => (
    <th onClick={() => { setSortBy(key); setSortDir(d => sortBy === key ? -d : 1) }}
      style={{ textAlign:align, padding:'7px 8px', fontSize:9, fontWeight:800,
        color: sortBy === key ? 'var(--p2)' : 'var(--t-3)', letterSpacing:0.5,
        cursor:'pointer', whiteSpace:'nowrap', userSelect:'none',
        borderBottom:'1px solid var(--b-1)' }}>
      {label}{sortBy === key ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}
    </th>
  )
  const td = { padding:'7px 8px', fontSize:11, borderBottom:'1px solid rgba(255,255,255,0.04)' }
  const btn = {
    padding:'6px 11px', fontSize:11, background:'transparent',
    border:'1px solid var(--b-1)', borderRadius:6, color:'var(--t-2)', cursor:'pointer',
  }

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
          padding:'2px 8px', borderRadius:4 }}>DASHBOARD</div>
        <span style={{ fontSize:12, fontWeight:600 }}>{quiz.quiz_name}</span>
        <div style={{ flex:1 }}/>
        {['trainees','clips'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn, background: tab === t ? 'rgba(232,89,12,0.14)' : 'transparent',
              borderColor: tab === t ? 'var(--p2)' : 'var(--b-1)',
              color: tab === t ? 'var(--p2)' : 'var(--t-3)' }}>
            {t === 'trainees' ? 'Trainees' : 'Clips'}
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:18, maxWidth:1180,
        margin:'0 auto', width:'100%' }}>

        {/* header numbers */}
        <div className="card" style={{ padding:16, marginBottom:12 }}>
          <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:10 }}>
            <span style={{ fontFamily:'JetBrains Mono,monospace' }}>{quiz.scope_event_ids}</span>
            {' · '}{quiz.clip_count} clips · pass {quiz.pass_mark_percent}% · {quiz.time_limit_min} min
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:8 }}>
            <Stat label="ASSIGNED" value={summary.assigned}
              sub={`${summary.started} started`}/>
            <Stat label="ATTEMPTS" value={summary.completedAttempts}
              sub={`${summary.passedAttempts} pass / ${summary.failedAttempts} fail`}/>
            <Stat label="PASS RATE" value={pct(summary.passRateTrainees)}
              sub={`by attempt ${pct(summary.passRateAttempts)}`}
              color={summary.passRateTrainees >= 50 ? '#30D158' : '#FF453A'}/>
            <Stat label="AVG SCORE" value={pct(summary.avgScoreLatestOnly)}
              sub={`all attempts ${pct(summary.avgScoreAllAttempts)}`}/>
            <Stat label="FIRST-TRY PASS" value={pct(summary.firstAttemptPassRate)}/>
            <Stat label="AVG TIME" value={clock(summary.avgTimeMs)}
              sub={`median ${clock(summary.medianTimeMs)}`}/>
          </div>
          {(byType.event.total > 0 && byType.no_event.total > 0) && (
            <div style={{ marginTop:10, fontSize:11, color:'var(--t-3)' }}>
              Real-event clips <b style={{ color:'var(--t-1)' }}>{pct(byType.event.score)}</b>
              {' · '}trap clips <b style={{ color:'var(--t-1)' }}>{pct(byType.no_event.score)}</b>
              {' — a big gap means they can classify but not resist false-tagging, or the reverse.'}
            </div>
          )}
        </div>

        {tab === 'trainees' ? (
          <div className="card" style={{ padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              <div style={{ fontSize:13, fontWeight:700, flex:1 }}>Trainees ({shown.length})</div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                style={{ ...btn, paddingRight:22 }}>
                <option value="all">All statuses</option>
                <option value="not started">Not started</option>
                <option value="in progress">In progress</option>
                <option value="completed-passed">Passed</option>
                <option value="completed-failed">Failed</option>
              </select>
              <button style={btn} onClick={() => {
                const c = quizSummaryCsv({ quiz, traineeRows: shown })
                download(c.filename, c.text).catch(() => {})   // toast already reported it
              }}>Download CSV</button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  {th('hrCode','HR CODE')}{th('name','NAME')}
                  {th('attempts','ATT','right')}{th('latestScore','LATEST','right')}
                  {th('bestScore','BEST','right')}{th('latestTimeMs','TIME','right')}
                  {th('latestDate','DATE')}{th('status','STATUS')}
                  <th style={{ borderBottom:'1px solid var(--b-1)' }}/>
                </tr></thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.hrCode}>
                      <td style={{ ...td, fontFamily:'JetBrains Mono,monospace',
                        color:'var(--t-3)' }}>{r.hrCode}</td>
                      <td style={td}>{r.name || '—'}</td>
                      <td style={{ ...td, textAlign:'right' }}>{r.attempts || '—'}</td>
                      <td style={{ ...td, textAlign:'right', fontWeight:700,
                        color: r.latestScore == null ? 'var(--t-3)'
                          : r.passed ? '#30D158' : '#FF453A' }}>{pct(r.latestScore)}</td>
                      <td style={{ ...td, textAlign:'right' }}>{pct(r.bestScore)}</td>
                      <td style={{ ...td, textAlign:'right', color:'var(--t-3)' }}>
                        {clock(r.latestTimeMs)}</td>
                      <td style={{ ...td, color:'var(--t-3)', fontSize:10 }}>
                        {r.latestDate ? new Date(r.latestDate).toLocaleDateString() : '—'}</td>
                      <td style={{ ...td, color:STATUS_COLOR[r.status], fontSize:10,
                        fontWeight:700 }}>{r.status}</td>
                      <td style={{ ...td, textAlign:'right' }}>
                        {r.attempts > 0 && (
                          <button style={{ ...btn, padding:'3px 8px', fontSize:10 }}
                            onClick={() => onOpenTrainee?.(r.hrCode)}>History</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!shown.length && (
                    <tr><td colSpan={9} style={{ ...td, color:'var(--t-3)', textAlign:'center',
                      padding:20 }}>Nobody matches that filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
              <div style={{ fontSize:13, fontWeight:700, flex:1 }}>
                Clips, worst first ({analysis.length})
              </div>
              <button style={btn} onClick={() => {
                const c = clipAnalysisCsv({ quiz, analysis })
                download(c.filename, c.text).catch(() => {})
              }}>Download CSV</button>
            </div>
            <div style={{ fontSize:10, color:'var(--t-3)', marginBottom:10, lineHeight:1.5 }}>
              A high error rate is either a hard moment or a wrong answer key. If most of the
              wrong answers agree with each other, suspect the key — that is what the consensus
              column is for. Click a clip to see who got it wrong and what they tagged.
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  {['CLIP','TYPE','ERR RATE','CORRECT','TRAINEES','MOST COMMON WRONG ANSWER','AVG TIME']
                    .map((h, i) => (
                    <th key={h} style={{ textAlign: i >= 2 && i <= 4 ? 'right' : 'left',
                      padding:'7px 8px', fontSize:9, fontWeight:800, color:'var(--t-3)',
                      letterSpacing:0.5, borderBottom:'1px solid var(--b-1)',
                      whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {analysis.map(c => (
                    <>
                      <tr key={c.clipIndex} onClick={() =>
                          setOpenClip(openClip === c.clipIndex ? null : c.clipIndex)}
                        style={{ cursor:'pointer' }}>
                        <td style={td}>
                          <span style={{ color:'var(--t-3)', fontFamily:'JetBrains Mono,monospace',
                            marginRight:6 }}>{c.clipIndex}</span>
                          {c.videoFilename}
                        </td>
                        <td style={{ ...td, fontSize:10,
                          color: c.clipType === 'no_event' ? '#FF9500' : 'var(--t-3)' }}>
                          {c.clipType === 'no_event' ? 'trap' : c.clipType}
                        </td>
                        <td style={{ ...td, textAlign:'right', fontWeight:800,
                          color: c.errorRate >= 50 ? '#FF453A'
                            : c.errorRate >= 25 ? '#FFD60A' : '#30D158' }}>
                          {pct(c.errorRate)}
                        </td>
                        <td style={{ ...td, textAlign:'right' }}>{c.correct}/{c.attempts}</td>
                        <td style={{ ...td, textAlign:'right', color:'var(--t-3)' }}>{c.trainees}</td>
                        <td style={{ ...td, fontSize:10 }}>
                          {c.consensusAnswer
                            ? <>
                                <span style={{ fontFamily:'JetBrains Mono,monospace' }}>
                                  {c.consensusAnswer}</span>
                                <span style={{ color:'var(--t-3)' }}> · {c.consensusShare}% of errors</span>
                                {c.likelyKeyProblem && (
                                  <span style={{ color:'#FF9500', fontWeight:800 }}>
                                    {'  '}— check the answer key</span>
                                )}
                              </>
                            : <span style={{ color:'var(--t-3)' }}>—</span>}
                        </td>
                        <td style={{ ...td, textAlign:'right', color:'var(--t-3)', fontSize:10 }}>
                          {clock(c.avgTimeMs)}
                        </td>
                      </tr>
                      {openClip === c.clipIndex && (
                        <tr key={c.clipIndex + '-open'}>
                          <td colSpan={7} style={{ padding:'10px 14px',
                            background:'var(--bg-3)', borderBottom:'1px solid var(--b-1)' }}>
                            {c.instruction && (
                              <div style={{ fontSize:10, color:'var(--t-3)', marginBottom:8 }}>
                                Instruction: “{c.instruction}”
                              </div>
                            )}
                            {!c.wrongTrainees.length ? (
                              <div style={{ fontSize:11, color:'#30D158' }}>
                                Everyone got this clip right.
                              </div>
                            ) : (
                              <>
                                <div style={{ fontSize:9, fontWeight:800, color:'var(--t-3)',
                                  marginBottom:6, letterSpacing:0.5 }}>WHO GOT IT WRONG</div>
                                {c.wrongTrainees.map((w, i) => (
                                  <div key={i} style={{ display:'flex', gap:10, fontSize:10,
                                    padding:'3px 0', alignItems:'baseline' }}>
                                    <span style={{ fontFamily:'JetBrains Mono,monospace',
                                      color:'var(--t-3)', width:70 }}>{w.hrCode}</span>
                                    <span style={{ color:'#FF453A', width:120 }}>{w.verdict}</span>
                                    <span style={{ flex:1 }}>
                                      tagged <b>{w.tagged}</b>
                                      {w.expected !== w.tagged && <> · expected <b>{w.expected}</b></>}
                                      {w.deltaMs != null && w.verdict === 'wrong_timestamp' &&
                                        <> · {(w.deltaMs / 1000).toFixed(2)}s off</>}
                                      {w.attrsDiffered && <> · differs on {w.attrsDiffered.split('|').join(', ')}</>}
                                    </span>
                                  </div>
                                ))}
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {!analysis.length && (
                    <tr><td colSpan={7} style={{ ...td, color:'var(--t-3)', textAlign:'center',
                      padding:20 }}>No completed attempts yet, so there is nothing to analyse.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
