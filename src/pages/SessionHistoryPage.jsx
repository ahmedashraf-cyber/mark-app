/**
 * SessionHistoryPage.jsx — past sessions list + single-session report.
 * ============================================================================
 *
 * This file has TWO views in one module:
 *
 *  1) THE LIST (default export) — all sessions for the user (or all users in
 *     admin mode), with a header search that filters by match name OR match ID
 *     (every half shares a match ID, so an ID surfaces the match and all its
 *     halves). Stats chips (total/scout/audit/avg) summarise the set. Each row
 *     is a SessionCard with a download (export) and a play (open report) button.
 *
 *  2) THE REPORT (the component rendered when a session is opened) — quality
 *     gauge, team split, top events/extras, the tagged-events list, and a VIDEO
 *     PLAYER. The player here is STANDALONE (no collection-app bridge): it
 *     auto-loads a saved path or lets you pick one (loadVideo → pick_video_file),
 *     supports the same transport keys as Scout (↑ / →← / +-), and has a
 *     "Change Video" button to replace the file.
 *
 * EXPORT (download button): handleExport pulls the session's tags from Firestore
 * and hands them to exportSessionToXlsx, which now saves via a native Rust save
 * dialog (save_xlsx_file) — see exportSession.js for why the old silent JS-fs
 * write was replaced.
 */
import { useState, useEffect, useRef } from 'react'
import { db } from '../firebase/config'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { useAdmin } from '../hooks/useAdmin.js'
import { invoke } from '@tauri-apps/api/core'
import { exportSessionToXlsx, exportSessionToUserDrive } from '../utils/exportSession'
import { EXTRAS, GK_EXTRAS, GK_WRONG_EXTRAS } from '../components/TagPanel'
import { SPEED_MIN, SPEED_MAX, SPEED_STEP } from '../data/shortcuts'
import { formatHalf } from '../utils/half.js'

// ── Collector Results Sheet — read audit sessions from here ───────
const COLLECTOR_SHEET_ID  = '1-XbJFxAhR2QYxOQHdwIUVp-XSqol-3VJdHVhSoSkPmw'
const COLLECTOR_SHEET_KEY = 'AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI'
const SES = {
  HR_CODE:0, SESSION_ID:1, MATCH_ID:2, MATCH_NAME:3, HALF:4, COMPLETED_AT:5,
  SCORE_OVERALL:6, SCORE_BASE:7, SCORE_PRESSURE:8, SCORE_PLAYERS:9,
  SCORE_LOCATION:10, SCORE_EXTRAS:11, SCORE_FREEZE:12,
  TOTAL_EVENTS:13, TOTAL_ERRORS:14,
  ERR_BASE:15, ERR_LOCATION:16, ERR_EXTRAS:17, ERR_PLAYERS:18,
  ERR_DELETION:19, ERR_CAMERA:20, ERR_ADDED:21,
  REVIEWER_EMAIL:22, COLLECTOR_DISPLAY:23, MARK_VERSION:24, COLLECTOR_NAME:25,
}

async function loadAuditSessionsFromSheet(reviewerEmail) {
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${COLLECTOR_SHEET_ID}/values/Sessions!A2:Z?key=${COLLECTOR_SHEET_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    const rows = data.values || []

    // Parse and filter to this reviewer's sessions
    const parsed = rows.map(r => ({
      sessionId:      r[SES.SESSION_ID]    || '',
      matchId:        r[SES.MATCH_ID]      || '',
      matchName:      r[SES.MATCH_NAME]    || '',
      half:           r[SES.HALF]          || '',
      completedAt:    r[SES.COMPLETED_AT]  ? new Date(r[SES.COMPLETED_AT]) : null,
      qualityScore:   r[SES.SCORE_OVERALL] ? parseFloat(r[SES.SCORE_OVERALL]) : null,
      totalBaseEvents:parseInt(r[SES.TOTAL_EVENTS])  || 0,
      totalAmendments:parseInt(r[SES.TOTAL_ERRORS])  || 0,
      reviewerEmail:  r[SES.REVIEWER_EMAIL]|| '',
      collectorName:  r[SES.COLLECTOR_NAME]|| '',
      hrCode:         r[SES.HR_CODE]       || '',
      type:           'audit',
      _fromSheet:     true,
    })).filter(s => s.sessionId)

    // Filter to this reviewer and deduplicate — keep only latest per matchId+half
    // If reviewerEmail is null → admin mode, return latest per matchId+half across ALL reviewers
    const byKey = {}
    parsed
      .filter(s => !reviewerEmail || (s.reviewerEmail || '').toLowerCase() === reviewerEmail.toLowerCase())
      .forEach(s => {
        const key = `${s.matchId}_${s.half}`
        const existing = byKey[key]
        if (!existing || (s.completedAt && (!existing.completedAt || s.completedAt > existing.completedAt))) {
          byKey[key] = s
        }
      })

    return Object.values(byKey)
  } catch(e) {
    console.warn('[MARK] Sheet audit load failed, falling back to Firestore:', e.message)
    return null // null = fallback to Firestore
  }
}

