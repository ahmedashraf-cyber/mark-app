import { useState, useEffect, useRef } from 'react'
import { db } from '../firebase/config'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import ErrorTimeline from '../components/ErrorTimeline'
import TaggedEventsList from '../components/TaggedEventsList'

const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00.000'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms  = Math.floor((s % 1) * 1000)
  return `${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
}

function QualityBadge({ score }) {
  const color = score >= 80 ? '#30D158' : score >= 60 ? '#FFD60A' : '#FF453A'
  return (
    <span style={{
      fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 800,
      color, background: `${color}18`,
      border: `1px solid ${color}44`,
      borderRadius: 6, padding: '2px 8px',
    }}>
      {score}%
    </span>
  )
}

// ── Session card on the list ──────────────────────────────────────────────────
function SessionCard({ session, onReview }) {
  const date = session.completedAt?.toDate?.()
    ? session.completedAt.toDate().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
    : session.matchDate || ''

  return (
    <div className="card" style={{ padding: '14px 16px', cursor: 'pointer', marginBottom: 8 }}
      onClick={() => onReview(session)}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 14, color: 'var(--t-1)', marginBottom: 3 }}>
            {session.matchName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--t-3)' }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--p2)', fontWeight: 700 }}>
              {session.matchId}
            </span>
            <span>·</span>
            <span>{session.half}</span>
            <span>·</span>
            <span>{date}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {session.qualityScore != null && <QualityBadge score={session.qualityScore} />}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--t-3)' }}>
              {session.totalTaggedErrors ?? 0} errors
            </div>
            <div style={{ fontSize: 10, color: 'var(--t-3)' }}>
              {session.totalReviewedEvents ?? 0} events
            </div>
          </div>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'var(--p2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(232,89,12,0.3)',
            flexShrink: 0,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
              <path d="M5 3l14 9-14 9V3z"/>
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Read-only review screen ───────────────────────────────────────────────────
function SessionReview({ session, tags, onBack }) {
  const videoRef    = useRef(null)
  const [videoLoaded, setVideoLoaded] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration,    setDuration]    = useState(0)
  const [playing,     setPlaying]     = useState(false)

  async function loadVideo() {
    try {
      const path = await invoke('pick_video_file')
      if (!path) return
      const url = await invoke('get_video_url', { path })
      const v = videoRef.current
      if (v) { v.src = url; v.load(); setVideoLoaded(true) }
    } catch(e) {
      console.error('[MARK] load video failed:', e)
    }
  }

  function seekTo(t) {
    const v = videoRef.current
    if (!v || !isFinite(t)) return
    v.currentTime = t
  }

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{
        flexShrink: 0, height: 48,
        background: 'var(--bg-2)', borderBottom: '1px solid var(--b-1)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
      }}>
        <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={onBack}>
          ← Back
        </button>
        <div style={{ height: 16, width: 1, background: 'var(--b-2)' }}/>
        <div>
          <span style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 13, color: 'var(--t-1)' }}>
            {session.matchName}
          </span>
          <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 8 }}>
            {session.half} · Read-only review
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {session.qualityScore != null && <QualityBadge score={session.qualityScore} />}
          <span style={{ fontSize: 11, color: 'var(--t-3)' }}>
            {tags.length} events tagged
          </span>
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Video */}
        <div style={{ flex: 1, position: 'relative', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <video
            ref={videoRef}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
            onDurationChange={e => { if (isFinite(e.target.duration)) setDuration(e.target.duration) }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          {!videoLoaded && (
            <div
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 12, cursor: 'pointer',
              }}
              onClick={loadVideo}
            >
              <div style={{ width: 64, height: 64, borderRadius: 16, border: '2px dashed var(--b-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M5 3l14 9-14 9V3z" stroke="var(--t-3)" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-2)' }}>Click to load video</div>
                <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 3 }}>Select the match video file</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls bar */}
      <div style={{ flexShrink: 0, background: 'var(--bg-2)', borderTop: '1px solid var(--b-1)', padding: '6px 16px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={togglePlay}
            style={{
              width: 28, height: 28, borderRadius: 7, border: 'none',
              background: playing ? 'var(--bg-3)' : 'var(--p2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            {playing
              ? <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>
            }
          </button>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--t-2)', flexShrink: 0 }}>
            {fmt(currentTime)}
          </span>
          {/* Scrubber */}
          <div style={{ flex: 1, height: 3, background: 'var(--b-2)', borderRadius: 2, position: 'relative', cursor: 'pointer' }}
            onClick={e => {
              if (!duration) return
              const rect = e.currentTarget.getBoundingClientRect()
              const pct  = (e.clientX - rect.left) / rect.width
              seekTo(pct * duration)
            }}
          >
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
              background: 'var(--p2)', borderRadius: 2,
              transition: 'width 0.1s linear',
            }}/>
          </div>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--t-3)', flexShrink: 0 }}>
            {fmt(duration)}
          </span>
        </div>
      </div>

      {/* Tagged events timeline */}
      <TaggedEventsList
        tags={tags}
        videoDuration={duration}
        currentTime={currentTime}
        matchName={session.matchName}
        onEdit={null}
        onDelete={null}
        onSeek={seekTo}
        readOnly
      />
    </div>
  )
}

// ── Main SessionHistoryPage ───────────────────────────────────────────────────
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
        // Sort by completedAt descending in JS — no composite index needed
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
      const q = query(
        collection(db, 'mark_error_tags'),
        where('sessionId', '==', session.sessionId)
      )
      const snap = await getDocs(q)
      const tags = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setActiveTags(tags)
      setActiveSession(session)
    } catch(e) {
      console.error('[MARK] load tags:', e)
    } finally {
      setTagsLoading(false)
    }
  }

  if (activeSession) {
    return (
      <SessionReview
        session={activeSession}
        tags={activeTags}
        onBack={() => { setActiveSession(null); setActiveTags([]) }}
      />
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{
        flexShrink: 0, height: 48,
        background: 'var(--bg-2)', borderBottom: '1px solid var(--b-1)',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
      }}>
        <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={onBack}>
          ← Back
        </button>
        <div style={{ height: 16, width: 1, background: 'var(--b-2)' }}/>
        <span style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 14, color: 'var(--t-1)' }}>
          Session History
        </span>
        {!loading && (
          <span style={{ fontSize: 11, color: 'var(--t-3)' }}>
            {sessions.length} completed sessions
          </span>
        )}
      </div>

      {/* Sessions list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--t-3)', paddingTop: 60, fontSize: 13 }}>
            Loading sessions...
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--t-3)', paddingTop: 60, fontSize: 13 }}>
            No completed sessions yet
          </div>
        ) : sessions.map(s => (
          <SessionCard
            key={s.id}
            session={s}
            onReview={tagsLoading ? () => {} : handleReview}
          />
        ))}
        {tagsLoading && (
          <div style={{ textAlign: 'center', color: 'var(--t-3)', paddingTop: 20, fontSize: 13 }}>
            Loading session data...
          </div>
        )}
      </div>
    </div>
  )
}
