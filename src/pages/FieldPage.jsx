/**
 * FieldPage.jsx — pure data-collection mode ("Field")
 * ============================================================================
 * v2 — adds: extras prompting, team selection, FieldTimeline, CSV export,
 *            collection-time tracking (wall-clock, accumulated across sittings)
 *
 * SHARED DEFINITIONS (not copied):
 *   getFieldExtrasFor(eventId)    → exported from TagPanel — the single extras source
 *   isFieldExtraRequired(...)     → also from TagPanel
 *   FieldTimeline                 → two-lane Home/Away marker timeline
 *   exportFieldSession.js         → deterministic CSV builder
 *
 * COLLECTION-TIME BOUNDARIES:
 *   Start = wall clock of first event captured (not session open)
 *   End   = wall clock when Done is pressed
 *   Accumulated across close/reopen via session.accumulatedMs
 *   Named *_wall_* throughout — never confused with video time
 *
 * DATA SEPARATION:
 *   All writes go to mark_collected_events (never mark_error_tags).
 *   Every doc has mode:'field', source:'field'.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { db } from '../firebase/config'
import { collection, addDoc, updateDoc, doc, setDoc,
         getDocs, query, where, serverTimestamp, deleteDoc } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { KEY_TO_EVENT, SPEED_MIN, SPEED_MAX, SPEED_STEP } from '../data/shortcuts'
import EventsSidebar from '../components/EventsSidebar'
import TaggedEventsList from '../components/TaggedEventsList'
import { getFieldExtrasFor } from '../components/TagPanel'
import ErrorTimeline from '../components/ErrorTimeline'
import { downloadFieldCsv } from '../utils/exportFieldSession'

// ── Stable video path hash ────────────────────────────────────────────────────
function hashPath(path) {
  try { return btoa(encodeURIComponent(path)).replace(/[/+=]/g,'').slice(0,14) }
  catch { return String(Date.now()).slice(-10) }
}

// ── Local session store ───────────────────────────────────────────────────────
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
function basename(path) {
  if (!path) return 'Untitled'
  return path.split(/[\\/]/).pop() || path
}

// Keyboard key list for extra selection
const KEYS = ['1','2','3','4','5','6','7','8','9','A','B','C','D','F']

export default function FieldPage({ session: initialSession, onDone, onBack }) {
  const { profile } = useAuth()

  const videoRef      = useRef(null)
  const isDraggingRef = useRef(false)

  // ── Video state ────────────────────────────────────────────────────────────
  const [videoLoaded,  setVideoLoaded]  = useState(false)
  const [videoPath,    setVideoPath]    = useState(null)
  const [videoError,   setVideoError]   = useState(null)
  const [playing,      setPlaying]      = useState(false)
  const [muted,        setMuted]        = useState(false)
  const [speed,        setSpeed]        = useState(1)
  const [currentTime,  setCurrentTime]  = useState(0)
  const [duration,     setDuration]     = useState(0)
  const [activeKey,    setActiveKey]    = useState(null)

  // ── Session & events ───────────────────────────────────────────────────────
  const [session,      setSession]      = useState(initialSession || null)
  const [events,       setEvents]       = useState([])

  // ── Extras / team capture state machine ───────────────────────────────────
  // null = idle, { eventId, eventLabel, videoTimeSec } = pending capture
  const [pendingCapture, setPendingCapture] = useState(null)
  const [captureStep,    setCaptureStep]    = useState('idle') // 'extras' | 'team' | 'idle'
  const [selectedExtras, setSelectedExtras] = useState([])
  const [flashEvent,     setFlashEvent]     = useState(null)

  // ── Done modal ─────────────────────────────────────────────────────────────
  const [showDoneModal, setShowDoneModal] = useState(false)
  const [submitting,    setSubmitting]   = useState(false)

  // ── Collection timing (wall-clock, accumulated) ────────────────────────────
  // collectionStartWallMs = wall clock when FIRST event of THIS sitting was captured
  // accumulatedMs = total from previous sittings (loaded from session)
  const collStartThisSittingRef = useRef(null)

  // ── Load events on session load ────────────────────────────────────────────
  useEffect(() => {
    if (!session?.sessionId) return
    getDocs(query(
      collection(db, 'mark_collected_events'),
      where('sessionId', '==', session.sessionId)
    )).then(snap => {
      const loaded = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
        .sort((a,b) => (a.videoTimeSec||0) - (b.videoTimeSec||0))
      setEvents(loaded)
    }).catch(e => console.warn('[MARK Field] load events:', e))
  }, [session?.sessionId])

  // ── Restore session from localStorage on mount ─────────────────────────────
  useEffect(() => {
    if (session) return
    const saved = loadLocalSessions().find(s => s.status !== 'completed')
    if (!saved) return
    setSession(saved)
    if (saved.videoPath) {
      invoke('get_video_url', { path: saved.videoPath })
        .then(url => {
          setVideoPath(saved.videoPath)
          const v = videoRef.current
          if (v) { v.src = url; v.load(); setVideoLoaded(true) }
        })
        .catch(() => {
          setVideoPath(saved.videoPath)
          setVideoError(`Video not found at original path — pick a new location.\n${saved.videoPath}`)
        })
    }
  }, [])

  // ── Create or resume session ───────────────────────────────────────────────
  async function ensureSession(path) {
    const existing = findSessionByPath(path)
    if (existing) { setSession(existing); return existing }

    const sessionId = `field_${profile.uid}_${hashPath(path)}_${Date.now()}`
    const newSession = {
      sessionId,
      videoPath:   path,
      videoName:   basename(path),
      mode:        'field', source: 'field',
      collectorId: profile.uid,
      collectorEmail: profile.email,
      collectorName:  profile.displayName || profile.email.split('@')[0],
      status:      'in_progress',
      startedAt:   new Date().toISOString(),
      totalEvents: 0,
      accumulatedMs:        0,   // total wall-clock from previous sittings
      collectionStartWallMs: null,
      collectionEndWallMs:   null,
    }
    try {
      await setDoc(doc(db, 'mark_field_sessions', sessionId), {
        ...newSession, startedAt: serverTimestamp(),
      })
    } catch(e) { console.warn('[MARK Field] session create:', e) }
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
      if (v) { v.src = url; v.load(); setVideoLoaded(true) }
      await ensureSession(path)
    } catch (e) {
      console.error('[MARK Field] video load:', e)
      setVideoError('Could not load this video file. Try mp4 (H.264).')
    }
  }
  function handleVideoError() {
    setVideoError('This video could not be decoded. Convert to mp4 (H.264) first.')
    setVideoLoaded(false)
  }

  // ── Playback ───────────────────────────────────────────────────────────────
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

  // ── Start a capture — pauses video, opens extras step ─────────────────────
  function startCapture(eventId, eventLabel, videoTimeSec) {
    if (!session) return
    // Wall-clock start anchor — first event of this sitting
    if (collStartThisSittingRef.current === null) {
      collStartThisSittingRef.current = Date.now()
    }
    const extras = getFieldExtrasFor(eventId)  // from TagPanel — single source of truth
    setPendingCapture({ eventId, eventLabel, videoTimeSec })
    setSelectedExtras([])
    if (extras.length > 0) {
      setCaptureStep('extras')
    } else {
      setCaptureStep('team')
    }
  }

  // ── Commit capture to Firestore ────────────────────────────────────────────
  async function commitCapture(pendingCap, extras, team) {
    setPendingCapture(null)
    setCaptureStep('idle')
    setSelectedExtras([])

    const id = `field_${Date.now()}_${Math.random().toString(36).slice(2,7)}`
    const ev = {
      id,
      sessionId:      session.sessionId,
      videoPath:      videoPath || session.videoPath || '',
      videoTimeSec:   pendingCap.videoTimeSec,
      eventId:        pendingCap.eventId,
      eventLabel:     pendingCap.eventLabel,
      extras,          // primary data — not error judgements
      team:            team || null,
      source:          'field',
      mode:            'field',
      collectorId:     profile.uid,
      collectorEmail:  profile.email,
      timestamp:       Date.now(),
    }
    try {
      const docRef = await addDoc(collection(db, 'mark_collected_events'), {
        ...ev, createdAt: serverTimestamp(),
      })
      const withDoc = { ...ev, _docId: docRef.id }
      setEvents(prev => [...prev, withDoc].sort((a,b) => a.videoTimeSec - b.videoTimeSec))
      setFlashEvent(pendingCap.eventLabel)
      setTimeout(() => setFlashEvent(null), 700)

      const newTotal  = (session.totalEvents || 0) + 1
      const updated   = {
        ...session,
        totalEvents: newTotal,
        collectionStartWallMs: session.collectionStartWallMs || collStartThisSittingRef.current,
      }
      setSession(updated)
      saveLocalSession(updated)
      updateDoc(doc(db, 'mark_field_sessions', session.sessionId), {
        totalEvents: newTotal,
        collectionStartWallMs: updated.collectionStartWallMs,
      }).catch(() => {})
    } catch (e) {
      console.error('[MARK Field] commitCapture:', e)
    }
  }

  // ── Abandon capture — no record written ───────────────────────────────────
  function abandonCapture() {
    setPendingCapture(null)
    setCaptureStep('idle')
    setSelectedExtras([])
  }

  // ── Delete event ───────────────────────────────────────────────────────────
  async function deleteEvent(ev) {
    try {
      const q = query(collection(db, 'mark_collected_events'), where('id','==',ev.id))
      const snap = await getDocs(q)
      snap.forEach(d => deleteDoc(d.ref))
      setEvents(prev => prev.filter(e => e.id !== ev.id))
      const newTotal = Math.max(0, (session?.totalEvents||1) - 1)
      const updated  = { ...session, totalEvents: newTotal }
      setSession(updated); saveLocalSession(updated)
      updateDoc(doc(db, 'mark_field_sessions', session?.sessionId), { totalEvents: newTotal }).catch(()=>{})
    } catch(e) { console.warn('[MARK Field] delete:', e) }
  }

  // ── Keyboard handler ───────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e) {
      const key = e.key, shift = e.shiftKey, upper = key.toUpperCase()

      // ── Extras step ─────────────────────────────────────────────────────
      if (captureStep === 'extras' && pendingCapture) {
        if (key === 'Escape') { abandonCapture(); return }
        if (key === 'Enter') {
          // Done selecting extras — move to team
          setCaptureStep('team')
          return
        }
        const extras = getFieldExtrasFor(pendingCapture.eventId)
        const idx = KEYS.indexOf(upper)
        if (idx >= 0 && idx < extras.length) {
          const label = extras[idx]
          setSelectedExtras(prev =>
            prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label]
          )
        }
        return
      }

      // ── Team step ────────────────────────────────────────────────────────
      if (captureStep === 'team' && pendingCapture) {
        if (key === 'Escape') { abandonCapture(); return }
        if (key === '1') { commitCapture(pendingCapture, selectedExtras, 'home'); return }
        if (key === '2') { commitCapture(pendingCapture, selectedExtras, 'away'); return }
        if (key === 'Enter') { commitCapture(pendingCapture, selectedExtras, null); return }
        return
      }

      // ── Collection (idle step) ───────────────────────────────────────────
      if (!videoLoaded || showDoneModal || captureStep !== 'idle') return

      if (key === 'ArrowUp')     { e.preventDefault(); togglePlay(); return }
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        e.preventDefault()
        seekBy((key === 'ArrowRight' ? 1 : -1) * (shift ? 40 : 400) / 1000)
        return
      }
      if (key === '+' || key === '=') { e.preventDefault(); changeSpeed(p => Math.min(SPEED_MAX, Math.round((p+SPEED_STEP)*100)/100)); return }
      if (key === '-' || key === '_') { e.preventDefault(); changeSpeed(p => Math.max(SPEED_MIN, Math.round((p-SPEED_STEP)*100)/100)); return }
      if (key === 'Escape') { setShowDoneModal(false); return }

      if (key === '0') {
        e.preventDefault()
        setActiveKey('0'); setTimeout(() => setActiveKey(null), 600)
        startCapture('fifty_fifty', 'Fifty Fifty', videoRef.current?.currentTime || 0)
        return
      }
      if (KEY_TO_EVENT[upper]) {
        e.preventDefault()
        const ev = KEY_TO_EVENT[upper]
        setActiveKey(upper); setTimeout(() => setActiveKey(null), 600)
        startCapture(ev.id, ev.label, videoRef.current?.currentTime || 0)
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [videoLoaded, showDoneModal, captureStep, pendingCapture, selectedExtras, session, videoPath])

  // Mouse-only sidebar events
  const handleMouseEventRef = useRef(null)
  handleMouseEventRef.current = (ev) => {
    if (!videoLoaded || captureStep !== 'idle') return
    startCapture(ev.id, ev.label, videoRef.current?.currentTime || 0)
  }
  const onMouseEventStable = useCallback((ev) => handleMouseEventRef.current(ev), [])

  // ── Done ───────────────────────────────────────────────────────────────────
  async function handleDone() {
    if (!session) { onDone && onDone({}); return }
    setSubmitting(true)

    const endWall    = Date.now()
    const startWall  = collStartThisSittingRef.current
    const prevAccMs  = session.accumulatedMs || 0
    const thisMs     = (startWall && endWall > startWall) ? (endWall - startWall) : 0
    const totalMs    = prevAccMs + thisMs
    const elapsedMins= totalMs > 0 ? totalMs / 60000 : 0
    const evPerMin   = elapsedMins > 0 ? (events.length / elapsedMins).toFixed(2) : null
    const hasHalfEnd = events.some(e => e.eventId === 'half_end')

    const completed = {
      ...session,
      status:                'completed',
      totalEvents:           events.length,
      accumulatedMs:         totalMs,
      collectionEndWallMs:   endWall,
      collectionStartWallMs: session.collectionStartWallMs || startWall,
      eventsPerMinute:       evPerMin,
      videoDurationSec:      duration || null,
      collectionIncomplete:  !hasHalfEnd,
    }
    try {
      await updateDoc(doc(db, 'mark_field_sessions', session.sessionId), {
        status:                'completed',
        totalEvents:           events.length,
        accumulatedMs:         totalMs,
        collectionEndWallMs:   endWall,
        collectionStartWallMs: completed.collectionStartWallMs,
        eventsPerMinute:       evPerMin,
        videoDurationSec:      duration || null,
        collectionIncomplete:  !hasHalfEnd,
        completedAt:           serverTimestamp(),
      })
    } catch(e) { console.warn('[MARK Field] complete:', e) }
    saveLocalSession(completed)

    // Export CSV
    try {
      downloadFieldCsv(completed, events)
    } catch(e) { console.warn('[MARK Field] CSV export failed:', e) }

    setSubmitting(false)
    onDone && onDone({ events: events.length, eventsPerMinute: evPerMin })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const videoName = basename(videoPath || session?.videoPath || '')
  const isPanelOpen = captureStep !== 'idle'
  const capExtras = pendingCapture ? getFieldExtrasFor(pendingCapture.eventId) : []

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', userSelect:'none', overflow:'hidden' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 16px', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none',
          color:'var(--t-3)', cursor:'pointer', fontSize:11, padding:'4px 8px', borderRadius:6 }}>
          ← Back
        </button>
        <div style={{ width:1, height:20, background:'var(--b-1)' }} />
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800,
          color:'#30D158', letterSpacing:1.5, background:'rgba(48,209,88,0.1)',
          padding:'2px 8px', borderRadius:4 }}>FIELD</div>
        <div style={{ flex:1, fontSize:12, fontWeight:600, color:'var(--t-1)',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {videoName || 'No video loaded'}
        </div>
        <div style={{ fontSize:11, color:'var(--t-3)' }}>
          <span style={{ color:'#30D158', fontWeight:700 }}>{events.length}</span> collected
        </div>
        {flashEvent && (
          <div style={{ fontSize:11, fontWeight:700, color:'#30D158',
            background:'rgba(48,209,88,0.15)', padding:'3px 10px', borderRadius:6 }}>
            ✓ {flashEvent}
          </div>
        )}
        <button className="btn-orange" style={{ padding:'6px 16px', fontSize:12 }}
          onClick={() => setShowDoneModal(true)}>
          Done
        </button>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', position:'relative' }}>
        <EventsSidebar side="left"  activeKey={activeKey} onMouseEvent={onMouseEventStable} />

        {/* Video */}
        <div style={{ flex:1, position:'relative', background:'#000',
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <video ref={videoRef}
            style={{ width:'100%', height:'100%', objectFit:'contain',
              display: videoLoaded ? 'block' : 'none' }}
            onTimeUpdate={e => { if (!isDraggingRef.current) setCurrentTime(e.target.currentTime) }}
            onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={handleVideoError}
          />
          {!videoLoaded && (
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'center', gap:16, cursor:'pointer' }}
              onClick={() => handleVideoFile()}
              onDragOver={e => e.preventDefault()}
              onDrop={async e => {
                e.preventDefault()
                const file = e.dataTransfer.files?.[0]
                handleVideoFile(file?.path || null)
              }}>
              {videoError ? (
                <div style={{ textAlign:'center', maxWidth:380, padding:'0 20px' }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>⚠️</div>
                  <div style={{ fontSize:13, color:'#FF453A', fontWeight:600, marginBottom:8 }}>
                    {videoError.split('\n')[0]}
                  </div>
                  {videoError.split('\n')[1] && (
                    <div style={{ fontSize:10, color:'var(--t-3)', marginBottom:12,
                      fontFamily:'JetBrains Mono,monospace', wordBreak:'break-all' }}>
                      {videoError.split('\n')[1]}
                    </div>
                  )}
                  <button className="btn-orange" style={{ padding:'8px 20px', fontSize:12 }}
                    onClick={() => { setVideoError(null); handleVideoFile() }}>
                    Pick Video File
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ width:80, height:80, borderRadius:20,
                    border:'2px dashed var(--b-2)', display:'flex',
                    alignItems:'center', justifyContent:'center' }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                      <path d="M5 3l14 9-14 9V3z" stroke="var(--t-3)" strokeWidth="1.5" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--t-2)' }}>
                      Drop video here or click to browse
                    </div>
                    <div style={{ fontSize:12, color:'var(--t-3)', marginTop:4 }}>
                      mp4 · mkv · mov · avi · webm · mts
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <EventsSidebar side="right" activeKey={activeKey} onMouseEvent={onMouseEventStable} />

        {/* ── Extras / Team capture panel (slides up from bottom) ────────────── */}
        {isPanelOpen && pendingCapture && (
          <div style={{
            position:'absolute', bottom:0, left:168, right:168,
            background:'var(--bg-2)', borderTop:'2px solid var(--b-1)',
            padding:'14px 20px 16px', zIndex:100,
            boxShadow:'0 -8px 32px rgba(0,0,0,0.4)',
          }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:12, fontWeight:700,
                  background:'#30D158', color:'#000', borderRadius:5, padding:'2px 8px' }}>
                  {pendingCapture.eventLabel}
                </span>
                <span style={{ fontSize:11, color:'var(--t-3)' }}>
                  {captureStep === 'extras' ? 'Select extras' : 'Select team'}
                </span>
                {selectedExtras.length > 0 && (
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                    {selectedExtras.map(x => (
                      <span key={x} style={{ fontSize:10, background:'rgba(48,209,88,0.15)',
                        color:'#30D158', padding:'1px 7px', borderRadius:4 }}>{x}</span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={abandonCapture}
                style={{ background:'none', border:'none', color:'var(--t-3)',
                  cursor:'pointer', fontSize:11 }}>
                ESC Cancel
              </button>
            </div>

            {/* Extras step */}
            {captureStep === 'extras' && (
              <>
                <div style={{ fontSize:9, fontWeight:800, color:'var(--t-3)',
                  letterSpacing:1, marginBottom:8, textTransform:'uppercase' }}>
                  Extras — press number to toggle, Enter when done
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
                  {capExtras.map((label, idx) => {
                    const k = KEYS[idx]
                    const selected = selectedExtras.includes(label)
                    return (
                      <div key={label}
                        onClick={() => setSelectedExtras(prev =>
                          prev.includes(label) ? prev.filter(x=>x!==label) : [...prev, label]
                        )}
                        style={{
                          display:'flex', alignItems:'center', gap:7, padding:'5px 10px',
                          background: selected ? 'rgba(48,209,88,0.15)' : 'var(--bg-3)',
                          border: `1px solid ${selected ? '#30D158' : 'var(--b-1)'}`,
                          borderRadius:7, cursor:'pointer',
                        }}>
                        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:10,
                          fontWeight:700, background:'var(--bg-3)', color:'var(--t-2)',
                          border:'1px solid var(--b-2)', borderRadius:4, padding:'1px 5px' }}>
                          {k}
                        </span>
                        <span style={{ fontSize:12, color: selected ? '#30D158' : 'var(--t-1)' }}>
                          {label}
                        </span>
                        {selected && <span style={{ fontSize:10, color:'#30D158' }}>✓</span>}
                      </div>
                    )
                  })}
                </div>
                <button onClick={() => setCaptureStep('team')}
                  style={{ background:'rgba(48,209,88,0.15)', border:'1px solid rgba(48,209,88,0.3)',
                    borderRadius:7, padding:'7px 16px', color:'#30D158', cursor:'pointer',
                    fontSize:12, fontWeight:600 }}>
                  Enter — Next: Team
                </button>
              </>
            )}

            {/* Team step */}
            {captureStep === 'team' && (
              <>
                <div style={{ fontSize:9, fontWeight:800, color:'var(--t-3)',
                  letterSpacing:1, marginBottom:8, textTransform:'uppercase' }}>
                  Team — 1 Home · 2 Away · Enter skip
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {[
                    { key:'1', label:'Home', color:'#0A84FF', bg:'rgba(10,132,255,0.15)' },
                    { key:'2', label:'Away', color:'#E8590C', bg:'rgba(232,89,12,0.15)'  },
                    { key:'↩', label:'Skip',  color:'var(--t-3)', bg:'var(--bg-3)'       },
                  ].map(btn => (
                    <button key={btn.label}
                      onClick={() => commitCapture(pendingCapture, selectedExtras,
                        btn.label==='Home'?'home':btn.label==='Away'?'away':null)}
                      style={{ flex:1, padding:'10px 0', background:btn.bg,
                        border:`1px solid ${btn.color}44`, borderRadius:8, color:btn.color,
                        cursor:'pointer', fontWeight:700, fontSize:13,
                        display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                      <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11,
                        background:'rgba(255,255,255,0.07)', padding:'1px 6px',
                        borderRadius:4 }}>{btn.key}</span>
                      {btn.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Scrub bar (standard ErrorTimeline) ───────────────────────────────── */}
      <div style={{ flexShrink:0, background:'var(--bg-2)',
        borderTop:'1px solid var(--b-1)', padding:'4px 16px 8px' }}>
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

      {/* ── Events list — Home/Away lanes (same component as Scout) ─────────── */}
      {/* matchName="Home vs Away" so TaggedEventsList parses lane labels correctly.
          In Scout it gets the real match name ("Team A vs Team B"); here we pass a
          fixed string since Field sessions have no match metadata. */}
      <TaggedEventsList
        tags={events}
        videoDuration={duration}
        currentTime={currentTime}
        matchName="Home vs Away"
        onEdit={null}
        onDelete={deleteEvent}
      />

      {/* ── Done modal ───────────────────────────────────────────────────────── */}
      {showDoneModal && (
        <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.8)',
          backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div className="card slide-up" style={{ width:420, padding:28 }}>
            <div style={{ fontFamily:'Inter', fontWeight:800, fontSize:18,
              color:'var(--t-1)', marginBottom:4 }}>Finish Collection</div>
            <div style={{ fontSize:13, color:'var(--t-3)', marginBottom:20 }}>{videoName}</div>

            {/* Stats */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
              <div style={{ background:'var(--bg-3)', borderRadius:8, padding:'12px', textAlign:'center' }}>
                <div style={{ fontSize:24, fontWeight:900, color:'#30D158' }}>{events.length}</div>
                <div style={{ fontSize:10, color:'var(--t-3)', marginTop:2 }}>Events Collected</div>
              </div>
              <div style={{ background:'var(--bg-3)', borderRadius:8, padding:'12px', textAlign:'center' }}>
                {(() => {
                  const accMs = session?.accumulatedMs || 0
                  const startMs = collStartThisSittingRef.current
                  const thisMs = startMs ? (Date.now() - startMs) : 0
                  const totalMs = accMs + thisMs
                  const mins = totalMs > 0 ? totalMs / 60000 : 0
                  const rate = mins > 0 ? (events.length / mins).toFixed(1) : '—'
                  return <>
                    <div style={{ fontSize:24, fontWeight:900, color:'var(--t-1)' }}>{rate}</div>
                    <div style={{ fontSize:10, color:'var(--t-3)', marginTop:2 }}>Events/min (wall clock)</div>
                  </>
                })()}
              </div>
            </div>

            {/* Home/Away split */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
              <div style={{ background:'rgba(10,132,255,0.08)', border:'1px solid rgba(10,132,255,0.2)',
                borderRadius:8, padding:'8px', textAlign:'center' }}>
                <div style={{ fontSize:18, fontWeight:800, color:'#0A84FF' }}>
                  {events.filter(e=>e.team==='home').length}
                </div>
                <div style={{ fontSize:9, color:'var(--t-3)', marginTop:1 }}>HOME</div>
              </div>
              <div style={{ background:'rgba(232,89,12,0.08)', border:'1px solid rgba(232,89,12,0.2)',
                borderRadius:8, padding:'8px', textAlign:'center' }}>
                <div style={{ fontSize:18, fontWeight:800, color:'#E8590C' }}>
                  {events.filter(e=>e.team==='away').length}
                </div>
                <div style={{ fontSize:9, color:'var(--t-3)', marginTop:1 }}>AWAY</div>
              </div>
            </div>

            {/* Incomplete warning */}
            {!events.some(e=>e.eventId==='half_end') && events.length > 0 && (
              <div style={{ background:'rgba(255,149,0,0.1)', border:'1px solid rgba(255,149,0,0.3)',
                borderRadius:8, padding:'8px 12px', marginBottom:16, fontSize:11, color:'#FF9500' }}>
                ⚠️ No Half End event tagged — export will have collection_incomplete=1
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
                {submitting ? 'Saving…' : 'Save & Export CSV'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