// ------ Helpers ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms  = Math.floor((s % 1) * 1000)
  return `${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
}

function extraLabel(id) {
  const all = [...EXTRAS, ...GK_EXTRAS, ...Object.values(GK_WRONG_EXTRAS || {}).flat()]
  return all.find(e => e.id === id)?.label || id
}

const DOT_COLORS = ['#E8590C','#0A84FF','#30D158','#FFD60A','#FF453A','#BF5AF2','#FF9F0A','#64D2FF']
const getDotColor = (i) => DOT_COLORS[i % DOT_COLORS.length]

function parseTeams(matchName) {
  const parts = (matchName || '').split(' vs ')
  return { home: parts[0]?.trim() || 'Home', away: parts[1]?.trim() || 'Away' }
}

// ------ Quality Gauge ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function QualityGauge({ score }) {
  const color  = score >= 80 ? '#30D158' : score >= 60 ? '#FFD60A' : '#FF453A'
  const r      = 40
  const circ   = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: 100, height: 100 }}>
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--b-2)" strokeWidth="8"/>
          <circle cx="50" cy="50" r={r} fill="none"
            stroke={color} strokeWidth="8"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 1s var(--ease-out-expo)' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'Inter', fontWeight: 900, fontSize: 22, color, lineHeight: 1 }}>{score}</span>
          <span style={{ fontSize: 9, color: 'var(--t-3)', fontWeight: 700, letterSpacing: 1 }}>QUALITY</span>
        </div>
      </div>
    </div>
  )
}

// ------ Stats Panel ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function StatsPanel({ session, tags }) {
  const { home, away } = parseTeams(session.matchName)
  const homeTags = tags.filter(t => t.team === 'home')
  const awayTags = tags.filter(t => t.team === 'away')

  // Event type breakdown
  const eventCounts = {}
  tags.forEach(t => {
    const label = t.triggeredEventLabel || t.triggeredKey || '?'
    eventCounts[label] = (eventCounts[label] || 0) + 1
  })
  const topEvents = Object.entries(eventCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)

  // Extra type breakdown
  const extraCounts = {}
  tags.forEach(t => {
    (t.extras || []).forEach(eid => {
      const label = extraLabel(eid)
      extraCounts[label] = (extraCounts[label] || 0) + 1
    })
  })
  const topExtras = Object.entries(extraCounts).sort((a,b) => b[1]-a[1]).slice(0, 5)

  const maxEvent = Math.max(...topEvents.map(e => e[1]), 1)

  return (
    <div style={{
      width: 220, flexShrink: 0,
      display: 'flex', flexDirection: 'column', gap: 0,
      borderRight: '1px solid var(--b-1)',
      overflowY: 'auto',
    }}>
      {/* Quality gauge */}
      <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid var(--b-1)', textAlign: 'center' }}>
        <QualityGauge score={session.qualityScore || 0} />
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--t-3)' }}>
          <span style={{ color: 'var(--t-2)', fontWeight: 700 }}>{session.totalTaggedErrors || 0}</span> errors /
          <span style={{ color: 'var(--t-2)', fontWeight: 700 }}> {session.totalReviewedEvents || 0}</span> events
        </div>
      </div>

      {/* Team split */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--b-1)' }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--t-3)', letterSpacing: 1.2, marginBottom: 10 }}>TEAM SPLIT</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[
            { label: home, count: homeTags.length, color: '#0A84FF', total: tags.length },
            { label: away, count: awayTags.length, color: '#FF453A', total: tags.length },
          ].map(t => (
            <div key={t.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--t-2)', fontWeight: 600 }}>{t.label}</span>
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: t.color, fontWeight: 700 }}>{t.count}</span>
              </div>
              <div style={{ height: 3, background: 'var(--b-2)', borderRadius: 2 }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: t.total > 0 ? `${(t.count / t.total) * 100}%` : '0%',
                  background: t.color,
                  transition: 'width 0.8s var(--ease-out-expo)',
                }}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top events */}
      {topEvents.length > 0 && (
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--b-1)' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--t-3)', letterSpacing: 1.2, marginBottom: 10 }}>TOP EVENTS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {topEvents.map(([label, count]) => (
              <div key={label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--t-2)' }}>{label}</span>
                  <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--p2)', fontWeight: 700 }}>{count}</span>
                </div>
                <div style={{ height: 2, background: 'var(--b-2)', borderRadius: 1 }}>
                  <div style={{
                    height: '100%', borderRadius: 1,
                    width: `${(count / maxEvent) * 100}%`,
                    background: 'var(--p2)',
                    transition: 'width 0.8s var(--ease-out-expo)',
                  }}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top extras */}
      {topExtras.length > 0 && (
        <div style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--t-3)', letterSpacing: 1.2, marginBottom: 10 }}>TOP EXTRAS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {topExtras.map(([label, count], i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: getDotColor(i), flexShrink: 0 }}/>
                  <span style={{ fontSize: 11, color: 'var(--t-2)' }}>{label}</span>
                </div>
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: getDotColor(i), fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ------ Event Timeline Card ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
function EventCard({ tag, index, isExpanded, onClick, teamColors, onSeek, videoLoaded }) {
  const extras   = (tag.extras || []).map(extraLabel)
  const teamColor = tag.team === 'home' ? teamColors.home : tag.team === 'away' ? teamColors.away : 'var(--b-2)'
  const isHome   = tag.team === 'home'
  const isAway   = tag.team === 'away'

  return (
    <div
      className="fade-in"
      style={{
        animationDelay: `${index * 0.04}s`,
        display: 'flex', gap: 0, marginBottom: 0,
      }}
    >
      {/* Timeline connector */}
      <div style={{ width: 48, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
          color: 'var(--p2)', marginTop: 14, textAlign: 'center', lineHeight: 1.2,
        }}>
          {fmt(tag.videoTimeSec)}
        </div>
        <div style={{ flex: 1, width: 1, background: 'var(--b-1)', marginTop: 6 }}/>
      </div>

      {/* Card */}
      <div
        onClick={onClick}
        style={{
          flex: 1, margin: '8px 16px 0 8px',
          background: isExpanded ? 'var(--bg-3)' : 'var(--bg-2)',
          border: `1px solid ${isExpanded ? teamColor : 'var(--b-1)'}`,
          borderLeft: `3px solid ${teamColor}`,
          borderRadius: 10,
          cursor: 'pointer',
          overflow: 'hidden',
          transition: 'all 0.18s var(--ease-out-expo)',
          boxShadow: isExpanded ? `0 4px 20px ${teamColor}22` : 'none',
        }}
      >
        {/* Card header */}
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Event key badge */}
          <span style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
            background: tag.isMissing ? '#BF5AF2' : 'var(--p2)', color: '#fff',
            borderRadius: 5, padding: '2px 6px', flexShrink: 0,
          }}>
            {tag.triggeredKey || '?'}
          </span>

          {/* Event name */}
          <span style={{
            fontFamily: 'Inter', fontWeight: 700, fontSize: 13, color: 'var(--t-1)', flex: 1,
          }}>
            {tag.triggeredEventLabel || tag.triggeredKey}
          </span>

          {/* Team badge */}
          {(isHome || isAway) && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: teamColor,
              background: `${teamColor}18`,
              border: `1px solid ${teamColor}44`,
              borderRadius: 4, padding: '1px 7px', flexShrink: 0,
            }}>
              {isHome ? 'H' : 'A'}
            </span>
          )}

          {/* Extras dots */}
          {extras.length > 0 && !isExpanded && (
            <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
              {extras.map((_, i) => (
                <div key={i} style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: getDotColor(i),
                  boxShadow: `0 0 3px ${getDotColor(i)}88`,
                }}/>
              ))}
            </div>
          )}

          {/* Expand chevron */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            style={{ flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
            <path d="M6 9l6 6 6-6" stroke="var(--t-3)" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>

        {/* Expanded detail */}
        {isExpanded && (
          <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--b-1)' }}>
            {extras.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 10 }}>
                {extras.map((label, i) => (
                  <span key={i} style={{
                    fontSize: 11, fontWeight: 600,
                    color: getDotColor(i),
                    background: `${getDotColor(i)}14`,
                    border: `1px solid ${getDotColor(i)}40`,
                    borderRadius: 5, padding: '3px 9px',
                  }}>
                    {label}
                  </span>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--t-3)', fontStyle: 'italic', paddingTop: 8 }}>No extras tagged</div>
            )}

            {videoLoaded && (
              <button
                onClick={e => { e.stopPropagation(); onSeek(tag.videoTimeSec || 0) }}
                style={{
                  marginTop: 10, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                  border: '1px solid rgba(232,89,12,0.4)',
                  background: 'rgba(232,89,12,0.1)',
                  color: 'var(--p2)', fontSize: 11, fontWeight: 700,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5 3l14 9-14 9V3z"/>
                </svg>
                Seek to {fmt(tag.videoTimeSec)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ------ Match Report (read-only review) ------------------------------------------------------------------------------------------------------------------------------
function MatchReport({ session, tags, onBack }) {
  const [expandedId,  setExpandedId]  = useState(null)
  const [videoLoaded, setVideoLoaded] = useState(false)
  const [playing,     setPlaying]     = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration,    setDuration]    = useState(0)
  const [speed,       setSpeed]       = useState(1)
  const [showVideo,   setShowVideo]   = useState(false)
  const videoRef = useRef(null)
  const { home, away } = parseTeams(session.matchName)
  const teamColors = { home: '#0A84FF', away: '#FF453A' }

  const sorted = [...tags].sort((a, b) => (a.videoTimeSec || 0) - (b.videoTimeSec || 0))

  // Auto-load video from localStorage path
  useEffect(() => {
    const key = `mark_video_path_${session.matchId}`
    const savedPath = localStorage.getItem(key)
    if (savedPath) {
      invoke('get_video_url', { path: savedPath })
        .then(url => {
          const v = videoRef.current
          if (v) {
            v.src = url
            v.load()
            setVideoLoaded(true)
            setShowVideo(true)
          }
        })
        .catch(() => {})
    }
  }, [session.matchId])

  async function loadVideo() {
    try {
      const path = await invoke('pick_video_file')
      if (!path) return
      localStorage.setItem(`mark_video_path_${session.matchId}`, path)
      const url = await invoke('get_video_url', { path })
      const v = videoRef.current
      if (v) { v.src = url; v.load(); setVideoLoaded(true); setShowVideo(true) }
    } catch(e) { console.error('[MARK] load video:', e) }
  }

  function seekTo(t) {
    const v = videoRef.current
    if (!v || !isFinite(t)) return
    v.currentTime = t
    if (v.paused) v.play().catch(() => {})
    setPlaying(true)
  }

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
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

  // Video keyboard controls — same method as MARK Scout (no collection-app sync here)
  useEffect(() => {
    if (!videoLoaded || !showVideo) return
    function handleKey(e) {
      const key = e.key, shift = e.shiftKey
      if (key === 'ArrowUp') { e.preventDefault(); togglePlay(); return }       // ↑ play / pause
      if (key === 'ArrowRight' || key === 'ArrowLeft') {                        // → / ← seek 400ms (40ms w/ Shift)
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
  }, [videoLoaded, showVideo])

  const date = session.completedAt?.toDate?.()
    ? session.completedAt.toDate().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
    : session.matchDate || ''

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{
        flexShrink: 0,
        background: 'var(--bg-2)', borderBottom: '1px solid var(--b-1)',
        padding: '0 16px', height: 48,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={onBack}>
          Back
        </button>
        <div style={{ width: 1, height: 16, background: 'var(--b-2)' }}/>
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 14, color: 'var(--t-1)' }}>
            {session.matchName}
          </span>
          <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 10 }}>
            {formatHalf(session.half)} -- {date}
          </span>
        </div>
        {!videoLoaded && (
          <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={loadVideo}>
            + Load Video
          </button>
        )}
        {videoLoaded && (
          <>
            <button className="btn-ghost" title="Remove the current video and load a new one"
              style={{ padding: '5px 12px', fontSize: 11, display:'flex', alignItems:'center', gap:6 }}
              onClick={loadVideo}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
              </svg>
              Change Video
            </button>
            <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
              onClick={() => setShowVideo(v => !v)}>
              {showVideo ? 'Hide Video' : 'Show Video'}
            </button>
          </>
        )}
      </div>

      {/* Single video element — always in DOM, wrapper shown/hidden */}
      <div style={{ flexShrink: 0, background: '#000', position: 'relative', display: showVideo ? 'block' : 'none' }}>
        <video
          ref={videoRef}
          style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', display: 'block' }}
          onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
          onDurationChange={e => { if (isFinite(e.target.duration)) setDuration(e.target.duration) }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        {/* Mini controls */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
          padding: '12px 14px 8px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <button onClick={togglePlay} style={{
            width: 24, height: 24, borderRadius: 6, border: 'none',
            background: playing ? 'rgba(255,255,255,0.2)' : 'var(--p2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
          }}>
            {playing
              ? <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              : <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>
            }
          </button>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'rgba(255,255,255,0.8)', flexShrink: 0 }}>
            {fmt(currentTime)}
          </span>
          <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.2)', borderRadius: 2, cursor: 'pointer' }}
            onClick={e => {
              if (!duration) return
              const rect = e.currentTarget.getBoundingClientRect()
              seekTo((e.clientX - rect.left) / rect.width * duration)
            }}
          >
            <div style={{
              height: '100%', borderRadius: 2, background: 'var(--p2)',
              width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
              transition: 'width 0.1s linear',
            }}/>
          </div>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>
            {fmt(duration)}
          </span>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10, flexShrink: 0,
            color: speed === 1 ? 'rgba(255,255,255,0.5)' : 'var(--p2)',
            background: 'rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 6px',
          }}>
            {speed % 1 === 0 ? speed + '.0' : speed}×
          </span>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Stats panel */}
        <StatsPanel session={session} tags={tags} />

        {/* Event timeline */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0 24px' }}>
          {sorted.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--t-3)', paddingTop: 60, fontSize: 13, fontStyle: 'italic' }}>
              No events tagged in this session
            </div>
          ) : (
            <>
              {/* Team legend */}
              <div style={{ display: 'flex', gap: 16, padding: '0 20px 14px 64px' }}>
                {[
                  { label: home, color: '#0A84FF' },
                  { label: away, color: '#FF453A' },
                ].map(t => (
                  <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: t.color }}/>
                    <span style={{ fontSize: 11, color: 'var(--t-3)', fontWeight: 600 }}>{t.label}</span>
                  </div>
                ))}
                <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 'auto' }}>
                  {sorted.length} events -- click to expand
                </span>
              </div>

              {sorted.map((tag, i) => (
                <EventCard
                  key={tag.id || i}
                  tag={tag}
                  index={i}
                  isExpanded={expandedId === (tag.id || i)}
                  onClick={() => setExpandedId(expandedId === (tag.id || i) ? null : (tag.id || i))}
                  teamColors={teamColors}
                  onSeek={seekTo}
                  videoLoaded={videoLoaded}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ------ Session Card (list view) ------------------------------------------------------------------------------------------------------------------------------------------------------
function SessionCard({ session, onReview, onExport, onExportSheets, loading, isAdmin }) {
  const score  = session.qualityScore || 0
  const color  = score >= 80 ? '#30D158' : score >= 60 ? '#FFD60A' : '#FF453A'
  const isAudit = session.type === 'audit'
  const date   = session.completedAt?.toDate?.()
    ? session.completedAt.toDate().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
    : ''

  // Mini arc for score
  const r = 16, circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ

  return (
    <div
      onClick={() => !loading && onReview(session)}
      style={{
        display:'flex', alignItems:'center', gap:14,
        padding:'14px 20px', cursor:'pointer',
        borderBottom:'1px solid var(--b-1)',
        transition:'background .12s',
        position:'relative',
      }}
      onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.025)'}
      onMouseLeave={e => e.currentTarget.style.background='transparent'}
    >
      {/* Left accent bar */}
      <div style={{
        position:'absolute', left:0, top:'20%', bottom:'20%', width:2,
        background:color, borderRadius:2, opacity:0.6,
      }}/>

      {/* Score ring */}
      <div style={{ position:'relative', width:44, height:44, flexShrink:0 }}>
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r={r} fill="none" stroke="var(--b-2)" strokeWidth="3"/>
          <circle cx="22" cy="22" r={r} fill="none"
            stroke={color} strokeWidth="3"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transform:'rotate(-90deg)', transformOrigin:'50% 50%' }}
          />
        </svg>
        <div style={{
          position:'absolute', inset:0,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <span style={{ fontFamily:'Inter', fontWeight:900, fontSize:10, color, lineHeight:1 }}>{score}%</span>
        </div>
      </div>

      {/* Match info */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:4 }}>
          <span style={{ fontFamily:'Inter', fontWeight:700, fontSize:13, color:'var(--t-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {session.matchName}
          </span>
          <span style={{
            fontSize:8, fontWeight:800, padding:'1px 6px', borderRadius:4, flexShrink:0,
            background:isAudit?'rgba(10,132,255,0.12)':'rgba(232,89,12,0.1)',
            color:isAudit?'#0A84FF':'var(--p2)',
            border:`1px solid ${isAudit?'rgba(10,132,255,0.2)':'rgba(232,89,12,0.2)'}`,
            letterSpacing:0.5,
          }}>{isAudit?'AUDIT':'SCOUT'}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:10, color:'var(--t-3)', flexWrap:'wrap' }}>
          <span style={{ fontFamily:'JetBrains Mono, monospace', color:'var(--p2)', fontWeight:600, fontSize:9 }}>{session.matchId}</span>
          <span style={{ color:'var(--b-2)' }}>·</span>
          <span>{formatHalf(session.half)}</span>
          <span style={{ color:'var(--b-2)' }}>·</span>
          <span>{date}</span>
          {isAdmin && session.reviewerEmail && (
            <>
              <span style={{ color:'var(--b-2)' }}>·</span>
              <span style={{
                fontSize:9, color:'#FFD700', fontWeight:600,
                display:'flex', alignItems:'center', gap:3,
              }}>
                <span>👤</span>{session.reviewerEmail}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'flex', gap:20, flexShrink:0, alignItems:'center' }}>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontFamily:'Inter', fontWeight:800, fontSize:16, color, lineHeight:1 }}>{session.totalTaggedErrors || 0}</div>
          <div style={{ fontSize:9, color:'var(--t-3)', fontWeight:600, letterSpacing:0.5, marginTop:2 }}>ERRORS</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontFamily:'Inter', fontWeight:700, fontSize:16, color:'var(--t-2)', lineHeight:1 }}>{session.totalReviewedEvents || 0}</div>
          <div style={{ fontSize:9, color:'var(--t-3)', fontWeight:600, letterSpacing:0.5, marginTop:2 }}>REVIEWED</div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display:'flex', gap:6, flexShrink:0 }}>
        <button
          onClick={e => { e.stopPropagation(); onExport(session) }}
          title="Export CSV"
          style={{
            width:32, height:32, borderRadius:8,
            background:'rgba(48,209,88,0.08)', border:'1px solid rgba(48,209,88,0.2)',
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
            transition:'all .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background='rgba(48,209,88,0.16)'}
          onMouseLeave={e => e.currentTarget.style.background='rgba(48,209,88,0.08)'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 3v13M6 11l6 6 6-6"/><path d="M4 20h16"/>
          </svg>
        </button>
        <button
          onClick={e => { e.stopPropagation(); onExportSheets(session) }}
          title="Export to Google Sheet"
          style={{
            width:32, height:32, borderRadius:8,
            background:'rgba(10,132,255,0.10)', border:'1px solid rgba(10,132,255,0.28)',
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
            transition:'all .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background='rgba(10,132,255,0.20)'}
          onMouseLeave={e => e.currentTarget.style.background='rgba(10,132,255,0.10)'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0A84FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>
          </svg>
        </button>
        <button
          onClick={e => { e.stopPropagation(); onReview(session) }}
          style={{
            width:32, height:32, borderRadius:8,
            background:'var(--p2)', border:'none',
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
            boxShadow:'0 2px 8px rgba(232,89,12,0.25)',
            transition:'all .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform='scale(1.08)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(232,89,12,0.4)' }}
          onMouseLeave={e => { e.currentTarget.style.transform='scale(1)'; e.currentTarget.style.boxShadow='0 2px 8px rgba(232,89,12,0.25)' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>
        </button>
      </div>
    </div>
  )
}

// ------ Main Page ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export default function SessionHistoryPage({ onBack, initialSession }) {
  const { profile } = useAuth()
  const [sessions,      setSessions]      = useState([])
  const [allSessions,   setAllSessions]   = useState([])
  const [loading,       setLoading]       = useState(true)
  const isAdmin = useAdmin(profile)
  const [adminMode,     setAdminMode]     = useState(isAdmin)  // admin sees all sessions by default
  const [activeSession, setActiveSession] = useState(null)
  const [activeTags,    setActiveTags]    = useState([])
  const [tagsLoading,   setTagsLoading]   = useState(false)
  const [search,        setSearch]        = useState('')

  useEffect(() => {
    if (!profile?.uid) return
    async function load() {
      setLoading(true)
      try {
        // Map an audit-session doc to the shape the history rows expect.
        const mapAudit = d => {
          const x = d.data()
          return {
            id: d.id, ...x,
            type: 'audit',
            mode: 'audit',
            totalTaggedErrors:   x.uniqueEditedEvents ?? x.totalAmendments ?? 0,
            totalReviewedEvents: x.totalBaseEvents ?? 0,
          }
        }

        // Own Scout sessions (always from Firestore)
        const q = query(
          collection(db, 'mark_sessions'),
          where('reviewerId', '==', profile.uid),
          where('status', '==', 'completed')
        )
        const snap = await getDocs(q)
        const scoutList = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        // Own Audit sessions — read from Sheet (latest per matchId+half), fallback to Firestore
        // Admin loads ALL sessions regardless of reviewer
        let auditList = await loadAuditSessionsFromSheet(isAdmin ? null : profile.email)
        if (!auditList) {
          // Firestore fallback
          const auditQ = query(collection(db, 'mark_audit_sessions'), where('reviewerId', '==', profile.uid))
          const auditSnap = await getDocs(auditQ).catch(() => ({ docs: [] }))
          // Deduplicate — keep only latest per matchId+half
          const byKey = {}
          auditSnap.docs.map(d => mapAudit(d)).forEach(s => {
            const key = `${s.matchId}_${s.half}`
            const existing = byKey[key]
            const sTime = s.completedAt?.toDate?.()?.getTime() || 0
            const eTime = existing?.completedAt?.toDate?.()?.getTime() || 0
            if (!existing || sTime > eTime) byKey[key] = s
          })
          auditList = Object.values(byKey)
        }

        const list = [...scoutList, ...auditList]
        list.sort((a, b) => {
          const at = a.completedAt instanceof Date ? a.completedAt.getTime() : (a.completedAt?.toDate?.()?.getTime() || 0)
          const bt = b.completedAt instanceof Date ? b.completedAt.getTime() : (b.completedAt?.toDate?.()?.getTime() || 0)
          return bt - at
        })
        setSessions(list)

        // Admin: also load ALL sessions (Scout + Audit), deduplicated
        if (profile.email === 'ahmed.ashraf@hudl.com') {
          const allQ = query(collection(db, 'mark_sessions'), where('status', '==', 'completed'))
          const allAuditQ = query(collection(db, 'mark_audit_sessions'))
          const [allSnap, allAuditSnap] = await Promise.all([getDocs(allQ), getDocs(allAuditQ).catch(() => ({ docs: [] }))])
          // Deduplicate audit sessions — keep latest per matchId+half+reviewerId
          const auditByKey = {}
          allAuditSnap.docs.map(d => mapAudit(d)).forEach(s => {
            const key = `${s.matchId}_${s.half}_${s.reviewerId || s.reviewerEmail}`
            const existing = auditByKey[key]
            const sTime = s.completedAt?.toDate?.()?.getTime() || 0
            const eTime = existing?.completedAt?.toDate?.()?.getTime() || 0
            if (!existing || sTime > eTime) auditByKey[key] = s
          })
          const allList = [
            ...allSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            ...Object.values(auditByKey),
          ]
          allList.sort((a, b) => (b.completedAt?.toDate?.()?.getTime() || 0) - (a.completedAt?.toDate?.()?.getTime() || 0))
          setAllSessions(allList)
        }

        if (initialSession) handleReview(initialSession)
      } catch(e) {
        console.error('[MARK] load sessions:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [profile?.uid])

  async function handleExport(session) {
    try {
      const q    = query(collection(db, 'mark_error_tags'), where('sessionId', '==', session.sessionId))
      const snap = await getDocs(q)
      const tags = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      await exportSessionToXlsx({
        session,
        tags,
        quality: session.qualityScore || 0,
        tagCount: session.totalTaggedErrors || 0,
        total: session.totalReviewedEvents || 0,
        videoPath: null,
      })
    } catch(e) {
      console.error('[MARK] export failed:', e)
    }
  }

  // STAGE 1 — Google Sheet in the reviewer's OWN Drive (OAuth sign-in, drive.file).
  // First run opens the browser to sign in; after that it's silent (refresh token).
  async function handleExportSheets(session) {
    try {
      const q    = query(collection(db, 'mark_error_tags'), where('sessionId', '==', session.sessionId))
      const snap = await getDocs(q)
      const tags = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const url  = await exportSessionToUserDrive({
        session,
        tags,
        quality: session.qualityScore || 0,
        tagCount: session.totalTaggedErrors || 0,
        total: session.totalReviewedEvents || 0,
      })
      const { invoke } = await import('@tauri-apps/api/core')
      if (url) await invoke('open_file', { path: url })
    } catch(e) {
      console.error('[MARK] Google Sheets export failed:', e)
      alert('Google Sheets export failed:\n\n' + (e?.message || e))
    }
  }

  async function handleReview(session) {
    setTagsLoading(true)
    try {
      if (session.type === 'audit' || session.mode === 'audit') {
        // Audit replay: amendments live in a separate collection. Map each to the
        // tag shape MatchReport/EventCard already render, so click-to-seek works
        // the same way (seek uses videoTimeSec).
        const aq   = query(collection(db, 'mark_audit_amendments'), where('sessionId', '==', session.sessionId))
        const asnap = await getDocs(aq)
        const tags = asnap.docs.map(d => {
          const x = d.data()
          const ms = x.videoTimestamp ?? x.payload?.videoTimestamp ?? null
          return {
            id: d.id,
            videoTimeSec: ms != null ? ms / 1000 : 0,
            team: 'home',
            triggeredKey: x.type || 'edit',
            triggeredEventLabel: x.originalName || x.type || 'edit',
            extras: [],
            isMissing: x.type === 'added',
          }
        }).sort((a, b) => (a.videoTimeSec || 0) - (b.videoTimeSec || 0))
        setActiveTags(tags)
        setActiveSession(session)
      } else {
        const q    = query(collection(db, 'mark_error_tags'), where('sessionId', '==', session.sessionId))
        const snap = await getDocs(q)
        setActiveTags(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setActiveSession(session)
      }
    } catch(e) {
      console.error('[MARK] load tags:', e)
    } finally {
      setTagsLoading(false)
    }
  }

  if (activeSession) {
    return <MatchReport session={activeSession} tags={activeTags} onBack={() => { setActiveSession(null); setActiveTags([]) }} />
  }

  // Compute stats
  const displayedSessions = adminMode ? allSessions : sessions
  const q = search.trim().toLowerCase()
  const filteredSessions = q
    ? displayedSessions.filter(s =>
        (s.matchName || '').toLowerCase().includes(q) ||
        String(s.matchId || '').toLowerCase().includes(q))
    : displayedSessions
  const totalSessions  = displayedSessions.length
  const avgScore       = displayedSessions.length > 0 ? Math.round(displayedSessions.reduce((s, x) => s + (x.qualityScore || 0), 0) / displayedSessions.length) : 0
  const scoutSessions  = displayedSessions.filter(s => s.type !== 'audit').length
  const auditSessions  = displayedSessions.filter(s => s.type === 'audit').length

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:'var(--bg)', overflow:'hidden' }}>

      {/* ── Header ── */}
      <header style={{
        flexShrink:0, height:52,
        background:'var(--bg-2)', borderBottom:'1px solid var(--b-1)',
        display:'flex', alignItems:'center', padding:'0 20px', gap:12,
      }}>
        <button className="btn-ghost" style={{ padding:'5px 12px', fontSize:11, display:'flex', alignItems:'center', gap:5 }} onClick={onBack}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          Back
        </button>
        <div style={{ width:1, height:16, background:'var(--b-2)' }}/>
        <div style={{ flex:1 }}>
          <span style={{ fontFamily:'Inter', fontWeight:900, fontSize:14, color:'var(--t-1)', letterSpacing:-0.2 }}>Session History</span>
        </div>

        {/* Search — match name or ID */}
        <div style={{ position:'relative', width:240 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--t-3)" strokeWidth="2.5" strokeLinecap="round"
            style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search match or ID…"
            style={{
              width:'100%', padding:'6px 26px 6px 30px', borderRadius:8,
              border:'1px solid var(--b-1)', background:'rgba(255,255,255,0.04)',
              color:'var(--t-1)', fontSize:12, fontFamily:'Inter', outline:'none', boxSizing:'border-box',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--p2)'}
            onBlur={e => e.target.style.borderColor = 'var(--b-1)'}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              position:'absolute', right:6, top:'50%', transform:'translateY(-50%)',
              width:16, height:16, borderRadius:'50%', border:'none', cursor:'pointer',
              background:'var(--b-2)', color:'var(--t-2)', fontSize:10, lineHeight:1,
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>×</button>
          )}
        </div>

        {/* Admin toggle */}
        {isAdmin && (
          <div style={{ display:'flex', alignItems:'center', gap:6,
            padding:'3px 4px', borderRadius:20,
            background:'rgba(255,215,0,0.06)', border:'1px solid rgba(255,215,0,0.2)',
          }}>
            <span style={{ fontSize:10, paddingLeft:8 }}>👑</span>
            {['Mine','All'].map(mode => (
              <button key={mode}
                onClick={() => setAdminMode(mode === 'All')}
                style={{
                  padding:'3px 10px', borderRadius:16, fontSize:11, fontWeight:700,
                  cursor:'pointer', border:'none',
                  background: (mode === 'All') === adminMode ? 'rgba(255,215,0,0.2)' : 'transparent',
                  color: (mode === 'All') === adminMode ? '#FFD700' : 'var(--t-3)',
                  transition:'all .15s',
                }}>{mode}</button>
            ))}
          </div>
        )}

        {/* Connect sender account — admin only */}
        {isAdmin && (
          <button
            onClick={async () => {
              try {
                const result = await invoke('connect_sender_account')
                alert(result)
              } catch(e) {
                alert('Connection failed: ' + e)
              }
            }}
            style={{
              padding:'3px 10px', borderRadius:16, fontSize:11, fontWeight:700,
              cursor:'pointer', border:'1px solid rgba(68,153,255,0.3)',
              background:'rgba(68,153,255,0.08)', color:'#4499FF',
            }}
            title="Connect hudl.quality.egypt@gmail.com as the report email sender"
          >📧 Connect Sender</button>
        )}

        {/* Stats pills */}
        {!loading && displayedSessions.length > 0 && (
          <div style={{ display:'flex', gap:8 }}>
            {[
              { label:'Total', value:totalSessions, color:'var(--t-2)' },
              { label:'Scout', value:scoutSessions, color:'var(--p2)' },
              { label:'Audit', value:auditSessions, color:'#0A84FF' },
              { label:'Avg Score', value:`${avgScore}%`, color: avgScore>=80?'#30D158':avgScore>=60?'#FFD60A':'#FF453A' },
            ].map(s => (
              <div key={s.label} style={{
                display:'flex', alignItems:'center', gap:5,
                padding:'3px 10px', borderRadius:20,
                background:'rgba(255,255,255,0.04)', border:'1px solid var(--b-1)',
              }}>
                <span style={{ fontSize:12, fontWeight:800, color:s.color, fontFamily:'Inter' }}>{s.value}</span>
                <span style={{ fontSize:9, color:'var(--t-3)', fontWeight:600, letterSpacing:0.5 }}>{s.label.toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
      </header>

      {/* ── Session list ── */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {loading ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', flexDirection:'column', gap:12 }}>
            <svg style={{ animation:'spin 1s linear infinite' }} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--t-3)" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" strokeOpacity=".2"/><path d="M12 2a10 10 0 0 1 10 10"/>
            </svg>
            <span style={{ fontSize:12, color:'var(--t-3)' }}>Loading sessions…</span>
          </div>
        ) : displayedSessions.length === 0 ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', flexDirection:'column', gap:10 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--b-2)" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 9h18"/><circle cx="8" cy="14" r="1" fill="var(--b-2)"/><circle cx="12" cy="14" r="1" fill="var(--b-2)"/><circle cx="16" cy="14" r="1" fill="var(--b-2)"/>
            </svg>
            <span style={{ fontSize:13, color:'var(--t-3)' }}>No completed sessions yet</span>
            <span style={{ fontSize:11, color:'var(--t-3)', opacity:0.6 }}>Sessions will appear here after you finish a review</span>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div style={{
              display:'grid', gridTemplateColumns:'60px 1fr 80px 80px 80px',
              padding:'8px 20px', borderBottom:'1px solid var(--b-1)',
              background:'var(--bg-2)', position:'sticky', top:0, zIndex:10,
            }}>
              {['SCORE','MATCH','ERRORS','REVIEWED',''].map((h,i) => (
                <div key={i} style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:1.2, textAlign:i>=2?'right':'left' }}>{h}</div>
              ))}
            </div>

            {filteredSessions.length === 0 ? (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'48px 20px', flexDirection:'column', gap:6 }}>
                <span style={{ fontSize:13, color:'var(--t-3)' }}>No sessions match “{search}”</span>
                <span style={{ fontSize:11, color:'var(--t-3)', opacity:0.6 }}>Try a different match name or ID</span>
              </div>
            ) : filteredSessions.map(s => (
              <SessionCard key={s.id} session={s} onReview={handleReview} onExport={handleExport} onExportSheets={handleExportSheets} loading={tagsLoading} isAdmin={isAdmin} />
            ))}
          </>
        )}
        {tagsLoading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:16, fontSize:12, color:'var(--t-3)' }}>
            <svg style={{ animation:'spin 1s linear infinite' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" strokeOpacity=".2"/><path d="M12 2a10 10 0 0 1 10 10"/>
            </svg>
            Loading session…
          </div>
        )}
      </div>
    </div>
  )
}
