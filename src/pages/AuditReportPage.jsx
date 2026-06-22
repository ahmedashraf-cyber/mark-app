import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { formatHalf } from '../utils/half.js'

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const AMEND_META = {
  deletion: { label: 'Deleted',       color: '#FF453A' },
  extras:   { label: 'Extras fixed',  color: '#FFD60A' },
  base:     { label: 'Event changed', color: '#E8590C' },
  camera:   { label: 'Camera fixed',  color: '#BF5AF2' },
}

const DOT_COLORS = ['#E8590C','#0A84FF','#30D158','#FFD60A','#FF453A','#BF5AF2','#FF9F0A']

// ── Score ring (large) ─────────────────────────────────────────────────────────
function ScoreRing({ score, size = 140 }) {
  const r      = (size / 2) - 12
  const circ   = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  const color  = score >= 80 ? '#30D158' : score >= 60 ? '#FFD60A' : '#FF453A'
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--b-2)" strokeWidth="10"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transform:'rotate(-90deg)', transformOrigin:'50% 50%', transition:'stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <span style={{ fontFamily:'Inter', fontWeight:900, fontSize:size*0.22, color, lineHeight:1 }}>{score}</span>
        <span style={{ fontSize:9, color:'var(--t-3)', fontWeight:700, letterSpacing:1.5 }}>QUALITY</span>
      </div>
    </div>
  )
}

