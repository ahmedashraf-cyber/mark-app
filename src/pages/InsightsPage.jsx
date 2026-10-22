/**
 * InsightsPage.jsx — Common Mistakes Analyzer
 * ============================================================================
 * For one match + half: which mistakes did collectors make most often, and at
 * which moment? Read-only — reads comparison_detail, writes nothing.
 *
 * v7.12.16 additions over the original:
 *   1. Session date-time filter — "from" and "to" datetime-local inputs next to
 *      the collector picker. Filters the same run set as the collector picker (AND).
 *      Session time = 13-digit epoch-ms at the end of collector_session_id.
 *      Runs card shows the span of included runs.
 *   2. Video side panel — fixed ~420 px right panel, slides in when a row is
 *      clicked. Row click → seeks the video to the pattern's moment and plays.
 *      Video remembered in localStorage per match+half.
 *      At < 900 px viewport width the panel stacks above the table.
 *
 * Counting rules (unchanged from v7.12.7):
 *   Pattern = event_code + verdict + moment (model_video_time_ms, or
 *   collector_video_time_ms for extras). Each run counts once per pattern.
 *   Missing = missing_*; Extra = extra_event / not_needed_extra;
 *   Wrong = wrong_* (wrong_timestamp, wrong_event, wrong_extra).
 *   correct and wrong_side are never counted.
 *   Frequency = runs with pattern ÷ runs included. Ties keep sheet order.
 */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { capabilities } from '../hooks/useAdmin'
import {
  readComparisonDetail, analyze, viewRows, summary, toCsv,
} from '../utils/insightsData'

const STEP_MS = 40
const BIG_STEP_MS = 1000

const MODULE_COLOR = {
  A:'#0A84FF', B:'#30D158', C:'#FFD60A', D:'#FF9F0A', TO:'#BF5AF2', PRESSURE:'#E8590C',
}
const VERDICT_STYLE = {
  missing: { color:'#f59e0b' },
  extra:   { color:'#ef4444' },
  wrong:   { color:'#a855f7' },
}
const RANK = ['#f59e0b', '#c0c0c0', '#cd7f32']
const verdictKind = v => v.startsWith('missing') ? 'missing'
  : (v === 'extra_event' || v === 'not_needed_extra') ? 'extra' : 'wrong'

const fmt = secs => {
  if (!isFinite(secs)) return '0:00.000'
  const ms = Math.max(0, Math.round(secs * 1000))
  return `${Math.floor(ms/60000)}:${String(Math.floor(ms%60000/1000)).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`
}

const fmtDay  = d => d?.toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' }) ?? ''
const fmtTime = d => d?.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit', hour12:false }) ?? ''
function fmtSpan(a, b) {
  if (!a) return ''
  if (fmtDay(a) !== fmtDay(b)) return `${fmtDay(a)} – ${fmtDay(b)}`
  return fmtTime(a) === fmtTime(b) ? `${fmtDay(a)}, ${fmtTime(a)}` : `${fmtDay(a)}, ${fmtTime(a)} – ${fmtTime(b)}`
}

const inputStyle = { background:'var(--bg-3)', border:'1px solid var(--b-1)', borderRadius:7,
  padding:'7px 11px', fontSize:12, color:'var(--t-1)', outline:'none' }
const btn = { padding:'6px 12px', fontSize:11, background:'transparent', border:'1px solid var(--b-1)',
  borderRadius:7, color:'var(--t-2)', cursor:'pointer' }
const th = { padding:'8px 10px', fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:0.6,
  textTransform:'uppercase', textAlign:'left', borderBottom:'1px solid var(--b-1)',
  cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }
const td = { padding:'8px 10px', fontSize:11, borderBottom:'1px solid rgba(255,255,255,0.05)' }

const Badge = ({ color, children }) => (
  <span style={{ fontSize:9, fontWeight:800, padding:'2px 7px', borderRadius:4, letterSpacing:0.4,
    color, background:color+'22', border:`1px solid ${color}55`, whiteSpace:'nowrap' }}>{children}</span>
)

