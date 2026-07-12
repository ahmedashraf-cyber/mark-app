import { useState, useRef, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { db } from '../firebase/config'
import { collection, addDoc, serverTimestamp, getDocs, query, where, deleteDoc, doc } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { useSync } from '../hooks/useSync.js'
import { formatHalf } from '../utils/half.js'
import { loadRoster, saveIdentities, buildIdentityMap, formatPerson, formatPeople } from '../data/roster.js'
import { SPEED_MIN, SPEED_MAX, SPEED_STEP } from '../data/shortcuts'

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// ── Bridge status pill ─────────────────────────────────────────────────────────
function BridgePill({ status }) {
  const connected = status === 'connected'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 20,
      background: connected ? 'rgba(48,209,88,0.1)' : 'rgba(255,255,255,0.05)',
      border: `1px solid ${connected ? 'rgba(48,209,88,0.3)' : 'rgba(255,255,255,0.1)'}`,
      transition: 'all .3s',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: connected ? '#30D158' : 'var(--t-3)',
        boxShadow: connected ? '0 0 6px rgba(48,209,88,0.6)' : 'none',
        transition: 'all .3s',
      }}/>
      <span style={{ fontSize: 11, fontWeight: 600, color: connected ? '#30D158' : 'var(--t-3)', fontFamily: 'DM Sans' }}>
        {connected ? 'Bridge connected' : 'Bridge disconnected'}
      </span>
    </div>
  )
}

// ── Score ring ─────────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 120 }) {
  const r     = (size / 2) - 10
  const circ  = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  const color = score >= 80 ? '#30D158' : score >= 60 ? '#FFD60A' : '#FF453A'

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--b-2)" strokeWidth="8"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontFamily: 'Inter', fontWeight: 900, fontSize: size * 0.22, color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 9, color: 'var(--t-3)', fontWeight: 700, letterSpacing: 1.5 }}>QUALITY</span>
      </div>
    </div>
  )
}

// ── Amendment type badge ───────────────────────────────────────────────────────
const AMEND_META = {
  deletion: { label: 'Deleted',       color: '#FF453A', icon: '✕' },
  extras:   { label: 'Extras fixed',  color: '#FFD60A', icon: '◈' },
  base:     { label: 'Event changed', color: '#E8590C', icon: '⟳' },
  camera:   { label: 'Camera fixed',  color: '#BF5AF2', icon: '⊙' },
}
function AmendBadge({ type }) {
  const m = AMEND_META[type] || { label: type, color: 'var(--t-3)', icon: '•' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
      background: `${m.color}14`, color: m.color, border: `1px solid ${m.color}33`,
      fontFamily: 'DM Sans',
    }}>{m.icon} {m.label}</span>
  )
}

// ── Mini score card ───────────────────────────────────────────────────────────
// ── Score card (equal size for all 4) ─────────────────────────────────────────
function ScoreCard({ label, score, reviewed, edited, color, isOverall = false }) {
  const displayColor = isOverall
    ? (score >= 80 ? '#30D158' : score >= 60 ? '#FFD60A' : '#FF453A')
    : color

  const pct = score !== null ? score : 0
  const r = 36
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ

  return (
    <div style={{
      flex: 1,
      background: 'var(--bg-3)',
      border: `1px solid ${score !== null ? displayColor + '30' : 'var(--b-1)'}`,
      borderRadius: 14,
      padding: '18px 16px 16px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      boxShadow: score !== null ? `0 4px 20px ${displayColor}0D` : 'none',
      opacity: score === null ? 0.4 : 1,
      transition: 'all .3s var(--ease-out-expo)',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Subtle glow accent top */}
      {score !== null && (
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '60%', height: 2, borderRadius: 2,
          background: `linear-gradient(90deg, transparent, ${displayColor}, transparent)`,
        }}/>
      )}

      {/* Label */}
      <div style={{ fontSize: 9, fontWeight: 800, color: displayColor, letterSpacing: 1.5, textTransform: 'uppercase' }}>
        {label}
      </div>

      {/* Ring */}
      <div style={{ position: 'relative', width: 88, height: 88 }}>
        <svg width="88" height="88" viewBox="0 0 88 88">
          <circle cx="44" cy="44" r={r} fill="none" stroke="var(--b-2)" strokeWidth="7"/>
          {score !== null && (
            <circle cx="44" cy="44" r={r} fill="none"
              stroke={displayColor} strokeWidth="7"
              strokeDasharray={circ} strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%',
                transition: 'stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)' }}
            />
          )}
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'Inter', fontWeight: 900, fontSize: 20, color: displayColor, lineHeight: 1 }}>
            {score !== null ? score : '—'}
          </span>
          {score !== null && <span style={{ fontSize: 8, color: 'var(--t-3)', fontWeight: 700, letterSpacing: 1 }}>%</span>}
        </div>
      </div>

      {/* Stats */}
      {score !== null && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: '#FF453A', lineHeight: 1 }}>{edited}</div>
            <div style={{ fontSize: 8, color: 'var(--t-3)', fontWeight: 600, letterSpacing: 0.8, marginTop: 2 }}>EDITED</div>
          </div>
          <div style={{ width: 1, height: 24, background: 'var(--b-2)' }}/>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: 'var(--t-2)', lineHeight: 1 }}>{reviewed}</div>
            <div style={{ fontSize: 8, color: 'var(--t-3)', fontWeight: 600, letterSpacing: 0.8, marginTop: 2 }}>REVIEWED</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Quick summary card ─────────────────────────────────────────────────────────
