/**
 * DrillTraineePage.jsx — one trainee, every quiz
 * ============================================================================
 * DRILL only. Reads only.
 *
 * The trend chart is inline SVG rather than a charting library: MARK has none
 * installed, and adding one for a single screen would cost more bundle than the
 * whole of DRILL. A polyline with circles is all this needs.
 *
 * Trainees reach this filtered to themselves; creators reach it from the quiz
 * dashboard for anyone.
 */
import { useMemo } from 'react'
import { traineeSummary, scoreByClipType } from '../utils/drillAnalytics'
import { traineeSummaryCsv, download } from '../utils/drillExport'

const clock = ms => {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const t = Math.floor(n / 1000)
  return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s`
}
const pct = v => v == null ? '—' : v + '%'

/** Score over time. One point per attempt, oldest left. */
function TrendChart({ points, passMark }) {
  if (!points.length) return (
    <div style={{ fontSize:12, color:'var(--t-3)', padding:'20px 0' }}>
      No completed attempts yet, so there is no trend to show.
    </div>
  )
  const W = 640, H = 170, P = { l:34, r:12, t:12, b:26 }
  const iw = W - P.l - P.r, ih = H - P.t - P.b
  // a single point would divide by zero, so it sits mid-axis
  const x = i => points.length === 1 ? P.l + iw / 2 : P.l + (i / (points.length - 1)) * iw
  const y = s => P.t + ih - (Math.max(0, Math.min(100, s)) / 100) * ih

  const line = points.map((p, i) => `${x(i)},${y(p.score)}`).join(' ')
  const showEvery = Math.ceil(points.length / 6)   // keep the axis readable

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto' }}>
      {[0, 25, 50, 75, 100].map(g => (
        <g key={g}>
          <line x1={P.l} x2={W - P.r} y1={y(g)} y2={y(g)}
            stroke="var(--b-1)" strokeWidth="1"/>
          <text x={P.l - 6} y={y(g) + 3} textAnchor="end"
            fill="var(--t-3)" fontSize="8">{g}</text>
        </g>
      ))}
      {passMark != null && (
        <>
          <line x1={P.l} x2={W - P.r} y1={y(passMark)} y2={y(passMark)}
            stroke="#30D158" strokeWidth="1" strokeDasharray="4 3" opacity="0.7"/>
          <text x={W - P.r} y={y(passMark) - 4} textAnchor="end"
            fill="#30D158" fontSize="8">pass {passMark}%</text>
        </>
      )}
      <polyline points={line} fill="none" stroke="var(--p2)" strokeWidth="2"
        strokeLinejoin="round"/>
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.score)} r="4"
            fill={p.passed ? '#30D158' : '#FF453A'}
            stroke="var(--bg-2)" strokeWidth="1.5"/>
          <title>{`${p.quizName} · attempt ${p.attempt} · ${p.score}% · ${new Date(p.date).toLocaleDateString()}`}</title>
        </g>
      ))}
      {points.map((p, i) => i % showEvery === 0 && (
        <text key={'l' + i} x={x(i)} y={H - 8} textAnchor="middle"
          fill="var(--t-3)" fontSize="8">
          {new Date(p.date).toLocaleDateString(undefined, { month:'short', day:'numeric' })}
        </text>
      ))}
    </svg>
  )
}

export default function DrillTraineePage({
  hrCode, sessions, quizzes, assignments, answersGiven, clips, onBack, readOnly,
}) {
  const s = useMemo(() => traineeSummary({ sessions, quizzes, assignments, hrCode }),
    [sessions, quizzes, assignments, hrCode])

  // trap versus real-event performance across every quiz they have taken
  const byType = useMemo(() => {
    const acc = { event:{correct:0,total:0}, no_event:{correct:0,total:0} }
    ;(s.perQuiz || []).forEach(p => {
      const r = scoreByClipType({ answersGiven, sessions, clips, quizId: p.quizId, hrCode })
      ;['event','no_event'].forEach(k => {
        acc[k].correct += r[k].correct; acc[k].total += r[k].total
      })
    })
    ;['event','no_event'].forEach(k => {
      acc[k].score = acc[k].total ? Math.round((acc[k].correct / acc[k].total) * 1000) / 10 : null
    })
    return acc
  }, [s.perQuiz, answersGiven, sessions, clips, hrCode])

  const latestPassMark = useMemo(() => {
    const q = (quizzes || []).find(q2 => (s.perQuiz || []).some(p => p.quizId === q2.quiz_id))
    return q ? Number(q.pass_mark_percent) : null
  }, [quizzes, s.perQuiz])

  const td = { padding:'7px 8px', fontSize:11, borderBottom:'1px solid rgba(255,255,255,0.04)' }
  const th = { textAlign:'left', padding:'7px 8px', fontSize:9, fontWeight:800,
    color:'var(--t-3)', letterSpacing:0.5, borderBottom:'1px solid var(--b-1)' }

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
          padding:'2px 8px', borderRadius:4 }}>
          {readOnly ? 'MY PROGRESS' : 'TRAINEE'}
        </div>
        <span style={{ fontSize:12, fontWeight:600 }}>{s.name || s.hrCode}</span>
        <span style={{ fontSize:10, color:'var(--t-3)',
          fontFamily:'JetBrains Mono,monospace' }}>{s.hrCode}</span>
        <div style={{ flex:1 }}/>
        <button onClick={() => {
            const c = traineeSummaryCsv({ summary: s })
            download(c.filename, c.text).catch(() => {})
          }}
          style={{ padding:'6px 11px', fontSize:11, background:'transparent',
            border:'1px solid var(--b-1)', borderRadius:6, color:'var(--t-2)',
            cursor:'pointer' }}>Download CSV</button>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:18, maxWidth:1000,
        margin:'0 auto', width:'100%' }}>

        <div className="card" style={{ padding:16, marginBottom:12 }}>
          <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:10 }}>
            {s.email || 'no email on record'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8 }}>
            {[
              ['ASSIGNED', s.assigned, null],
              ['TAKEN', s.completed, null],
              ['PASSED', s.passed, '#30D158'],
              ['PASS RATE', pct(s.passRate), s.passRate >= 50 ? '#30D158' : '#FF453A'],
              ['AVG SCORE', pct(s.avgScore), null],
            ].map(([label, value, color]) => (
              <div key={label} style={{ background:'var(--bg-3)', borderRadius:8,
                padding:'11px 12px' }}>
                <div style={{ fontSize:19, fontWeight:900, color: color || 'var(--t-1)' }}>{value}</div>
                <div style={{ fontSize:9, color:'var(--t-3)', marginTop:2,
                  letterSpacing:0.5 }}>{label}</div>
              </div>
            ))}
          </div>
          {byType.event.total > 0 && byType.no_event.total > 0 && (
            <div style={{ marginTop:10, fontSize:11, color:'var(--t-3)' }}>
              Real-event clips <b style={{ color:'var(--t-1)' }}>{pct(byType.event.score)}</b>
              {' · '}trap clips <b style={{ color:'var(--t-1)' }}>{pct(byType.no_event.score)}</b>
              {byType.event.score != null && byType.no_event.score != null &&
                Math.abs(byType.event.score - byType.no_event.score) >= 20 &&
                (byType.event.score > byType.no_event.score
                  ? ' — reads events well but over-tags when there is nothing there'
                  : ' — resists false tagging but misses real events')}
            </div>
          )}
        </div>

        <div className="card" style={{ padding:16, marginBottom:12 }}>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:2 }}>Score over time</div>
          <div style={{ fontSize:10, color:'var(--t-3)', marginBottom:8 }}>
            One point per attempt, oldest first. Green passed, red failed. Hover for the quiz.
          </div>
          <TrendChart points={s.trend} passMark={latestPassMark}/>
        </div>

        <div className="card" style={{ padding:14 }}>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>
            Quizzes ({s.perQuiz.length})
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                <th style={th}>QUIZ</th><th style={th}>SCOPE</th>
                <th style={{ ...th, textAlign:'right' }}>ATT</th>
                <th style={{ ...th, textAlign:'right' }}>LATEST</th>
                <th style={{ ...th, textAlign:'right' }}>BEST</th>
                <th style={{ ...th, textAlign:'right' }}>TIME</th>
                <th style={th}>DATE</th><th style={th}>RESULT</th>
              </tr></thead>
              <tbody>
                {s.perQuiz.map(p => (
                  <tr key={p.quizId}>
                    <td style={td}>{p.quizName}</td>
                    <td style={{ ...td, fontFamily:'JetBrains Mono,monospace', fontSize:10,
                      color:'var(--t-3)' }}>{p.scope || '—'}</td>
                    <td style={{ ...td, textAlign:'right' }}>{p.attempts || '—'}</td>
                    <td style={{ ...td, textAlign:'right', fontWeight:700,
                      color: p.latestScore == null ? 'var(--t-3)'
                        : p.passed ? '#30D158' : '#FF453A' }}>{pct(p.latestScore)}</td>
                    <td style={{ ...td, textAlign:'right' }}>{pct(p.bestScore)}</td>
                    <td style={{ ...td, textAlign:'right', color:'var(--t-3)' }}>
                      {clock(p.latestTimeMs)}</td>
                    <td style={{ ...td, color:'var(--t-3)', fontSize:10 }}>
                      {p.latestDate ? new Date(p.latestDate).toLocaleDateString() : '—'}</td>
                    <td style={{ ...td, fontSize:10, fontWeight:700,
                      color: p.attempts === 0 ? 'var(--t-3)'
                        : p.passed ? '#30D158' : '#FF453A' }}>
                      {p.attempts === 0 ? 'not started' : p.passed ? 'passed' : 'not passed'}</td>
                  </tr>
                ))}
                {!s.perQuiz.length && (
                  <tr><td colSpan={8} style={{ ...td, color:'var(--t-3)', textAlign:'center',
                    padding:20 }}>No quizzes assigned.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