// ── localStorage helpers for video path ────────────────────────────────────
const VIDEO_KEY = (matchId, half) => `mark_insights_video_${matchId}_${half}`
function loadStoredVideo(matchId, half) {
  try { return JSON.parse(localStorage.getItem(VIDEO_KEY(matchId, half)) || 'null') } catch { return null }
}
function saveStoredVideo(matchId, half, data) {
  try { if (data) localStorage.setItem(VIDEO_KEY(matchId, half), JSON.stringify(data))
        else localStorage.removeItem(VIDEO_KEY(matchId, half)) } catch {}
}

export default function InsightsPage({ role, onBack }) {
  const caps = capabilities(role)
  if (!caps.insights) return (
    <Shell onBack={onBack}>
      <div className="card" style={{ padding:24, fontSize:13, color:'#FF453A' }}>
        You don't have access to Insights.
      </div>
    </Shell>
  )
  return <Analyzer onBack={onBack}/>
}

function Analyzer({ onBack }) {
  const [matchId, setMatchId] = useState('')
  const [half,    setHalf]    = useState('1H')
  const [status,  setStatus]  = useState('initial')
  const [error,   setError]   = useState('')
  const [result,  setResult]  = useState(null)
  const [ran,     setRan]     = useState({ matchId:'', half:'' })

  // collector filter
  const [selected, setSelected] = useState(null)   // Set<run_id> | null = all
  const [collOpen, setCollOpen] = useState(false)

  // date-time filter (null = no limit)
  const [dateFrom, setDateFrom] = useState(null)   // Date | null
  const [dateTo,   setDateTo]   = useState(null)   // Date | null
  const [dFromStr, setDFromStr] = useState('')
  const [dToStr,   setDToStr]   = useState('')

  // verdict pills
  const [pills, setPills] = useState({ missing:true, extra:true, wrong:true })

  // sort
  const [sort, setSort] = useState({ key:'count', dir:'desc' })
  const sortBy = key => setSort(s => ({ key, dir: s.key===key && s.dir==='desc' ? 'asc' : 'desc' }))
  const arrow = key => sort.key===key ? (sort.dir==='desc' ? ' ▼' : ' ▲') : ''

  // video panel
  const [panelOpen, setPanelOpen] = useState(false)
  const [active, setActive]       = useState(null)    // the group row that was clicked
  const videoRef = useRef(null)
  const wrapRef  = useRef(null)
  const pendingSeek = useRef(null)
  const [videoSrc,  setVideoSrc]  = useState('')
  const [videoName, setVideoName] = useState('')
  const [videoMissing, setVideoMissing] = useState(false) // stored file not found
  const [playing,   setPlaying]   = useState(false)
  const [cur,       setCur]       = useState(0)
  const [dur,       setDur]       = useState(0)
  const [isFs,      setIsFs]      = useState(false)
  const fileRef = useRef(null)

  // close collector popup on outside click
  useEffect(() => {
    if (!collOpen) return
    const close = () => setCollOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [collOpen])

  // fullscreen listener
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  // keyboard: ↑/↓ navigate rows (panel closed); ↑ play/pause, ←→ seek (panel open)
  useEffect(() => {
    const onKey = e => {
      const tag = document.activeElement?.tagName
      if (tag==='INPUT' || tag==='SELECT' || tag==='TEXTAREA') return
      if (panelOpen) {
        if (e.key==='ArrowUp') { e.preventDefault(); togglePlay(); return }
        if (e.key==='ArrowLeft'  || e.key==='ArrowRight') {
          e.preventDefault()
          const dir = e.key==='ArrowLeft' ? -1 : 1
          seekBy(dir * (e.shiftKey && e.ctrlKey ? BIG_STEP_MS : STEP_MS))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, videoSrc])

  function seekTo(ms) {
    const t = Math.max(0, ms / 1000)
    const v = videoRef.current
    if (v && videoSrc && v.readyState >= 1) {
      v.currentTime = t
      v.play().catch(() => {})
    } else {
      pendingSeek.current = ms
    }
  }
  function seekBy(ms) {
    const v = videoRef.current
    if (!v || !videoSrc) return
    v.pause()
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + ms / 1000))
  }
  function togglePlay() {
    const v = videoRef.current
    if (!v || !videoSrc) return
    v.paused ? v.play().catch(() => {}) : v.pause()
  }

  // When active row changes, seek video
  useEffect(() => {
    if (!active) return
    const ms = active.anchor_ms
    if (videoSrc) seekTo(ms)
    // if no video yet, pendingSeek is set here and acted on when video loads
    else pendingSeek.current = ms
  }, [active])

  // Cleanup object URLs
  useEffect(() => () => { if (videoSrc) URL.revokeObjectURL(videoSrc) }, [videoSrc])

  function loadVideoFile(file) {
    if (!file || !file.type.startsWith('video/')) return
    if (videoSrc) URL.revokeObjectURL(videoSrc)
    const url = URL.createObjectURL(file)
    setVideoSrc(url)
    setVideoName(file.name)
    setVideoMissing(false)
    saveStoredVideo(ran.matchId, ran.half, { name: file.name })
    // seek will happen in loadedmetadata
  }

  function openVideoForRow(group) {
    setActive(group)
    setPanelOpen(true)
    if (!videoSrc) {
      pendingSeek.current = group.anchor_ms
      fileRef.current?.click()
    } else {
      seekTo(group.anchor_ms)
    }
  }

  function closePanel() {
    const v = videoRef.current
    if (v) v.pause()
    setPanelOpen(false)
    setActive(null)
  }

  // Load stored video metadata when ran changes
  useEffect(() => {
    if (!ran.matchId) return
    const stored = loadStoredVideo(ran.matchId, ran.half)
    if (stored) {
      // We only store the name, not the file itself. Show it with "not found" message
      // until user confirms the file or opens a new one.
      setVideoName(stored.name)
      setVideoMissing(true) // will clear when user loads a file
      setVideoSrc('')
    } else {
      setVideoName('')
      setVideoMissing(false)
      setVideoSrc('')
    }
  }, [ran.matchId, ran.half])

  // ── Analyze ───────────────────────────────────────────────────────────────
  async function run() {
    const id = matchId.trim()
    if (!id) { setError('Enter a match ID.'); return }
    setError(''); setStatus('loading'); setResult(null); setSelected(null)
    setActive(null); closePanel()
    try {
      const res = analyze(await readComparisonDetail(), id, half)
      setRan({ matchId:id, half })
      if (!res) { setStatus('nodata'); return }
      setResult(res); setStatus('ready')
    } catch (e) { setError(e?.message || String(e)); setStatus('initial') }
  }

  // ── Date filter helpers ───────────────────────────────────────────────────
  function onDateFrom(val) {
    setDFromStr(val)
    setDateFrom(val ? new Date(val) : null)
    if (result) { /* triggers re-render via deps */ }
  }
  function onDateTo(val) {
    setDToStr(val)
    // "to" includes the whole chosen minute (like the reference)
    setDateTo(val ? new Date(new Date(val).getTime() + 59999) : null)
  }
  function clearDates() { setDFromStr(''); setDToStr(''); setDateFrom(null); setDateTo(null) }

  // ── Compute included runs (collector + date AND) ──────────────────────────
  const includedRuns = useMemo(() => {
    if (!result) return null
    const { allRuns } = result
    const keys = [...allRuns.keys()]
    const filtered = keys.filter(runId => {
      const { label, sDate } = allRuns.get(runId)
      // collector filter
      if (selected && !selected.has(runId)) return false
      // date filter
      if (dateFrom || dateTo) {
        if (!sDate) return false   // no date → exclude when filter is set (spec: "exclude that run")
        if (dateFrom && sDate < dateFrom) return false
        if (dateTo   && sDate > dateTo)   return false
      }
      return true
    })
    return new Set(filtered)
  }, [result, selected, dateFrom, dateTo])

  // ── Span of included runs (for Runs card) ────────────────────────────────
  const runSpan = useMemo(() => {
    if (!result || !includedRuns) return ''
    const dates = [...includedRuns]
      .map(id => result.allRuns.get(id)?.sDate)
      .filter(Boolean)
      .sort((a, b) => a - b)
    return fmtSpan(dates[0], dates[dates.length - 1])
  }, [result, includedRuns])

  // ── View rows ──────────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    if (!result) return []
    const v = viewRows(result, { selectedRuns: includedRuns, pills })
    const k = sort.key, dir = sort.dir==='asc' ? 1 : -1
    const val = g => k==='count' ? g.count : k==='anchor' ? g.anchor_ms
      : String(g[k] ?? '').toLowerCase()
    return v.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir)
  }, [result, includedRuns, pills, sort])

  const stats = useMemo(() => {
    if (!result) return { runs:0, patterns:0, missing:0, extra:0, wrong:0 }
    // summary uses includedRuns count for `runs`
    const s = { ...summary(result, rows), runs: includedRuns?.size ?? result.totalRuns }
    return s
  }, [result, rows, includedRuns])

  const maxCount = Math.max(1, ...rows.map(r => r.count))

  // ── CSV export ────────────────────────────────────────────────────────────
  async function exportCsv() {
    const csv = toCsv(rows, { matchId:ran.matchId, half:ran.half, totalRuns: includedRuns?.size ?? result.totalRuns })
    try { await invoke('save_text_file_dialog', { name:`common_mistakes_${ran.matchId}_${ran.half}.csv`, content:csv }) }
    catch (e) { setError('Export failed: ' + (e?.message || e)) }
  }

  // ── Collector dropdown helpers ────────────────────────────────────────────
  const allRunIds = result ? [...result.collectors.keys()] : []
  const isAllColl = !selected || selected.size === allRunIds.length
  const collLabel = isAllColl ? 'All collectors'
    : selected.size === 0    ? 'No collectors'
    : selected.size <= 2     ? [...selected].map(r => result.collectors.get(r)).join(', ')
    : `${selected.size} collectors`
  const toggleRun = r => {
    const s = new Set(selected || allRunIds)
    s.has(r) ? s.delete(r) : s.add(r)
    setSelected(s.size === allRunIds.length ? null : s)
  }

  const hasDates = dateFrom || dateTo

  return (
    <Shell onBack={onBack} panelOpen={panelOpen} panel={
      <VideoPanel
        open={panelOpen}
        active={active}
        videoRef={videoRef}
        wrapRef={wrapRef}
        fileRef={fileRef}
        videoSrc={videoSrc}
        videoName={videoName}
        videoMissing={videoMissing}
        playing={playing}
        cur={cur}
        dur={dur}
        isFs={isFs}
        onClose={closePanel}
        onChangeFile={() => fileRef.current?.click()}
        onRemove={() => {
          if (videoSrc) URL.revokeObjectURL(videoSrc)
          setVideoSrc(''); setVideoName(''); setVideoMissing(false)
          saveStoredVideo(ran.matchId, ran.half, null)
        }}
        onFileChange={e => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (f) loadVideoFile(f)
          // cancel: nothing changes (file stays as-is)
        }}
        onLoadedMetadata={e => {
          setDur(e.target.duration)
          if (pendingSeek.current != null) {
            const t = pendingSeek.current / 1000
            pendingSeek.current = null
            e.target.currentTime = t
            e.target.play().catch(() => {})
          }
        }}
        onTimeUpdate={e => setCur(e.target.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTogglePlay={togglePlay}
        onSeekBy={seekBy}
        onToggleFs={() => {
          if (document.fullscreenElement) document.exitFullscreen()
          else wrapRef.current?.requestFullscreen?.()
        }}
        onSeekRange={v => {
          if (videoRef.current && dur) videoRef.current.currentTime = (v / 1000) * dur
        }}
      />
    }>
      {/* ── Controls bar ── */}
      <div className="card" style={{ padding:14, marginBottom:12, display:'flex',
        gap:8, alignItems:'center', flexWrap:'wrap', position:'relative', zIndex:100 }}>
        <input value={matchId} onChange={e => setMatchId(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => e.key==='Enter' && run()} placeholder="Match ID"
          inputMode="numeric" style={{ ...inputStyle, width:130, fontFamily:'JetBrains Mono,monospace' }}/>
        <select value={half} onChange={e => setHalf(e.target.value)}
          style={{ ...inputStyle, cursor:'pointer' }}>
          <option value="1H">1H</option><option value="2H">2H</option>
          <option value="ET1">ET1</option><option value="ET2">ET2</option>
        </select>
        <button className="btn-orange" style={{ padding:'7px 16px', fontSize:12 }}
          disabled={status==='loading'} onClick={run}>Analyze</button>

        {status==='ready' && (<>
          <div style={{ width:1, height:22, background:'var(--b-1)', margin:'0 4px' }}/>

          {/* Collector picker */}
          <div style={{ position:'relative' }} onClick={e => e.stopPropagation()}>
            <button style={btn} onClick={() => setCollOpen(o => !o)}>{collLabel} ▾</button>
            {collOpen && (
              <div className="card" style={{ position:'absolute', top:'110%', left:0, zIndex:200,
                minWidth:220, maxHeight:320, overflowY:'auto', padding:8 }}>
                <div style={{ display:'flex', gap:10, padding:'2px 6px 8px', fontSize:10 }}>
                  <span style={{ color:'var(--p2)', cursor:'pointer' }} onClick={() => setSelected(null)}>All</span>
                  <span style={{ color:'var(--p2)', cursor:'pointer' }} onClick={() => setSelected(new Set())}>None</span>
                </div>
                {allRunIds.map(r => (
                  <label key={r} style={{ display:'flex', gap:8, alignItems:'center',
                    padding:'5px 6px', fontSize:11, cursor:'pointer' }}>
                    <input type="checkbox" checked={!selected || selected.has(r)}
                      onChange={() => toggleRun(r)} style={{ accentColor:'var(--p2)' }}/>
                    <span style={{ fontFamily:'JetBrains Mono,monospace' }}>{result.collectors.get(r)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Date-time filter */}
          <input type="datetime-local" value={dFromStr} onChange={e => onDateFrom(e.target.value)}
            style={{ ...inputStyle, padding:'5px 8px', fontSize:11 }}/>
          <span style={{ fontSize:11, color:'var(--t-3)' }}>–</span>
          <input type="datetime-local" value={dToStr} onChange={e => onDateTo(e.target.value)}
            style={{ ...inputStyle, padding:'5px 8px', fontSize:11 }}/>
          {hasDates && (
            <button onClick={clearDates} style={{ ...btn, fontSize:10, padding:'5px 10px',
              color:'var(--p2)', borderColor:'rgba(232,89,12,0.4)' }}>Clear dates</button>
          )}

          <div style={{ width:1, height:22, background:'var(--b-1)', margin:'0 2px' }}/>

          {/* Verdict pills */}
          {Object.keys(pills).map(p => (
            <button key={p} onClick={() => setPills(x => ({ ...x, [p]:!x[p] }))}
              style={{ ...btn, borderRadius:999,
                color: pills[p] ? VERDICT_STYLE[p].color : 'var(--t-3)',
                borderColor: pills[p] ? VERDICT_STYLE[p].color+'88' : 'var(--b-1)',
                background: pills[p] ? VERDICT_STYLE[p].color+'18' : 'transparent' }}>{p}</button>
          ))}
          <div style={{ flex:1 }}/>
          <button style={btn} onClick={exportCsv}>Export CSV</button>
        </>)}
      </div>

      {error && (
        <div className="card" style={{ padding:'10px 14px', marginBottom:12, fontSize:12,
          color:'#FF453A', border:'1px solid rgba(255,69,58,0.35)' }}>{error}</div>
      )}

      {status==='initial'  && <Empty>Enter a match ID and half to analyze collector mistakes.</Empty>}
      {status==='loading'  && <Empty><Spinner/> Reading comparison data…</Empty>}
      {status==='nodata'   && <Empty>No data for match {ran.matchId} {ran.half}.</Empty>}

      {status==='ready' && (<>
        {/* ── Summary chips ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, marginBottom:12 }}>
          {[
            ['Runs',     stats.runs,     runSpan ? <span style={{ fontSize:9, color:'var(--t-3)', fontWeight:400 }}>{runSpan}</span> : null, 'var(--t-1)'],
            ['Patterns', stats.patterns, null, 'var(--t-1)'],
            ['Missing',  stats.missing,  null, VERDICT_STYLE.missing.color],
            ['Extra',    stats.extra,    null, VERDICT_STYLE.extra.color],
            ['Wrong',    stats.wrong,    null, VERDICT_STYLE.wrong.color],
          ].map(([l, v, sub, c]) => (
            <div key={l} className="card" style={{ padding:'10px 12px' }}>
              <div style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:0.6, textTransform:'uppercase' }}>{l}</div>
              <div style={{ fontSize:20, fontWeight:700, color:c, marginTop:2, lineHeight:1.1 }}>{v}</div>
              {sub && <div style={{ marginTop:2 }}>{sub}</div>}
            </div>
          ))}
        </div>

        {/* ── Table ── */}
        <div className="card" style={{ padding:4, overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={{ ...th, width:36, cursor:'default' }}>#</th>
              <th style={th} onClick={() => sortBy('event_code')}>Event{arrow('event_code')}</th>
              <th style={th} onClick={() => sortBy('verdict')}>Verdict{arrow('verdict')}</th>
              <th style={th} onClick={() => sortBy('anchor')}>Timestamp{arrow('anchor')}</th>
              <th style={th} onClick={() => sortBy('module')}>Module{arrow('module')}</th>
              <th style={{ ...th, width:'30%' }} onClick={() => sortBy('count')}>Frequency{arrow('count')}</th>
              <th style={{ ...th, width:28, cursor:'default' }}/>
            </tr></thead>
            <tbody>
              {rows.map((g, i) => {
                const vk = verdictKind(g.verdict)
                const isActive = active?.key === g.key
                return (
                  <tr key={g.key} className="insights-row"
                    onClick={() => openVideoForRow(g)}
                    style={{ cursor:'pointer', background: isActive ? 'rgba(232,89,12,0.10)' : undefined }}>
                    <td style={{ ...td, fontWeight:800, color:RANK[i]||'var(--t-3)' }}>{i+1}</td>
                    <td style={{ ...td, fontFamily:'JetBrains Mono,monospace' }}>{g.event_code}</td>
                    <td style={td}><Badge color={VERDICT_STYLE[vk].color}>{g.verdict}</Badge></td>
                    <td style={{ ...td, fontFamily:'JetBrains Mono,monospace', color:'var(--t-2)' }}>
                      {g.anchor_readable || '—'}</td>
                    <td style={td}>{g.module
                      ? <Badge color={MODULE_COLOR[g.module]||'#94a3b8'}>{g.module}</Badge>
                      : <span style={{ color:'var(--t-3)' }}>—</span>}</td>
                    <td style={td}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ flex:1, height:6, background:'var(--bg-3)', borderRadius:3 }}>
                          <div style={{ width:`${g.count/maxCount*100}%`, height:'100%',
                            borderRadius:3, background:VERDICT_STYLE[vk].color }}/>
                        </div>
                        <span style={{ fontSize:10, color:'var(--t-2)', whiteSpace:'nowrap',
                          fontFamily:'JetBrains Mono,monospace' }}>
                          {g.count}/{includedRuns?.size??result.totalRuns} ({g.pct}%)</span>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign:'center' }}>
                      <span className="insights-seek" style={{ color:'var(--p2)' }}>▶</span></td>
                  </tr>
                )
              })}
              {!rows.length && (
                <tr><td colSpan={7} style={{ ...td, textAlign:'center', padding:24, color:'var(--t-3)' }}>
                  No mistakes match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </>)}

      <style>{`
        .insights-seek{opacity:0;transition:opacity .15s}
        .insights-row:hover .insights-seek{opacity:1}
      `}</style>
    </Shell>
  )
}

// ── Video panel ─────────────────────────────────────────────────────────────
function VideoPanel({ open, active, videoRef, wrapRef, fileRef, videoSrc, videoName,
    videoMissing, playing, cur, dur, isFs, onClose, onChangeFile, onRemove,
    onFileChange, onLoadedMetadata, onTimeUpdate, onPlay, onPause,
    onTogglePlay, onSeekBy, onToggleFs, onSeekRange }) {

  const ctl = { ...btn, padding:'5px 9px', fontSize:12 }

  return (
    <div style={{ width:open?420:0, flexShrink:0, overflow:'hidden', height:'100%',
      transition:'width .2s ease', background:'var(--bg-2)',
      borderLeft:open?'1px solid var(--b-1)':'none' }}>
      <div style={{ width:420, height:'100%', overflowY:'auto', padding:12, boxSizing:'border-box' }}>

        {/* ── Video area ── */}
        <div className="card" style={{ padding:12, marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:700, flex:1 }}>Video</div>
            <button style={{ ...btn, padding:'3px 9px' }} onClick={onClose}>✕</button>
          </div>

          {videoMissing && !videoSrc && (
            <div style={{ fontSize:11, color:'#FFD60A', padding:'8px 0 4px' }}>
              The video you used before can't be found. Choose the file again.
            </div>
          )}

          {videoSrc && (
            <div style={{ fontSize:11, color:'var(--t-2)', padding:'0 0 8px', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ fontFamily:'JetBrains Mono,monospace', color:'var(--t-1)' }}>{videoName}</span>
              <span style={{ width:6, height:6, borderRadius:'50%', background:'#30D158', flexShrink:0 }}/>
              <button style={{ background:'none', border:'none', color:'var(--p2)', fontSize:11, cursor:'pointer', padding:0 }}
                onClick={onChangeFile}>Change video</button>
            </div>
          )}

          {!videoSrc ? (
            <div style={{ border:'1px dashed var(--b-1)', borderRadius:8, padding:'28px 16px',
              textAlign:'center', cursor:'pointer', color:'var(--t-3)', fontSize:12 }}
              onClick={onChangeFile}>
              {!videoMissing && 'Drop a video here or click to browse'}
              {videoMissing && 'Click to choose the video file'}
              <div style={{ marginTop:10 }}>
                <span style={{ ...btn, display:'inline-block' }}>Open video</span>
              </div>
            </div>
          ) : (
            <div ref={wrapRef} style={{ background:'#000', borderRadius:8, overflow:'hidden' }}>
              <video ref={videoRef} src={videoSrc}
                style={{ width:'100%', maxHeight:isFs?'calc(100vh - 90px)':240, display:'block' }}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onPlay={onPlay}
                onPause={onPause}/>
              <div style={{ padding:8, background:'var(--bg-2)' }}>
                <input type="range" min={0} max={1000} step={1}
                  value={dur ? Math.round((cur/dur)*1000) : 0}
                  onChange={e => onSeekRange(+e.target.value)}
                  style={{ width:'100%', accentColor:'var(--p2)' }}/>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4 }}>
                  <button style={ctl} onClick={() => onSeekBy(-STEP_MS)} title="Back 40ms (←)">◀◀</button>
                  <button style={ctl} onClick={onTogglePlay} title="Play/Pause (↑)">{playing?'❚❚':'▶'}</button>
                  <button style={ctl} onClick={() => onSeekBy(STEP_MS)} title="Forward 40ms (→)">▶▶</button>
                  <span style={{ flex:1, textAlign:'center', fontSize:10, color:'var(--t-2)',
                    fontFamily:'JetBrains Mono,monospace' }}>{fmt(cur)} / {fmt(dur)}</span>
                  <button style={ctl} onClick={onToggleFs} title={isFs?'Exit fullscreen':'Fullscreen'}>{isFs?'✕':'⛶'}</button>
                </div>
              </div>
            </div>
          )}

          {/* Change / Remove buttons */}
          {(videoSrc || videoMissing) && (
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              <button style={{ ...btn, fontSize:11 }} onClick={onChangeFile}>Change video</button>
              <button style={{ ...btn, fontSize:11, color:'#FF453A', borderColor:'rgba(255,69,58,0.3)' }}
                onClick={onRemove}>Remove</button>
            </div>
          )}

          <input ref={fileRef} type="file" accept="video/*" style={{ display:'none' }} onChange={onFileChange}/>
        </div>

        {/* ── Row detail ── */}
        <div className="card" style={{ padding:14 }}>
          {!active ? (
            <div style={{ fontSize:12, color:'var(--t-3)' }}>Click a row to seek the video</div>
          ) : (() => {
            const vk = verdictKind(active.verdict)
            return (<>
              <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
                <span style={{ fontSize:13, fontWeight:700, fontFamily:'JetBrains Mono,monospace' }}>
                  {active.event_code}</span>
                <Badge color={VERDICT_STYLE[vk].color}>{active.verdict}</Badge>
                {active.module && <Badge color={MODULE_COLOR[active.module]||'#94a3b8'}>{active.module}</Badge>}
              </div>
              <div style={{ fontSize:11, color:'var(--t-2)', lineHeight:1.8 }}>
                <div>Timestamp: <b style={{ fontFamily:'JetBrains Mono,monospace' }}>{active.anchor_readable||'—'}</b></div>
                <div>Frequency: <b>{active.count} / {active.contributingRuns?.length ?? '?'} runs ({active.pct}%)</b></div>
              </div>
              {(active.contributingRuns?.length > 0) && (<>
                <div style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:0.6,
                  textTransform:'uppercase', margin:'12px 0 6px' }}>Collectors who made this mistake</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                  {active.contributingRuns.map(r => (
                    <span key={r} style={{ fontSize:10, padding:'3px 8px', borderRadius:5,
                      background:'var(--bg-3)', border:'1px solid var(--b-1)',
                      fontFamily:'JetBrains Mono,monospace' }}>{r}</span>
                  ))}
                </div>
              </>)}
            </>)
          })()}
        </div>
      </div>
    </div>
  )
}

const Empty = ({ children }) => (
  <div className="card" style={{ padding:'40px 20px', textAlign:'center', fontSize:13,
    color:'var(--t-3)', display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
    {children}
  </div>
)
const Spinner = () => (
  <span style={{ width:14, height:14, border:'2px solid var(--b-1)', borderTopColor:'var(--p2)',
    borderRadius:'50%', display:'inline-block', animation:'insightsSpin .8s linear infinite' }}>
    <style>{'@keyframes insightsSpin{to{transform:rotate(360deg)}}'}</style>
  </span>
)

function Shell({ onBack, children, panel = null, panelOpen = false }) {
  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:'var(--bg)',
      color:'var(--t-1)', overflow:'hidden' }}>
      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)', borderBottom:'1px solid var(--b-1)',
        display:'flex', alignItems:'center', padding:'0 16px', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none', color:'var(--t-3)',
          cursor:'pointer', fontSize:11, padding:'4px 8px' }}>← Back</button>
        <div style={{ width:1, height:20, background:'var(--b-1)' }}/>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800, color:'var(--p2)',
          letterSpacing:1.5, background:'rgba(232,89,12,0.12)', padding:'2px 8px', borderRadius:4 }}>INSIGHTS</div>
        <span style={{ fontSize:12, fontWeight:600 }}>Common Mistakes</span>
      </div>
      {/* responsive: side by side ≥900px, stacked <900px */}
      <div style={{ flex:1, display:'flex', flexDirection:'row', overflow:'hidden', minHeight:0 }}>
        <style>{`
          @media (max-width: 899px) {
            .insights-shell-inner { flex-direction: column-reverse !important; }
            .insights-panel { width: 100% !important; height: ${panelOpen ? '340px' : '0'} !important; border-left: none !important; border-top: 1px solid var(--b-1) !important; }
          }
        `}</style>
        <div className="insights-shell-inner" style={{ flex:1, display:'flex', flexDirection:'row', overflow:'hidden', minHeight:0 }}>
          <div style={{ flex:1, minWidth:0, overflowY:'auto', padding:18 }}>{children}</div>
          <div className="insights-panel">{panel}</div>
        </div>
      </div>
    </div>
  )
}
