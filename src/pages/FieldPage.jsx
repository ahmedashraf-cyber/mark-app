/**
 * FieldPage.jsx — pure data-collection mode ("Field")
 * ============================================================================
 *
 * Field mode is the opposite of Scout: the user IS the collector, not the
 * reviewer. Every event tagged is primary data — there is no error type step,
 * no quality score, no bridge sync with Tag Once.
 *
 * WHAT IS SHARED WITH SCOUT (not copied — referenced directly):
 *   • EventsSidebar       — same event palettes and hotkeys
 *   • KEY_TO_EVENT        — same keyboard shortcuts
 *   • ErrorTimeline       — reused as EventTimeline (same component, neutral label)
 *   • TaggedEventsList    — same list; extras shown as empty for collected events
 *   • video player        — same pick_video_file + get_video_url Rust path
 *
 * WHAT IS DIFFERENT FROM SCOUT:
 *   • No TagPanel / error type step — key press → captured immediately
 *   • Writes to `mark_collected_events` (not `mark_error_tags`) with source:'field'
 *   • No matchId — session keyed to video file path hash
 *   • No bridge calls (requestEventCount, syncNavigation, etc.)
 *   • No quality score, pressure score, A/B/C/D/TO scores
 *   • Pressure is just an event — no MP/OP shape step
 *   • Export has no error columns
 *
 * SESSION IDENTITY:
 *   sessionId = field_${uid}_${videoPathHash}_${date}
 *   Stored in localStorage['mark_field_sessions'] as JSON array.
 *   Keyed to videoPath — reopening the same file resumes the same session.
 *   If file is missing on reopen, user is prompted to re-link.
 *
 * DATA SEPARATION:
 *   All writes go to `mark_collected_events` collection (never mark_error_tags).
 *   Every doc has mode:'field', source:'field'.
 *   Existing queries on mark_error_tags never pick up Field rows.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { db } from '../firebase/config'
import { collection, addDoc, updateDoc, doc, setDoc, getDocs,
         query, where, serverTimestamp, deleteDoc } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { KEY_TO_EVENT, SPEED_MIN, SPEED_MAX, SPEED_STEP } from '../data/shortcuts'
import EventsSidebar from '../components/EventsSidebar'
import TaggedEventsList from '../components/TaggedEventsList'
import ErrorTimeline from '../components/ErrorTimeline'

// ── Stable video path hash — 12-char base64 of the path ──────────────────────
function hashPath(path) {
  try { return btoa(encodeURIComponent(path)).replace(/[/+=]/g,'').slice(0,14) }
  catch { return String(Date.now()).slice(-10) }
}

// ── Local session store (localStorage) ───────────────────────────────────────
const LS_KEY = 'mark_field_sessions'
function loadLocalSessions() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function saveLocalSession(sess) {
  const all = loadLocalSessions().filter(s => s.sessionId !== sess.sessionId)
  localStorage.setItem(LS_KEY, JSON.stringify([sess, ...all].slice(0, 50)))
}
function findSessionByPath(videoPath) {
  return loadLocalSessions().find(s => s.videoPath === videoPath && s.status !== 'completed') || null
}

// ── Video filename from path ──────────────────────────────────────────────────
function basename(path) {
  if (!path) return 'Untitled'
  return path.split(/[\\/]/).pop() || path
}

// ── Format video time ─────────────────────────────────────────────────────────
function fmtTime(s) {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2,'0')}`
}

// ── FieldPage ─────────────────────────────────────────────────────────────────
export default function FieldPage({ session: initialSession, onDone, onBack }) {
  const { profile } = useAuth()

  const videoRef     = useRef(null)
  const isDraggingRef= useRef(false)
  const collStartRef = useRef(null) // timestamp of first event — for speed metric

  const [videoLoaded,  setVideoLoaded]  = useState(false)
  const [videoPath,    setVideoPath]    = useState(null)
  const [videoError,   setVideoError]   = useState(null)
  const [playing,      setPlaying]      = useState(false)
  const [muted,        setMuted]        = useState(false)
  const [speed,        setSpeed]        = useState(1)
  const [currentTime,  setCurrentTime]  = useState(0)
  const [duration,     setDuration]     = useState(0)
  const [activeKey,    setActiveKey]    = useState(null)

  // Session — created lazily when first video is loaded
  const [session,      setSession]      = useState(initialSession || null)
  const [events,       setEvents]       = useState([])

  // Flash indicator when an event is captured
  const [flashEvent,   setFlashEvent]   = useState(null)

  // Done modal
  const [showDoneModal, setShowDoneModal] = useState(false)
  const [submitting,    setSubmitting]   = useState(false)

  // ── Load existing events from Firestore when session is known ───────────────
  useEffect(() => {
    if (!session?.sessionId) return
    getDocs(query(
      collection(db, 'mark_collected_events'),
      where('sessionId', '==', session.sessionId)
    )).then(snap => {
      const loaded = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
      loaded.sort((a,b) => (a.videoTimeSec||0) - (b.videoTimeSec||0))
      setEvents(loaded)
    }).catch(e => console.warn('[MARK Field] load events failed:', e))
  }, [session?.sessionId])

  // ── Try to restore session from localStorage on mount ──────────────────────
  useEffect(() => {
    if (session) return // already have one from initialSession
    // Restore last open session if video path is still valid
    const saved = loadLocalSessions().find(s => s.status !== 'completed')
    if (saved) {
      setSession(saved)
      // Attempt to auto-load the saved video
      if (saved.videoPath) {
        invoke('get_video_url', { path: saved.videoPath })
          .then(url => {
            setVideoPath(saved.videoPath)
            const v = videoRef.current
            if (v) { v.src = url; v.load(); setVideoLoaded(true) }
          })
          .catch(() => {
            // File not found — show prompt to re-link
            setVideoPath(saved.videoPath)
            setVideoError(`Video not found at original path — pick a new location.\n${saved.videoPath}`)
          })
      }
    }
  }, [])

  // ── Create or resume a session for a given video path ──────────────────────
  async function ensureSession(path) {
    // Resume existing session keyed to this file
    const existing = findSessionByPath(path)
    if (existing) {
      setSession(existing)
      return existing
    }
    // Create new
    const sessionId  = `field_${profile.uid}_${hashPath(path)}_${Date.now()}`
    const videoName  = basename(path)
    const newSession = {
      sessionId,
      videoPath:   path,
      videoName,
      mode:        'field',
      source:      'field',
      collectorId: profile.uid,
      collectorEmail: profile.email,
      collectorName:  profile.displayName || profile.email.split('@')[0],
      status:      'in_progress',
      startedAt:   new Date().toISOString(),
      totalEvents: 0,
    }
    // Write to Firestore
    try {
      await setDoc(doc(db, 'mark_field_sessions', sessionId), {
        ...newSession,
        startedAt: serverTimestamp(),
      })
    } catch(e) { console.warn('[MARK Field] session create failed:', e) }
    // Write to localStorage
    saveLocalSession(newSession)
    setSession(newSession)
    return newSession
  }

  // ── Video loading ──────────────────────────────────────────────────────────
  async function handleVideoFile(forcedPath) {
    try {
      const path = forcedPath || await invoke('pick_video_file')
      if (!path) return
      setVideoError(null)
      const url = await invoke('get_video_url', { path })
      setVideoPath(path)
      const v = videoRef.current
      if (v) {
        v.src = url
        v.load()
        setVideoLoaded(true)
      }
      await ensureSession(path)
    } catch (e) {
      console.error('[MARK Field] video load failed:', e)
      setVideoError('Could not load this video file. Try a different format (mp4, mkv, mov).')
    }
  }

  // ── Video error handler — catches codec/format failures ────────────────────
  function handleVideoError() {
    setVideoError('This video could not be decoded. Try converting to mp4 (H.264) first.')
    setVideoLoaded(false)
  }

  // ── Playback helpers ───────────────────────────────────────────────────────
  function togglePlay() {
    const v = videoRef.current; if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else          { v.pause(); setPlaying(false) }
  }
  function changeSpeed(updater) {
    const v = videoRef.current; if (!v) return
    const next = typeof updater === 'function' ? updater(v.playbackRate) : updater
    v.playbackRate = next; setSpeed(next)
  }
  function seekBy(secs) {
    const v = videoRef.current; if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration||0, v.currentTime + secs))
    setCurrentTime(v.currentTime)
  }
  function seekTo(secs) {
    const v = videoRef.current; if (!v) return
    if (!isFinite(secs) || !isFinite(v.duration)) return
    v.currentTime = Math.max(0, Math.min(v.duration, secs))
    setCurrentTime(v.currentTime)
  }
  function toggleMute() {
    const v = videoRef.current; if (!v) return
    v.muted = !v.muted; setMuted(v.muted)
  }

  // ── Event capture — no error type step, direct save ──────────────────────
  async function captureEvent(eventId, eventLabel, videoTimeSec) {
    if (!session) return
    if (collStartRef.current === null) collStartRef.current = Date.now()

    const id  = `field_${Date.now()}_${Math.random().toString(36).slice(2,7)}`
    const ev  = {
      id,
      sessionId:      session.sessionId,
      videoPath:      videoPath || session.videoPath || '',
      videoTimeSec,
      eventId,
      eventLabel,
      // No extras, no errorType, no team, no pressureShape
      extras:         [],     // always empty — Field mode has no error fields
      source:         'field',
      mode:           'field',
      collectorId:    profile.uid,
      collectorEmail: profile.email,
      timestamp:      Date.now(),
    }
    try {
      const docRef = await addDoc(collection(db, 'mark_collected_events'), {
        ...ev, createdAt: serverTimestamp(),
      })
      const withDoc = { ...ev, _docId: docRef.id }
      setEvents(prev => [...prev, withDoc].sort((a,b) => a.videoTimeSec - b.videoTimeSec))
      // Flash confirmation
      setFlashEvent(eventLabel)
      setTimeout(() => setFlashEvent(null), 700)
      // Update session counters
      const newTotal = (session.totalEvents || 0) + 1
      const updated  = { ...session, totalEvents: newTotal }
      setSession(updated)
      saveLocalSession(updated)
      updateDoc(doc(db, 'mark_field_sessions', session.sessionId), {
        totalEvents: newTotal
      }).catch(() => {})
    } catch (e) {
      console.error('[MARK Field] captureEvent failed:', e)
    }
  }

  async function deleteEvent(ev) {
    try {
      if (ev._docId) {
        const q = query(collection(db, 'mark_collected_events'), where('id', '==', ev.id))
        const snap = await getDocs(q)
        snap.forEach(d => deleteDoc(d.ref))
      }
      setEvents(prev => prev.filter(e => e.id !== ev.id))
      const newTotal = Math.max(0, (session?.totalEvents || 1) - 1)
      const updated  = { ...session, totalEvents: newTotal }
      setSession(updated)
      saveLocalSession(updated)
      updateDoc(doc(db, 'mark_field_sessions', session?.sessionId), {
        totalEvents: newTotal
      }).catch(() => {})
    } catch(e) { console.warn('[MARK Field] delete failed:', e) }
  }

  // ── Keyboard handler ───────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e) {
      if (!videoLoaded) return
      if (showDoneModal) return
      const key = e.key, shift = e.shiftKey, upper = key.toUpperCase()

      if (key === 'ArrowUp') { e.preventDefault(); togglePlay(); return }
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        e.preventDefault()
        seekBy((key === 'ArrowRight' ? 1 : -1) * (shift ? 40 : 400) / 1000)
        return
      }
      if (key === '+' || key === '=') { e.preventDefault(); changeSpeed(p => Math.min(SPEED_MAX, Math.round((p+SPEED_STEP)*100)/100)); return }
      if (key === '-' || key === '_') { e.preventDefault(); changeSpeed(p => Math.max(SPEED_MIN, Math.round((p-SPEED_STEP)*100)/100)); return }
      if (key === 'Escape') { setShowDoneModal(false); return }

      // 0 key — Fifty Fifty
      if (key === '0') {
        e.preventDefault()
        setActiveKey('0'); setTimeout(() => setActiveKey(null), 600)
        captureEvent('fifty_fifty', 'Fifty Fifty', videoRef.current?.currentTime || 0)
        return
      }

      // Letter keys — event capture (no TagPanel, no error type step)
      if (KEY_TO_EVENT[upper]) {
        e.preventDefault()
        const ev = KEY_TO_EVENT[upper]
        setActiveKey(upper); setTimeout(() => setActiveKey(null), 600)
        captureEvent(ev.id, ev.label, videoRef.current?.currentTime || 0)
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [videoLoaded, showDoneModal, session, videoPath])

  // Mouse-only events from sidebar
  const handleMouseEventRef = useRef(null)
  handleMouseEventRef.current = (ev) => {
    if (!videoLoaded) return
    captureEvent(ev.id, ev.label, videoRef.current?.currentTime || 0)
  }
  const onMouseEventStable = useCallback((ev) => handleMouseEventRef.current(ev), [])

  // ── Done / close session ───────────────────────────────────────────────────
  async function handleDone() {
    if (!session) { onDone && onDone({}); return }
    setSubmitting(true)
    // Speed metric: totalEvents / active minutes (first to last event)
    const sortedTimes = events.map(e => e.videoTimeSec).sort((a,b)=>a-b)
    const spanMins = sortedTimes.length >= 2
      ? (sortedTimes[sortedTimes.length-1] - sortedTimes[0]) / 60
      : 0
    const eventsPerMinute = spanMins > 0 ? Math.round(events.length / spanMins) : 0

    const completed = {
      ...session,
      status:          'completed',
      totalEvents:     events.length,
      eventsPerMinute,
      completedAt:     new Date().toISOString(),
    }
    try {
      await updateDoc(doc(db, 'mark_field_sessions', session.sessionId), {
        status:          'completed',
        totalEvents:     events.length,
        eventsPerMinute,
        completedAt:     serverTimestamp(),
      })
    } catch(e) { console.warn('[MARK Field] complete failed:', e) }
    saveLocalSession(completed)
    setSubmitting(false)
    onDone && onDone({ events: events.length, eventsPerMinute })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const videoName = basename(videoPath || session?.videoPath || '')

  return (
    <div ref={null} style={{ height:'100vh', display:'flex', flexDirection:'column', background:'var(--bg)', userSelect:'none', overflow:'hidden' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)', borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center', padding:'0 16px', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none', color:'var(--t-3)', cursor:'pointer', fontSize:11, padding:'4px 8px', borderRadius:6 }}>
          ← Back
        </button>
        <div style={{ width:1, height:20, background:'var(--b-1)' }} />
        {/* Mode badge */}
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800, color:'#30D158', letterSpacing:1.5, background:'rgba(48,209,88,0.1)', padding:'2px 8px', borderRadius:4 }}>
          FIELD
        </div>
        {/* Video name */}
        <div style={{ flex:1, fontSize:12, fontWeight:600, color:'var(--t-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {videoName || 'No video loaded'}
        </div>
        {/* Event count */}
        <div style={{ fontSize:11, color:'var(--t-3)' }}>
          <span style={{ color:'#30D158', fontWeight:700 }}>{events.length}</span> collected
        </div>
        {/* Flash indicator — shows last captured event */}
        {flashEvent && (
          <div style={{ fontSize:11, fontWeight:700, color:'#30D158', background:'rgba(48,209,88,0.15)', padding:'3px 10px', borderRadius:6, animation:'fadeIn 0.1s ease' }}>
            ✓ {flashEvent}
          </div>
        )}
        {/* Done button */}
        <button className="btn-orange" style={{ padding:'6px 16px', fontSize:12 }}
          onClick={() => setShowDoneModal(true)}>
          Done
        </button>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        <EventsSidebar side="left" activeKey={activeKey} onMouseEvent={onMouseEventStable} />

        {/* Video area */}
        <div style={{ flex:1, position:'relative', background:'#000', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <video
            ref={videoRef}
            style={{ width:'100%', height:'100%', objectFit:'contain', display: videoLoaded ? 'block' : 'none' }}
            onTimeUpdate={e => { if (!isDraggingRef.current) setCurrentTime(e.target.currentTime) }}
            onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={handleVideoError}
          />

          {/* Drop zone / placeholder */}
          {!videoLoaded && (
            <div
              style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, cursor:'pointer' }}
              onClick={() => handleVideoFile()}
              onDragOver={e => e.preventDefault()}
              onDrop={async e => {
                e.preventDefault()
                const file = e.dataTransfer.files?.[0]
                if (file?.path) {
                  handleVideoFile(file.path)
                } else {
                  handleVideoFile()
                }
              }}
            >
              {videoError ? (
                <div style={{ textAlign:'center', maxWidth:360, padding:'0 20px' }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>⚠️</div>
                  <div style={{ fontSize:13, color:'#FF453A', fontWeight:600, marginBottom:8 }}>
                    {videoError.split('\n')[0]}
                  </div>
                  {videoError.split('\n')[1] && (
                    <div style={{ fontSize:10, color:'var(--t-3)', marginBottom:12, fontFamily:'JetBrains Mono,monospace', wordBreak:'break-all' }}>
                      {videoError.split('\n')[1]}
                    </div>
                  )}
                  <button className="btn-orange" style={{ padding:'8px 20px', fontSize:12 }} onClick={() => { setVideoError(null); handleVideoFile() }}>
                    Pick Video File
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ width:80, height:80, borderRadius:20, border:'2px dashed var(--b-2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                      <path d="M5 3l14 9-14 9V3z" stroke="var(--t-3)" strokeWidth="1.5" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--t-2)' }}>Drop video here or click to browse</div>
                    <div style={{ fontSize:12, color:'var(--t-3)', marginTop:4 }}>mp4 · mkv · mov · avi · webm · mts</div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <EventsSidebar side="right" activeKey={activeKey} onMouseEvent={onMouseEventStable} />
      </div>

      {/* ── Controls bar ─────────────────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'var(--bg-2)', borderTop:'1px solid var(--b-1)', padding:'4px 16px 8px' }}>
        <ErrorTimeline
          errors={events}
          videoDuration={duration}
          videoRef={videoRef}
          currentTime={currentTime}
          playing={playing}
          muted={muted}
          onSeek={seekTo}
          onSyncSeek={seekTo}
          onTogglePlay={togglePlay}
          onToggleMute={toggleMute}
          onDragStart={() => { isDraggingRef.current = true }}
        />
      </div>

      {/* ── Events list ──────────────────────────────────────────────────────── */}
      <TaggedEventsList
        tags={events}
        videoDuration={duration}
        currentTime={currentTime}
        matchName={videoName}
        onEdit={null}
        onDelete={deleteEvent}
      />

      {/* ── Done modal ───────────────────────────────────────────────────────── */}
      {showDoneModal && (
        <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.8)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div className="card slide-up" style={{ width:380, padding:28 }}>
            <div style={{ fontFamily:'Inter', fontWeight:800, fontSize:18, color:'var(--t-1)', marginBottom:6 }}>
              Finish Collection
            </div>
            <div style={{ fontSize:13, color:'var(--t-3)', marginBottom:20 }}>
              {videoName}
            </div>

            {/* Stats */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:20 }}>
              <div style={{ background:'var(--bg-3)', borderRadius:8, padding:'12px 14px', textAlign:'center' }}>
                <div style={{ fontSize:24, fontWeight:900, color:'#30D158' }}>{events.length}</div>
                <div style={{ fontSize:10, color:'var(--t-3)', marginTop:2 }}>Events Collected</div>
              </div>
              <div style={{ background:'var(--bg-3)', borderRadius:8, padding:'12px 14px', textAlign:'center' }}>
                <div style={{ fontSize:24, fontWeight:900, color:'var(--t-1)' }}>
                  {(() => {
                    const times = events.map(e => e.videoTimeSec).sort((a,b)=>a-b)
                    if (times.length < 2) return '—'
                    const mins = (times[times.length-1] - times[0]) / 60
                    return mins > 0 ? `${Math.round(events.length / mins)}` : '—'
                  })()}
                </div>
                <div style={{ fontSize:10, color:'var(--t-3)', marginTop:2 }}>Events/min</div>
              </div>
            </div>

            {/* Event breakdown */}
            {events.length > 0 && (
              <div style={{ marginBottom:20, background:'var(--bg-3)', borderRadius:8, padding:'10px 12px' }}>
                <div style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:1, marginBottom:8 }}>EVENT BREAKDOWN</div>
                {(() => {
                  const counts = {}
                  events.forEach(e => { counts[e.eventLabel] = (counts[e.eventLabel]||0)+1 })
                  return Object.entries(counts)
                    .sort((a,b)=>b[1]-a[1])
                    .slice(0,8)
                    .map(([label, count]) => (
                      <div key={label} style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--t-2)', padding:'2px 0' }}>
                        <span>{label}</span>
                        <span style={{ fontFamily:'JetBrains Mono,monospace', color:'var(--t-1)', fontWeight:600 }}>{count}</span>
                      </div>
                    ))
                })()}
              </div>
            )}

            <div style={{ display:'flex', gap:10 }}>
              <button className="btn-ghost" style={{ flex:1, padding:'10px 0', fontSize:13 }}
                onClick={() => setShowDoneModal(false)}>
                Cancel
              </button>
              <button className="btn-orange" style={{ flex:2, padding:'10px 0', fontSize:13 }}
                disabled={submitting}
                onClick={handleDone}>
                {submitting ? 'Saving…' : 'Save & Close Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
