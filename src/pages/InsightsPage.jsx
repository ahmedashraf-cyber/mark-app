/**
 * InsightsPage.jsx — Common Mistakes Analyzer
 * ============================================================================
 * For one match + half: which mistakes did collectors make most often, and at
 * which moment? Read-only — reads comparison_detail, writes nothing.
 *
 * Layout and video behaviour follow the reference common_mistakes_analyzer.html.
 * Two deliberate differences:
 *   · the video is INLINE beside the table, not Comparison's pop-out window,
 *     so it can never collide with an open Comparison video
 *   · CSV export uses the native save dialog — a temporary <a download> does
 *     nothing inside MARK's desktop window
 *
 * All grouping and counting lives in utils/insightsData.js and is tested there.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { capabilities } from '../hooks/useAdmin'
import {
  readComparisonDetail, analyze, viewRows, summary, toCsv,
} from '../utils/insightsData'

const STEP_MS = 40          // one frame at 25 fps
const BIG_STEP_MS = 1000

// same module palette as the Audit cards
const MODULE_COLOR = { A:'#0A84FF', B:'#30D158', C:'#FFD60A', D:'#FF9F0A', TO:'#BF5AF2', PRESSURE:'#E8590C' }
const VERDICT_STYLE = {
  missing: { color:'#f59e0b', label:'missing' },
  extra:   { color:'#ef4444', label:'extra' },
  wrong:   { color:'#a855f7', label:'wrong' },
}
const verdictKind = v => v.startsWith('missing') ? 'missing' : v === 'extra_event' ? 'extra' : 'wrong'
const RANK = ['#f59e0b', '#c0c0c0', '#cd7f32']   // gold, silver, bronze

const fmt = secs => {
  if (!isFinite(secs)) return '00:00.000'
  const ms = Math.max(0, Math.round(secs * 1000))
  return `${String(Math.floor(ms / 60000)).padStart(2,'0')}:${String(Math.floor(ms % 60000 / 1000)).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`
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
    color, background: color + '22', border:`1px solid ${color}55`, whiteSpace:'nowrap' }}>{children}</span>
)

export default function InsightsPage({ role, onBack }) {
  const caps = capabilities(role)
  // Hiding the card is not access control — the page refuses on its own.
  if (!caps.insights) return (
    <Shell onBack={onBack}>
      <div className="card" style={{ padding:24, fontSize:13, color:'#FF453A' }}>
        You don&rsquo;t have access to Insights.
      </div>
    </Shell>
  )
  return <Analyzer onBack={onBack}/>
}

function Analyzer({ onBack }) {
  const [matchId, setMatchId] = useState('')
  const [half, setHalf]       = useState('1H')
  const [status, setStatus]   = useState('initial')   // initial | loading | ready | nodata
  const [error, setError]     = useState('')
  const [result, setResult]   = useState(null)
  const [ran, setRan]         = useState({ matchId:'', half:'' })
  const [selected, setSelected] = useState(null)      // Set of run_id, null = all
  const [pills, setPills]     = useState({ missing:true, extra:true, wrong:true })
  const [sort, setSort]       = useState({ key:'count', dir:'desc' })
  const [active, setActive]   = useState(null)        // the clicked group
  const [panelOpen, setPanelOpen] = useState(false)
  const [collOpen, setCollOpen] = useState(false)

  useEffect(() => {
    if (!collOpen) return
    const close = () => setCollOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [collOpen])

  async function run() {
    const id = matchId.trim()
    if (!id) { setError('Enter a match ID.'); return }
    setError(''); setStatus('loading'); setResult(null); setSelected(null)
    setActive(null); setPanelOpen(false)
    try {
      const res = analyze(await readComparisonDetail(), id, half)
      setRan({ matchId:id, half })
      if (!res) { setStatus('nodata'); return }
      setResult(res); setStatus('ready')
    } catch (e) {
      setError(e?.message || String(e)); setStatus('initial')
    }
  }

  const rows = useMemo(() => {
    const v = viewRows(result, { selectedRuns: selected, pills })
    const k = sort.key, dir = sort.dir === 'asc' ? 1 : -1
    const val = g => k === 'count' ? g.count : k === 'anchor' ? g.anchor_ms
      : String(g[k] ?? '').toLowerCase()
    return v.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir)
  }, [result, selected, pills, sort])
  const stats = summary(result, rows)
  const maxCount = Math.max(1, ...rows.map(r => r.count))

  const sortBy = key => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
  const arrow = key => sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''

  async function exportCsv() {
    const csv = toCsv(rows, { matchId: ran.matchId, half: ran.half, totalRuns: result.totalRuns })
    try {
      await invoke('save_text_file_dialog',
        { name: `common_mistakes_${ran.matchId}_${ran.half}.csv`, content: csv })
    } catch (e) { setError('Export failed: ' + (e?.message || e)) }
  }

  // collector dropdown
  const allRuns = result ? [...result.collectors.keys()] : []
  const isAll = !selected || selected.size === allRuns.length
  const collLabel = isAll ? 'All collectors'
    : selected.size === 0 ? 'No collectors'
    : selected.size <= 2 ? [...selected].map(r => result.collectors.get(r)).join(', ')
    : `${selected.size} collectors`
  const toggleRun = r => {
    const s = new Set(selected || allRuns)
    s.has(r) ? s.delete(r) : s.add(r)
    setSelected(s.size === allRuns.length ? null : s)
  }

  return (
    <Shell onBack={onBack} drawer={
      <VideoPanel open={panelOpen} active={active} result={result}
        onClose={() => { setPanelOpen(false); setActive(null) }}/>
    }>
      <div>
        {/* ── main column ── */}
        <div>
          {/* Every .card has will-change: transform, which makes it its own
              stacking context. The dropdown lives INSIDE this card, so its
              z-index only competes within it — the summary cards and table
              after it were painted on top regardless of the dropdown's value.
              Lifting this whole card is what puts the dropdown above them. */}
          <div className="card" style={{ padding:14, marginBottom:12, display:'flex',
            gap:8, alignItems:'center', flexWrap:'wrap', position:'relative', zIndex:100 }}>
            <input value={matchId} onChange={e => setMatchId(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && run()} placeholder="Match ID"
              inputMode="numeric" style={{ ...inputStyle, width:130,
                fontFamily:'JetBrains Mono,monospace' }}/>
            <select value={half} onChange={e => setHalf(e.target.value)}
              style={{ ...inputStyle, cursor:'pointer' }}>
              <option value="1H">1H</option><option value="2H">2H</option>
            </select>
            <button className="btn-orange" style={{ padding:'7px 16px', fontSize:12 }}
              disabled={status === 'loading'} onClick={run}>Analyze</button>

            {status === 'ready' && (<>
              <div style={{ width:1, height:22, background:'var(--b-1)', margin:'0 4px' }}/>
              <div style={{ position:'relative' }}>
                <button style={btn} onClick={e => { e.stopPropagation(); setCollOpen(o => !o) }}>{collLabel} ▾</button>
                {collOpen && (
                  <div className="card" onClick={e => e.stopPropagation()}
                    style={{ position:'absolute', top:'110%', left:0, zIndex:100,
                    minWidth:220, maxHeight:320, overflowY:'auto', padding:8 }}>
                    <div style={{ display:'flex', gap:10, padding:'2px 6px 8px', fontSize:10 }}>
                      <a style={{ color:'var(--p2)', cursor:'pointer' }} onClick={() => setSelected(null)}>All</a>
                      <a style={{ color:'var(--p2)', cursor:'pointer' }} onClick={() => setSelected(new Set())}>None</a>
                    </div>
                    {allRuns.map(r => (
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
              {Object.keys(pills).map(p => (
                <button key={p} onClick={() => setPills(x => ({ ...x, [p]: !x[p] }))}
                  style={{ ...btn, borderRadius:999,
                    color: pills[p] ? VERDICT_STYLE[p].color : 'var(--t-3)',
                    borderColor: pills[p] ? VERDICT_STYLE[p].color + '88' : 'var(--b-1)',
                    background: pills[p] ? VERDICT_STYLE[p].color + '18' : 'transparent' }}>{p}</button>
              ))}
              <div style={{ flex:1 }}/>
              <button style={btn} onClick={exportCsv}>Export CSV</button>
            </>)}
          </div>

          {error && (
            <div className="card" style={{ padding:'10px 14px', marginBottom:12, fontSize:12,
              color:'#FF453A', border:'1px solid rgba(255,69,58,0.35)' }}>{error}</div>
          )}

          {status === 'initial' && <Empty>Enter a match ID and half to analyze collector mistakes.</Empty>}
          {status === 'loading' && <Empty><Spinner/> Reading comparison data…</Empty>}
          {status === 'nodata' && (
            <Empty>No data found for match {ran.matchId} {ran.half}. It may not have been compared yet.</Empty>
          )}

          {status === 'ready' && (<>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:8, marginBottom:12 }}>
              {[['Runs', stats.runs, 'var(--t-1)'], ['Unique Patterns', stats.patterns, 'var(--t-1)'],
                ['Missing', stats.missing, VERDICT_STYLE.missing.color],
                ['Extra', stats.extra, VERDICT_STYLE.extra.color],
                ['Wrong', stats.wrong, VERDICT_STYLE.wrong.color]].map(([l, v, c]) => (
                <div key={l} className="card" style={{ padding:'10px 12px' }}>
                  <div style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:0.6,
                    textTransform:'uppercase' }}>{l}</div>
                  <div style={{ fontSize:20, fontWeight:700, color:c, marginTop:2 }}>{v}</div>
                </div>
              ))}
            </div>

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
                    const vk = verdictKind(g.verdict), isActive = active?.key === g.key
                    return (
                      <tr key={g.key} className="insights-row"
                        onClick={() => { setActive(g); setPanelOpen(true) }}
                        style={{ cursor:'pointer',
                          background: isActive ? 'rgba(232,89,12,0.10)' : undefined }}>
                        <td style={{ ...td, fontWeight:800, color: RANK[i] || 'var(--t-3)' }}>{i + 1}</td>
                        <td style={{ ...td, fontFamily:'JetBrains Mono,monospace' }}>{g.event_code}</td>
                        <td style={td}><Badge color={VERDICT_STYLE[vk].color}>{g.verdict}</Badge></td>
                        <td style={{ ...td, fontFamily:'JetBrains Mono,monospace', color:'var(--t-2)' }}>
                          {g.anchor_readable || '—'}</td>
                        <td style={td}>{g.module
                          ? <Badge color={MODULE_COLOR[g.module] || '#94a3b8'}>{g.module}</Badge>
                          : <span style={{ color:'var(--t-3)' }}>—</span>}</td>
                        <td style={td}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={{ flex:1, height:6, background:'var(--bg-3)', borderRadius:3 }}>
                              <div style={{ width:`${g.count / maxCount * 100}%`, height:'100%',
                                borderRadius:3, background: VERDICT_STYLE[vk].color }}/>
                            </div>
                            <span style={{ fontSize:10, color:'var(--t-2)', whiteSpace:'nowrap',
                              fontFamily:'JetBrains Mono,monospace' }}>
                              {g.count}/{result.totalRuns} ({g.pct}%)</span>
                          </div>
                        </td>
                        <td style={{ ...td, textAlign:'center' }}>
                          <span className="insights-seek" style={{ color:'var(--p2)' }}>▶</span></td>
                      </tr>
                    )
                  })}
                  {!rows.length && (
                    <tr><td colSpan={7} style={{ ...td, textAlign:'center', padding:24,
                      color:'var(--t-3)' }}>No mistakes match the current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>)}
        </div>

      </div>
      {/* the seek icon shows on row hover only */}
      <style>{`.insights-seek{opacity:0;transition:opacity .15s}.insights-row:hover .insights-seek{opacity:1}`}</style>
    </Shell>
  )
}

