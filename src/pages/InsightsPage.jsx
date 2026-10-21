/**
 * InsightsPage.jsx — Common Mistakes Analyzer (cross-match with Sampled Halves filters)
 * ======================================================================================
 * Reads comparison_detail (all matches) + Sampled Halves, joins them,
 * and shows a ranked event-error list filterable by batch, collector,
 * competition, task type, reviewer, and date range.
 *
 * The original single-match VideoPanel is preserved for the event detail drawer.
 * All grouping / ranking / comparison logic lives in insightsData.js +
 * sampledHalves.js and is tested there.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { capabilities, ROLE } from '../hooks/useAdmin'
import { useAuth } from '../hooks/useAuth'
import {
  readComparisonDetail, analyzeFiltered, rankEvents, batchComparison,
  ERROR_VERDICTS, PILLS,
} from '../utils/insightsData'
import {
  readSampledHalves, buildSampledIndex, joinStats, supervisorBatches,
  filterOptions, filteredHalfKeys,
} from '../utils/sampledHalves'

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputStyle = { background:'var(--bg-3)', border:'1px solid var(--b-1)', borderRadius:7,
  padding:'7px 11px', fontSize:12, color:'var(--t-1)', outline:'none' }
const btn = { padding:'6px 12px', fontSize:11, background:'transparent', border:'1px solid var(--b-1)',
  borderRadius:7, color:'var(--t-2)', cursor:'pointer' }
const th = { padding:'8px 10px', fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:0.6,
  textTransform:'uppercase', textAlign:'left', borderBottom:'1px solid var(--b-1)',
  cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }
const td = { padding:'8px 10px', fontSize:11, borderBottom:'1px solid rgba(255,255,255,0.05)' }
const MODULE_COLOR = { A:'#0A84FF', B:'#30D158', C:'#FFD60A', D:'#FF9F0A', TO:'#BF5AF2', PRESSURE:'#E8590C' }
const VERDICT_STYLE = {
  missing: { color:'#f59e0b', label:'missing' },
  extra:   { color:'#ef4444', label:'extra' },
  wrong:   { color:'#a855f7', label:'wrong' },
}
const RANK = ['#f59e0b', '#c0c0c0', '#cd7f32']
const verdictKind = v => v.startsWith('missing') ? 'missing' : v === 'extra_event' ? 'extra' : 'wrong'
const STEP_MS = 40
const BIG_STEP_MS = 1000
const fmt = secs => {
  if (!isFinite(secs)) return '00:00.000'
  const ms = Math.max(0, Math.round(secs * 1000))
  return `${String(Math.floor(ms / 60000)).padStart(2,'0')}:${String(Math.floor(ms % 60000 / 1000)).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`
}
const Badge = ({ color, children }) => (
  <span style={{ fontSize:9, fontWeight:800, padding:'2px 7px', borderRadius:4, letterSpacing:0.4,
    color, background: color + '22', border:`1px solid ${color}55`, whiteSpace:'nowrap' }}>{children}</span>
)

const SUPERVISOR_ROLES = new Set([ROLE.SUPERVISOR, ROLE.COORDINATOR])

// ── Access gate ───────────────────────────────────────────────────────────────
export default function InsightsPage({ role, onBack }) {
  const caps = capabilities(role)
  if (!caps.insights) return (
    <Shell onBack={onBack}>
      <div className="card" style={{ padding:24, fontSize:13, color:'#FF453A' }}>
        You don&rsquo;t have access to Insights.
      </div>
    </Shell>
  )
  return <Analyzer role={role} onBack={onBack}/>
}

// ── Main analyzer ─────────────────────────────────────────────────────────────
function Analyzer({ role, onBack }) {
  const { roleInfo } = useAuth()
  const isSupervisor = SUPERVISOR_ROLES.has(role)
  const myHrCode = roleInfo?.code || ''

  // Data loading
  const [loadStatus, setLoadStatus]   = useState('idle')   // idle | loading | ready | error
  const [loadError,  setLoadError]    = useState('')
  const [compRows,   setCompRows]     = useState([])
  const [sampledRows, setSampledRows] = useState([])
  const [sampledIdx, setSampledIdx]   = useState(new Map())
  const [joinInfo,   setJoinInfo]     = useState(null)

  // Filters (session-only, not persisted)
  const [fBatches,      setFBatches]      = useState([])   // []= all
  const [fCollectors,   setFCollectors]   = useState([])
  const [fCompetitions, setFCompetitions] = useState([])
  const [fTaskTypes,    setFTaskTypes]    = useState([])
  const [fReviewers,    setFReviewers]    = useState([])
  const [fDateFrom,     setFDateFrom]     = useState('')
  const [fDateTo,       setFDateTo]       = useState('')
  const [defaultBatch,  setDefaultBatch]  = useState(null) // "Showing your batch: ..." label

  // Sort
  const [sort, setSort] = useState({ key: 'rate', dir: 'desc' })
  const sortBy = key => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
  const arrow = key => sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''

  // Video panel
  const [active, setActive]     = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)

  // Dropdown open state
  const [openDrop, setOpenDrop] = useState(null) // 'batch'|'collector'|'competition'|'tasktype'|'reviewer'|null
  useEffect(() => {
    if (!openDrop) return
    const close = e => { if (!e.target.closest('.insights-drop')) setOpenDrop(null) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [openDrop])

  // Load on mount
  useEffect(() => {
    let alive = true
    async function load() {
      setLoadStatus('loading')
      try {
        const [comp, sampled] = await Promise.all([readComparisonDetail(), readSampledHalves()])
        if (!alive) return
        const idx = buildSampledIndex(sampled)
        setCompRows(comp)
        setSampledRows(sampled)
        setSampledIdx(idx)
        setJoinInfo(joinStats(comp, idx))

        // Pre-select supervisor's own batch (Option A: derive from Reviewer column)
        if (isSupervisor && myHrCode) {
          const myBatches = supervisorBatches(sampled, myHrCode)
          if (myBatches.length) {
            setFBatches(myBatches)
            setDefaultBatch(myBatches)
          }
        }
        setLoadStatus('ready')
      } catch (e) {
        if (!alive) return
        setLoadError(e?.message || String(e))
        setLoadStatus('error')
      }
    }
    load()
    return () => { alive = false }
  }, [])

  // Filter options derived from all sampled rows
  const opts = useMemo(() => filterOptions(sampledRows), [sampledRows])

  // Active filters object
  const filters = { batches: fBatches, hrCodes: fCollectors, competitions: fCompetitions,
    taskTypes: fTaskTypes, reviewers: fReviewers, dateFrom: fDateFrom, dateTo: fDateTo }

  // Compute which half-keys pass the filters
  const { halfKeys: mainHalfKeys, allFiltersEmpty } = useMemo(
    () => filteredHalfKeys(sampledRows, sampledIdx, filters),
    [sampledRows, sampledIdx, fBatches, fCollectors, fCompetitions, fTaskTypes, fReviewers, fDateFrom, fDateTo]
  )

  // "Everyone else" half-keys for batch comparison (same non-batch filters, different batch)
  const oneBatchSelected = fBatches.length === 1
  const othersHalfKeys = useMemo(() => {
    if (!oneBatchSelected) return new Set()
    const allOtherBatches = opts.batches.filter(b => b !== fBatches[0])
    if (!allOtherBatches.length) return new Set()
    const { halfKeys } = filteredHalfKeys(sampledRows, sampledIdx, { ...filters, batches: allOtherBatches })
    return halfKeys
  }, [oneBatchSelected, fBatches, sampledRows, sampledIdx, fCollectors, fCompetitions, fTaskTypes, fReviewers, fDateFrom, fDateTo])

  // Main analysis
  const analysis = useMemo(() => {
    if (loadStatus !== 'ready' || !compRows.length) return null
    return analyzeFiltered(compRows, sampledIdx, mainHalfKeys, allFiltersEmpty)
  }, [loadStatus, compRows, sampledIdx, mainHalfKeys, allFiltersEmpty])

  // Ranked events
  const ranked = useMemo(() => {
    if (!analysis) return []
    const rows = rankEvents(analysis.groupMap, analysis.totalHalves)
    const k = sort.key, dir = sort.dir === 'asc' ? 1 : -1
    if (k === 'gap' && oneBatchSelected) {
      // sort by ratio descending
      return rows.sort((a, b) => {
        const ra = cmpData?.get(a.event_code)?.ratio ?? -Infinity
        const rb = cmpData?.get(b.event_code)?.ratio ?? -Infinity
        return (rb - ra) * dir
      })
    }
    return rows.sort((a, b) => {
      const va = k === 'rate' ? a.rate : k === 'count' ? a.errorCount : String(a[k] ?? '').toLowerCase()
      const vb = k === 'rate' ? b.rate : k === 'count' ? b.errorCount : String(b[k] ?? '').toLowerCase()
      return (va > vb ? 1 : va < vb ? -1 : 0) * dir
    })
  }, [analysis, sort, oneBatchSelected])

  // Batch comparison
  const cmpData = useMemo(() => {
    if (!oneBatchSelected || !compRows.length) return null
    return batchComparison(compRows, mainHalfKeys, othersHalfKeys)
  }, [oneBatchSelected, compRows, mainHalfKeys, othersHalfKeys])

  const maxRate  = Math.max(1e-9, ...(ranked.map(r => r.rate)))
  const totalErr = ranked.reduce((s, r) => s + r.errorCount, 0)
  const hasFilters = fBatches.length || fCollectors.length || fCompetitions.length
    || fTaskTypes.length || fReviewers.length || fDateFrom || fDateTo

  function clearFilters() {
    setFBatches([]); setFCollectors([]); setFCompetitions([])
    setFTaskTypes([]); setFReviewers([]); setFDateFrom(''); setFDateTo('')
    setDefaultBatch(null)
  }

  return (
    <Shell onBack={onBack} drawer={
      <VideoPanel open={panelOpen} active={active}
        onClose={() => { setPanelOpen(false); setActive(null) }}/>
    }>
      {/* ── Loading / error states ── */}
      {loadStatus === 'loading' && (
        <Empty><Spinner/> Loading comparison data and sampled halves…</Empty>
      )}
      {loadStatus === 'error' && (
        <div className="card" style={{ padding:14, color:'#FF453A', fontSize:12 }}>{loadError}</div>
      )}

      {loadStatus === 'ready' && (<>
        {/* ── Supervisor default-batch banner ── */}
        {defaultBatch && (
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px',
            background:'rgba(232,89,12,0.08)', border:'1px solid rgba(232,89,12,0.25)',
            borderRadius:8, marginBottom:12, fontSize:12 }}>
            <span style={{ color:'var(--p2)', fontWeight:600 }}>
              Showing your batch{defaultBatch.length > 1 ? 'es' : ''}: {defaultBatch.join(', ')}
            </span>
            <button onClick={clearFilters}
              style={{ background:'none', border:'none', color:'var(--t-3)', fontSize:11,
                cursor:'pointer', padding:0, textDecoration:'underline' }}>
              Change
            </button>
          </div>
        )}

        {/* ── Filter bar ── */}
        <div className="card" style={{ padding:12, marginBottom:12, display:'flex',
          gap:8, alignItems:'center', flexWrap:'wrap', position:'relative', zIndex:200 }}>

          {/* Batch */}
          <MultiSelect label="Batch" options={opts.batches.map(b => ({ value:b, label:b }))}
            selected={fBatches} onChange={setFBatches} openKey="batch"
            openDrop={openDrop} setOpenDrop={setOpenDrop}/>

          {/* Collector */}
          <MultiSelect label="Collector"
            options={opts.collectors.map(([code, name]) => ({
              value: code,
              label: name ? `${code} · ${name}` : code,
            }))}
            selected={fCollectors} onChange={setFCollectors} openKey="collector"
            openDrop={openDrop} setOpenDrop={setOpenDrop}/>

          {/* Competition */}
          <MultiSelect label="Competition" options={opts.competitions.map(c => ({ value:c, label:c }))}
            selected={fCompetitions} onChange={setFCompetitions} openKey="competition"
            openDrop={openDrop} setOpenDrop={setOpenDrop}/>

          {/* Task type */}
          <MultiSelect label="Task type" options={opts.taskTypes.map(t => ({ value:t, label:t }))}
            selected={fTaskTypes} onChange={setFTaskTypes} openKey="tasktype"
            openDrop={openDrop} setOpenDrop={setOpenDrop}/>

          {/* Reviewer */}
          <MultiSelect label="Reviewer" options={opts.reviewers.map(r => ({ value:r, label:r }))}
            selected={fReviewers} onChange={setFReviewers} openKey="reviewer"
            openDrop={openDrop} setOpenDrop={setOpenDrop}/>

          {/* Date range */}
          <input type="date" value={fDateFrom} onChange={e => setFDateFrom(e.target.value)}
            style={{ ...inputStyle, padding:'5px 8px', fontSize:11 }}/>
          <span style={{ fontSize:11, color:'var(--t-3)' }}>–</span>
          <input type="date" value={fDateTo} onChange={e => setFDateTo(e.target.value)}
            style={{ ...inputStyle, padding:'5px 8px', fontSize:11 }}/>

          {hasFilters && (
            <button onClick={clearFilters} style={{ ...btn, color:'var(--p2)',
              borderColor:'rgba(232,89,12,0.4)' }}>Clear filters</button>
          )}
        </div>

        {/* ── Sample size banner ── */}
        {analysis && (
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 14px',
            background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:8,
            marginBottom:12, fontSize:12, flexWrap:'wrap' }}>
            <span style={{ color:'var(--t-2)' }}>
              Based on <b style={{ color:'var(--t-1)' }}>{analysis.totalHalves}</b> half{analysis.totalHalves !== 1 ? 'ves' : ''} ·{' '}
              <b style={{ color:'var(--t-1)' }}>{totalErr}</b> error{totalErr !== 1 ? 's' : ''}
            </span>
            {analysis.totalHalves < 5 && (
              <span style={{ color:'#FFD60A', fontSize:11 }}>
                ⚠ Fewer than 5 halves — ranking may not be reliable
              </span>
            )}
            {analysis.unsampledHalves > 0 && allFiltersEmpty && (
              <span style={{ color:'var(--t-3)', fontSize:11 }}>
                ({analysis.unsampledHalves} half{analysis.unsampledHalves !== 1 ? 'ves' : ''} not in Sampled Halves)
              </span>
            )}
            {joinInfo && (
              <span style={{ color:'var(--t-3)', fontSize:10, marginLeft:'auto' }}>
                join: {joinInfo.matched} matched · {joinInfo.unmatched} unmatched · {joinInfo.multi} multi-row
              </span>
            )}
          </div>
        )}

        {/* ── Batch comparison banner ── */}
        {oneBatchSelected && analysis && (
          <div style={{ padding:'8px 14px', background:'rgba(10,132,255,0.08)',
            border:'1px solid rgba(10,132,255,0.25)', borderRadius:8, marginBottom:12,
            fontSize:11, color:'var(--t-2)' }}>
            Batch <b style={{ color:'var(--t-1)' }}>{fBatches[0]}</b> vs everyone else ·{' '}
            {analysis.totalHalves} halves in batch ·{' '}
            {analyzeFiltered(compRows, sampledIdx, othersHalfKeys, false).totalHalves} halves in others
          </div>
        )}

        {/* ── Sort bar ── */}
        {ranked.length > 0 && (
          <div style={{ display:'flex', gap:6, marginBottom:8, alignItems:'center' }}>
            <span style={{ fontSize:10, color:'var(--t-3)', textTransform:'uppercase',
              letterSpacing:0.5, marginRight:4 }}>Sort:</span>
            {[['rate','Errors per half'], ['count','Total errors'],
              ...(oneBatchSelected ? [['gap','Biggest gap vs others']] : [])
            ].map(([k, lbl]) => (
              <button key={k} onClick={() => sortBy(k)}
                style={{ ...btn, fontSize:10, padding:'4px 10px',
                  color: sort.key === k ? 'var(--p2)' : 'var(--t-3)',
                  borderColor: sort.key === k ? 'rgba(232,89,12,0.5)' : 'var(--b-1)',
                  background: sort.key === k ? 'rgba(232,89,12,0.08)' : 'transparent',
                }}>
                {lbl}{arrow(k)}
              </button>
            ))}
          </div>
        )}

        {/* ── Results table ── */}
        {!ranked.length ? (
          <Empty>No data for the selected filters. Try widening the filters or clearing them.</Empty>
        ) : (
          <div className="card" style={{ padding:4, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                <th style={{ ...th, width:36, cursor:'default' }}>#</th>
                <th style={th} onClick={() => sortBy('event_code')}>Event{arrow('event_code')}</th>
                <th style={th}>Top verdict</th>
                <th style={{ ...th, width:'30%' }} onClick={() => sortBy('rate')}>
                  Errors per half{arrow('rate')}
                </th>
                {oneBatchSelected && <th style={th}>vs others</th>}
                <th style={{ ...th, width:28, cursor:'default' }}/>
              </tr></thead>
              <tbody>
                {ranked.map((g, i) => {
                  // Dominant verdict
                  const topVerdict = Object.entries(g.verdict_counts || {})
                    .sort((a,b) => b[1]-a[1])[0]?.[0] || ''
                  const vk = topVerdict ? verdictKind(topVerdict) : 'wrong'
                  const isActive = active?.event_code === g.event_code

                  // Batch comparison cell
                  let cmpCell = null
                  if (oneBatchSelected && cmpData) {
                    const c = cmpData.get(g.event_code)
                    if (!c?.canCompare) {
                      cmpCell = <span style={{ color:'var(--t-3)', fontSize:10 }}>
                        Not enough halves to compare
                      </span>
                    } else {
                      const ratio = c.ratio
                      const color = ratio == null ? 'var(--t-3)' : ratio >= 1.5 ? '#ef4444' : ratio <= 0.67 ? '#30D158' : 'var(--t-2)'
                      cmpCell = (
                        <span style={{ fontSize:10, color }}>
                          {fBatches[0]} {c.batchRate.toFixed(2)} · others {c.othersRate.toFixed(2)}
                          {ratio != null && <> · <b>{ratio.toFixed(1)}×</b></>}
                        </span>
                      )
                    }
                  }

                  return (
                    <tr key={g.event_code} className="insights-row"
                      onClick={() => { setActive(g); setPanelOpen(true) }}
                      style={{ cursor:'pointer', background: isActive ? 'rgba(232,89,12,0.10)' : undefined }}>
                      <td style={{ ...td, fontWeight:800, color: RANK[i] || 'var(--t-3)' }}>{i+1}</td>
                      <td style={{ ...td, fontFamily:'JetBrains Mono,monospace' }}>{g.event_code}</td>
                      <td style={td}>
                        {topVerdict ? <Badge color={VERDICT_STYLE[vk].color}>{topVerdict}</Badge>
                          : <span style={{ color:'var(--t-3)' }}>—</span>}
                      </td>
                      <td style={td}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ flex:1, height:6, background:'var(--bg-3)', borderRadius:3 }}>
                            <div style={{ width:`${g.rate / maxRate * 100}%`, height:'100%',
                              borderRadius:3, background: VERDICT_STYLE[vk].color }}/>
                          </div>
                          <span style={{ fontSize:10, color:'var(--t-2)', whiteSpace:'nowrap',
                            fontFamily:'JetBrains Mono,monospace' }}>
                            {g.rate.toFixed(2)}/half ({g.errorCount})
                          </span>
                        </div>
                      </td>
                      {oneBatchSelected && <td style={td}>{cmpCell}</td>}
                      <td style={{ ...td, textAlign:'center' }}>
                        <span className="insights-seek" style={{ color:'var(--p2)' }}>▶</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </>)}
    </Shell>
  )
}

// ── Multi-select dropdown component ───────────────────────────────────────────
function MultiSelect({ label, options, selected, onChange, openKey, openDrop, setOpenDrop }) {
  const isOpen = openDrop === openKey
  const allSel = !selected.length
  const dispLabel = allSel ? `${label}: All`
    : selected.length === 1 ? `${label}: ${options.find(o => o.value === selected[0])?.label || selected[0]}`
    : `${label}: ${selected.length}`

  const toggle = v => {
    const s = new Set(selected)
    s.has(v) ? s.delete(v) : s.add(v)
    onChange([...s])
  }

  return (
    <div className="insights-drop" style={{ position:'relative' }}>
      <button style={{ ...btn, fontSize:11,
        color: allSel ? 'var(--t-2)' : 'var(--p2)',
        borderColor: allSel ? 'var(--b-1)' : 'rgba(232,89,12,0.5)',
        background: allSel ? 'transparent' : 'rgba(232,89,12,0.08)',
      }} onClick={e => { e.stopPropagation(); setOpenDrop(isOpen ? null : openKey) }}>
        {dispLabel} ▾
      </button>
      {isOpen && options.length > 0 && (
        <div className="card" style={{ position:'absolute', top:'110%', left:0, zIndex:500,
          minWidth:200, maxHeight:300, overflowY:'auto', padding:8, boxShadow:'0 8px 32px rgba(0,0,0,0.5)' }}>
          <div style={{ display:'flex', gap:10, padding:'2px 6px 8px', fontSize:10 }}>
            <span style={{ color:'var(--p2)', cursor:'pointer' }} onClick={() => onChange([])}>All</span>
            <span style={{ color:'var(--p2)', cursor:'pointer' }} onClick={() => onChange(options.map(o => o.value))}>All of these</span>
          </div>
          {options.map(o => (
            <label key={o.value} style={{ display:'flex', gap:8, alignItems:'center',
              padding:'5px 6px', fontSize:11, cursor:'pointer' }}>
              <input type="checkbox" checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)} style={{ accentColor:'var(--p2)' }}/>
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Video Panel (unchanged from original, for event detail drawer) ──────────
function VideoPanel({ open, active, onClose }) {
  const videoRef = useRef(null)
  const wrapRef  = useRef(null)
  const pending  = useRef(null)
  const [src, setSrc]         = useState('')
  const [playing, setPlaying] = useState(false)
  const [cur, setCur]         = useState(0)
  const [dur, setDur]         = useState(0)
  const [isFs, setIsFs]       = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!active) return
    // anchor_ms lives on the analyzeFiltered row only if there's a sample; fall back to 0
    const t = (active.anchor_ms || 0) / 1000
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
  useEffect(() => {
    if (!open) return
    const onKey = e => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (!src) return
      const ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey
      if (e.key === 'ArrowUp')    { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); seekBy(ctrl && shift ? -BIG_STEP_MS : -STEP_MS) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(ctrl && shift ?  BIG_STEP_MS :  STEP_MS) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, src])

  const ctl = { ...btn, padding:'5px 9px', fontSize:12 }
  const topVerdict = active && Object.entries(active.verdict_counts || {}).sort((a,b)=>b[1]-a[1])[0]?.[0]
  const vk = topVerdict ? verdictKind(topVerdict) : 'wrong'

  return (
    <div style={{ width: open ? 420 : 0, flexShrink:0, overflow:'hidden', height:'100%',
      transition:'width .2s ease', background:'var(--bg-2)',
      borderLeft: open ? '1px solid var(--b-1)' : 'none' }}>
      <div style={{ width:420, height:'100%', overflowY:'auto', padding:12, boxSizing:'border-box' }}>
        <div className="card" style={{ padding:12, marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:700, flex:1 }}>Video</div>
            <button style={{ ...btn, padding:'3px 9px' }} onClick={onClose}>✕</button>
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
            <div ref={wrapRef} style={{ background:'#000', borderRadius:8, overflow:'hidden' }}>
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
                  <button style={ctl} onClick={() => seekBy(-STEP_MS)}>◀◀</button>
                  <button style={ctl} onClick={togglePlay}>{playing ? '❚❚' : '▶'}</button>
                  <button style={ctl} onClick={() => seekBy(STEP_MS)}>▶▶</button>
                  <span style={{ flex:1, textAlign:'center', fontSize:10, color:'var(--t-2)',
                    fontFamily:'JetBrains Mono,monospace' }}>{fmt(cur)} / {fmt(dur)}</span>
                  <button style={ctl} onClick={toggleFs}>{isFs ? '✕' : '⛶'}</button>
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
              {topVerdict && <Badge color={VERDICT_STYLE[vk].color}>{topVerdict}</Badge>}
            </div>
            <div style={{ fontSize:11, color:'var(--t-2)', lineHeight:1.8 }}>
              <div>Errors: <b>{active.errorCount}</b> across <b>{active.halveCount}</b> halves</div>
              <div>Rate: <b>{active.rate?.toFixed(3)}</b> per half</div>
            </div>
            {Object.entries(active.verdict_counts || {}).length > 0 && (
              <>
                <div style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:0.6,
                  textTransform:'uppercase', margin:'12px 0 6px' }}>Verdict breakdown</div>
                {Object.entries(active.verdict_counts).sort((a,b)=>b[1]-a[1]).map(([v,c]) => (
                  <div key={v} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4 }}>
                    <Badge color={VERDICT_STYLE[verdictKind(v)].color}>{v}</Badge>
                    <span style={{ fontSize:11, color:'var(--t-2)' }}>{c}</span>
                  </div>
                ))}
              </>
            )}
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
