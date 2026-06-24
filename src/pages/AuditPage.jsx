import { useState, useRef, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { db } from '../firebase/config'
import { collection, addDoc, serverTimestamp, getDocs, query, where } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { useSync } from '../hooks/useSync.js'
import { formatHalf } from '../utils/half.js'
import { loadRoster, saveIdentities, buildIdentityMap, formatPerson, formatPeople } from '../data/roster.js'

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
  const [activeFilter, setActiveFilter] = useState(null)   // null = show all; else a CHANGE type
  const { baseEvents } = results
  // Show edits by ANY real reviewer (all types) — collectors' edits are ignored.
  const reviewerSet = new Set((reviewerIds || []).map(Number))
  const amendments = results.amendments.filter(a => reviewerSet.has(Number(a.author)))

  // Identity lookup (legacyId -> { hrcode, name, email }) resolved by the bridge
  // from EventHistory and merged with the persistent Firestore roster.
  const idMap = identityMap || results.identityMap || {}

  // Build refinement lookup (collector's original values) by key+type
  const refinementMap = {}
  try {
    const cache = window.apollo?.client?.cache?.extract() || {}
    Object.values(cache).forEach(v => {
      if (v.__typename === 'Event' && v.category === 'refinement') {
        const k = `${v.key}_${v.type}`
        if (!refinementMap[k]) refinementMap[k] = v.payload || {}
      }
    })
  } catch(e) {}

  // Build base event lookup
  const baseByKey = {}
  baseEvents.forEach(e => { baseByKey[e.key] = e })

  // Deduplicate amendments by key
  const byKey = {}
  amendments.forEach(a => {
    if (!byKey[a.key]) byKey[a.key] = []
    byKey[a.key].push(a)
  })

  // Include reviewer-ADDED events (collector missed them) that have no amendment,
  // so the table shows every error event the score counts.
  baseEvents.forEach(e => {
    if (reviewerSet.has(Number(e.author)) && !byKey[e.key]) {
      byKey[e.key] = [{ key: e.key, type: 'added', author: e.author, capturedTime: e.capturedTime, payload: {} }]
    }
  })

  // Helper: extract clean value from fields object (values only, no keys)
  function cleanFields(fields) {
    if (!fields) return '—'
    return Object.entries(fields)
      .filter(([k, v]) => k !== 'extras' && v !== null && v !== undefined && String(v) !== '')
      .map(([, v]) => Array.isArray(v) ? v.join(', ') : String(v))
      .join(' · ') || '—'
  }

  // Build rows
  const rows = Object.entries(byKey).map(([key, amends]) => {
    const base = baseByKey[key]
    const types = [...new Set(amends.map(a => a.type))]
    const latestAmend = [...amends].sort((a, b) =>
      (b.capturedTime || '').localeCompare(a.capturedTime || '')
    )[0]

    // Before: from refinement (collector's original), After: from amendment
    let before = '—'
    let after = '—'

    const mainAmend = amends[0]
    if (mainAmend.type === 'deletion') {
      before = base?.name || '—'
      after = 'Deleted'
    } else if (mainAmend.type === 'base') {
      before = base?.name || '—'
      after = mainAmend.payload?.name || cleanFields(mainAmend.payload?.fields)
    } else if (mainAmend.type === 'extras' || mainAmend.type === 'location') {
      const refKey = `${key}_${mainAmend.type}`
      const ref = refinementMap[refKey]
      before = ref ? cleanFields(ref.fields) : '—'
      after = cleanFields(mainAmend.payload?.fields)
    } else if (mainAmend.type === 'camera') {
      before = '—'
      after = mainAmend.payload?.name || cleanFields(mainAmend.payload?.fields)
    } else if (mainAmend.type === 'added') {
      before = '—'
      after = 'Added (missed)'
    }

    const collectorAuthorId = base?.author
    const reviewerAuthorId = latestAmend?.author
    const reviewerName = formatPerson(idMap[String(reviewerAuthorId)], reviewerAuthorId)
    const collectorDisplay = formatPerson(idMap[String(collectorAuthorId)], collectorAuthorId)

    return {
      key,
      eventName:    base?.name || '—',
      timestamp:    base?.videoTimestamp ? fmt(base.videoTimestamp / 1000) : '—',
      tsSec:        base?.videoTimestamp != null ? base.videoTimestamp / 1000 : null,
      teamId:       base?.teamId || '—',
      types,
      before,
      after,
      collectorId:  collectorDisplay,
      reviewerName,
      capturedTime: latestAmend?.capturedTime || '',
    }
  }).sort((a, b) => {
    const ta = baseByKey[a.key]?.videoTimestamp || 0
    const tb = baseByKey[b.key]?.videoTimestamp || 0
    return ta - tb
  })

  // Issue 3: distinct CHANGE types present (for the filter pills), and the filtered view.
  const presentTypes = [...new Set(rows.flatMap(r => r.types))].sort()
  const visibleRows = activeFilter ? rows.filter(r => r.types.includes(activeFilter)) : rows

  function downloadCSV() {
    const headers = ['Match ID','Match Name','Half','Timestamp','Event Name','Team','Change Types','Before Change','After Change','Collector ID','Reviewer ID','Captured Time']
    const csvRows = rows.map(r => [
      session.matchId,
      session.matchName,
      formatHalf(session.half),
      r.timestamp,
      r.eventName,
      r.teamId,
      r.types.join(' + '),
      r.before || '—',
      r.after  || '—',
      r.collectorId,
      r.reviewerName,
      r.capturedTime,
    ])
    const csv = [headers, ...csvRows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|]/g, '').trim()
    a.download = `${safe(session.matchId)} - ${safe(session.matchName)} - ${formatHalf(session.half)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (rows.length === 0) return null

  const AMEND_COLORS = {
    deletion: '#FF453A', extras: '#FFD60A', base: '#E8590C',
    camera: '#BF5AF2', location: '#0A84FF',
  }

  return (
    <div className="fade-in" style={{ marginTop: 14 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ fontSize:10, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2 }}>
          AMENDMENTS — {rows.length} EVENTS EDITED
        </div>
        <button
          className="btn-ghost"
          style={{ padding:'4px 12px', fontSize:11, display:'flex', alignItems:'center', gap:6 }}
          onClick={downloadCSV}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 3v13M6 11l6 6 6-6"/><path d="M4 20h16"/>
          </svg>
          Download CSV
        </button>
      </div>

      {/* Collectors & reviewers for this half — Update #1 yields possibly MULTIPLE collectors */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 18px', marginBottom:10, fontSize:11, color:'var(--t-3)' }}>
        <span>
          <span style={{ fontWeight:700, color:'var(--t-2)' }}>
            {(results.collectorIds && results.collectorIds.length > 1) ? 'Collectors: ' : 'Collector: '}
          </span>
          {formatPeople(results.collectorIds && results.collectorIds.length ? results.collectorIds : [results.collectorId], idMap, results.collectorId)}
        </span>
        <span>
          <span style={{ fontWeight:700, color:'var(--t-2)' }}>
            {(reviewerIds && reviewerIds.length > 1) ? 'Reviewers: ' : 'Reviewer: '}
          </span>
          {formatPeople(reviewerIds, idMap, results.reviewerId)}
        </span>
      </div>

      {/* Issue 3: filter by CHANGE type */}
      {presentTypes.length > 1 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10, alignItems:'center' }}>
          <span style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:1, marginRight:2 }}>FILTER</span>
          <button
            onClick={() => setActiveFilter(null)}
            style={{
              fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:6, cursor:'pointer',
              background: activeFilter === null ? 'var(--p2)' : 'transparent',
              color: activeFilter === null ? '#fff' : 'var(--t-3)',
              border:`1px solid ${activeFilter === null ? 'var(--p2)' : 'var(--b-2)'}`,
            }}
          >All ({rows.length})</button>
          {presentTypes.map(t => {
            const count = rows.filter(r => r.types.includes(t)).length
            const col = AMEND_COLORS[t] || 'var(--t-3)'
            const on = activeFilter === t
            return (
              <button key={t}
                onClick={() => setActiveFilter(on ? null : t)}
                style={{
                  fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:6, cursor:'pointer',
                  background: on ? col : `${col}14`,
                  color: on ? '#fff' : col,
                  border:`1px solid ${on ? col : col+'40'}`,
                }}
              >{t} ({count})</button>
            )
          })}
        </div>
      )}

      {/* Table */}
      <div style={{ borderRadius:10, border:'1px solid var(--b-1)', overflow:'hidden' }}>
        {/* Header row */}
        <div style={{
          display:'grid',
          gridTemplateColumns:'60px 1fr 60px 110px 130px 130px 70px 70px 70px',
          padding:'7px 14px',
          background:'var(--bg-3)',
          borderBottom:'1px solid var(--b-1)',
        }}>
          {['TIME','EVENT','TEAM','CHANGE','BEFORE','AFTER','COLLECTOR','REVIEWER','CAPTURED'].map(h => (
            <span key={h} style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:1 }}>{h}</span>
          ))}
        </div>

        {/* Data rows */}
        <div style={{ maxHeight:280, overflowY:'auto' }}>
          {visibleRows.map((r, i) => {
            const seekable = r.tsSec != null && typeof onSeek === 'function'
            return (
            <div key={r.key} style={{
              display:'grid',
              gridTemplateColumns:'60px 1fr 60px 110px 130px 130px 70px 70px 70px',
              padding:'7px 14px',
              borderBottom:'1px solid var(--b-1)',
              background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
              borderLeft:`2px solid ${AMEND_COLORS[r.types[0]] || 'var(--b-2)'}`,
              transition:'background .1s',
              cursor: seekable ? 'pointer' : 'default',
            }}
              title={seekable ? `Jump to ${r.timestamp}` : undefined}
              onClick={() => { if (seekable) onSeek(r.tsSec) }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.03)'}
              onMouseLeave={e => e.currentTarget.style.background= i%2===0?'transparent':'rgba(255,255,255,0.01)'}
            >
              <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color:'var(--p2)' }}>{r.timestamp}</span>
              <span style={{ fontSize:11, color:'var(--t-1)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.eventName}</span>
              <span style={{ fontSize:10, color:'var(--t-3)' }}>{r.teamId}</span>
              <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                {r.types.map((t, j) => (
                  <span key={j} style={{
                    fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:4,
                    background:`${AMEND_COLORS[t] || 'var(--t-3)'}14`,
                    color: AMEND_COLORS[t] || 'var(--t-3)',
                    border:`1px solid ${AMEND_COLORS[t] || 'var(--t-3)'}30`,
                  }}>{t}</span>
                ))}
              </div>
              <span style={{ fontSize:10, color:'#FF453A', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.before}>{r.before || '—'}</span>
              <span style={{ fontSize:10, color:'#30D158', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.after}>{r.after || '—'}</span>
              <span style={{ fontSize:10, color:'var(--t-3)', fontFamily:'JetBrains Mono, monospace' }}>{r.collectorId}</span>
              <span style={{ fontSize:10, color:'var(--t-2)', fontWeight:500 }}>{r.reviewerName}</span>
              <span style={{ fontSize:9, color:'var(--t-3)' }}>
                {r.capturedTime ? new Date(r.capturedTime).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) : '—'}
              </span>
            </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main AuditPage ─────────────────────────────────────────────────────────────
export default function AuditPage({ session, onBack, onFullReport }) {
  const { profile } = useAuth()
  const videoRef    = useRef(null)
  const [videoLoaded,    setVideoLoaded]    = useState(false)
  const [playing,        setPlaying]        = useState(false)
  const [currentTime,    setCurrentTime]    = useState(0)
  const [duration,       setDuration]       = useState(0)
  const [bridgeStatus,   setBridgeStatus]   = useState('disconnected')
  const [loading,        setLoading]        = useState(false)
  const [results,        setResults]        = useState(null)
  const [score,          setScore]          = useState(null)
  const [error,          setError]          = useState('')
  const [saved,          setSaved]          = useState(false)
  const [abcScores,      setAbcScores]      = useState(null)
  const [resolvingIds,   setResolvingIds]   = useState(false)

  const { requestQAResults, resolveMatchIdentities } = useSync(setBridgeStatus, session.sessionId)

  // Persistent Firestore roster backbone — loaded once, used as a fallback when
  // a person wasn't resolved live this session.
  const rosterRef = useRef({})
  useEffect(() => {
    loadRoster().then(r => { rosterRef.current = r })
  }, [])

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
    if (bridgeStatus !== 'connected') {
      setError('Bridge not connected — click ⚡ Embed Bridge first (with the collection app closed)')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await requestQAResults(session.matchId, session.half)
      if (!data) { setError('No data returned — make sure collection app is open on this match'); setLoading(false); return }

      // All reviewers (set) — falls back to the single primary if needed.
      const reviewerIds = (data.reviewerIds && data.reviewerIds.length)
        ? data.reviewerIds
        : (data.reviewerId != null ? [data.reviewerId] : [])
      // Normalize so QuickSummary, the table, and the score all read the SAME list
      data.reviewerIds = reviewerIds

      // Calculate score — errors = reviewer edits/deletions + reviewer-added misses
      const errorKeys = computeErrorKeys(data.baseEvents, data.amendments, reviewerIds)
      const uniqueEdited = errorKeys.size
      const total = data.baseEvents.length
      const q = total > 0 ? Math.round(((total - uniqueEdited) / total) * 100) : 0

      // Calculate A/B/C scores using refinement extras from cache
      let refinements = {}
      try {
        const cache = window.apollo?.client?.cache?.extract() || {}
        Object.values(cache).forEach(v => {
          if (v.__typename === 'Event' && v.category === 'refinement' && v.type === 'extras') {
            const extras = Object.keys(v.payload?.fields || {}).filter(k => k !== 'extras')
            refinements[v.key] = extras
          }
        })
      } catch(e) {}

      const abc = {}
      for (const [key, group] of Object.entries(REVIEW_GROUPS)) {
        abc[key] = calcGroupScore(group, data.baseEvents, data.amendments, refinements, reviewerIds)
      }
      // Seed the identity map from whatever the bridge already harvested
      // (passive tap / prior sweep) plus the persistent roster.
      const seedIdentities = data.identities || []
      data.identityMap = buildIdentityMap(seedIdentities, rosterRef.current)

      setAbcScores(abc)
      setResults(data)
      setScore(q)

      // Save to Firebase
      if (!saved) {
        await saveToFirebase(data, q, abc)
        setSaved(true)
      }

      // Auto-resolve EVERY collector/reviewer identity in the background — the
      // bridge sweeps EventHistory so we no longer open each card by hand. Names
      // fill in a moment after results render; resolved people are persisted to
      // the roster so future audits show them instantly.
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

  async function saveToFirebase(data, q, abc) {
    try {
      const reviewerIds = (data.reviewerIds && data.reviewerIds.length)
        ? data.reviewerIds
        : (data.reviewerId != null ? [data.reviewerId] : [])
      const reviewerAmends = filterAmendments(data.amendments, reviewerIds)
      const uniqueEdited = computeErrorKeys(data.baseEvents, data.amendments, reviewerIds).size
      const types = {}
      reviewerAmends.forEach(a => { types[a.type] = (types[a.type] || 0) + 1 })

      await addDoc(collection(db, 'mark_audit_sessions'), {
        sessionId:          session.sessionId,
        matchId:            session.matchId,
        matchName:          session.matchName,
        half:               session.half,
        reviewerId:         profile.uid,
        reviewerEmail:      profile.email,
        reviewerName:       profile.displayName || profile.email.split('@')[0],
        collectorId:        data.collectorId,
        collectorIds:       data.collectorIds || (data.collectorId != null ? [data.collectorId] : []),
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
        amendmentTypes:     types,
        status:             'completed',
        completedAt:        serverTimestamp(),
      })

      // Save amendment details
      for (const a of data.amendments) {
        await addDoc(collection(db, 'mark_audit_amendments'), {
          sessionId:    session.sessionId,
          matchId:      session.matchId,
          amendmentId:  a.id,
          key:          a.key,
          type:         a.type,
          originalName: a.originalName,
          author:       a.author,
          capturedTime: a.capturedTime,
          payload:      a.payload || {},
        })
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

        {/* Get results */}
        <button
          className="btn-orange"
          style={{
            padding: '8px 18px', fontSize: 13,
            opacity: loading ? 0.7 : 1,
            display: 'flex', alignItems: 'center', gap: 8,
          }}
          disabled={loading}
          onClick={handleGetResults}
        >
          {loading ? (
            <>
              <svg style={{ animation: 'spin 1s linear infinite' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" strokeOpacity=".3"/>
                <path d="M12 2a10 10 0 0 1 10 10"/>
              </svg>
              Reading results…
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
      </header>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

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
              <div style={{
                width: 56, height: 56, borderRadius: 16, background: 'rgba(232,89,12,0.08)',
                border: '1px solid rgba(232,89,12,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--p2)" strokeWidth="2" strokeLinecap="round">
                  <path d="M9 19l-7-7 7-7"/><path d="M15 5l7 7-7 7"/>
                </svg>
              </div>
              <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 14, color: 'var(--t-2)', marginBottom: 6 }}>
                Ready to audit
              </div>
              <div style={{ fontSize: 12, color: 'var(--t-3)', lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
                Make sure the collection app is open on this match and the bridge is injected.
                When done reviewing, click <strong style={{ color: 'var(--p2)' }}>Get Audit Results</strong>.
              </div>
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
