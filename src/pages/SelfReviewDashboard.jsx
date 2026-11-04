/**
 * SelfReviewDashboard.jsx: read-only Self-Review scores, a view inside the Self-Review area.
 * ============================================================================
 * Mounted ONLY by CollectorSelfReviewPage.jsx. Imports nothing from Scout, Audit, Tag, Drill, Comparison, Insights or the
 * Model Editor, and writes nothing except the pass mark (selfReviewPassMark.js, Batch Manager only).
 *
 * Identity is never asked for. The HR-code and role come from the login (useAuth). A collector role gets scope 'own': the
 * data layer returns only their rows. Every other role gets scope 'all'.
 *
 * Data is re-read when the view opens and on every filter change. Replies that arrive out of order are discarded, and two
 * reads closer than DASH_MIN_READ_GAP_MS share one network call. Nothing here is cached for the life of the app.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAuth } from '../hooks/useAuth'
import { COLLECTOR_ROLES } from '../hooks/useAdmin'
import SearchSelect from '../components/SearchSelect'
import { loadDashboardData } from '../utils/selfReviewDashData'
import { readPassMark, setPassMark } from '../utils/selfReviewPassMark'
import {
  totals, overallScore, correctRatio, passRate, bestLowest, pillClass, filterReviews, weeklyTrend, trendDelta,
  errorBreakdown, leaderboard, reviewRow, sortRows, dayKey,
} from '../utils/selfReviewDashStats'
import {
  SELF_REVIEW_RESULTS_TAB, PASS_MARK_DEFAULT, PASS_MARK_OPTIONS, DASH_MIN_READ_GAP_MS,
} from '../config/selfReviewDashboardConfig'

const G = '#2fbf71', Y = '#f2b134', R = '#ef5b5b', P = '#a77bff', BLUE = '#4f8cff'
const PILL = { g: { color: G, background: '#2fbf7122' }, y: { color: Y, background: '#f2b13422' }, r: { color: R, background: '#ef5b5b22' } }
const pct1 = v => (v == null ? '–' : `${v.toFixed(1)}%`)

const CSS = `
.srd-grid{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px}
.srd-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
@media(max-width:900px){.srd-grid{grid-template-columns:1fr}}
.srd-t{width:100%;border-collapse:collapse}
.srd-t th,.srd-t td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--b-1);white-space:nowrap;font-size:13px}
.srd-t th{color:var(--t-3);font-weight:500;font-size:12px;cursor:pointer;user-select:none}
.srd-t th:hover{color:var(--t-1)}
.srd-t th.nosort{cursor:default}
`

const S = {
  page:  { height:'100vh', display:'flex', flexDirection:'column', background:'var(--bg)', overflow:'hidden' },
  head:  { background:'var(--bg-2)', borderBottom:'1px solid var(--b-1)', padding:'0 20px', minHeight:52, display:'flex', alignItems:'center', gap:12, flexShrink:0, flexWrap:'wrap' },
  back:  { background:'none', border:'none', color:'var(--t-3)', fontSize:18, cursor:'pointer' },
  title: { fontSize:16, fontWeight:700, color:'var(--t-1)' },
  sub:   { fontSize:12, color:'var(--t-3)' },
  body:  { flex:1, overflowY:'auto', padding:'20px 24px' },
  inner: { maxWidth:1280, margin:'0 auto' },
  card:  { background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:12, padding:'14px 16px' },
  h2:    { fontSize:14, margin:'0 0 10px', color:'var(--t-1)' },
  note:  { fontSize:12, color:'var(--t-3)' },
  badge: { fontSize:11, padding:'2px 9px', borderRadius:99, background:'rgba(232,89,12,.12)', color:'var(--p2)', border:'1px solid rgba(232,89,12,.35)' },
  btn:   { background:'var(--bg-3)', border:'1px solid var(--b-2)', color:'var(--t-2)', borderRadius:8, padding:'6px 12px', fontSize:12, cursor:'pointer' },
  empty: { color:'var(--t-3)', padding:20, textAlign:'center', fontSize:13 },
}

const Pill = ({ score, passMark }) => <span data-testid="pill" style={{ ...PILL[pillClass(score, passMark)], padding:'2px 9px', borderRadius:99, fontWeight:600, fontSize:12 }}>{score.toFixed(1)}%</span>

function Kpi({ label, value, sub, testId }) {
  return (
    <div style={S.card} data-testid={testId}>
      <div style={{ ...S.note, textTransform:'uppercase', letterSpacing:'.04em' }}>{label}</div>
      <div style={{ fontSize:28, fontWeight:650, marginTop:4, color:'var(--t-1)' }} data-role="value">{value}</div>
      <div style={S.note}>{sub}</div>
    </div>
  )
}

function Trend({ rs, passMark }) {
  const pts = weeklyTrend(rs).filter(p => p.overall != null)
  if (!pts.length) return <div style={S.empty}>No matched reviews</div>
  const W = 640, H = 230, L = 34, B = 26, T = 10, Rr = 10, hi = 100
  const lo = Math.min(60, Math.floor(Math.min(...pts.map(p => p.overall)) / 5) * 5, passMark)
  const X = i => L + (pts.length > 1 ? i / (pts.length - 1) : 0.5) * (W - L - Rr)
  const Yv = v => T + (hi - v) / (hi - lo) * (H - T - B)
  const grid = []
  for (let v = lo; v <= hi; v += 10) grid.push(v)
  const step = Math.ceil(pts.length / 7)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Weekly overall score trend" data-testid="trend">
      {grid.map(v => (
        <g key={v}><line x1={L} x2={W - Rr} y1={Yv(v)} y2={Yv(v)} stroke="rgba(255,255,255,.08)" />
          <text x={L - 6} y={Yv(v) + 4} textAnchor="end" fill="var(--t-3)" fontSize="11">{v}</text></g>))}
      <line x1={L} x2={W - Rr} y1={Yv(passMark)} y2={Yv(passMark)} stroke={G} strokeDasharray="4 4" data-testid="passline" />
      <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Yv(p.overall)}`).join(' ')} fill="none" stroke={BLUE} strokeWidth="2.5" />
      {pts.map((p, i) => (
        <circle key={p.week} cx={X(i)} cy={Yv(p.overall)} r="3.5" fill={BLUE}><title>{`Week of ${p.week}: ${p.overall.toFixed(1)}% (${p.n} review${p.n === 1 ? '' : 's'})`}</title></circle>))}
      {pts.map((p, i) => (i % step === 0 ? <text key={`l${p.week}`} x={X(i)} y={H - 8} textAnchor="middle" fill="var(--t-3)" fontSize="11">{p.week.slice(5)}</text> : null))}
    </svg>
  )
}

function Errors({ rs }) {
  const e = errorBreakdown(rs)
  const items = [['Missed', e.missed, e.missedPct, R], ['Wrong event', e.wrong, e.wrongPct, Y], ['Collector-only', e.extra, e.extraPct, P]]
  return (
    <div data-testid="errors">
      <div style={{ fontSize:28, fontWeight:650, color:'var(--t-1)' }}>{e.total}<span style={{ ...S.note, fontWeight:400 }}> total errors</span></div>
      <div style={{ height:8, borderRadius:4, background:'rgba(255,255,255,.08)', display:'flex', overflow:'hidden', margin:'10px 0' }}>
        {items.map(([n, c, , col]) => <div key={n} style={{ width: `${e.total ? c / e.total * 100 : 0}%`, background: col }} />)}
      </div>
      {items.map(([n, c, p, col]) => (
        <div key={n} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--b-1)', fontSize:13, color:'var(--t-1)' }}>
          <span><i style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:col, marginRight:6 }} />{n}</span>
          <b>{c} <span style={S.note}>({p}%)</span></b>
        </div>))}
    </div>
  )
}

function Leaderboard({ rs, passMark }) {
  const L = leaderboard(rs, passMark)
  if (!L.length) return <div style={S.empty}>No data</div>
  return (
    <div style={{ overflowX:'auto' }}>
      <table className="srd-t" data-testid="leaderboard">
        <thead><tr><th className="nosort" /><th className="nosort">Collector</th><th className="nosort">Matched reviews</th><th className="nosort">Overall score</th>
          <th className="nosort">Correct %</th><th className="nosort">Pass rate</th><th className="nosort">Error rate</th></tr></thead>
        <tbody>{L.map(r => (
          <tr key={r.hr}><td style={{ color:'var(--t-3)', width:28 }}>{r.rank}</td><td>{r.hr}</td><td>{r.reviews}</td>
            <td>{r.overall == null ? '–' : <Pill score={r.overall} passMark={passMark} />}</td>
            <td>{pct1(r.correct)}</td><td>{r.passRate == null ? '–' : `${r.passRate}%`}</td><td>{pct1(r.errorRate)}</td></tr>))}</tbody>
      </table>
    </div>
  )
}

const HEAD = [['date', 'Date'], ['match', 'Match'], ['half', 'Half'], ['hr', 'Collector'], ['trainerRows', 'Reviewer events'], ['correct', 'Correct'],
  ['correctPct', 'Correct %'], ['missed', 'Missed'], ['wrong', 'Wrong'], ['extra', 'Collector-only'], ['score', 'Score']]

function ReviewsTable({ rs, passMark, showCollector }) {
  const [sort, setSort] = useState({ key: 'date', dir: -1 })
  const cols = HEAD.filter(h => showCollector || h[0] !== 'hr')
  const rows = useMemo(() => sortRows(rs.map(reviewRow), sort.key, sort.dir), [rs, sort])
  if (!rows.length) return <div style={S.empty}>No matched reviews for these filters</div>
  return (
    <div style={{ overflowX:'auto' }}>
      <table className="srd-t" data-testid="reviews">
        <thead><tr>{cols.map(([k, t]) => (
          <th key={k} data-k={k} onClick={() => setSort(s => ({ key: k, dir: s.key === k ? -s.dir : -1 }))}>{t}{sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>))}</tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.runId}><td>{dayKey(r.date)}</td><td>{r.match}</td><td>{r.half}</td>{showCollector && <td>{r.hr}</td>}
            <td>{r.trainerRows}</td><td>{r.correct}</td><td>{pct1(r.correctPct)}</td><td>{r.missed}</td><td>{r.wrong}</td><td>{r.extra}</td>
            <td><Pill score={r.score} passMark={passMark} /></td></tr>))}</tbody>
      </table>
    </div>
  )
}

export default function SelfReviewDashboard({ onBack }) {
  const { user, roleInfo, caps } = useAuth()
  const hrCode = (roleInfo?.code || '').trim().toUpperCase()
  const scope = COLLECTOR_ROLES.includes(roleInfo?.role) ? 'own' : 'all'
  const canEditPass = !!caps?.selfReviewPassMark
  const canView = !!caps?.selfReviewDashboard      // checked BEFORE any read: a role without access never causes the tab to be fetched

  const [view, setView] = useState({ status: 'loading', data: null, error: null })
  const [refreshing, setRefreshing] = useState(false)
  const [passMark, setPassMarkState] = useState(PASS_MARK_DEFAULT)
  const [pmNotice, setPmNotice] = useState('')
  const [pmError, setPmError] = useState('')
  const [pmSaving, setPmSaving] = useState(false)
  const [half, setHalf] = useState('')
  const [period, setPeriod] = useState('0')
  const [match, setMatch] = useState('')
  const [collector, setCollector] = useState('')

  const seq = useRef(0)
  const last = useRef({ at: 0, promise: null })
  const first = useRef(true)

  const read = useCallback(force => {
    const now = Date.now()
    if (!force && last.current.promise && now - last.current.at < DASH_MIN_READ_GAP_MS) return last.current.promise
    const p = Promise.all([loadDashboardData({ scope, hrCode }), readPassMark()])
    last.current = { at: now, promise: p }
    p.catch(() => { if (last.current.promise === p) last.current.promise = null })      // a failed read is never reused
    return p
  }, [scope, hrCode])

  const load = useCallback(async force => {
    if (!canView) return
    const mine = ++seq.current
    setRefreshing(true)
    try {
      const [data, pm] = await read(force)
      if (mine !== seq.current) return                     // a newer request exists: this answer is stale
      setView({ status: 'ok', data, error: null })
      setPassMarkState(pm.value); setPmNotice(pm.notice)
    } catch (e) {
      if (mine !== seq.current) return
      setView({ status: 'error', data: null, error: e })
    } finally {
      if (mine === seq.current) setRefreshing(false)
    }
  }, [read, canView])

  // on open, and on every filter change
  useEffect(() => { load(first.current); first.current = false }, [half, period, match, collector, load])

  const data = view.data
  const effMatch = data && match && data.matches.includes(match) ? match : ''
  const effHalf = data && half && data.halves.includes(half) ? half : ''
  const rs = useMemo(() => (data ? filterReviews(data.reviews, {
    half: effHalf, periodDays: Number(period), match: effMatch, collector: scope === 'all' ? collector : '',
  }) : []), [data, effHalf, period, effMatch, collector, scope])

  async function changePassMark(v) {
    setPmError(''); setPmSaving(true)
    try {
      const res = await setPassMark(v, { email: roleInfo?.email || user?.email || '', hrCode: roleInfo?.code || '', bootstrapAdmin: roleInfo?.source === 'builtin' })
      setPassMarkState(res.value); setPmNotice(res.logged ? '' : 'The pass mark was saved, but the change could not be logged.')
    } catch (e) { setPmError(e?.message || String(e)) }
    finally { setPmSaving(false) }
  }

  if (!canView) {
    return (
      <div style={S.page}><style>{CSS}</style>
        <div style={S.head}><button style={S.back} onClick={onBack}>←</button><span style={S.title}>Self-Review Scores</span></div>
        <div style={S.body}><div style={{ ...S.card, ...S.empty }} data-testid="no-access">You do not have access to the Self-Review dashboard.</div></div>
      </div>)
  }

  const t = totals(rs)
  const delta = trendDelta(rs)
  const { best, lowest } = bestLowest(rs)
  const roleLine = scope === 'own' ? 'own halves only' : 'all collectors'

  return (
    <div style={S.page}>
      <style>{CSS}</style>
      <div style={S.head}>
        <button style={S.back} onClick={onBack} aria-label="Back to Self-Review">←</button>
        <span style={S.title}>Self-Review Scores</span>
        <span style={S.sub}>{SELF_REVIEW_RESULTS_TAB} · Mark Field Collected Data</span>
        <div style={{ flex:1 }} />
        <span style={S.badge} data-testid="role-badge">{roleInfo?.role || 'Unknown role'} · {roleLine}</span>
        <button style={S.btn} onClick={() => load(true)} disabled={refreshing} data-testid="refresh">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <div style={S.body}><div style={S.inner}>
        {view.status === 'loading' && <div style={{ ...S.card, ...S.empty }} data-testid="loading">Loading Self-Review scores…</div>}
        {view.status === 'error' && (
          <div style={{ ...S.card, borderColor: 'rgba(239,91,91,.5)' }} role="alert" data-testid="error">
            <div style={{ color:R, fontWeight:600, marginBottom:6 }}>The scores could not be shown</div>
            <div style={{ color:'var(--t-1)', fontSize:13 }}>{view.error?.message || String(view.error)}</div>
            {view.error?.problems?.length > 0 && (
              <ul style={{ margin:'10px 0 0', paddingLeft:18, color:'var(--t-2)', fontSize:12 }}>
                {view.error.problems.slice(0, 10).map((p, i) => <li key={i}>{p.runId} · row {p.row}: {p.reason}</li>)}
                {view.error.problems.length > 10 && <li>…and {view.error.problems.length - 10} more</li>}
              </ul>)}
          </div>)}
        {view.status === 'ok' && (<>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'flex-end', marginBottom:14 }}>
            <SearchSelect label="Half" testId="f-half" value={effHalf} onChange={setHalf}
              options={[{ value:'', label:'All halves' }, ...data.halves.map(h => ({ value:h, label:h }))]} />
            <SearchSelect label="Period" testId="f-period" value={period} onChange={setPeriod}
              options={[{ value:'0', label:'All time' }, { value:'30', label:'Last 30 days' }, { value:'90', label:'Last 90 days' }]} />
            <SearchSelect label="Match ID" testId="f-match" value={effMatch} onChange={setMatch}
              options={[{ value:'', label:'All matches' }, ...data.matches.map(m => ({ value:m, label:m }))]} />
            {scope === 'all' && (
              <SearchSelect label="Collector" testId="f-collector" value={collector} onChange={setCollector}
                options={[{ value:'', label:'All collectors' }, ...data.collectors.map(c => ({ value:c, label:c }))]} />)}
            <div style={{ marginLeft:'auto', textAlign:'right' }}>
              <SearchSelect label="Pass mark" testId="f-pass" value={passMark} onChange={changePassMark} disabled={!canEditPass || pmSaving}
                options={PASS_MARK_OPTIONS.map(n => ({ value:n, label:`${n}%` }))} />
              <div style={S.note} data-testid="pass-note">{pmSaving ? 'Saving…' : canEditPass ? 'You can edit the pass mark' : 'Set by Batch Manager'}</div>
            </div>
          </div>
          {pmNotice && <div style={{ ...S.note, color:Y, marginBottom:8 }} role="status" data-testid="pass-notice">{pmNotice}</div>}
          {pmError && <div style={{ ...S.note, color:R, marginBottom:8 }} role="alert" data-testid="pass-error">{pmError}</div>}

          {data.reason === 'NO_HR_CODE' && (
            <div style={{ ...S.card, ...S.empty }} data-testid="empty">Your account has no HR-code, so there are no halves to show.</div>)}
          {data.reason !== 'NO_HR_CODE' && data.reviews.length === 0 && (
            <div style={{ ...S.card, ...S.empty }} data-testid="empty">
              {scope === 'own' ? 'You have no matched Self-Review results yet.' : 'There are no matched Self-Review results yet.'}</div>)}

          {data.reviews.length > 0 && (<>
            <div className="srd-kpis" data-testid="kpis">
              <Kpi testId="k-overall" label="Overall score" value={pct1(overallScore(rs))}
                sub={`${delta == null ? '' : `${delta >= 0 ? '▲ ' : '▼ '}${Math.abs(delta).toFixed(1)} vs earlier · `}all errors incl. collector-only`} />
              <Kpi testId="k-correct" label="Correct ratio" value={pct1(correctRatio(rs))}
                sub={t.trainer > 0 ? `${t.correct.toLocaleString()} of ${t.trainer.toLocaleString()} reviewer events` : 'correct ÷ reviewer events'} />
              <Kpi testId="k-reviews" label={scope === 'all' ? 'Matched reviews' : 'My halves'} value={rs.length}
                sub={scope === 'all' ? `${new Set(rs.map(x => x.hr)).size} collector(s)` : 'reviewed & matched'} />
              <Kpi testId="k-pass" label="Pass rate" value={passRate(rs, passMark) == null ? '–' : `${passRate(rs, passMark)}%`} sub={`≥ ${passMark}% pass mark`} />
              <Kpi testId="k-best" label="Best" value={best == null ? '–' : pct1(best)} sub="single review" />
              <Kpi testId="k-lowest" label="Lowest" value={lowest == null ? '–' : pct1(lowest)} sub="single review" />
            </div>
            <div className="srd-grid">
              <div style={S.card}><h2 style={S.h2}>Score trend (weekly overall score)</h2><Trend rs={rs} passMark={passMark} /></div>
              <div style={S.card}><h2 style={S.h2}>Error breakdown</h2><Errors rs={rs} /></div>
            </div>
            {scope === 'all' && <div style={{ ...S.card, marginBottom:12 }}><h2 style={S.h2}>Collector leaderboard</h2><Leaderboard rs={rs} passMark={passMark} /></div>}
            <div style={S.card}><h2 style={S.h2}>Reviews</h2><ReviewsTable rs={rs} passMark={passMark} showCollector={scope === 'all'} /></div>
          </>)}
          <p style={{ ...S.note, marginTop:12 }} data-testid="footer">
            Score = 100% − (missed + wrong_event + collector_only) ÷ trainer_rows. Only runs with a trainer comparison are scored.
            {' '}{data.noComparison} run(s) with no trainer comparison excluded; {data.duplicates} later duplicate run(s) ignored.
            {data.incomplete > 0 && ` ${data.incomplete} run(s) have fewer rows than their own summary says: check the copy is complete.`}
          </p>
        </>)}
      </div></div>
    </div>
  )
}