// ── ExistingSessionView — full results display from Sheet data ────────────────
// Shown when a reviewer navigates to a match that was already audited.
// Reads from the Events tab of the collector Sheet — no Firestore reads.
// Supports click-to-seek by video timestamp, filter pills, download CSV.
function ExistingSessionView({ session, onSeek }) {
  const [activeFilter, setActiveFilter] = useState(null)

  const AMEND_COLORS = {
    base:'#E8590C', deletion:'#FF453A', extras:'#FFD60A',
    location:'#0A84FF', players:'#30D158', camera:'#BF5AF2',
    added:'#30D158', 'freeze-frame':'#AC8CFF', impact:'#FF9F0A',
    'goal-location':'#0A84FF',
    // label variants
    Base:'#E8590C', Extra:'#FFD60A', Location:'#0A84FF', Players:'#30D158',
    Added:'#30D158', Deleted:'#FF453A', Wrong:'#FF9F0A',
  }
  const scoreColor = s => s == null ? 'var(--t-3)' : s >= 90 ? '#30D158' : s >= 80 ? '#FFD60A' : '#FF453A'

  // Parse amendments from Events tab rows: [hrCode,sessionId,matchId,matchName,half,completedAt,eventName,errorType,amendmentId,videoTs,markVersion]
  const EVT = { HR:0, SID:1, MID:2, MNAME:3, HALF:4, CAT:5, ENAME:6, ETYPE:7, AID:8, VTS:9, VER:10 }
  const rows = (session.amendments || []).map((a, i) => {
    const eventName = a[EVT.ENAME] || '—'
    const errorType = a[EVT.ETYPE] || '—'
    const vts       = a[EVT.VTS] ? parseFloat(a[EVT.VTS]) : null
    const ASPECT_OF = { base:'Base', camera:'Base', extras:'Extra', location:'Location', players:'Players', deletion:'Base', added:'Base', 'freeze-frame':'Freeze Frame', impact:'Impact', 'goal-location':'Location' }
    const aspect    = ASPECT_OF[errorType] || errorType
    const editType  = errorType === 'deletion' ? 'Deleted' : errorType === 'added' ? 'Added' : 'Wrong'
    return { i, eventName, errorType, aspect, editType, vts, half: a[EVT.HALF] }
  }).sort((a, b) => (a.vts || 0) - (b.vts || 0))

  const presentTypes = [...new Set(rows.flatMap(r => [r.aspect, r.editType]))].filter(Boolean).sort()
  const visible = activeFilter
    ? rows.filter(r => r.aspect === activeFilter || r.editType === activeFilter || r.errorType === activeFilter)
    : rows

  // Error type totals for the badge bar
  const typeCounts = {}
  rows.forEach(r => { typeCounts[r.errorType] = (typeCounts[r.errorType] || 0) + 1 })

  function fmtTs(sec) {
    if (sec == null || !isFinite(sec)) return '—'
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
    return `${m}:${String(s).padStart(2,'0')}`
  }

  function downloadCSV() {
    const headers = ['Half','Timestamp','Event Name','Error Type']
    const csvRows = rows.map(r => [r.half, fmtTs(r.vts), r.eventName, r.errorType])
    const csv = [headers,...csvRows].map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = `${session.matchId || 'match'}_amendments.csv`
    a.click()
  }

  return (
    <div className="scale-in" style={{ padding:'0 16px 16px' }}>

      {/* ── Score card bar ── */}
      <div style={{ background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:16, padding:16, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', marginBottom:14 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14 }}>
          <div style={{ background:'var(--bg-3)', border:'1px solid var(--b-1)', borderRadius:12, padding:'14px 10px', textAlign:'center' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8, marginBottom:6 }}>OVERALL</div>
            <div style={{ fontFamily:'Inter', fontWeight:900, fontSize:28, color:scoreColor(session.score), lineHeight:1 }}>
              {session.score != null ? session.score : '—'}<span style={{ fontSize:14 }}>%</span>
            </div>
            <div style={{ fontSize:10, color:'var(--t-3)', marginTop:5 }}>{session.totalErrors} err / {session.totalEvents}</div>
            <div style={{ marginTop:7, height:3, borderRadius:2, background:'var(--b-1)', overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${session.score||0}%`, background:scoreColor(session.score), borderRadius:2 }}/>
            </div>
          </div>
          <div style={{ background:'var(--bg-3)', border:'1px solid var(--b-1)', borderRadius:12, padding:'14px 10px', textAlign:'center' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8, marginBottom:6 }}>TOTAL EVENTS</div>
            <div style={{ fontFamily:'Inter', fontWeight:900, fontSize:28, color:'var(--t-1)', lineHeight:1 }}>{session.totalEvents}</div>
            <div style={{ fontSize:10, color:'var(--t-3)', marginTop:5 }}>reviewed</div>
          </div>
          <div style={{ background:'var(--bg-3)', border:'1px solid var(--b-1)', borderRadius:12, padding:'14px 10px', textAlign:'center' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8, marginBottom:6 }}>ERRORS</div>
            <div style={{ fontFamily:'Inter', fontWeight:900, fontSize:28, color:'#FF453A', lineHeight:1 }}>{session.totalErrors}</div>
            <div style={{ fontSize:10, color:'var(--t-3)', marginTop:5 }}>{rows.length} amendments</div>
          </div>
        </div>

        {/* Stats + badges row */}
        <div style={{ display:'flex', alignItems:'center', gap:16, padding:'10px 12px', background:'var(--bg-3)', borderRadius:10, border:'1px solid var(--b-1)', flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
            <span style={{ fontFamily:'Inter', fontWeight:900, fontSize:16, color:'var(--t-1)' }}>{session.totalEvents}</span>
            <span style={{ fontSize:9, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8 }}>REVIEWED</span>
          </div>
          <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
            <span style={{ fontFamily:'Inter', fontWeight:900, fontSize:16, color:'#FF453A' }}>{session.totalErrors}</span>
            <span style={{ fontSize:9, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8 }}>ERRORS</span>
          </div>
          <div style={{ width:1, height:20, background:'var(--b-2)' }}/>
          <div style={{ display:'flex', gap:5, flexWrap:'wrap', flex:1 }}>
            {Object.entries(typeCounts).map(([type, count]) => (
              <span key={type} style={{ display:'flex', alignItems:'center', gap:3 }}>
                <AmendBadge type={type}/>
                <span style={{ fontSize:10, color:'var(--t-3)' }}>×{count}</span>
              </span>
            ))}
          </div>
          <div style={{ fontSize:11, color:'var(--t-3)' }}>
            {session.reviewer ? `by ${session.reviewer.split('@')[0]}` : ''}
            {' · '}{session.completedAt ? new Date(session.completedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : ''}
          </div>
        </div>
      </div>

      {/* ── Amendments table ── */}
      {rows.length > 0 && (
        <div className="fade-in" style={{ marginTop:4 }}>
          {/* Header */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <div style={{ fontSize:10, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2 }}>
              AMENDMENTS — {rows.length} EVENTS · CLICK ROW TO SEEK VIDEO
            </div>
            <button className="btn-ghost" style={{ padding:'4px 12px', fontSize:11, display:'flex', alignItems:'center', gap:6 }} onClick={downloadCSV}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 3v13M6 11l6 6 6-6"/><path d="M4 20h16"/>
              </svg>
              Download CSV
            </button>
          </div>

          {/* Filter pills */}
          {presentTypes.length > 1 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10, alignItems:'center' }}>
              <span style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:1, marginRight:2 }}>FILTER</span>
              <button onClick={() => setActiveFilter(null)} style={{ fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:6, cursor:'pointer', background:activeFilter===null?'var(--p2)':'transparent', color:activeFilter===null?'#fff':'var(--t-3)', border:`1px solid ${activeFilter===null?'var(--p2)':'var(--b-2)'}` }}>All ({rows.length})</button>
              {[...new Set(rows.map(r=>r.errorType))].sort().map(t => {
                const count = rows.filter(r=>r.errorType===t).length
                const col = AMEND_COLORS[t] || 'var(--t-3)'
                const on = activeFilter===t
                return (
                  <button key={t} onClick={()=>setActiveFilter(on?null:t)} style={{ fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:6, cursor:'pointer', background:on?col:`${col}14`, color:on?'#fff':col, border:`1px solid ${on?col:col+'40'}` }}>
                    {t} ({count})
                  </button>
                )
              })}
            </div>
          )}

          {/* Table */}
          <div style={{ borderRadius:10, border:'1px solid var(--b-1)', overflow:'hidden' }}>
            {/* Header */}
            <div style={{ display:'grid', gridTemplateColumns:'60px 1fr 110px 80px', padding:'7px 14px', background:'var(--bg-3)', borderBottom:'1px solid var(--b-1)' }}>
              {['TIME','EVENT NAME','ERROR TYPE','SEEK'].map(h=>(
                <span key={h} style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:1 }}>{h}</span>
              ))}
            </div>
            {/* Rows */}
            <div style={{ maxHeight:340, overflowY:'auto' }}>
              {visible.map((r, idx) => {
                const seekable = r.vts != null && typeof onSeek === 'function'
                const col = AMEND_COLORS[r.errorType] || 'var(--t-3)'
                return (
                  <div key={idx}
                    onClick={() => seekable && onSeek(r.vts)}
                    style={{
                      display:'grid', gridTemplateColumns:'60px 1fr 110px 80px',
                      padding:'8px 14px', borderBottom:'1px solid var(--b-1)',
                      cursor: seekable ? 'pointer' : 'default',
                      transition:'background .1s',
                    }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.04)'}
                    onMouseLeave={e=>e.currentTarget.style.background=''}
                  >
                    <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--p2)', fontWeight:600 }}>{fmtTs(r.vts)}</span>
                    <span style={{ fontSize:12, color:'var(--t-1)', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.eventName}</span>
                    <span>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:5, background:`${col}18`, color:col, border:`1px solid ${col}40` }}>{r.errorType}</span>
                    </span>
                    <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                      {seekable ? (
                        <span style={{ fontSize:10, color:'var(--p2)', display:'flex', alignItems:'center', gap:3 }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <polygon points="5,3 19,12 5,21"/>
                          </svg>
                          Play
                        </span>
                      ) : <span style={{ fontSize:10, color:'var(--t-3)' }}>—</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize:11, color:'var(--t-3)', marginTop:10, textAlign:'center' }}>
        Data loaded from Sheet · {rows.length} amendment rows · Click <strong style={{ color:'var(--p2)' }}>Re-audit Match</strong> to run a fresh audit
      </div>
    </div>
  )
}

function QuickSummary({ results, score, abcScores, onFullReport }) {
  const types = {}
  results.amendments.forEach(a => { types[a.type] = (types[a.type] || 0) + 1 })
  const uniqueEdited = computeErrorKeys(results.baseEvents, results.amendments, results.reviewerIds).size

  return (
    <div className="scale-in" style={{
      background: 'var(--bg-2)', border: '1px solid var(--b-1)',
      borderRadius: 16, padding: '16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      {/* 4 equal score cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
        <ScoreCard label="Overall" score={score} reviewed={results.baseEvents.length} edited={uniqueEdited} color="var(--p2)" isOverall/>
        <ScoreCard label="A - Review" score={abcScores?.A?.score ?? null} reviewed={abcScores?.A?.reviewed ?? 0} edited={abcScores?.A?.edited ?? 0} color="#0A84FF"/>
        <ScoreCard label="B - Review" score={abcScores?.B?.score ?? null} reviewed={abcScores?.B?.reviewed ?? 0} edited={abcScores?.B?.edited ?? 0} color="#30D158"/>
        <ScoreCard label="C - Review" score={abcScores?.C?.score ?? null} reviewed={abcScores?.C?.reviewed ?? 0} edited={abcScores?.C?.edited ?? 0} color="#FFD60A"/>
      </div>

      {/* Bottom: stats + badges + full report */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '10px 12px',
        background: 'var(--bg-3)', borderRadius: 10,
        border: '1px solid var(--b-1)',
      }}>
        {[
          { label: 'REVIEWED', value: results.baseEvents.length, color: 'var(--t-1)' },
          { label: 'ERRORS',   value: uniqueEdited,              color: '#FF453A' },
          { label: 'UP TO',    value: fmt(results.videoTime),     color: 'var(--p2)' },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ fontFamily: 'Inter', fontWeight: 900, fontSize: 16, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--t-3)', letterSpacing: 0.8 }}>{s.label}</span>
          </div>
        ))}
        <div style={{ width: 1, height: 20, background: 'var(--b-2)', marginLeft: 4 }}/>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1 }}>
          {Object.entries(types).map(([type, count]) => (
            <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <AmendBadge type={type}/>
              <span style={{ fontSize: 10, color: 'var(--t-3)' }}>×{count}</span>
            </span>
          ))}
        </div>
        <button className="btn-orange" style={{ padding: '8px 18px', fontSize: 12, flexShrink: 0 }} onClick={onFullReport}>
          Full Report →
        </button>
      </div>
    </div>
  )
}

// ── A/B/C Review group definitions ────────────────────────────────────────────
const REVIEW_GROUPS = {
  A: {
    label: 'A - Review',
    color: '#0A84FF',
    match: (e, extras) => {
      const n = e.name
      const t = e.fields?.type || ''
      if (['shot','own-goal-against','foul-committed','error','stoppage',
           'end-stoppage','referee-ball-drop','end-shot','starting-xi',
           'substitution','out','tactical-shift','player-off','player-on',
           'card','offside','freeze-frame','shield'].includes(n)) return true
      if (n === 'pass' && t !== 'recovery') return true
      if (n === 'goal-keeper' && ['save','conceded-no-save'].includes(t)) return true
      return false
    }
  },
  B: {
    label: 'B - Review',
    color: '#30D158',
    match: (e, extras) => {
      const n = e.name
      const t = e.fields?.type || ''
      if (['clearance','interception','block','dribble','tackle',
           'miscontrol','fifty-fifty'].includes(n)) return true
      if (n === 'pass' && t === 'recovery') return true
      if (n === 'goal-keeper' && !['save','conceded-no-save'].includes(t)) return true
      return false
    }
  },
  C: {
    label: 'C - Review',
    color: '#FFD60A',
    match: (e, extras) => {
      const n = e.name
      if (['ball-recovery','pressure-start','pressure-end'].includes(n)) return true
      // Aerial Losts — events with aerial-won in extras
      if (['pass','shot','clearance','miscontrol'].includes(n) && extras?.includes('aerial-won')) return true
      return false
    }
  }
}

function filterAmendments(amendments, reviewerIds) {
  // Count edits by ANY real reviewer (a match may be reviewed by more than one
  // person / re-reviewed later). Everyone else is a collector — including the
  // collector's own self-amendments — and is ignored. All edit types count.
  const set = new Set((reviewerIds || []).map(Number))
  if (set.size === 0) return []
  return amendments.filter(a => set.has(Number(a.author)))
}

// Error events = reviewed events where a reviewer made a change, counted once
// per event key:
//   • a reviewer EDIT or DELETION  → amendment authored by a reviewer, OR
//   • a reviewer-ADDED event       → the collector missed it; the base event
//                                     itself is authored by a reviewer.
// This Set is the numerator behind every score.
function computeErrorKeys(baseEvents, amendments, reviewerIds) {
  const set = new Set((reviewerIds || []).map(Number))
  const errs = new Set()
  if (set.size === 0) return errs
  ;(baseEvents || []).forEach(e => { if (set.has(Number(e.author))) errs.add(e.key) })
  ;(amendments || []).forEach(a => { if (set.has(Number(a.author))) errs.add(a.key) })
  return errs
}

function calcGroupScore(group, baseEvents, amendments, refinements, reviewerIds) {
  // Find base events belonging to this group
  const groupBase = baseEvents.filter(e => {
    const extras = refinements[e.key] || []
    return group.match(e, extras)
  })
  if (groupBase.length === 0) return { score: null, reviewed: 0, edited: 0 }

  const groupKeys = new Set(groupBase.map(e => e.key))
  const errorKeys = computeErrorKeys(
    groupBase,
    amendments.filter(a => groupKeys.has(a.key)),
    reviewerIds
  )
  const uniqueEdited = errorKeys.size
  const score = Math.round(((groupBase.length - uniqueEdited) / groupBase.length) * 100)
  return { score, reviewed: groupBase.length, edited: uniqueEdited }
}

// ── Per-event-type quality scores ───────────────────────────────────────────
// e.g. "pass" had 20 total occurrences in this match, 10 were wrong → 50%.
// Same numerator logic as calcGroupScore (computeErrorKeys), just grouped by
// the event's own name instead of a module group. This is the true quality
// score per event type — replaces the old "errors ÷ session count" rate,
// which could exceed 100% since one event type can have more errors than
// there are sessions.
function calcEventTypeScores(baseEvents, amendments, reviewerIds) {
  const byName = {}
  ;(baseEvents || []).forEach(e => {
    const name = e.name || 'unknown'
    if (!byName[name]) byName[name] = []
    byName[name].push(e)
  })
  const result = {}
  for (const [name, events] of Object.entries(byName)) {
    const keys = new Set(events.map(e => e.key))
    const relatedAmends = (amendments || []).filter(a => keys.has(a.key))
    const errorKeys = computeErrorKeys(events, relatedAmends, reviewerIds)
    const total = events.length
    const errors = errorKeys.size
    result[name] = {
      total,
      errors,
      score: total > 0 ? Math.round(((total - errors) / total) * 100) : null,
    }
  }
  return result
}

// ── Amendments Table ──────────────────────────────────────────────────────────
function ModuleScores({ moduleScores }) {
  if (!moduleScores) return null
  // Fixed display order; only show modules that have a denominator.
  const ORDER = ['base', 'pressure', 'players', 'location', 'extras', 'freeze-frame']
  const LABELS = { base:'Base', pressure:'Pressure', players:'Players', location:'Location', extras:'Extras', 'freeze-frame':'Freeze Frame' }
  const items = ORDER
    .map(k => ({ k, ...(moduleScores[k] || {}) }))
    .filter(m => m.total && m.total > 0 && m.score != null)
  if (!items.length) return null

  const colorFor = s => s >= 90 ? '#30D158' : s >= 75 ? '#FFD60A' : '#FF453A'

  return (
    <div className="fade-in" style={{ marginTop: 14 }}>
      <div style={{ fontSize:10, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2, marginBottom:10 }}>
        MODULE SCORES
      </div>
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${Math.min(items.length, 6)}, 1fr)`, gap:10 }}>
        {items.map(m => {
          const col = colorFor(m.score)
          return (
            <div key={m.k} style={{
              background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:12,
              padding:'12px 10px', textAlign:'center',
            }}>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.5, marginBottom:6, textTransform:'uppercase' }}>
                {LABELS[m.k] || m.k}
              </div>
              <div style={{ fontFamily:'Inter', fontWeight:800, fontSize:22, color:col, lineHeight:1 }}>
                {m.score.toFixed(1)}<span style={{ fontSize:12, fontWeight:700 }}>%</span>
              </div>
              <div style={{ fontSize:10, color:'var(--t-3)', marginTop:5 }}>
                {m.errors} err / {m.total}
              </div>
              {/* thin score bar */}
              <div style={{ marginTop:7, height:3, borderRadius:2, background:'var(--b-1)', overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${m.score}%`, background:col, borderRadius:2 }}/>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize:10, color:'var(--t-3)', marginTop:8, lineHeight:1.5 }}>
        Per-module quality of the collector's work, from the reviewer's edits. Denominator = reviewed events that have each module. An event can count in more than one module.
      </div>
    </div>
  )
}

function AmendmentsTable({ results, session, reviewerIds, identityMap, onSeek }) {
  const [activeFilter, setActiveFilter] = useState(null)
  const [expandedKey, setExpandedKey] = useState(null)
  const { baseEvents } = results
  const reviewerSet = new Set((reviewerIds || []).map(Number))

  // ── Identity map ───────────────────────────────────────────────────────────
  const idMap = identityMap || results.identityMap || {}
  const resolveIdentity = (authorId) => {
    const id = String(authorId)
    const entry = idMap[id]
    if (!entry) return { hrcode: `id:${authorId}`, name: '' }
    return { hrcode: entry.hrcode || entry.hrCode || id, name: entry.name || '' }
  }

  // ── Player map from lineupPlayers ──────────────────────────────────────────
  const playerMap = {}
  const teamMap = {}
  // Build from lineupPlayers array (bridge payload)
  ;(results.lineupPlayers || []).forEach(p => {
    playerMap[p.id] = { name: p.nickname || p.name || '', jersey: p.jersey, teamName: p.teamName || '', teamId: p.teamId }
    teamMap[p.teamId] = p.teamName || ''
    teamMap[String(p.teamId)] = p.teamName || ''
  })
  // Merge from lineupPlayerMap (pre-built in handleGetResults)
  Object.entries(results.lineupPlayerMap || {}).forEach(([id, p]) => {
    if (!playerMap[Number(id)]) playerMap[Number(id)] = { name: p.nickname || p.name || '', jersey: p.jersey, teamName: p.teamName || '', teamId: p.teamId }
    if (p.teamId) { teamMap[p.teamId] = p.teamName || ''; teamMap[String(p.teamId)] = p.teamName || '' }
  })
  // Also merge from results.teamMap directly
  Object.entries(results.teamMap || {}).forEach(([id, name]) => {
    teamMap[id] = name; teamMap[String(id)] = name
  })
  // Fallback: always also read from Apollo cache
  try {
    const apolloCache = window.apollo?.client?.cache?.extract() || {}
    const matchObj = Object.values(apolloCache).find(v => v.__typename === 'Match')
    const resolveRef = (ref) => ref?.__ref ? apolloCache[ref.__ref] : ref
    ;[resolveRef(matchObj?.home), resolveRef(matchObj?.away)].forEach(team => {
      if (!team?.players) return
      teamMap[team.id] = team.name || ''
      teamMap[String(team.id)] = team.name || ''
      ;(team.players || []).forEach(ref => {
        const p = resolveRef(ref)
        if (!p?.id) return
        playerMap[p.id] = { name: p.nickname || p.name || '', jersey: p.jersey_number, teamName: team.name || '', teamId: team.id }
      })
    })
  } catch(e) {}
  const resolvePlayer = (id) => {
    if (id == null) return null
    const p = playerMap[id]
    return p || { name: `id:${id}`, jersey: '?', teamName: '', teamId: null }
  }

  // ── Refinement map — from Apollo cache + stored results data ──────────────
  const refinementMap = {}
  // First load from stored results (survives Firebase restore)
  Object.entries(results.refinementData || {}).forEach(([k, v]) => { refinementMap[k] = v })
  // Then overlay from live Apollo cache (most accurate when match is open)
  try {
    const cache = window.apollo?.client?.cache?.extract() || {}
    Object.values(cache).forEach(v => {
      if (v.__typename === 'Event' && v.category === 'refinement') {
        const k = `${v.key}_${v.type}`
        refinementMap[k] = v.payload || {}
      }
    })
  } catch(e) {}

  // ── Base event lookup ──────────────────────────────────────────────────────
  const baseByKey = {}
  baseEvents.forEach(e => { baseByKey[e.key] = e })

  // ── Replacement map from handleGetResults ──────────────────────────────────
  const replacementMap = results.replacementMap || {}

  // ── Filter reviewer amendments only ───────────────────────────────────────
  const reviewerAmendments = (results.amendments || []).filter(a => reviewerSet.has(Number(a.author)))

  // ── Group amendments by key ───────────────────────────────────────────────
  const byKey = {}
  reviewerAmendments.forEach(a => {
    if (!byKey[a.key]) byKey[a.key] = []
    byKey[a.key].push(a)
  })

  // Include reviewer-added events (missed by collector)
  baseEvents.forEach(e => {
    if (reviewerSet.has(Number(e.author)) && !byKey[e.key]) {
      byKey[e.key] = [{ key: e.key, type: 'added', author: e.author, capturedTime: e.capturedTime, payload: {} }]
    }
  })

  // ── Error type classification ──────────────────────────────────────────────
  const classifyError = (key, amends) => {
    const types = [...new Set(amends.map(a => a.type))]
    const hasDeletion = types.includes('deletion')
    const replacement = replacementMap[key]

    if (hasDeletion && replacement) {
      return replacement.renamed ? 'rename' : 'replacement'
    }
    if (hasDeletion) return 'deletion'
    if (types.includes('freeze-frame')) return 'freeze-frame'
    if (types.includes('goal-location')) return 'goal-location'
    if (types.includes('squad')) return 'squad'
    if (types.includes('players')) return 'wrong-player'
    if (types.includes('location')) return 'wrong-location'
    if (types.includes('extras')) return 'wrong-extras'
    if (types.includes('base')) {
      const base = baseByKey[key]
      const baseAmend = amends.find(a => a.type === 'base')
      const tsChanged = baseAmend?.payload?.videoTimestamp != null && baseAmend.payload.videoTimestamp !== base?.videoTimestamp
      const nameChanged = baseAmend?.payload?.name && baseAmend.payload.name !== base?.name
      if (tsChanged && !nameChanged) return 'wrong-timestamp'
      return 'wrong-event'
    }
    if (types.includes('impact')) return 'wrong-extras'
    if (types.includes('added')) return 'added'
    return 'wrong-event'
  }

  // ── Module label ───────────────────────────────────────────────────────────
  const moduleOf = (errorType, types) => {
    const m = {
      'deletion': 'Base', 'rename': 'Base', 'replacement': 'Base',
      'wrong-event': 'Base', 'wrong-timestamp': 'Base', 'added': 'Base',
      'wrong-extras': 'Extras', 'wrong-location': 'Location',
      'wrong-player': 'Players', 'freeze-frame': 'Freeze Frame',
      'goal-location': 'Goal Location', 'squad': 'Squad',
    }
    return m[errorType] || 'Base'
  }

  // ── Player diff helper ─────────────────────────────────────────────────────
  const diffPlayers = (beforePlayers, afterPlayers) => {
    const roles = ['playerId', 'secondaryPlayerId', 'thirdPlayerId']
    const roleLabels = { playerId: 'Main', secondaryPlayerId: 'Secondary', thirdPlayerId: 'Third' }
    const allKeys = [...new Set([...Object.keys(beforePlayers || {}), ...Object.keys(afterPlayers || {})])]
    return allKeys.filter(k => roles.includes(k)).map(role => {
      const bId = beforePlayers?.[role]
      const aId = afterPlayers?.[role]
      const changed = bId !== aId
      const missing = bId == null && aId != null
      return {
        role: roleLabels[role] || role,
        before: bId != null ? resolvePlayer(bId) : null,
        after: aId != null ? resolvePlayer(aId) : null,
        changed,
        missing,
        removed: bId != null && aId == null,
      }
    })
  }

  // ── Freeze-frame diff ──────────────────────────────────────────────────────
  const diffFF = (refFF, amendFF) => {
    const beforePlayers = refFF?.players || []
    const afterPlayers = amendFF?.players || []
    const beforeRoles = refFF?.roles || {}
    const afterRoles = amendFF?.roles || {}
    const getP = (players, idx) => {
      if (idx == null) return null
      const p = players[idx]
      return p?.playerId ? resolvePlayer(p.playerId) : null
    }
    return {
      beforeKeeper: getP(beforePlayers, (beforeRoles.keeper||[])[0]),
      afterKeeper:  getP(afterPlayers,  (afterRoles.keeper||[])[0]),
      beforeShooter: getP(beforePlayers, (beforeRoles.shooter||[])[0]),
      afterShooter:  getP(afterPlayers,  (afterRoles.shooter||[])[0]),
      beforeReviewed: refFF?.locationsReviewed,
      afterReviewed:  amendFF?.locationsReviewed,
    }
  }

  // ── Format timestamp with milliseconds ────────────────────────────────────
  const fmtTs = (ms) => {
    if (ms == null) return '—'
    const totalSec = ms / 1000
    const min = Math.floor(totalSec / 60)
    const sec = Math.floor(totalSec % 60)
    const millis = Math.round(ms % 1000)
    return `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(millis).padStart(3,'0')}`
  }

  // ── Build rows ─────────────────────────────────────────────────────────────
  const rows = Object.entries(byKey).map(([key, amends]) => {
    const base = baseByKey[key]
    const errorType = classifyError(key, amends)
    const latestAmend = [...amends].sort((a,b) => (b.capturedTime||'').localeCompare(a.capturedTime||''))[0]
    const mainAmend = amends[0]
    const types = [...new Set(amends.map(a => a.type))]

    // Collector = base event author; Reviewer = amendment author
    const collectorId = base?.author
    const reviewerAuthorId = latestAmend?.author
    const collector = resolveIdentity(collectorId)
    const reviewer = resolveIdentity(reviewerAuthorId)
    const teamName = teamMap[base?.teamId] || teamMap[String(base?.teamId)] || teamMap[Number(base?.teamId)] || (base?.teamId ? `Team ${base.teamId}` : '—')

    // Build before/after structured data
    let before = null
    let after = null

    if (errorType === 'deletion') {
      before = { eventName: base?.name, ts: fmtTs(base?.videoTimestamp) }
      after = { deleted: true }
    } else if (errorType === 'rename') {
      const rep = replacementMap[key]
      const addedEvent = rep?.addedEvent
      before = { eventName: base?.name, ts: fmtTs(base?.videoTimestamp) }
      after = { eventName: addedEvent?.name, ts: fmtTs(addedEvent?.videoTimestamp) }
    } else if (errorType === 'replacement') {
      const rep = replacementMap[key]
      const addedEvent = rep?.addedEvent
      const addedKey = addedEvent?.key
      // Diff the refinements between old and new
      const oldExtras = refinementMap[`${key}_extras`]?.fields
      const newExtras = addedKey ? refinementMap[`${addedKey}_extras`]?.fields : null
      const oldLoc = refinementMap[`${key}_location`]?.location
      const newLoc = addedKey ? refinementMap[`${addedKey}_location`]?.location : null
      const oldPlayers = refinementMap[`${key}_players`]?.players
      const newPlayers = addedKey ? refinementMap[`${addedKey}_players`]?.players : null
      before = { eventName: base?.name, ts: fmtTs(base?.videoTimestamp), extras: oldExtras, location: oldLoc, players: oldPlayers }
      after = { eventName: addedEvent?.name, ts: fmtTs(addedEvent?.videoTimestamp), extras: newExtras, location: newLoc, players: newPlayers }
    } else if (errorType === 'wrong-extras') {
      const refKey = `${key}_extras`
      const impactKey = `${key}_impact`
      const refExtras = refinementMap[refKey]?.fields || refinementMap[impactKey]?.fields
      const amendExtras = amends.find(a => a.type === 'extras' || a.type === 'impact')?.payload?.fields
      // Only show changed fields
      const changedBefore = {}, changedAfter = {}
      const allKeys = [...new Set([...Object.keys(refExtras||{}), ...Object.keys(amendExtras||{})])]
      allKeys.forEach(k => {
        const bv = JSON.stringify(refExtras?.[k])
        const av = JSON.stringify(amendExtras?.[k])
        if (bv !== av) { changedBefore[k] = refExtras?.[k]; changedAfter[k] = amendExtras?.[k] }
      })
      before = { fields: Object.keys(changedBefore).length ? changedBefore : refExtras }
      after  = { fields: Object.keys(changedAfter).length  ? changedAfter  : amendExtras }
    } else if (errorType === 'wrong-location') {
      const refLoc = refinementMap[`${key}_location`]?.location
      const amendLoc = amends.find(a => a.type === 'location')?.payload?.location
      before = { location: refLoc }
      after  = { location: amendLoc }
    } else if (errorType === 'wrong-player') {
      const refPlayers = refinementMap[`${key}_players`]?.players || {}
      const amendPlayers = amends.find(a => a.type === 'players')?.payload?.players || {}
      before = { playerDiff: diffPlayers(refPlayers, amendPlayers).map(d => ({ ...d, side: 'before' })) }
      after  = { playerDiff: diffPlayers(refPlayers, amendPlayers).map(d => ({ ...d, side: 'after' })) }
    } else if (errorType === 'wrong-timestamp') {
      const baseAmend = amends.find(a => a.type === 'base')
      before = { ts: fmtTs(base?.videoTimestamp) }
      after  = { ts: fmtTs(baseAmend?.payload?.videoTimestamp) }
    } else if (errorType === 'freeze-frame') {
      const refFF = refinementMap[`${key}_freeze-frame`]?.freezeFrame
      const amendFF = amends.find(a => a.type === 'freeze-frame')?.payload?.freezeFrame
      const ffDiff = diffFF(refFF, amendFF)
      before = { ff: ffDiff, side: 'before' }
      after  = { ff: ffDiff, side: 'after' }
    } else if (errorType === 'goal-location') {
      const refGL = refinementMap[`${key}_goal-location`]?.['goal-location']
      const amendGL = amends.find(a => a.type === 'goal-location')?.payload?.['goal-location']
      before = { goalLoc: refGL }
      after  = { goalLoc: amendGL }
    } else if (errorType === 'squad') {
      const squadAmend = amends.find(a => a.type === 'squad')
      before = { formation: base?.payload?.formation || base?.formation || '—' }
      after  = { formation: squadAmend?.payload?.formation || '—' }
    } else if (errorType === 'added') {
      before = { missing: true }
      after  = { eventName: base?.name }
    } else if (errorType === 'wrong-event') {
      const baseAmend = amends.find(a => a.type === 'base')
      before = { eventName: base?.name }
      after  = { eventName: baseAmend?.payload?.name || '—' }
    }

    return {
      key, errorType,
      eventName: base?.name || '—',
      timestamp: fmtTs(base?.videoTimestamp),
      tsSec: base?.videoTimestamp != null ? base.videoTimestamp / 1000 : null,
      teamName,
      module: moduleOf(errorType, types),
      before, after,
      collectorHr: collector.hrcode,
      collectorName: collector.name,
      reviewerHr: reviewer.hrcode,
      reviewerName: reviewer.name,
      capturedTime: latestAmend?.capturedTime || '',
    }
  }).filter(r => r.errorType !== 'wrong-event' || r.before?.eventName !== r.after?.eventName)
    .sort((a, b) => {
      const ta = baseByKey[a.key]?.videoTimestamp || 0
      const tb = baseByKey[b.key]?.videoTimestamp || 0
      return ta - tb
    })

  if (rows.length === 0) return null

  // ── Error type config ──────────────────────────────────────────────────────
  const ERROR_CONFIG = {
    'deletion':        { label: 'Deleted',        color: '#FF453A', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg> },
    'rename':          { label: 'Wrong event',    color: '#FF6B1F', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> },
    'replacement':     { label: 'Replaced',       color: '#FF9F0A', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> },
    'wrong-event':     { label: 'Wrong event',    color: '#FF6B1F', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> },
    'wrong-timestamp': { label: 'Wrong timestamp',color: '#FF9F0A', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> },
    'wrong-extras':    { label: 'Wrong extras',   color: '#FF9F0A', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg> },
    'wrong-location':  { label: 'Wrong location', color: '#0A84FF', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> },
    'wrong-player':    { label: 'Wrong player',   color: '#BF5AF2', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
    'freeze-frame':    { label: 'Freeze frame',   color: '#5AC8FA', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> },
    'goal-location':   { label: 'Goal location',  color: '#0A84FF', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> },
    'squad':           { label: 'Squad',           color: '#6E6E73', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
    'added':           { label: 'Missed event',   color: '#30D158', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg> },
  }

  // ── Renderers ──────────────────────────────────────────────────────────────
  const renderBadge = (errorType) => {
    const cfg = ERROR_CONFIG[errorType] || ERROR_CONFIG['wrong-event']
    return (
      <span style={{
        display:'inline-flex', alignItems:'center', gap:4, fontSize:10, fontWeight:600,
        padding:'2px 8px', borderRadius:5, whiteSpace:'nowrap',
        background:`${cfg.color}18`, color:cfg.color, border:`0.5px solid ${cfg.color}40`,
      }}>
        {cfg.icon} {cfg.label}
      </span>
    )
  }

  const renderFieldDiff = (fields, isAfter) => {
    if (!fields) return <span style={{ fontSize:11, color:'var(--t-3)' }}>—</span>
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
        {Object.entries(fields).filter(([k,v]) => v != null && String(v) !== '').map(([k, v]) => {
          const val = Array.isArray(v) ? (v.length ? v.join(', ') : '—') : String(v)
          return (
            <div key={k} style={{ display:'flex', gap:5, alignItems:'baseline' }}>
              <span style={{ fontSize:9, color:'var(--t-3)', fontFamily:'JetBrains Mono, monospace', minWidth:55 }}>{k}</span>
              <span style={{ fontSize:11, color: isAfter ? '#30D158' : '#FF453A', textDecoration: isAfter ? 'none' : 'line-through', fontFamily:'JetBrains Mono, monospace' }}>{val}</span>
            </div>
          )
        })}
      </div>
    )
  }

  const renderLocation = (loc, isAfter) => {
    if (!loc) return <span style={{ fontSize:11, color:'var(--t-3)' }}>—</span>
    const actual = loc.actual || loc
    const x = actual.x ?? actual.X
    const y = actual.y ?? actual.Y
    if (x == null && y == null) return <span style={{ fontSize:11, color:'var(--t-3)' }}>—</span>
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
        <div style={{ display:'flex', gap:5, alignItems:'baseline' }}>
          <span style={{ fontSize:9, color:'var(--t-3)', fontFamily:'JetBrains Mono, monospace', minWidth:12 }}>x</span>
          <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color: isAfter ? '#30D158' : '#FF453A', textDecoration: isAfter ? 'none' : 'line-through' }}>{x?.toFixed(2)}</span>
        </div>
        <div style={{ display:'flex', gap:5, alignItems:'baseline' }}>
          <span style={{ fontSize:9, color:'var(--t-3)', fontFamily:'JetBrains Mono, monospace', minWidth:12 }}>y</span>
          <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color: isAfter ? '#30D158' : '#FF453A', textDecoration: isAfter ? 'none' : 'line-through' }}>{y?.toFixed(2)}</span>
        </div>
      </div>
    )
  }

  const renderPlayerPill = (player, status) => {
    if (!player) return (
      <span style={{ fontSize:11, color:'#FF9F0A', fontStyle:'italic' }}>Missing this field</span>
    )
    const colors = {
      wrong: { bg:'rgba(255,69,58,0.08)', border:'rgba(255,69,58,0.2)', jersey:'#FF453A', name:'var(--t-1)' },
      right: { bg:'rgba(48,209,88,0.08)', border:'rgba(48,209,88,0.2)', jersey:'#30D158', name:'var(--t-1)' },
      same:  { bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.08)', jersey:'var(--t-3)', name:'var(--t-3)' },
    }
    const c = colors[status] || colors.same
    return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'2px 8px 2px 4px', borderRadius:999, background:c.bg, border:`0.5px solid ${c.border}` }}>
        <span style={{ fontSize:10, fontFamily:'JetBrains Mono, monospace', fontWeight:500, background:'rgba(255,255,255,0.06)', padding:'0 4px', borderRadius:3, color:c.jersey }}>#{player.jersey}</span>
        <span style={{ fontSize:11, color:c.name }}>{player.name}</span>
        {player.teamName && <span style={{ fontSize:10, color:'var(--t-3)' }}>· {player.teamName}</span>}
      </span>
    )
  }

  const renderPlayerDiff = (playerDiff, isAfter) => {
    if (!playerDiff) return <span style={{ fontSize:11, color:'var(--t-3)' }}>—</span>
    const relevantRoles = playerDiff.filter(d => d.changed || d.missing || d.removed || d.before || d.after)
    if (!relevantRoles.length) return <span style={{ fontSize:11, color:'var(--t-3)' }}>—</span>
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {relevantRoles.map((d, i) => {
          const microtag = d.missing ? 'missing' : d.removed ? 'removed' : d.changed ? (isAfter ? 'corrected' : 'changed') : null
          const player = isAfter ? d.after : d.before
          const status = !d.changed ? 'same' : isAfter ? 'right' : 'wrong'
          return (
            <div key={i} style={{ display:'flex', flexDirection:'column', gap:2 }}>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ fontSize:9, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', color: d.changed ? '#FF9F0A' : 'var(--t-3)' }}>{d.role}</span>
                {microtag && d.changed && (
                  <span style={{ fontSize:9, fontWeight:600, color:'#FF9F0A', background:'rgba(255,159,10,0.08)', border:'0.5px solid rgba(255,159,10,0.2)', padding:'1px 5px', borderRadius:3, letterSpacing:'.04em' }}>{microtag}</span>
                )}
              </div>
              {renderPlayerPill(player, status)}
            </div>
          )
        })}
      </div>
    )
  }

  const renderFFDiff = (ff, isAfter) => {
    if (!ff) return <span style={{ fontSize:11, color:'var(--t-3)' }}>—</span>
    const keeper = isAfter ? ff.afterKeeper : ff.beforeKeeper
    const shooter = isAfter ? ff.afterShooter : ff.beforeShooter
    const reviewed = isAfter ? ff.afterReviewed : ff.beforeReviewed
    const keeperChanged = ff.beforeKeeper?.name !== ff.afterKeeper?.name
    const shooterChanged = ff.beforeShooter?.name !== ff.afterShooter?.name
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        <div>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', color: keeperChanged ? '#FF9F0A' : 'var(--t-3)', marginBottom:2 }}>Keeper</div>
          {keeper ? renderPlayerPill(keeper, keeperChanged ? (isAfter ? 'right' : 'wrong') : 'same') : <span style={{ fontSize:11, color:'var(--t-3)' }}>Not identified</span>}
        </div>
        <div>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', color: shooterChanged ? '#FF9F0A' : 'var(--t-3)', marginBottom:2 }}>Shooter</div>
          {shooter ? renderPlayerPill(shooter, shooterChanged ? (isAfter ? 'right' : 'wrong') : 'same') : <span style={{ fontSize:11, color:'var(--t-3)' }}>Not set</span>}
        </div>
        <div style={{ fontSize:10, color: reviewed ? '#30D158' : 'var(--t-3)' }}>
          {reviewed ? '✓ Reviewed' : '✗ Not reviewed'}
        </div>
      </div>
    )
  }

  const renderBefore = (r) => {
    const { errorType, before, after } = r
    if (!before) return <span style={{ fontSize:11, color:'var(--t-3)' }}>—</span>
    if (errorType === 'deletion') return (
      <div>
        <div style={{ fontSize:11, color:'#FF453A', textDecoration:'line-through', fontWeight:600 }}>{before.eventName}</div>
        <div style={{ fontSize:10, color:'var(--t-3)', fontFamily:'JetBrains Mono, monospace', marginTop:1 }}>{before.ts}</div>
      </div>
    )
    if (errorType === 'rename') return (
      <div style={{ fontSize:11, color:'#FF453A', textDecoration:'line-through', fontWeight:600 }}>{before.eventName}</div>
    )
    if (errorType === 'replacement') return (
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <div style={{ fontSize:11, color:'var(--t-2)', fontWeight:600 }}>{before.eventName}</div>
        {before.ts && <div style={{ fontSize:10, color:'var(--t-3)', fontFamily:'JetBrains Mono, monospace' }}>{before.ts}</div>}
        {before.extras && renderFieldDiff(before.extras, false)}
        {before.location && renderLocation(before.location, false)}
        {before.players && renderPlayerDiff(diffPlayers(before.players, after?.players || {}), false)}
      </div>
    )
    if (errorType === 'wrong-extras') return renderFieldDiff(before.fields, false)
    if (errorType === 'wrong-location') return renderLocation(before.location, false)
    if (errorType === 'wrong-player') return renderPlayerDiff(before.playerDiff, false)
    if (errorType === 'wrong-timestamp') return (
      <span style={{ fontSize:12, fontFamily:'JetBrains Mono, monospace', color:'#FF453A', textDecoration:'line-through' }}>{before.ts}</span>
    )
    if (errorType === 'freeze-frame') return renderFFDiff(before.ff, false)
    if (errorType === 'goal-location') return renderLocation(before.goalLoc, false)
    if (errorType === 'squad') return (
      <span style={{ fontSize:11, color:'#FF453A', textDecoration:'line-through', fontFamily:'JetBrains Mono, monospace' }}>{before.formation}</span>
    )
    if (errorType === 'added') return (
      <span style={{ fontSize:11, color:'#FF9F0A', fontStyle:'italic' }}>Missing this field</span>
    )
    return <span style={{ fontSize:11, color:'#FF453A', textDecoration:'line-through' }}>{before.eventName}</span>
  }

  const renderAfter = (r) => {
    const { errorType, after, before } = r
    if (!after) return <span style={{ fontSize:11, color:'var(--t-3)' }}>—</span>
    if (errorType === 'deletion') return (
      <span style={{ fontSize:11, color:'#FF453A' }}>Removed from session</span>
    )
    if (errorType === 'rename') return (
      <div style={{ fontSize:11, color:'#30D158', fontWeight:600 }}>{after.eventName}</div>
    )
    if (errorType === 'replacement') return (
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <div style={{ fontSize:11, color:'var(--t-2)', fontWeight:600 }}>{after.eventName}</div>
        {after.ts && <div style={{ fontSize:10, color:'var(--t-3)', fontFamily:'JetBrains Mono, monospace' }}>{after.ts}</div>}
        {after.extras && renderFieldDiff(after.extras, true)}
        {after.location && renderLocation(after.location, true)}
        {after.players && renderPlayerDiff(diffPlayers(before?.players || {}, after.players), true)}
      </div>
    )
    if (errorType === 'wrong-extras') return renderFieldDiff(after.fields, true)
    if (errorType === 'wrong-location') return renderLocation(after.location, true)
    if (errorType === 'wrong-player') return renderPlayerDiff(after.playerDiff, true)
    if (errorType === 'wrong-timestamp') return (
      <span style={{ fontSize:12, fontFamily:'JetBrains Mono, monospace', color:'#30D158' }}>{after.ts}</span>
    )
    if (errorType === 'freeze-frame') return renderFFDiff(after.ff, true)
    if (errorType === 'goal-location') return renderLocation(after.goalLoc, true)
    if (errorType === 'squad') return (
      <span style={{ fontSize:11, color:'#30D158', fontFamily:'JetBrains Mono, monospace' }}>{after.formation}</span>
    )
    if (errorType === 'added') return (
      <span style={{ fontSize:11, color:'#30D158', fontWeight:600 }}>{after.eventName}</span>
    )
    return <span style={{ fontSize:11, color:'#30D158' }}>{after.eventName}</span>
  }

  // ── Filter pills ───────────────────────────────────────────────────────────
  const errorTypes = [...new Set(rows.map(r => r.errorType))]
  const visibleRows = activeFilter ? rows.filter(r => r.errorType === activeFilter) : rows

  // ── CSV export ─────────────────────────────────────────────────────────────
  const downloadCSV = () => {
    const safe = (s) => String(s ?? '').replace(/"/g, '""')
    const locationStr = (loc) => {
      if (!loc) return '—'
      const a = loc.actual || loc
      return `x:${a.x?.toFixed(2)} y:${a.y?.toFixed(2)}`
    }
    const playerStr = (playerDiff, isAfter) => {
      if (!playerDiff) return '—'
      return playerDiff.filter(d => d.changed).map(d => {
        const p = isAfter ? d.after : d.before
        return p ? `${d.role}: #${p.jersey} ${p.name} (${p.teamName})` : `${d.role}: Missing`
      }).join(' | ')
    }
    const headers = ['Match ID','Match Name','Half','Timestamp','Event Name','Team','Error Type','Module','Before','After','Collector HR','Collector Name','Reviewer HR','Reviewer Name','Captured At']
    const csvRows = rows.map(r => {
      let bStr = '—', aStr = '—'
      const b = r.before, a = r.after
      if (r.errorType === 'deletion') { bStr = b?.eventName || '—'; aStr = 'Deleted' }
      else if (r.errorType === 'rename') { bStr = b?.eventName || '—'; aStr = a?.eventName || '—' }
      else if (r.errorType === 'replacement') { bStr = `${b?.eventName}`; aStr = `${a?.eventName}` }
      else if (r.errorType === 'wrong-extras') { bStr = Object.entries(b?.fields||{}).map(([k,v])=>`${k}: ${Array.isArray(v)?v.join(','):v}`).join(' | '); aStr = Object.entries(a?.fields||{}).map(([k,v])=>`${k}: ${Array.isArray(v)?v.join(','):v}`).join(' | ') }
      else if (r.errorType === 'wrong-location') { bStr = locationStr(b?.location); aStr = locationStr(a?.location) }
      else if (r.errorType === 'wrong-player') { bStr = playerStr(b?.playerDiff, false); aStr = playerStr(a?.playerDiff, true) }
      else if (r.errorType === 'wrong-timestamp') { bStr = b?.ts || '—'; aStr = a?.ts || '—' }
      else if (r.errorType === 'freeze-frame') { bStr = `Keeper: ${b?.ff?.beforeKeeper?.name||'Not set'} · Shooter: ${b?.ff?.beforeShooter?.name||'Not set'}`; aStr = `Keeper: ${a?.ff?.afterKeeper?.name||'Not set'} · Shooter: ${a?.ff?.afterShooter?.name||'Not set'}` }
      else if (r.errorType === 'goal-location') { bStr = locationStr(b?.goalLoc); aStr = locationStr(a?.goalLoc) }
      else if (r.errorType === 'squad') { bStr = b?.formation||'—'; aStr = a?.formation||'—' }
      else if (r.errorType === 'added') { bStr = 'Missing'; aStr = a?.eventName||'—' }
      return [session.matchId, session.matchName, formatHalf(session.half), r.timestamp, r.eventName, r.teamName, ERROR_CONFIG[r.errorType]?.label || r.errorType, r.module, bStr, aStr, r.collectorHr, r.collectorName, r.reviewerHr, r.reviewerName, r.capturedTime].map(v => `"${safe(v)}"`)
    })
    const csv = [headers.map(h=>`"${h}"`), ...csvRows].map(row => row.join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const el = document.createElement('a')
    el.href = url
    const s = (v) => String(v||'').replace(/[\\/:*?"<>|]/g,'').trim()
    el.download = `${s(session.matchId)}_${s(session.matchName)}_${s(formatHalf(session.half))}_${s(results.collectorHrCode||'')}.csv`
    el.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fade-in" style={{ marginTop:14 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ fontSize:10, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2 }}>
          ERRORS — {rows.length} EVENTS
        </div>
        <button className="btn-ghost" style={{ padding:'4px 12px', fontSize:11, display:'flex', alignItems:'center', gap:6 }} onClick={downloadCSV}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 3v13M6 11l6 6 6-6"/><path d="M4 20h16"/></svg>
          Download CSV
        </button>
      </div>

      {/* People summary */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 18px', marginBottom:10, fontSize:11, color:'var(--t-3)' }}>
        <span>
          <span style={{ fontWeight:700, color:'var(--t-2)' }}>Collector: </span>
          {formatPeople(results.collectorIds?.length ? results.collectorIds : [results.collectorId], idMap, results.collectorId)}
        </span>
        <span>
          <span style={{ fontWeight:700, color:'var(--t-2)' }}>Reviewer: </span>
          {formatPeople(reviewerIds, idMap, results.reviewerId)}
        </span>
      </div>

      {/* Filter pills */}
      {errorTypes.length > 1 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10, alignItems:'center' }}>
          <span style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:1 }}>FILTER</span>
          <button onClick={() => setActiveFilter(null)} style={{ fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:6, cursor:'pointer', background: activeFilter===null?'var(--p2)':'transparent', color: activeFilter===null?'#fff':'var(--t-3)', border:`1px solid ${activeFilter===null?'var(--p2)':'var(--b-2)'}` }}>
            All ({rows.length})
          </button>
          {errorTypes.map(t => {
            const cfg = ERROR_CONFIG[t]
            const count = rows.filter(r => r.errorType === t).length
            const on = activeFilter === t
            return (
              <button key={t} onClick={() => setActiveFilter(on ? null : t)} style={{ fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:6, cursor:'pointer', background: on ? cfg?.color : `${cfg?.color}18`, color: on ? '#fff' : cfg?.color, border:`1px solid ${on ? cfg?.color : cfg?.color+'40'}` }}>
                {cfg?.label||t} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Table */}
      <div style={{ borderRadius:10, border:'0.5px solid var(--b-1)', overflow:'hidden' }}>
        {/* Column headers */}
        <div style={{ display:'grid', gridTemplateColumns:'52px minmax(90px,1fr) 130px 80px minmax(100px,1fr) minmax(100px,1fr) 100px 100px', padding:'7px 12px', background:'var(--bg-3)', borderBottom:'0.5px solid var(--b-1)', gap:'0 8px' }}>
          {['TIME','EVENT · TEAM','ERROR TYPE','MODULE','BEFORE','AFTER','COLLECTOR','REVIEWER'].map(h => (
            <span key={h} style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:1 }}>{h}</span>
          ))}
        </div>

        {/* Data rows */}
        <div style={{ maxHeight:380, overflowY:'auto' }}>
          {visibleRows.map((r, i) => {
            const cfg = ERROR_CONFIG[r.errorType]
            const seekable = r.tsSec != null && typeof onSeek === 'function'
            const isExpanded = expandedKey === r.key
            return (
              <div key={r.key}>
                <div style={{
                  display:'grid', gridTemplateColumns:'52px minmax(90px,1fr) 130px 80px minmax(100px,1fr) minmax(100px,1fr) 100px 100px',
                  padding:'9px 12px', gap:'0 8px', alignItems:'start',
                  borderBottom:`0.5px solid var(--b-1)`,
                  borderLeft:`2px solid ${cfg?.color || 'var(--b-2)'}`,
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  cursor: seekable ? 'pointer' : 'default',
                  transition:'background .1s',
                }}
                  onClick={() => { if (seekable) onSeek(r.tsSec) }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background= i%2===0?'transparent':'rgba(255,255,255,0.01)'}
                  title={seekable ? `Jump to ${r.timestamp}` : undefined}
                >
                  {/* Time */}
                  <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color:'var(--p2)', paddingTop:2 }}>{r.timestamp}</span>
                  {/* Event · Team */}
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--t-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.eventName}</div>
                    <div style={{ fontSize:10, color:'var(--t-3)', marginTop:1 }}>{r.teamName}</div>
                  </div>
                  {/* Error type badge */}
                  <div style={{ paddingTop:2 }}>{renderBadge(r.errorType)}</div>
                  {/* Module */}
                  <span style={{ fontSize:11, color:'var(--t-3)', paddingTop:2 }}>{r.module}</span>
                  {/* Before */}
                  <div>{renderBefore(r)}</div>
                  {/* After */}
                  <div>{renderAfter(r)}</div>
                  {/* Collector */}
                  <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                    <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', fontWeight:500, color:'#E8590C' }}>{r.collectorHr}</span>
                    <span style={{ fontSize:10, color:'var(--t-3)' }}>{r.collectorName}</span>
                  </div>
                  {/* Reviewer */}
                  <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                    <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', fontWeight:500, color:'#0A84FF' }}>{r.reviewerHr}</span>
                    <span style={{ fontSize:10, color:'var(--t-3)' }}>{r.reviewerName}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main AuditPage ─────────────────────────────────────────────────────────────
export default function AuditPage({ session, onBack, onFullReport, initialResults = null, initialScore = null }) {
  const { profile } = useAuth()
  const videoRef    = useRef(null)
  // Restore prior results only if they belong to THIS match/half (App keeps them
  // across the full-report round trip; the page remounts and would otherwise reset).
  const restored = (initialResults && String(initialResults.matchId) === String(session.matchId)) ? initialResults : null
  const [videoLoaded,    setVideoLoaded]    = useState(false)
  const [playing,        setPlaying]        = useState(false)
  const [currentTime,    setCurrentTime]    = useState(0)
  const [duration,       setDuration]       = useState(0)
  const [speed,          setSpeed]          = useState(1)
  const [bridgeStatus,   setBridgeStatus]   = useState('disconnected')
  const [loading,        setLoading]        = useState(false)
  const [results,        setResults]        = useState(restored)
  const [score,          setScore]          = useState(restored ? initialScore : null)
  const [error,          setError]          = useState('')
  const [saved,          setSaved]          = useState(false)
  const [abcScores,      setAbcScores]      = useState(restored ? (restored.abcScores || null) : null)
  const [existingSession,setExistingSession]= useState(null)   // session from Sheet if already audited
  const [checkingSheet,  setCheckingSheet]  = useState(true)   // true while checking Sheet on mount
  const [reauditConfirm, setReauditConfirm] = useState(false)  // true when confirm dialog is shown
  const [resolvingIds,   setResolvingIds]   = useState(false)
  const [exportState,    setExportState]    = useState(null)   // null | { phase, step, total, done, driveLink }

  // Master Drive folder ID — all sessions go inside sub-folders here
  // Set once via Settings or first-run prompt, persisted to localStorage
  const MASTER_DRIVE_FOLDER_ID = '1TeuEJqnKiGrCmZZfpfOKFMzwa3KBxO0A'

  const { requestQAResults, resolveMatchIdentities } = useSync(setBridgeStatus, session.sessionId)

  // Persistent Firestore roster backbone — loaded once, used as a fallback when
  // a person wasn't resolved live this session.
  const rosterRef = useRef({})
  useEffect(() => {
    loadRoster().then(r => { rosterRef.current = r })
  }, [])

  // ── Check Sheet for existing session when navigating to this match+half ──
  const COLLECTOR_SHEET_ID  = '1-XbJFxAhR2QYxOQHdwIUVp-XSqol-3VJdHVhSoSkPmw'
  const COLLECTOR_SHEET_KEY = 'AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI'
  const SES_MATCH_ID = 2, SES_HALF = 4, SES_COMPLETED_AT = 5, SES_SCORE = 6
  const SES_SESSION_ID = 1, SES_REVIEWER = 22, SES_COLLECTOR = 25, SES_HR = 0
  const SES_TOTAL_EVENTS = 13, SES_TOTAL_ERRORS = 14

  useEffect(() => {
    let cancelled = false
    async function checkSheetForExistingSession() {
      setCheckingSheet(true)
      try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${COLLECTOR_SHEET_ID}/values/Sessions!A2:Z?key=${COLLECTOR_SHEET_KEY}`
        const res  = await fetch(url)
        const data = await res.json()
        if (data.error) throw new Error(data.error.message)
        const rows = data.values || []

        // Find rows matching this matchId + half
        const matchRows = rows.filter(r =>
          String(r[SES_MATCH_ID] || '').trim() === String(session.matchId) &&
          String(r[SES_HALF] || '').trim() === String(session.half)
        )

        if (!matchRows.length) {
          if (!cancelled) setCheckingSheet(false)
          return
        }

        // Pick the latest by completedAt
        matchRows.sort((a, b) => {
          const at = a[SES_COMPLETED_AT] ? new Date(a[SES_COMPLETED_AT]).getTime() : 0
          const bt = b[SES_COMPLETED_AT] ? new Date(b[SES_COMPLETED_AT]).getTime() : 0
          return bt - at
        })
        const latest = matchRows[0]

        // Load amendments from Events tab for this session
        const sessionId = latest[SES_SESSION_ID] || ''
        let amendments = []
        try {
          const evtUrl = `https://sheets.googleapis.com/v4/spreadsheets/${COLLECTOR_SHEET_ID}/values/Events!A2:K?key=${COLLECTOR_SHEET_KEY}`
          const evtRes  = await fetch(evtUrl)
          const evtData = await evtRes.json()
          amendments = (evtData.values || []).filter(r => (r[1]||'') === sessionId)
        } catch(e) { console.warn('[MARK] Events tab load failed:', e.message) }

        if (!cancelled) {
          setExistingSession({
            sessionId,
            matchId:       latest[SES_MATCH_ID] || '',
            half:          latest[SES_HALF] || '',
            completedAt:   latest[SES_COMPLETED_AT] || '',
            score:         latest[SES_SCORE] ? parseFloat(latest[SES_SCORE]) : null,
            reviewer:      latest[SES_REVIEWER] || '',
            collector:     latest[SES_COLLECTOR] || '',
            hrCode:        latest[SES_HR] || '',
            totalEvents:   parseInt(latest[SES_TOTAL_EVENTS]) || 0,
            totalErrors:   parseInt(latest[SES_TOTAL_ERRORS]) || 0,
            amendments,
            raw: latest,
          })
          setCheckingSheet(false)
        }
      } catch(e) {
        console.warn('[MARK] Sheet check failed:', e.message)
        if (!cancelled) setCheckingSheet(false)
      }
    }
    checkSheetForExistingSession()
    return () => { cancelled = true }
  }, [session.matchId, session.half])

  // Video is loaded manually by the reviewer — no auto-load

  async function loadVideo() {
    try {
      const path = await invoke('pick_video_file')
      if (!path) return
      localStorage.setItem(`mark_video_path_${session.matchId}`, path)
      const url = await invoke('get_video_url', { path })
      videoRef.current.src = url
      videoRef.current.load()
      setVideoLoaded(true)
    } catch(e) { setError('Failed to load video') }
  }

  async function handleInjectBridge() {
    try {
      const res = await invoke('patch_tag_once_asar')
      if (typeof res === 'string' && res.toLowerCase().includes('already')) {
        alert('Bridge is already embedded (current version). If the collection app is open, just reload it.')
      } else {
        alert('Bridge embedded \u2713 \u2014 now reopen the collection app. From now on it loads automatically on every page, so sync stays connected across halves, matches and modes.')
      }
    } catch(e) {
      console.warn('[MARK] embed:', e)
      alert(String(e))
    }
  }

  async function handleGetResults() {
    // ── Guard: if already audited, require confirmation before re-running ──
    if (existingSession && !reauditConfirm) {
      setReauditConfirm(true)
      return
    }
    setReauditConfirm(false)

    if (bridgeStatus !== 'connected') {
      setError('Bridge not connected — click ⚡ Embed Bridge first (with the collection app closed)')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await requestQAResults(session.matchId, session.half)
      if (!data) { setError('No data returned — make sure collection app is open on this match'); setLoading(false); return }

      // ── Build lineup player map from bridge payload ──────────────────────
      const lineupPlayerMap = {}
      ;(data.lineupPlayers || []).forEach(p => {
        lineupPlayerMap[p.id] = { name: p.name, nickname: p.nickname, jersey: p.jersey, teamId: p.teamId, teamName: p.teamName, side: p.side }
      })
      const teamMap = {}
      ;(data.lineupPlayers || []).forEach(p => { teamMap[p.teamId] = p.teamName })
      data.lineupPlayerMap = lineupPlayerMap
      data.teamMap = teamMap

      // ── Use refinements sent directly from bridge ──────────────────────────
      // Bridge sends { key_type: payload } for all refinements of reviewed events.
      // This is authoritative — no need to read Apollo cache separately.
      data.refinementData = data.refinements || {}

      // ── Step A: Filter system amendments ────────────────────────────────
      // Remove pressure-pair links (base + pairKey + no author) and
      // system location flags (location desired:null + no author)
      data.amendments = (data.amendments || []).filter(a => {
        const noAuthor = a.author == null || a.author === undefined
        if (a.type === 'base' && a.payload && a.payload.pairKey && noAuthor) return false
        if (a.type === 'location' && a.payload && a.payload.location && a.payload.location.desired && a.payload.location.desired.x === null && noAuthor) return false
        return true
      })

      // ── Step B: Role detection ───────────────────────────────────────────
      // Use diagnostics.work (per-author: base, refinement, amendment, views)
      // sent by the bridge to correctly identify:
      //   BASE COLLECTOR  : base > 5
      //   SPECIALIST      : (players+location) refinements > 5 AND base = 0
      //   REVIEWER        : amendments > 0 AND base = 0 AND refinements = 0
      // This correctly excludes the specialist collector who has zero base
      // events but is NOT a reviewer — old logic misidentified them via telemetry.
      const COLLECTOR_WORK_MIN = 3
      const workProfiles = (data.diagnostics && data.diagnostics.work) || []
      let trueReviewerIds = []

      if (workProfiles.length > 0) {
        workProfiles.forEach(w => {
          const isCollector = (w.base || 0) > COLLECTOR_WORK_MIN
          const isSpecialist = (w.refinement || 0) > COLLECTOR_WORK_MIN && (w.base || 0) === 0
          const isReviewer = (w.amendment || 0) > 0 && (w.base || 0) === 0 && (w.refinement || 0) === 0
          if (isReviewer && !isCollector && !isSpecialist) {
            trueReviewerIds.push(Number(w.author))
          }
        })
      }

      // Fallback: derive from base event authorship if diagnostics.work unavailable
      if (trueReviewerIds.length === 0) {
        const baseAuthorCounts = {}
        ;(data.baseEvents || []).forEach(e => {
          if (e.author != null) baseAuthorCounts[String(e.author)] = (baseAuthorCounts[String(e.author)] || 0) + 1
        })
        const amendAuthorSet = new Set()
        ;(data.amendments || []).forEach(a => {
          if (a.author != null) amendAuthorSet.add(String(a.author))
        })
        trueReviewerIds = [...amendAuthorSet]
          .filter(id => !baseAuthorCounts[id] || baseAuthorCounts[id] < COLLECTOR_WORK_MIN)
          .map(Number)
          .filter(id => !isNaN(id))
      }

      // Final fallback to bridge telemetry reviewerIds
      if (trueReviewerIds.length === 0) {
        const bridgeReviewerIds = (data.reviewerIds && data.reviewerIds.length)
          ? data.reviewerIds
          : (data.reviewerId != null ? [data.reviewerId] : [])
        trueReviewerIds = bridgeReviewerIds
      }

      const reviewerIds = trueReviewerIds.filter(id => !isNaN(id))
      data.reviewerIds = reviewerIds

      // ── Step C: Detect delete+add pairs (rename/replacement) ─────────────
      const PAIR_TOLERANCE_MS = 2000
      const reviewerSet = new Set(reviewerIds.map(Number))
      const reviewerBaseEvents = (data.baseEvents || []).filter(e => reviewerSet.has(Number(e.author)))
      const baseByKey = {}
      ;(data.baseEvents || []).forEach(e => { baseByKey[e.key] = e })
      const replacementMap = {}
      ;(data.amendments || []).filter(a => a.type === 'deletion' && reviewerSet.has(Number(a.author))).forEach(del => {
        const delBase = baseByKey[del.key]
        if (!delBase || delBase.videoTimestamp == null) return
        let best = null, bestDiff = Infinity
        reviewerBaseEvents.forEach(rev => {
          if (rev.key === del.key) return
          const diff = Math.abs((rev.videoTimestamp || 0) - delBase.videoTimestamp)
          if (diff <= PAIR_TOLERANCE_MS && diff < bestDiff) { best = rev; bestDiff = diff }
        })
        if (best) replacementMap[del.key] = { addedEvent: best, renamed: best.name !== delBase.name }
      })
      data.replacementMap = replacementMap

      // ── Score calculation (reviewer-only, correct) ───────────────────────
      const errorKeys = computeErrorKeys(data.baseEvents, data.amendments, reviewerIds)
      const uniqueEdited = errorKeys.size
      const total = data.baseEvents.length
      const q = total > 0 ? Math.round(((total - uniqueEdited) / total) * 100) : 0

      // ── Module scores with corrected reviewerIds ─────────────────────────
      let refinements = {}
      try {
        const cache = window.apollo && window.apollo.client && window.apollo.client.cache.extract() || {}
        Object.values(cache).forEach(v => {
          if (v.__typename === 'Event' && v.category === 'refinement' && v.type === 'extras') {
            const extras = Object.keys(v.payload && v.payload.fields || {}).filter(k => k !== 'extras')
            refinements[v.key] = extras
          }
        })
      } catch(e) {}

      const abc = {}
      for (const key of Object.keys(REVIEW_GROUPS)) {
        abc[key] = calcGroupScore(REVIEW_GROUPS[key], data.baseEvents, data.amendments, refinements, reviewerIds)
      }
      const eventTypeScores = calcEventTypeScores(data.baseEvents, data.amendments, reviewerIds)
      data.eventTypeScores = eventTypeScores

      const seedIdentities = data.identities || []
      data.identityMap = buildIdentityMap(seedIdentities, rosterRef.current)

      setAbcScores(abc)
      data.abcScores = abc
      setResults(data)
      setScore(q)

      if (!saved) {
        await saveToFirebase(data, q, abc)
        setSaved(true)
      }

      const distinctAuthors = [...new Set([
        ...data.baseEvents.map(e => e.author),
        ...data.amendments.map(a => a.author),
      ].filter(x => x != null))]
      setResolvingIds(true)
      resolveMatchIdentities(session.matchId, session.half, distinctAuthors)
        .then(live => {
          const merged = (live && live.length) ? live : seedIdentities
          const map = buildIdentityMap(merged, rosterRef.current)
          setResults(prev => (prev ? { ...prev, identityMap: map } : prev))
          saveIdentities(merged)
        })
        .catch(() => {})
        .finally(() => setResolvingIds(false))
    } catch(e) {
      setError('Error getting results: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

    // ── Export CSV + cut error clips + upload all to Drive ───────────────────
  async function handleExportAndUpload() {
    if (!results) return

    // 1. Require master folder ID
    const masterFolderId = '1TeuEJqnKiGrCmZZfpfOKFMzwa3KBxO0A'

    // 2. Require video path
    const videoPath = localStorage.getItem(`mark_video_path_${session.matchId}`) || ''
    if (!videoPath) {
      setError('No video loaded — click "Load Video" and select the match video first, then export.')
      return
    }

    setExportState({ phase: 'starting', step: 0, total: 0, done: false, driveLink: '' })
    setError('')

    try {
      // ── Helpers ──────────────────────────────────────────────────────────
      const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|]/g, '').trim()
      const fmtHalf = (h) => {
        const m = {
          '1h': '1st Half', '2h': '2nd Half', 'et1': 'ET 1', 'et2': 'ET 2',
          '1': '1st Half', '2': '2nd Half',
          'first_half': '1st Half', 'second_half': '2nd Half',
          'first': '1st Half', 'second': '2nd Half',
        }
        return m[String(h).toLowerCase()] || String(h)
      }

      // Build the display identity map for the CSV
      const idMap = results.identityMap || {}
      const reviewerIds = results.reviewerIds || (results.reviewerId != null ? [results.reviewerId] : [])
      const primaryCollectorEntry = idMap[String(results.collectorId)] || null
      const collectorHr = primaryCollectorEntry?.hrcode || primaryCollectorEntry?.hrCode || String(results.collectorId)
      const collectorName = primaryCollectorEntry?.name || `Collector ${results.collectorId}`
      const primaryReviewerEntry = idMap[String(results.reviewerId)] || null
      const reviewerName = primaryReviewerEntry?.name || profile.displayName || 'Reviewer'

      const matchId   = safe(session.matchId)
      const matchName = safe(session.matchName)
      const halfLabel = fmtHalf(session.half)
      const halfSafe  = safe(halfLabel)

      // ── Build the errors rows (same logic as AmendmentsTable) ────────────
      const baseByKey = {}
      ;(results.baseEvents || []).forEach(e => { baseByKey[e.key] = e })
      const reviewerSet = new Set(reviewerIds.map(Number))
      const filteredAmends = (results.amendments || []).filter(a => reviewerSet.has(Number(a.author)))
      const amendsByKey = {}
      filteredAmends.forEach(a => {
        if (!amendsByKey[a.key]) amendsByKey[a.key] = []
        amendsByKey[a.key].push(a)
      })

      // Build refinements cache from Apollo
      const refinementsCache = {}
      try {
        const apolloCache = window.apollo?.client?.cache?.extract() || {}
        Object.values(apolloCache).forEach(v => {
          if (v.__typename === 'Event' && v.category === 'refinement') {
            const k = `${v.key}_${v.type}`
            if (!refinementsCache[k]) refinementsCache[k] = v.payload || {}
          }
        })
      } catch(e) {}

      // Build lineup player map and team map
      const lineupPlayerMap = {}
      const teamMap = {}
      ;(results.lineupPlayers || []).forEach(p => {
        lineupPlayerMap[p.id] = { name: p.name, nickname: p.nickname, jersey: p.jersey, teamName: p.teamName || '', teamId: p.teamId }
        teamMap[p.teamId] = p.teamName || ''
      })

      const fmt = (sec) => {
        const ms = Math.round(sec * 1000)
        const min = Math.floor(ms / 60000)
        const s = Math.floor((ms % 60000) / 1000)
        const millis = ms % 1000
        return `${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(millis).padStart(3,'0')}`
      }

      const errorRows = Object.entries(amendsByKey).map(([key, amends]) => {
        const base = baseByKey[key]
        const types = [...new Set(amends.map(a => a.type))]
        const latestAmend = amends.sort((a,b) => (b.capturedTime||0)-(a.capturedTime||0))[0]
        const tsSec  = base?.videoTimestamp != null ? base.videoTimestamp / 1000 : null

        // Error type classification
        const hasDeletion = types.includes('deletion')
        const rep = results.replacementMap?.[key]
        let errorType = 'wrong-event'
        if (hasDeletion && rep) errorType = rep.renamed ? 'rename' : 'replacement'
        else if (hasDeletion) errorType = 'deletion'
        else if (types.includes('freeze-frame')) errorType = 'freeze-frame'
        else if (types.includes('goal-location')) errorType = 'goal-location'
        else if (types.includes('squad')) errorType = 'squad'
        else if (types.includes('players')) errorType = 'wrong-player'
        else if (types.includes('location')) errorType = 'wrong-location'
        else if (types.includes('extras') || types.includes('impact')) errorType = 'wrong-extras'
        else if (types.includes('base')) {
          const ba = amends.find(a => a.type === 'base')
          const tsChanged = ba?.payload?.videoTimestamp != null && ba.payload.videoTimestamp !== base?.videoTimestamp
          const nameChanged = ba?.payload?.name && ba.payload.name !== base?.name
          if (tsChanged && !nameChanged) errorType = 'wrong-timestamp'
        }

        const errorLabels = {
          'deletion':'Deleted','rename':'Wrong event','replacement':'Replaced',
          'wrong-event':'Wrong event','wrong-timestamp':'Wrong timestamp',
          'wrong-extras':'Wrong extras','wrong-location':'Wrong location',
          'wrong-player':'Wrong player','freeze-frame':'Freeze frame',
          'goal-location':'Goal location','squad':'Squad','added':'Missed event',
        }
        const moduleLabels = {
          'deletion':'Base','rename':'Base','replacement':'Base','wrong-event':'Base',
          'wrong-timestamp':'Base','added':'Base','wrong-extras':'Extras',
          'wrong-location':'Location','wrong-player':'Players',
          'freeze-frame':'Freeze Frame','goal-location':'Goal Location','squad':'Squad',
        }

        // Before/After strings
        let beforeStr = '—', afterStr = '—'
        if (errorType === 'deletion') {
          beforeStr = base?.name || '—'; afterStr = 'Deleted'
        } else if (errorType === 'rename') {
          beforeStr = base?.name || '—'; afterStr = rep?.addedEvent?.name || '—'
        } else if (errorType === 'replacement') {
          beforeStr = base?.name || '—'; afterStr = rep?.addedEvent?.name || base?.name || '—'
        } else if (errorType === 'wrong-extras') {
          const refFields = refinementsCache?.[`${key}_extras`]?.fields || refinementsCache?.[`${key}_impact`]?.fields
          const amendFields = amends.find(a => a.type === 'extras' || a.type === 'impact')?.payload?.fields
          const changedKeys = Object.keys({...(refFields||{}), ...(amendFields||{})}).filter(k => JSON.stringify(refFields?.[k]) !== JSON.stringify(amendFields?.[k]))
          beforeStr = changedKeys.map(k => { const v = refFields?.[k]; return `${k}: ${Array.isArray(v)?v.join(','):v}` }).join(' | ') || '—'
          afterStr  = changedKeys.map(k => { const v = amendFields?.[k]; return `${k}: ${Array.isArray(v)?v.join(','):v}` }).join(' | ') || '—'
        } else if (errorType === 'wrong-location') {
          const refLoc = refinementsCache?.[`${key}_location`]?.location?.actual
          const amendLoc = amends.find(a => a.type === 'location')?.payload?.location?.actual
          beforeStr = refLoc ? `x:${refLoc.x?.toFixed(2)} y:${refLoc.y?.toFixed(2)}` : '—'
          afterStr  = amendLoc ? `x:${amendLoc.x?.toFixed(2)} y:${amendLoc.y?.toFixed(2)}` : '—'
        } else if (errorType === 'wrong-player') {
          const refPlayers = refinementsCache?.[`${key}_players`]?.players || {}
          const amendPlayers = amends.find(a => a.type === 'players')?.payload?.players || {}
          const roleMap = { playerId:'Main', secondaryPlayerId:'Secondary', thirdPlayerId:'Third' }
          const changedRoles = Object.keys({...refPlayers,...amendPlayers}).filter(r => refPlayers[r] !== amendPlayers[r])
          const pName = (id) => id == null ? 'Missing' : (lineupPlayerMap[id] ? `#${lineupPlayerMap[id].jersey} ${lineupPlayerMap[id].nickname||lineupPlayerMap[id].name} (${lineupPlayerMap[id].teamName})` : `id:${id}`)
          beforeStr = changedRoles.map(r => `${roleMap[r]||r}: ${pName(refPlayers[r])}`).join(' | ') || '—'
          afterStr  = changedRoles.map(r => `${roleMap[r]||r}: ${pName(amendPlayers[r])}`).join(' | ') || '—'
        } else if (errorType === 'wrong-timestamp') {
          const ba = amends.find(a => a.type === 'base')
          beforeStr = tsSec !== null ? fmt(tsSec) : '—'
          afterStr  = ba?.payload?.videoTimestamp != null ? fmt(ba.payload.videoTimestamp / 1000) : '—'
        } else if (errorType === 'freeze-frame') {
          const refFF = refinementsCache?.[`${key}_freeze-frame`]?.freezeFrame
          const amendFF = amends.find(a => a.type === 'freeze-frame')?.payload?.freezeFrame
          const getFFP = (players, roles, role) => {
            const idx = (roles?.[role]||[])[0]
            if (idx == null) return 'Not set'
            const p = players?.[idx]
            const info = p?.playerId ? lineupPlayerMap[p.playerId] : null
            return info ? `#${info.jersey} ${info.nickname||info.name}` : 'Not identified'
          }
          beforeStr = `Keeper: ${getFFP(refFF?.players, refFF?.roles, 'keeper')} · Shooter: ${getFFP(refFF?.players, refFF?.roles, 'shooter')}`
          afterStr  = `Keeper: ${getFFP(amendFF?.players, amendFF?.roles, 'keeper')} · Shooter: ${getFFP(amendFF?.players, amendFF?.roles, 'shooter')}`
        } else if (errorType === 'goal-location') {
          const refGL = refinementsCache?.[`${key}_goal-location`]?.['goal-location']
          const amendGL = amends.find(a => a.type === 'goal-location')?.payload?.['goal-location']
          beforeStr = refGL ? `x:${refGL.x} y:${refGL.y}` : '—'
          afterStr  = amendGL ? `x:${amendGL.x} y:${amendGL.y}` : '—'
        } else if (errorType === 'squad') {
          const sq = amends.find(a => a.type === 'squad')
          beforeStr = base?.payload?.formation || '—'
          afterStr  = sq?.payload?.formation || '—'
        }

        const teamName = base?.teamId ? (teamMap[base.teamId] || String(base.teamId)) : '—'
        const collId = idMap[String(base?.author)] || {}
        const revId  = idMap[String(latestAmend?.author)] || {}

        return {
          key,
          eventName: base?.name || '—',
          timestamp: tsSec !== null ? fmt(tsSec) : '—',
          tsSec,
          teamName,
          errorTypeLabel: errorLabels[errorType] || errorType,
          module: moduleLabels[errorType] || 'Base',
          beforeStr, afterStr,
          collectorHr: collId.hrcode || collId.hrCode || String(base?.author || '—'),
          collectorName: collId.name || '',
          reviewerHr: revId.hrcode || revId.hrCode || String(latestAmend?.author || '—'),
          reviewerName: revId.name || reviewerName,
          capturedTime: latestAmend?.capturedTime ? new Date(latestAmend.capturedTime).toISOString() : '',
        }
      }).sort((a, b) => (a.tsSec ?? 0) - (b.tsSec ?? 0))

      // ── Build CSV content ────────────────────────────────────────────────
      const csvQ = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const csvLines = []

      // Summary block
      const abcLabels = { A:'Base', B:'Pressure', C:'Extras', D:'Players', E:'Location', F:'Freeze Frame' }
      csvLines.push(['AUDIT SESSION SUMMARY'].map(csvQ).join(','))
      csvLines.push(['Match ID', matchId].map(csvQ).join(','))
      csvLines.push(['Match Name', session.matchName].map(csvQ).join(','))
      csvLines.push(['Half', halfLabel].map(csvQ).join(','))
      csvLines.push(['Collector HR Code', collectorHr].map(csvQ).join(','))
      csvLines.push(['Collector Name', collectorName].map(csvQ).join(','))
      csvLines.push(['Reviewer', reviewerName].map(csvQ).join(','))
      csvLines.push(['Overall Score', `${score}%`].map(csvQ).join(','))
      csvLines.push(['Total Events', String(results.baseEvents?.length ?? 0)].map(csvQ).join(','))
      csvLines.push(['Total Errors', String(errorRows.length)].map(csvQ).join(','))
      // Module scores
      if (abcScores) {
        Object.entries(abcScores).forEach(([key, val]) => {
          csvLines.push([`${abcLabels[key] || key} Score`, val?.score != null ? `${Math.round(val.score)}%` : '—'].map(csvQ).join(','))
        })
      }
      csvLines.push([]) // blank line separator

      // Errors table header — matches approved table design
      csvLines.push(['Match ID','Match Name','Half','Timestamp','Event Name','Team','Error Type','Module','Before','After','Collector HR','Collector Name','Reviewer HR','Reviewer Name','Captured At'].map(csvQ).join(','))
      errorRows.forEach(r => {
        csvLines.push([
          session.matchId, session.matchName, halfLabel, r.timestamp,
          r.eventName, r.teamName, r.errorTypeLabel, r.module,
          r.beforeStr, r.afterStr, r.collectorHr, r.collectorName, r.reviewerHr, r.reviewerName, r.capturedTime,
        ].map(csvQ).join(','))
      })
      const csvContent = csvLines.map(l => Array.isArray(l) ? '' : l).join('\r\n')

      // ── Folder name & file names ─────────────────────────────────────────
      const folderName   = `${matchId}_${matchName}_${halfSafe}_${safe(collectorHr)}`
      const csvFileName  = `${matchId}_${matchName}_${halfSafe}_${safe(collectorHr)}.csv`

      // Clip list: one per error row that has a timestamp
      // Timestamp format: MM:SS.mmm → sanitize for filename → MM-SS.mmm
      const clipsWithTs = errorRows.filter(r => r.tsSec !== null)
      const clipDefs = clipsWithTs.map(r => {
        const evtSafe = safe(r.eventName).slice(0, 35)
        const tsFmt   = r.timestamp.replace(':', '-')   // 03:13.350 → 03-13.350
        const errSafe = safe(r.errorTypeLabel || r.module || 'error').slice(0, 25)
        return { ts: r.tsSec, name: `${evtSafe}_${tsFmt}_${errSafe}.mp4` }
      })

      const total = 2 + clipDefs.length // CSV upload + folder create + N clips
      setExportState({ phase: 'cutting', step: 0, total, done: false, driveLink: '' })

      // ── 1. Get Drive token ───────────────────────────────────────────────
      let token
      try {
        token = await invoke('get_google_access_token_cmd')
      } catch(e) { throw new Error('Token failed: ' + (e?.message || JSON.stringify(e))) }

      // ── 2. Create match sub-folder inside master folder ──────────────────
      setExportState(s => ({ ...s, phase: 'folder', step: 0 }))
      let subFolderId
      try {
        subFolderId = await invoke('drive_create_folder', {
          token, name: folderName, parentId: masterFolderId,
        })
      } catch(e) { throw new Error('Folder create failed: ' + (e?.message || JSON.stringify(e))) }

      // ── 3. Cut all clips locally ─────────────────────────────────────────
      setExportState(s => ({ ...s, phase: 'cutting', step: 0, total: clipDefs.length + 1 }))
      let cutFiles = []
      if (clipDefs.length > 0) {
        try {
          cutFiles = await invoke('cut_clips', {
            videoPath, subfolder: folderName, clips: clipDefs,
          })
        } catch(e) { throw new Error('Clip cutting failed: ' + (e?.message || JSON.stringify(e))) }
      }
      setExportState(s => ({ ...s, step: cutFiles.length }))

      // ── 4. Save CSV locally then upload ─────────────────────────────────
      let userprofile
      try {
        userprofile = await invoke('get_userprofile')
      } catch(e) { throw new Error('get_userprofile failed: ' + (e?.message || JSON.stringify(e))) }
      const csvLocalPath = `${userprofile}\\Downloads\\${folderName}\\${csvFileName}`
      try {
        await invoke('save_text_file', { path: csvLocalPath, content: csvContent })
      } catch(e) { throw new Error('save_text_file failed: ' + (e?.message || JSON.stringify(e))) }
      setExportState(s => ({ ...s, phase: 'uploading', step: 0, total: cutFiles.length + 1 }))

      let driveLink = ''
      try {
        const csvLink = await invoke('upload_csv_as_sheet', {
          token, filePath: csvLocalPath, fileName: csvFileName, parentFolderId: subFolderId,
        })
        driveLink = csvLink
      } catch(e) { throw new Error('CSV upload failed: ' + (e?.message || JSON.stringify(e))) }
      setExportState(s => ({ ...s, step: 1 }))

      // ── 5. Upload each clip ──────────────────────────────────────────────
      for (let i = 0; i < cutFiles.length; i++) {
        const clipName = cutFiles[i]
        const localPath = `${userprofile}\\Downloads\\${folderName}\\${clipName}`
        await invoke('drive_upload_file', {
          token, filePath: localPath, fileName: clipName, parentFolderId: subFolderId,
        })
        setExportState(s => ({ ...s, step: i + 2 }))
      }

      // ── Done — driveLink points to the folder ────────────────────────────
      const folderUrl = `https://drive.google.com/drive/folders/${subFolderId}`
      setExportState({ phase: 'done', step: total, total, done: true, driveLink: folderUrl })

        // ── Send report email via Gmail API (hudl.quality.egypt@gmail.com) ──────
        // Fires automatically after upload — free, unlimited, fully automatic.
        try {
          const errorTypes = {}
          filteredAmends.forEach(a => {
            errorTypes[a.type] = (errorTypes[a.type] || 0) + 1
          })

          // ── Fetch recipients.json from GitHub ─────────────────────────────
          const recipientsUrl = 'https://raw.githubusercontent.com/ahmedashraf-cyber/mark-app/main/recipients.json'
          const recipientsRes = await fetch(recipientsUrl)
          const recipientsData = await recipientsRes.json()

          // ── Detect environment from bridge payload ─────────────────────────
          const env = results?.environment || 'production'
          console.log('[MARK] Email env:', env)

          let TO_EMAILS = ''
          let CC_EMAILS = ''

          if (env === 'staging') {
            // ── Staging: send only to collector(s), no reviewer, no leaders ──
            const stagingCollectors = recipientsData?.staging?.collectors || []

            // collectorHr may be comma-separated (multi-collector sessions)
            const collectorCodes = String(collectorHr || '').split(',').map(c => c.trim()).filter(Boolean)
            const collectorEmails = collectorCodes
              .map(code => stagingCollectors.find(c => c.code === code))
              .filter(Boolean)
              .map(c => c.email)
              .filter(e => e && e.includes('@'))

            TO_EMAILS = collectorEmails.join(',')
            CC_EMAILS = ''
            console.log('[MARK] Staging email — TO:', TO_EMAILS)

          } else {
            // ── Production: collector + sup (TO), reviewer + sup (CC) ────────
            const people = recipientsData?.production?.people || []
            const byCode = {}
            people.forEach(p => { byCode[p.code] = p })

            // Collector(s)
            const collectorCodes = String(collectorHr || '').split(',').map(c => c.trim()).filter(Boolean)
            const toEmails = []
            collectorCodes.forEach(code => {
              const p = byCode[code]
              if (!p) return
              if (p.email)    toEmails.push(p.email)
              if (p.supEmail) toEmails.push(p.supEmail)
            })

            // Reviewer(s)
            const reviewerHrCode = results?.reviewerHrCode || reviewerHr || ''
            const reviewerCodes = String(reviewerHrCode).split(',').map(c => c.trim()).filter(Boolean)
            const ccEmails = []
            reviewerCodes.forEach(code => {
              const p = byCode[code]
              if (!p) return
              if (p.email)    ccEmails.push(p.email)
              if (p.supEmail) ccEmails.push(p.supEmail)
            })

            // Dedupe
            TO_EMAILS = [...new Set(toEmails.filter(e => e && e.includes('@')))].join(',')
            CC_EMAILS = [...new Set(ccEmails.filter(e => e && e.includes('@')))].join(',')
            console.log('[MARK] Production email — TO:', TO_EMAILS, '| CC:', CC_EMAILS)
          }

          if (TO_EMAILS) {
            const emailResult = await invoke('send_gmail_report', {
              matchName:     session.matchName || '',
              matchId:       String(session.matchId || ''),
              half:          halfLabel,
              overallScore:  score ?? 0,
              scoreA:        abcScores?.A?.score ?? 0,
              scoreB:        abcScores?.B?.score ?? 0,
              scoreC:        abcScores?.C?.score ?? 0,
              totalErrors:   filteredAmends.length,
              errorsByType:  JSON.stringify(errorTypes),
              collectorName: collectorName,
              collectorHr:   collectorHr,
              reviewerName:  reviewerName,
              reviewerHr:    results?.reviewerHrCode || reviewerHr || '',
              folderUrl,
              toEmails:      TO_EMAILS,
              ccEmails:      CC_EMAILS,
            })
            console.log('[MARK] Gmail report:', emailResult)
          } else {
            console.warn('[MARK] Gmail report skipped — no recipients resolved for HR code:', collectorHr)
          }
        } catch(emailErr) {
          // Never block the UI for email failures
          console.warn('[MARK] Gmail report failed (non-blocking):', emailErr)
        }

    } catch(e) {
      setExportState(null)
      setError('Export failed: ' + e.message)
    }
  }

  async function saveToFirebase(data, q, abc) {
    try {
      const reviewerIds = (data.reviewerIds && data.reviewerIds.length)
        ? data.reviewerIds
        : (data.reviewerId != null ? [data.reviewerId] : [])
      const reviewerAmends = filterAmendments(data.amendments, reviewerIds)
      const uniqueEdited = computeErrorKeys(data.baseEvents, data.amendments, reviewerIds).size
      const types = {}
      reviewerAmends.forEach(a => { types[a.type] = (types[a.type] || 0) + 1 })

      // Resolve clean hrCode for the primary collector from the identity map
      const idMap = data.identityMap || {}
      const primaryCollectorEntry = idMap[String(data.collectorId)] || null
      const collectorHrCode = primaryCollectorEntry?.hrcode || primaryCollectorEntry?.hrCode || null

      // Resolve the REAL QA reviewer of record from the identity map — this is
      // the person whose review decisions are reflected in the amendments,
      // NOT the MARK operator who happens to be logged in on this machine.
      // Falls back to the operator's own identity only if the real reviewer
      // can't be resolved (e.g. brand new person not yet in the roster).
      const primaryReviewerEntry = idMap[String(data.reviewerId)] || null
      const resolvedReviewerName  = primaryReviewerEntry?.name  || profile.displayName || profile.email.split('@')[0]
      const resolvedReviewerEmail = primaryReviewerEntry?.email || profile.email
      const resolvedReviewerHrCode = primaryReviewerEntry?.hrcode || primaryReviewerEntry?.hrCode || null

      // Per-module scores (abc keys: A=base, B=pressure, C=extras, D=players, E=location, F=freeze-frame)
      const moduleScores = {
        base:        abc?.A?.score ?? null,
        pressure:    abc?.B?.score ?? null,
        extras:      abc?.C?.score ?? null,
        players:     abc?.D?.score ?? null,
        location:    abc?.E?.score ?? null,
        freezeFrame: abc?.F?.score ?? null,
      }

      // ── Delete all previous sessions for this matchId+half by this reviewer ──
      // This ensures only the LATEST audit session is kept — no duplicate sessions per match+half
      try {
        const prevQ = query(
          collection(db, 'mark_audit_sessions'),
          where('matchId', '==', String(session.matchId)),
          where('half',    '==', String(session.half)),
          where('reviewerId', '==', profile.uid)
        )
        const prevSnap = await getDocs(prevQ)
        for (const prevDoc of prevSnap.docs) {
          const prevSessionId = prevDoc.data().sessionId || prevDoc.id
          // Delete amendments for this old session
          const amendQ = query(collection(db, 'mark_audit_amendments'), where('sessionId', '==', prevSessionId))
          const amendSnap = await getDocs(amendQ)
          for (const aDoc of amendSnap.docs) await deleteDoc(doc(db, 'mark_audit_amendments', aDoc.id))
          // Delete the session doc itself
          await deleteDoc(doc(db, 'mark_audit_sessions', prevDoc.id))
        }
        if (prevSnap.size > 0) console.log(`[MARK] Cleaned ${prevSnap.size} previous session(s) for ${session.matchId} ${session.half}`)
      } catch(e) {
        console.warn('[MARK] Could not clean previous sessions:', e.message)
      }

      await addDoc(collection(db, 'mark_audit_sessions'), {
        sessionId:          session.sessionId,
        matchId:            session.matchId,
        matchName:          session.matchName,
        half:               session.half,
        reviewerId:         profile.uid,
        reviewerEmail:      resolvedReviewerEmail,
        reviewerName:       resolvedReviewerName,
        reviewerHrCode:     resolvedReviewerHrCode,
        // Operator = whoever was actually logged into MARK on this machine —
        // kept separately for audit-trail purposes, never shown as "the reviewer"
        operatorUid:        profile.uid,
        operatorEmail:      profile.email,
        operatorName:       profile.displayName || profile.email.split('@')[0],
        collectorId:        data.collectorId,
        collectorIds:       data.collectorIds || (data.collectorId != null ? [data.collectorId] : []),
        collectorHrCode,
        qaReviewerId:       data.reviewerId,
        qaReviewerIds:      reviewerIds,
        videoTime:          data.videoTime,
        totalBaseEvents:    data.baseEvents.length,
        totalAmendments:    reviewerAmends.length,
        uniqueEditedEvents: uniqueEdited,
        qualityScore:       q,
        qualityScoreA:      abc?.A?.score ?? null,
        qualityScoreB:      abc?.B?.score ?? null,
        qualityScoreC:      abc?.C?.score ?? null,
        moduleScores,
        eventTypeScores:    data.eventTypeScores || {},
        amendmentTypes:     types,
        status:             'completed',
        completedAt:        serverTimestamp(),
      })

      // Save amendment details
      const baseTsByKey = {}
      ;(data.baseEvents || []).forEach(e => { baseTsByKey[e.key] = e.videoTimestamp })
      const sanitizeForFirestore = (obj) => {
        // Firestore doesn't support nested arrays. Serialize the whole payload as JSON string
        // for amendment types that may contain nested arrays (freeze-frame, squad positions etc.)
        if (!obj || typeof obj !== 'object') return obj
        const str = JSON.stringify(obj)
        // If it contains nested arrays (array within array), store as JSON string
        if (/\[\s*\[/.test(str)) return { _json: str }
        return obj
      }
      for (const a of data.amendments) {
        await addDoc(collection(db, 'mark_audit_amendments'), {
          sessionId:      session.sessionId,
          matchId:        session.matchId,
          amendmentId:    a.id,
          key:            a.key,
          type:           a.type,
          originalName:   a.originalName,
          author:         a.author,
          capturedTime:   a.capturedTime,
          videoTimestamp: baseTsByKey[a.key] ?? a.payload?.videoTimestamp ?? null,
          payload:        sanitizeForFirestore(a.payload || {}),
        })
      }
      // Mirror session summary to collector results Sheet (fire-and-forget — never blocks audit save)
      if (collectorHrCode) {
        const sheetRow = {
          hrCode:           collectorHrCode,
          sessionId:        session.sessionId,
          matchId:          String(session.matchId),
          matchName:        session.matchName || '',
          half:             String(session.half),
          completedAt:      new Date().toISOString(),
          scoreOverall:     String(q ?? ''),
          scoreBase:        String(moduleScores.base ?? ''),
          scorePressure:    String(moduleScores.pressure ?? ''),
          scorePlayers:     String(moduleScores.players ?? ''),
          scoreLocation:    String(moduleScores.location ?? ''),
          scoreExtras:      String(moduleScores.extras ?? ''),
          scoreFreeze:      String(moduleScores.freezeFrame ?? ''),
          totalEvents:      String(data.baseEvents.length),
          totalErrors:      String(uniqueEdited),
          errBase:          String(types.base || 0),
          errLocation:      String(types.location || 0),
          errExtras:        String(types.extras || 0),
          errPlayers:       String(types.players || 0),
          errDeletion:      String(types.deletion || 0),
          errCamera:        String(types.camera || 0),
          errAdded:         String(types.added || 0),
          reviewerEmail:    profile.email || '',
          collectorDisplay: data.collectorId || '',
          markVersion:      '7.5.8',
        }
        // NOTE: Sheet sync is handled by the GitHub Actions workflow triggered below.
        // The Rust append commands are intentionally skipped to avoid duplicate rows —
        // the workflow does a full overwrite of both Sessions and Events tabs.

        // Append individual amendment rows to Events tab
        const evtRows = reviewerAmends
          .filter(a => a.originalName)  // skip amendments with no event name
          .map(a => ({
            hrCode:      collectorHrCode,
            sessionId:   session.sessionId,
            matchId:     String(session.matchId),
            matchName:   session.matchName || '',
            half:        String(session.half),
            completedAt: new Date().toISOString(),
            eventName:   a.originalName || '',
            errorType:   a.type || '',
            amendmentId: a.id || '',
            videoTs:     baseTsByKey[a.key] != null ? String(Math.round(baseTsByKey[a.key]/1000)) : '',
            markVersion: '7.5.11',
          }))
        // Events tab is also handled by the GitHub workflow full-sync below
        // (skipping invoke('append_collector_events') to avoid duplicates)

        // Trigger immediate Sheet full-sync via GitHub Actions (fire-and-forget)
        // Token stored in Tauri build config, not hardcoded here
        const ghToken = import.meta.env.VITE_GH_SYNC_TOKEN || ''
        const GH_REPO    = 'ahmedashraf-cyber/hudl-tooling'
        const GH_WORKFLOW = 'migrate_to_sheet.yml'
        if (ghToken) {
          fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`, {
            method: 'POST',
            headers: {
              'Authorization': `token ${ghToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/vnd.github.v3+json',
            },
            body: JSON.stringify({ ref: 'main' }),
          }).then(() => console.log('[MARK] Sheet sync triggered'))
            .catch(e => console.warn('[MARK] Sheet sync trigger failed:', e.message))
        } else {
          console.log('[MARK] No sync token — Sheet will sync on next 30-min cron')
        }
      }
    } catch(e) { console.error('[MARK] save audit:', e) }
  }

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }

  function seekTo(pct) {
    if (!videoRef.current || !duration) return
    videoRef.current.currentTime = pct * duration
  }

  // Seconds-based seek for amendment row clicks — same approach as SessionHistory's
  // click-to-seek (sets video.currentTime directly to the event's timestamp).
  function seekToSeconds(t) {
    const v = videoRef.current
    if (!v || t == null || !isFinite(t)) return
    v.currentTime = Math.max(0, t)
    setCurrentTime(v.currentTime)
  }

  function seekBy(seconds) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + seconds))
    setCurrentTime(v.currentTime)
  }

  function changeSpeed(valueOrUpdater) {
    const v = videoRef.current
    if (!v) return
    const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(v.playbackRate) : valueOrUpdater
    v.playbackRate = next
    setSpeed(next)
  }

  // Video keyboard controls — same shortcuts as Scout (no collection-app sync here;
  // Audit drives only its own player). ↑ play/pause · →/← seek 400ms (40ms w/ Shift)
  // · +/- speed. Disabled while typing in a field.
  useEffect(() => {
    if (!videoLoaded) return
    function handleKey(e) {
      const tag = (e.target && e.target.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return
      const key = e.key, shift = e.shiftKey
      if (key === 'ArrowUp') { e.preventDefault(); togglePlay(); return }
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        e.preventDefault()
        const ms = shift ? 40 : 400
        seekBy((key === 'ArrowRight' ? 1 : -1) * ms / 1000)
        return
      }
      if (key === '+' || key === '=') { e.preventDefault(); changeSpeed(p => Math.min(SPEED_MAX, Math.round((p + SPEED_STEP) * 100) / 100)); return }
      if (key === '-' || key === '_') { e.preventDefault(); changeSpeed(p => Math.max(SPEED_MIN, Math.round((p - SPEED_STEP) * 100) / 100)); return }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [videoLoaded])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── Top bar ── */}
      <header style={{
        flexShrink: 0, height: 52,
        background: 'var(--bg-2)', borderBottom: '1px solid var(--b-1)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
      }}>
        <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={onBack}>
          ← Back
        </button>
        <div style={{ width: 1, height: 16, background: 'var(--b-2)' }}/>

        {/* Session info */}
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 14, color: 'var(--t-1)' }}>
            {session.matchName}
          </span>
          <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 10 }}>
            {formatHalf(session.half)} · Audit
          </span>
        </div>

        {/* Bridge status */}
        <BridgePill status={bridgeStatus}/>

        {/* Inject bridge */}
        <button className="btn-ghost" style={{ padding: '5px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={handleInjectBridge}>
          <span style={{ fontSize: 14 }}>⚡</span> Embed Bridge
        </button>

        {/* Get results — blocked with confirmation if already audited */}
        {reauditConfirm ? (
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(232,89,12,0.12)', border:'1px solid rgba(232,89,12,0.4)', borderRadius:8, padding:'6px 12px' }}>
            <span style={{ fontSize:12, color:'#E8590C', fontWeight:600 }}>Re-audit will overwrite existing results. Confirm?</span>
            <button className="btn-orange" style={{ padding:'4px 12px', fontSize:12 }} onClick={handleGetResults}>Yes, re-audit</button>
            <button className="btn-ghost" style={{ padding:'4px 10px', fontSize:12 }} onClick={() => setReauditConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button
            className="btn-orange"
            style={{ padding:'8px 18px', fontSize:13, opacity: loading ? 0.7 : 1, display:'flex', alignItems:'center', gap:8 }}
            disabled={loading || checkingSheet}
            onClick={handleGetResults}
            title={existingSession ? `Already audited on ${new Date(existingSession.completedAt).toLocaleDateString('en-GB')} — click to re-audit` : ''}
          >
            {loading ? (
              <>
                <svg style={{ animation:'spin 1s linear infinite' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" strokeOpacity=".3"/><path d="M12 2a10 10 0 0 1 10 10"/>
                </svg>
                Reading results…
              </>
            ) : checkingSheet ? (
              <>
                <svg style={{ animation:'spin 1s linear infinite' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" strokeOpacity=".3"/><path d="M12 2a10 10 0 0 1 10 10"/>
                </svg>
                Checking…
              </>
            ) : existingSession ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M9 19l-7-7 7-7"/><path d="M15 5l7 7-7 7"/>
                </svg>
                Re-audit Match
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M9 19l-7-7 7-7"/><path d="M15 5l7 7-7 7"/>
                </svg>
                Get Audit Results
              </>
            )}
          </button>
        )}
      </header>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Existing session banner — shown when match already audited, no new results yet ── */}
        {existingSession && !results && !loading && (
          <div style={{ background:'rgba(34,197,94,0.08)', borderBottom:'0.5px solid rgba(34,197,94,0.25)', padding:'10px 20px', display:'flex', alignItems:'center', gap:16, flexShrink:0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
            <div style={{ flex:1 }}>
              <span style={{ fontSize:13, fontWeight:600, color:'#22c55e' }}>Already audited</span>
              <span style={{ fontSize:12, color:'var(--t-3)', marginLeft:10 }}>
                Score: <strong style={{ color:'var(--t-1)' }}>{existingSession.score != null ? existingSession.score + '%' : '—'}</strong>
                {' · '}{existingSession.totalEvents} events
                {' · '}{existingSession.totalErrors} errors
                {' · '}{existingSession.reviewer ? `Reviewed by ${existingSession.reviewer.split('@')[0]}` : ''}
                {' · '}{existingSession.completedAt ? new Date(existingSession.completedAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : ''}
              </span>
            </div>
            <span style={{ fontSize:11, color:'var(--t-3)' }}>Data loaded from Sheet · {existingSession.amendments.length} amendment rows</span>
          </div>
        )}

        {/* Video area — full width. When results are shown, it occupies ~2/3 of the
            viewport height and the results/table pane takes the remaining ~1/3. */}
        <div style={{ background: '#000', position: 'relative', flexShrink: 0, width: '100%', height: results ? '66vh' : 'auto' }}>
          <video
            ref={videoRef}
            style={{ width: '100%', height: results ? '100%' : 400, objectFit: 'contain', display: 'block', transition: 'height .4s cubic-bezier(0.16,1,0.3,1)' }}
            onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
            onDurationChange={e => { if (isFinite(e.target.duration)) setDuration(e.target.duration) }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />

          {/* Video controls overlay */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
            padding: '20px 16px 10px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {/* Play/pause */}
            <button onClick={togglePlay} style={{
              width: 28, height: 28, borderRadius: 8, border: 'none',
              background: videoLoaded ? 'var(--p2)' : 'rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: videoLoaded ? 'pointer' : 'not-allowed', flexShrink: 0,
              boxShadow: videoLoaded ? '0 2px 8px rgba(232,89,12,0.4)' : 'none',
            }} disabled={!videoLoaded}>
              {playing
                ? <svg width="9" height="9" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                : <svg width="9" height="9" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>
              }
            </button>

            {/* Time */}
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'rgba(255,255,255,0.8)', flexShrink: 0 }}>
              {fmt(currentTime)}
            </span>

            {/* Scrubber */}
            <div
              style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, cursor: videoLoaded ? 'pointer' : 'default', position: 'relative' }}
              onClick={e => { if (!videoLoaded) return; const r = e.currentTarget.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width) }}
            >
              <div style={{
                height: '100%', borderRadius: 2, background: 'var(--p2)',
                width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
                transition: 'width .1s linear',
                boxShadow: '0 0 6px rgba(232,89,12,0.6)',
              }}/>
              {/* Scrubber thumb */}
              {duration > 0 && (
                <div style={{
                  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                  left: `${(currentTime / duration) * 100}%`,
                  width: 12, height: 12, borderRadius: '50%',
                  background: 'var(--p2)', marginLeft: -6,
                  boxShadow: '0 0 8px rgba(232,89,12,0.8)',
                }}/>
              )}
            </div>

            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
              {fmt(duration)}
            </span>

            {/* Playback speed (changed via + / - like Scout) */}
            {videoLoaded && speed !== 1 && (
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--p2)', flexShrink: 0, fontWeight: 700 }}>
                {speed}×
              </span>
            )}

            {/* Load video (when none) / Replace video (when one is loaded, in case the wrong file was opened) */}
            {!videoLoaded ? (
              <button className="btn-ghost" style={{ padding: '4px 12px', fontSize: 11, flexShrink: 0 }} onClick={loadVideo}>
                + Load Video
              </button>
            ) : (
              <button
                className="btn-ghost"
                title="Replace the loaded video"
                style={{ padding: '4px 10px', fontSize: 11, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}
                onClick={loadVideo}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 2v6h6"/><path d="M3 8a9 9 0 1 0 2.6-3.6L3 8"/>
                </svg>
                Replace
              </button>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="slide-down" style={{
            margin: '12px 16px 0', padding: '8px 14px', borderRadius: 8,
            background: 'rgba(255,69,58,0.1)', border: '1px solid rgba(255,69,58,0.3)',
            fontSize: 12, color: '#FF453A',
          }}>{error}</div>
        )}

        {/* Results area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {!results && !loading && (
            <div style={{ textAlign: 'center', paddingTop: 40 }}>
              {existingSession ? (
                // ── Already audited — full results from Sheet ──────────────
                <ExistingSessionView
                  session={existingSession}
                  onSeek={seekToSeconds}
                />
              ) : checkingSheet ? (
                <div style={{ fontSize:13, color:'var(--t-3)' }}>Checking for existing audit results…</div>
              ) : (
                // Not yet audited
                <>
                  <div style={{ width:56, height:56, borderRadius:16, background:'rgba(232,89,12,0.08)', border:'1px solid rgba(232,89,12,0.2)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--p2)" strokeWidth="2" strokeLinecap="round">
                      <path d="M9 19l-7-7 7-7"/><path d="M15 5l7 7-7 7"/>
                    </svg>
                  </div>
                  <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:14, color:'var(--t-2)', marginBottom:6 }}>
                    Ready to audit
                  </div>
                  <div style={{ fontSize:12, color:'var(--t-3)', lineHeight:1.6, maxWidth:320, margin:'0 auto' }}>
                    Make sure the collection app is open on this match and the bridge is injected.
                    When done reviewing, click <strong style={{ color:'var(--p2)' }}>Get Audit Results</strong>.
                  </div>
                </>
              )}
            </div>
          )}

          {results && score !== null && (
            <>
              <QuickSummary
                results={results}
                score={score}
                abcScores={abcScores}
                onFullReport={() => onFullReport(results, score, session)}
              />
              {resolvingIds && (
                <div className="fade-in" style={{
                  marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  fontSize: 11, color: 'var(--t-3)',
                }}>
                  <svg style={{ animation: 'spin 1s linear infinite' }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" strokeOpacity=".3"/><path d="M12 2a10 10 0 0 1 10 10"/>
                  </svg>
                  Resolving collector &amp; reviewer names…
                </div>
              )}
              <ModuleScores moduleScores={results.moduleScores} />
              <AmendmentsTable results={results} session={session} identityMap={results.identityMap} reviewerIds={results.reviewerIds || (results.reviewerId != null ? [results.reviewerId] : [])} onSeek={seekToSeconds} />

              {/* ── Export & Upload to Drive ── */}
              {!exportState && (
                <div className="fade-in" style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
                  <button
                    className="btn-orange"
                    style={{ padding: '9px 22px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
                    onClick={handleExportAndUpload}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Export CSV + Clips → Drive
                  </button>
                </div>
              )}

              {/* ── Progress bar ── */}
              {exportState && !exportState.done && (
                <div className="fade-in" style={{
                  marginTop: 16, background: 'var(--bg-1)', border: '0.5px solid var(--b-1)',
                  borderRadius: 16, padding: '14px 18px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-2)' }}>
                      {exportState.phase === 'folder'    && '📁 Creating Drive folder…'}
                      {exportState.phase === 'cutting'   && `✂️  Cutting clip ${exportState.step} of ${exportState.total - 1}…`}
                      {exportState.phase === 'uploading' && `☁️  Uploading ${exportState.step} of ${exportState.total}…`}
                      {exportState.phase === 'starting'  && 'Starting export…'}
                    </span>
                    <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--t-3)' }}>
                      {exportState.total > 0 ? `${Math.round((exportState.step / exportState.total) * 100)}%` : '…'}
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'var(--bg-3)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: exportState.total > 0 ? `${Math.round((exportState.step / exportState.total) * 100)}%` : '5%',
                      background: 'linear-gradient(90deg, var(--p), var(--p2))',
                      borderRadius: 999,
                      transition: 'width 0.4s var(--ease)',
                    }}/>
                  </div>
                  <div style={{ marginTop: 7, fontSize: 11, color: 'var(--t-3)' }}>
                    This may take 1–3 minutes depending on the number of errors and your connection.
                  </div>
                </div>
              )}

              {/* ── Done banner ── */}
              {exportState?.done && (
                <div className="fade-in" style={{
                  marginTop: 16, background: 'rgba(48,209,88,0.06)', border: '0.5px solid rgba(48,209,88,0.2)',
                  borderRadius: 16, padding: '12px 18px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#30D158' }}>
                        Uploaded to Drive — {exportState.total - 1} clips + CSV
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 2 }}>
                        Clips saved locally to Downloads folder too
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {exportState.driveLink && (
                      <button
                        onClick={() => invoke('open_file', { path: exportState.driveLink })}
                        style={{
                          padding: '5px 12px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: 'rgba(48,209,88,0.1)', color: '#30D158',
                          border: '0.5px solid rgba(48,209,88,0.25)', cursor: 'pointer',
                        }}
                      >
                        Open in Drive ↗
                      </button>
                    )}
                    <button
                      className="btn-ghost"
                      style={{ padding: '5px 12px', fontSize: 11 }}
                      onClick={() => setExportState(null)}
                    >
                      Re-export
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {saved && (
            <div className="fade-in" style={{
              marginTop: 10, textAlign: 'center', fontSize: 11, color: '#30D158',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.5" strokeLinecap="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
              Results saved · {results?.usedTelemetry ? 'Telemetry mode' : 'Video time mode'} · bridge {results?.bridgeVersion || 'OLD (re-inject!)'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