function VideoPanel({ open, active, result, onClose }) {
  const videoRef = useRef(null)
  const wrapRef  = useRef(null)
  const pending  = useRef(null)      // a seek requested before the video loaded
  const [src, setSrc] = useState('')
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [isFs, setIsFs] = useState(false)
  const fileRef = useRef(null)

  // Seek on every row click. Before a video is loaded, remember it and apply it
  // on loadedmetadata — the same pending-seek idea Comparison uses.
  useEffect(() => {
    if (!active) return
    const t = active.anchor_ms / 1000
    const v = videoRef.current
    if (v && src && v.readyState >= 1) v.currentTime = t
    else pending.current = t
  }, [active, src])

  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])

  const loadFile = file => {
    if (!file || !file.type.startsWith('video/')) return
    if (src) URL.revokeObjectURL(src)
    setSrc(URL.createObjectURL(file))
  }
  const seekBy = ms => {
    const v = videoRef.current
    if (!v || !src) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + ms / 1000))
  }
  const togglePlay = () => {
    const v = videoRef.current
    if (!v || !src) return
    v.paused ? v.play() : v.pause()
  }
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else wrapRef.current?.requestFullscreen?.()
  }
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  // Keyboard shortcuts: only while the panel is open, a video is loaded, and no
  // text field has focus — exactly as the reference.
  useEffect(() => {
    if (!open) return
    const onKey = e => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (!src) return
      const ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey
      if (e.key === 'ArrowUp') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); seekBy(ctrl && shift ? -BIG_STEP_MS : -STEP_MS) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(ctrl && shift ?  BIG_STEP_MS :  STEP_MS) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, src])

  const vk = active && verdictKind(active.verdict)
  const ctl = { ...btn, padding:'5px 9px', fontSize:12 }

  return (
    <div style={{ width: open ? 420 : 0, flexShrink:0, overflow:'hidden', height:'100%',
      transition:'width .2s ease', background:'var(--bg-2)',
      borderLeft: open ? '1px solid var(--b-1)' : 'none' }}>
      <div style={{ width:420, height:'100%', overflowY:'auto', padding:12, boxSizing:'border-box' }}>
        <div className="card" style={{ padding:12, marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:700, flex:1 }}>Video</div>
            <button style={{ ...btn, padding:'3px 9px' }} onClick={onClose} title="Close">✕</button>
          </div>

          {!src ? (
            <div onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); loadFile(e.dataTransfer.files?.[0]) }}
              onClick={() => fileRef.current?.click()}
              style={{ border:'1px dashed var(--b-1)', borderRadius:8, padding:'34px 16px',
                textAlign:'center', cursor:'pointer', color:'var(--t-3)', fontSize:12 }}>
              Drop a video file here or click to browse
              <div style={{ marginTop:12 }}>
                <span style={{ ...btn, display:'inline-block' }}>Browse</span>
              </div>
              <input ref={fileRef} type="file" accept="video/*" style={{ display:'none' }}
                onChange={e => loadFile(e.target.files?.[0])}/>
            </div>
          ) : (
            <div ref={wrapRef} style={{ background:'#000', borderRadius:8, overflow:'hidden',
              display:'flex', flexDirection:'column', justifyContent:'center' }}>
              <video ref={videoRef} src={src}
                style={{ width:'100%', maxHeight: isFs ? 'calc(100vh - 90px)' : 240, display:'block' }}
                onLoadedMetadata={e => {
                  setDur(e.target.duration)
                  if (pending.current != null) { e.target.currentTime = pending.current; pending.current = null }
                }}
                onTimeUpdate={e => setCur(e.target.currentTime)}
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}/>
              <div style={{ padding:8, background:'var(--bg-2)' }}>
                <input type="range" min={0} max={dur || 0} step={0.001} value={cur}
                  onChange={e => { if (videoRef.current) videoRef.current.currentTime = +e.target.value }}
                  style={{ width:'100%', accentColor:'var(--p2)' }}/>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4 }}>
                  <button style={ctl} onClick={() => seekBy(-STEP_MS)} title="Back 40ms (←)">◀◀</button>
                  <button style={ctl} onClick={togglePlay} title="Play / Pause (↑)">{playing ? '❚❚' : '▶'}</button>
                  <button style={ctl} onClick={() => seekBy(STEP_MS)} title="Forward 40ms (→)">▶▶</button>
                  <span style={{ flex:1, textAlign:'center', fontSize:10, color:'var(--t-2)',
                    fontFamily:'JetBrains Mono,monospace' }}>{fmt(cur)} / {fmt(dur)}</span>
                  <button style={ctl} onClick={toggleFs}
                    title={isFs ? 'Exit fullscreen' : 'Fullscreen'}>{isFs ? '✕' : '⛶'}</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card" style={{ padding:14 }}>
          {!active ? (
            <div style={{ fontSize:12, color:'var(--t-3)' }}>Click a row to see event detail</div>
          ) : (<>
            <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
              <span style={{ fontSize:13, fontWeight:700, fontFamily:'JetBrains Mono,monospace' }}>
                {active.event_code}</span>
              <Badge color={VERDICT_STYLE[vk].color}>{active.verdict}</Badge>
              {active.module && <Badge color={MODULE_COLOR[active.module] || '#94a3b8'}>{active.module}</Badge>}
            </div>
            <div style={{ fontSize:11, color:'var(--t-2)', lineHeight:1.8 }}>
              <div>Timestamp: <b style={{ fontFamily:'JetBrains Mono,monospace' }}>{active.anchor_readable || '—'}</b></div>
              <div>Frequency: <b>{active.count} / {result?.totalRuns} runs ({active.pct}%)</b></div>
            </div>
            <div style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:0.6,
              textTransform:'uppercase', margin:'12px 0 6px' }}>Collectors who made this mistake</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
              {(active.contributingRuns || []).map(r => (
                <span key={r} style={{ fontSize:10, padding:'3px 8px', borderRadius:5,
                  background:'var(--bg-3)', border:'1px solid var(--b-1)',
                  fontFamily:'JetBrains Mono,monospace' }}>{result?.collectors.get(r)}</span>
              ))}
            </div>
          </>)}
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

/**
 * Layout matches the reference: a header, then a row of [scrolling main |
 * drawer]. The drawer is OUTSIDE the scroll area, full height, so it stays in
 * view however far down the table the clicked row is. (It was first built
 * inside the scroll area, at the top of the table — so after scrolling down,
 * a clicked row opened the panel above the visible part of the page.)
 */
function Shell({ onBack, children, drawer = null }) {
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
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
        <div style={{ flex:1, minWidth:0, overflowY:'auto', padding:18 }}>{children}</div>
        {drawer}
      </div>
    </div>
  )
}