// ── Bar chart ──────────────────────────────────────────────────────────────────
function BarChart({ data, title, colorKey }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:12, padding:'16px 18px' }}>
      <div style={{ fontSize:10, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2, marginBottom:14 }}>{title}</div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {data.map((d, i) => (
          <div key={d.label}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={{ fontSize:11, color:'var(--t-2)', fontWeight:500 }}>{d.label}</span>
              <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color: colorKey ? (AMEND_META[colorKey]?.color || 'var(--p2)') : DOT_COLORS[i % DOT_COLORS.length], fontWeight:700 }}>{d.value}</span>
            </div>
            <div style={{ height:4, background:'var(--b-2)', borderRadius:2 }}>
              <div style={{
                height:'100%', borderRadius:2,
                width:`${(d.value/max)*100}%`,
                background: d.color || DOT_COLORS[i % DOT_COLORS.length],
                transition:'width 0.8s cubic-bezier(0.16,1,0.3,1)',
                boxShadow:`0 0 6px ${d.color || DOT_COLORS[i % DOT_COLORS.length]}44`,
              }}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Donut chart ────────────────────────────────────────────────────────────────
function DonutChart({ data, title }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return null

  let cumulative = 0
  const size = 140
  const r    = 54
  const cx   = size / 2
  const cy   = size / 2

  const slices = data.map(d => {
    const pct   = d.value / total
    const start = cumulative
    cumulative += pct
    return { ...d, startPct: start, endPct: cumulative }
  })

  function describeArc(startPct, endPct) {
    const startAngle = startPct * 2 * Math.PI - Math.PI / 2
    const endAngle   = endPct   * 2 * Math.PI - Math.PI / 2
    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const large = endPct - startPct > 0.5 ? 1 : 0
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
  }

  return (
    <div style={{ background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:12, padding:'16px 18px' }}>
      <div style={{ fontSize:10, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2, marginBottom:14 }}>{title}</div>
      <div style={{ display:'flex', alignItems:'center', gap:20 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink:0 }}>
          {slices.map((s, i) => (
            <path key={i} d={describeArc(s.startPct, s.endPct)}
              fill={s.color} opacity={0.85}
              style={{ transition:'opacity .2s' }}
            />
          ))}
          <circle cx={cx} cy={cy} r={r*0.6} fill="var(--bg-2)"/>
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
            style={{ fontFamily:'Inter', fontWeight:900, fontSize:18, fill:'var(--t-1)' }}>{total}</text>
        </svg>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {slices.map((s, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:7 }}>
              <div style={{ width:8, height:8, borderRadius:2, background:s.color, flexShrink:0 }}/>
              <span style={{ fontSize:11, color:'var(--t-2)' }}>{s.label}</span>
              <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color:s.color, fontWeight:700, marginLeft:'auto', paddingLeft:8 }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Timeline heatmap ───────────────────────────────────────────────────────────
function TimelineHeatmap({ baseEvents, amendments, videoTime }) {
  const BUCKETS = 10
  const bucketSize = videoTime / BUCKETS

  const editedKeys = new Set(amendments.map(a => a.key))
  const buckets = Array.from({ length: BUCKETS }, (_, i) => ({ idx:i, total:0, edited:0 }))

  baseEvents.forEach(e => {
    const tsSeconds = (e.videoTimestamp || 0) / 1000
    const bi = Math.min(Math.floor(tsSeconds / bucketSize), BUCKETS - 1)
    if (bi >= 0) {
      buckets[bi].total++
      if (editedKeys.has(e.key)) buckets[bi].edited++
    }
  })

  const maxEdited = Math.max(...buckets.map(b => b.edited), 1)

  return (
    <div style={{ background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:12, padding:'16px 18px' }}>
      <div style={{ fontSize:10, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2, marginBottom:14 }}>ERROR DISTRIBUTION OVER TIME</div>
      <div style={{ display:'flex', gap:4, alignItems:'flex-end', height:60 }}>
        {buckets.map((b, i) => {
          const pct = b.edited / maxEdited
          const color = pct > 0.6 ? '#FF453A' : pct > 0.3 ? '#FFD60A' : pct > 0 ? '#E8590C' : 'var(--b-2)'
          return (
            <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
              <div style={{
                width:'100%', borderRadius:3,
                height: Math.max(4, pct * 52),
                background: color,
                transition:'height .8s cubic-bezier(0.16,1,0.3,1)',
                boxShadow: pct > 0 ? `0 0 6px ${color}44` : 'none',
              }}/>
              <span style={{ fontSize:8, color:'var(--t-3)', fontFamily:'JetBrains Mono, monospace' }}>
                {fmt(i * bucketSize)}
              </span>
            </div>
          )
        })}
      </div>
      <div style={{ display:'flex', gap:12, marginTop:8 }}>
        {[['#FF453A','High'],['#FFD60A','Medium'],['#E8590C','Low'],['var(--b-2)','None']].map(([c,l]) => (
          <div key={l} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div style={{ width:8, height:8, borderRadius:2, background:c }}/>
            <span style={{ fontSize:9, color:'var(--t-3)' }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Events table ───────────────────────────────────────────────────────────────
function EventsTable({ baseEvents, amendments }) {
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('time')

  const editedKeys  = new Set(amendments.map(a => a.key))
  const amendByKey  = {}
  amendments.forEach(a => {
    if (!amendByKey[a.key]) amendByKey[a.key] = []
    amendByKey[a.key].push(a)
  })

  let rows = baseEvents.map(e => ({
    ...e,
    edited: editedKeys.has(e.key),
    amendTypes: (amendByKey[e.key] || []).map(a => a.type),
  }))

  if (filter === 'edited')   rows = rows.filter(r => r.edited)
  if (filter === 'clean')    rows = rows.filter(r => !r.edited)

  if (sortBy === 'time')     rows.sort((a, b) => (a.videoTimestamp||0) - (b.videoTimestamp||0))
  if (sortBy === 'name')     rows.sort((a, b) => (a.name||'').localeCompare(b.name||''))
  if (sortBy === 'edited')   rows.sort((a, b) => b.edited - a.edited)

  return (
    <div>
      {/* Controls */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
        <span style={{ fontSize:10, fontWeight:800, color:'var(--t-3)', letterSpacing:1, marginRight:4 }}>FILTER</span>
        {[['all','All events'],['edited','Edited only'],['clean','Clean only']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)} style={{
            padding:'4px 10px', borderRadius:6, fontSize:11, cursor:'pointer', fontWeight:600,
            border:`1px solid ${filter===v?'var(--p2)':'var(--b-2)'}`,
            background: filter===v ? 'rgba(232,89,12,0.12)' : 'transparent',
            color: filter===v ? 'var(--p2)' : 'var(--t-3)',
            transition:'all .15s',
          }}>{l}</button>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:10, fontWeight:800, color:'var(--t-3)', letterSpacing:1 }}>SORT</span>
          {[['time','Time'],['name','Name'],['edited','Edited first']].map(([v,l]) => (
            <button key={v} onClick={() => setSortBy(v)} style={{
              padding:'4px 10px', borderRadius:6, fontSize:11, cursor:'pointer', fontWeight:600,
              border:`1px solid ${sortBy===v?'var(--p2)':'var(--b-2)'}`,
              background: sortBy===v ? 'rgba(232,89,12,0.12)' : 'transparent',
              color: sortBy===v ? 'var(--p2)' : 'var(--t-3)',
              transition:'all .15s',
            }}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize:11, color:'var(--t-3)', marginLeft:8 }}>{rows.length} events</span>
      </div>

      {/* Table */}
      <div style={{ borderRadius:10, border:'1px solid var(--b-1)', overflow:'hidden' }}>
        {/* Header */}
        <div style={{
          display:'grid', gridTemplateColumns:'70px 1fr 80px 120px',
          padding:'8px 14px', background:'var(--bg-3)',
          borderBottom:'1px solid var(--b-1)',
        }}>
          {['TIME','EVENT','TEAM','AMENDMENT'].map(h => (
            <span key={h} style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2 }}>{h}</span>
          ))}
        </div>

        {/* Rows */}
        <div style={{ maxHeight:340, overflowY:'auto' }}>
          {rows.length === 0 ? (
            <div style={{ padding:'24px', textAlign:'center', color:'var(--t-3)', fontSize:12 }}>No events</div>
          ) : rows.map((r, i) => (
            <div key={r.id || i} style={{
              display:'grid', gridTemplateColumns:'70px 1fr 80px 120px',
              padding:'8px 14px',
              borderBottom:'1px solid var(--b-1)',
              background: r.edited ? 'rgba(255,69,58,0.03)' : 'transparent',
              borderLeft: r.edited ? '2px solid rgba(255,69,58,0.4)' : '2px solid transparent',
              transition:'background .1s',
            }}>
              <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color:'var(--p2)' }}>
                {fmt((r.videoTimestamp||0)/1000)}
              </span>
              <span style={{ fontSize:11, color:'var(--t-1)', fontWeight: r.edited ? 600 : 400 }}>
                {r.name || '—'}
              </span>
              <span style={{ fontSize:10, color:'var(--t-3)' }}>
                {r.teamId || '—'}
              </span>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                {r.amendTypes.map((t, j) => {
                  const m = AMEND_META[t] || { label:t, color:'var(--t-3)' }
                  return (
                    <span key={j} style={{
                      fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:4,
                      background:`${m.color}14`, color:m.color, border:`1px solid ${m.color}30`,
                    }}>{m.label}</span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Export CSV ─────────────────────────────────────────────────────────────────
async function exportAuditCSV(results, score, session) {
  const editedKeys = new Set(results.amendments.map(a => a.key))
  const amendByKey = {}
  results.amendments.forEach(a => {
    if (!amendByKey[a.key]) amendByKey[a.key] = []
    amendByKey[a.key].push(a)
  })

  const rows = [
    ['Match', 'Half', 'Quality Score', 'Total Events', 'Edited Events', 'Reviewed Until'],
    [session.matchName, session.half, `${score}%`, results.baseEvents.length,
      new Set(results.amendments.map(a=>a.key)).size, fmt(results.videoTime)],
    [],
    ['Timestamp', 'Event Name', 'Team ID', 'Edited', 'Amendment Types'],
    ...results.baseEvents.map(e => [
      fmt((e.videoTimestamp||0)/1000),
      e.name || '',
      e.teamId || '',
      editedKeys.has(e.key) ? 'Yes' : 'No',
      (amendByKey[e.key]||[]).map(a=>a.type).join(', '),
    ])
  ]

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `audit_${session.matchId}_${session.half}_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Main AuditReportPage ───────────────────────────────────────────────────────
export default function AuditReportPage({ results, score, session, onBack }) {
  const [tab, setTab] = useState('overview') // 'overview' | 'events'

  const uniqueEdited = new Set(results.amendments.map(a => a.key)).size
  const total        = results.baseEvents.length

  // Amendment type breakdown
  const typeData = Object.entries(
    results.amendments.reduce((acc, a) => { acc[a.type] = (acc[a.type]||0)+1; return acc }, {})
  ).map(([type, value]) => ({
    label: AMEND_META[type]?.label || type,
    value,
    color: AMEND_META[type]?.color || 'var(--t-3)',
  }))

  // Event name breakdown (top edited events)
  const eventEditCounts = {}
  results.amendments.forEach(a => {
    const name = a.originalName || 'Unknown'
    eventEditCounts[name] = (eventEditCounts[name]||0)+1
  })
  const eventData = Object.entries(eventEditCounts)
    .sort((a,b) => b[1]-a[1]).slice(0,8)
    .map(([label,value],i) => ({ label, value, color: DOT_COLORS[i%DOT_COLORS.length] }))

  // Team breakdown
  const teamCounts = {}
  results.baseEvents.forEach(e => {
    if (!new Set(results.amendments.map(a=>a.key)).has(e.key)) return
    const team = String(e.teamId || 'Unknown')
    teamCounts[team] = (teamCounts[team]||0)+1
  })
  const teamData = Object.entries(teamCounts).map(([label,value],i) => ({
    label, value, color: i===0 ? '#0A84FF' : '#FF453A'
  }))

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:'var(--bg)', overflow:'hidden' }}>

      {/* ── Top bar ── */}
      <header style={{
        flexShrink:0, height:52,
        background:'var(--bg-2)', borderBottom:'1px solid var(--b-1)',
        display:'flex', alignItems:'center', padding:'0 16px', gap:12,
      }}>
        <button className="btn-ghost" style={{ padding:'5px 12px', fontSize:12 }} onClick={onBack}>
          ← Back
        </button>
        <div style={{ width:1, height:16, background:'var(--b-2)' }}/>
        <div style={{ flex:1 }}>
          <span style={{ fontFamily:'Inter', fontWeight:800, fontSize:14, color:'var(--t-1)' }}>
            Audit Report
          </span>
          <span style={{ fontSize:11, color:'var(--t-3)', marginLeft:10 }}>
            {session.matchName} · {formatHalf(session.half)}
          </span>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:4 }}>
          {[['overview','Overview'],['events','Events table']].map(([v,l]) => (
            <button key={v} onClick={() => setTab(v)} style={{
              padding:'5px 14px', borderRadius:6, fontSize:12, cursor:'pointer', fontWeight:600,
              border:`1px solid ${tab===v?'var(--p2)':'var(--b-1)'}`,
              background: tab===v ? 'rgba(232,89,12,0.12)' : 'transparent',
              color: tab===v ? 'var(--p2)' : 'var(--t-3)',
              transition:'all .15s',
            }}>{l}</button>
          ))}
        </div>

        {/* Export */}
        <button className="btn-ghost" style={{ padding:'5px 14px', fontSize:12, display:'flex', alignItems:'center', gap:6 }}
          onClick={() => exportAuditCSV(results, score, session)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 3v13M6 11l6 6 6-6"/><path d="M4 20h16"/>
          </svg>
          Export CSV
        </button>
      </header>

      {/* ── Content ── */}
      <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>

        {tab === 'overview' && (
          <div className="fade-in">

            {/* Header summary row */}
            <div style={{ display:'flex', gap:16, marginBottom:20, alignItems:'stretch' }}>

              {/* Score + key stats */}
              <div style={{
                background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:14,
                padding:'20px 24px', display:'flex', gap:24, alignItems:'center', flex:1,
              }}>
                <ScoreRing score={score} size={130}/>
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  {[
                    { label:'EVENTS REVIEWED', value:total,           color:'var(--t-1)' },
                    { label:'EDITS MADE',       value:uniqueEdited,   color:'#FF453A' },
                    { label:'CLEAN EVENTS',     value:total-uniqueEdited, color:'#30D158' },
                    { label:'REVIEWED UNTIL',   value:fmt(results.videoTime), color:'var(--p2)' },
                  ].map(s => (
                    <div key={s.label} style={{ display:'flex', flexDirection:'column' }}>
                      <span style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2 }}>{s.label}</span>
                      <span style={{ fontFamily:'Inter', fontWeight:800, fontSize:20, color:s.color, lineHeight:1.1 }}>{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Session info */}
              <div style={{
                background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:14,
                padding:'20px 24px', minWidth:220,
              }}>
                <div style={{ fontSize:10, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2, marginBottom:14 }}>SESSION INFO</div>
                {[
                  { label:'Match',    value:session.matchName },
                  { label:'Half',     value:formatHalf(session.half) },
                  { label:'Match ID', value:session.matchId },
                  { label:'Collector ID', value:String(results.collectorId||'—') },
                  { label:'Reviewer ID',  value:String(results.reviewerId||'—') },
                ].map(r => (
                  <div key={r.label} style={{ marginBottom:8 }}>
                    <div style={{ fontSize:9, color:'var(--t-3)', fontWeight:700, letterSpacing:0.5 }}>{r.label}</div>
                    <div style={{ fontSize:12, color:'var(--t-1)', fontWeight:600, marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Charts grid */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              <DonutChart
                title="AMENDMENT TYPE BREAKDOWN"
                data={typeData}
              />
              <BarChart
                title="TOP EDITED EVENT TYPES"
                data={eventData}
              />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              <BarChart
                title="EDITS BY TEAM"
                data={teamData}
              />
              <TimelineHeatmap
                baseEvents={results.baseEvents}
                amendments={results.amendments}
                videoTime={results.videoTime}
              />
            </div>
          </div>
        )}

        {tab === 'events' && (
          <div className="fade-in">
            <EventsTable baseEvents={results.baseEvents} amendments={results.amendments}/>
          </div>
        )}
      </div>
    </div>
  )
}
