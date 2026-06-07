import { useState, useEffect, useRef } from 'react'
import { db } from '../firebase/config'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { invoke } from '@tauri-apps/api/core'
import { EXTRAS, GK_EXTRAS, GK_WRONG_EXTRAS } from '../components/TagPanel'

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
            {session.half} -- {date}
          </span>
        </div>
        {!videoLoaded && (
          <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={loadVideo}>
            + Load Video
          </button>
        )}
        {videoLoaded && (
          <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
            onClick={() => setShowVideo(v => !v)}>
            {showVideo ? 'Hide Video' : 'Show Video'}
          </button>
        )}
      </div>

      {/* Video player - collapsible */}
      {showVideo && (
        <div style={{ flexShrink: 0, background: '#000', position: 'relative' }} className="slide-down">
          <video
            ref={videoRef}
            style={{ width: '100%', maxHeight: 280, objectFit: 'contain', display: 'block' }}
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
          </div>
        </div>
      )}

      {/* Hidden video element for auto-load without showing */}
      {!showVideo && <video ref={videoRef} style={{ display: 'none' }}
        onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
        onDurationChange={e => { if (isFinite(e.target.duration)) setDuration(e.target.duration) }}
      />}

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
function SessionCard({ session, onReview, loading }) {
  const color = (session.qualityScore || 0) >= 80 ? '#30D158' : (session.qualityScore || 0) >= 60 ? '#FFD60A' : '#FF453A'
  const date  = session.completedAt?.toDate?.()
    ? session.completedAt.toDate().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
    : ''

  return (
    <div className="card" style={{ padding: '14px 16px', cursor: 'pointer', marginBottom: 8 }}
      onClick={() => !loading && onReview(session)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Quality indicator */}
        <div style={{
          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
          background: `${color}18`, border: `1.5px solid ${color}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'Inter', fontWeight: 900, fontSize: 13, color }}>{session.qualityScore || 0}%</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 14, color: 'var(--t-1)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.matchName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--t-3)' }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--p2)', fontWeight: 700 }}>{session.matchId}</span>
            <span>--</span>
            <span>{session.half}</span>
            {date && <><span>--</span><span>{date}</span></>}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--t-2)', fontWeight: 600 }}>{session.totalTaggedErrors || 0} errors</div>
          <div style={{ fontSize: 10, color: 'var(--t-3)', marginTop: 2 }}>{session.totalReviewedEvents || 0} events reviewed</div>
        </div>

        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: 'var(--p2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(232,89,12,0.3)',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>
        </div>
      </div>
    </div>
  )
}

// ------ Main Page ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export default function SessionHistoryPage({ onBack }) {
  const { profile } = useAuth()
  const [sessions,      setSessions]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [activeSession, setActiveSession] = useState(null)
  const [activeTags,    setActiveTags]    = useState([])
  const [tagsLoading,   setTagsLoading]   = useState(false)

  useEffect(() => {
    if (!profile?.uid) return
    async function load() {
      setLoading(true)
      try {
        const q = query(
          collection(db, 'mark_sessions'),
          where('reviewerId', '==', profile.uid),
          where('status', '==', 'completed')
        )
        const snap = await getDocs(q)
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        list.sort((a, b) => {
          const ta = a.completedAt?.toDate?.()?.getTime() || 0
          const tb = b.completedAt?.toDate?.()?.getTime() || 0
          return tb - ta
        })
        setSessions(list)
      } catch(e) {
        console.error('[MARK] load sessions:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [profile?.uid])

  async function handleReview(session) {
    setTagsLoading(true)
    try {
      const q    = query(collection(db, 'mark_error_tags'), where('sessionId', '==', session.sessionId))
      const snap = await getDocs(q)
      setActiveTags(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setActiveSession(session)
    } catch(e) {
      console.error('[MARK] load tags:', e)
    } finally {
      setTagsLoading(false)
    }
  }

  if (activeSession) {
    return <MatchReport session={activeSession} tags={activeTags} onBack={() => { setActiveSession(null); setActiveTags([]) }} />
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      <div style={{
        flexShrink: 0, height: 48,
        background: 'var(--bg-2)', borderBottom: '1px solid var(--b-1)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
      }}>
        <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={onBack}>
          Back
        </button>
        <div style={{ width: 1, height: 16, background: 'var(--b-2)' }}/>
        <span style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 14, color: 'var(--t-1)' }}>Session History</span>
        {!loading && (
          <span style={{ fontSize: 11, color: 'var(--t-3)' }}>{sessions.length} completed sessions</span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--t-3)', paddingTop: 60, fontSize: 13 }}>Loading...</div>
        ) : sessions.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--t-3)', paddingTop: 60, fontSize: 13 }}>No completed sessions yet</div>
        ) : sessions.map(s => (
          <SessionCard key={s.id} session={s} onReview={handleReview} loading={tagsLoading} />
        ))}
        {tagsLoading && (
          <div style={{ textAlign: 'center', color: 'var(--t-3)', paddingTop: 16, fontSize: 12 }}>Loading session data...</div>
        )}
      </div>
    </div>
  )
}
