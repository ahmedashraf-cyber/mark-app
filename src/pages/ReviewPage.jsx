import { useState, useEffect, useRef } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { db } from '../firebase/config'
import { collection, addDoc, updateDoc, doc, serverTimestamp, increment } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { useSync } from '../hooks/useSync'
import { KEY_TO_EVENT, MISSING_EVENT_KEY, SPEED_MIN, SPEED_MAX, SPEED_STEP } from '../data/shortcuts'
import TagPanel from '../components/TagPanel'
import TaggedEventsList from '../components/TaggedEventsList'
import ErrorTimeline from '../components/ErrorTimeline'
import EventsSidebar from '../components/EventsSidebar'
import { exportSessionToXlsx } from '../utils/exportSession'

export default function ReviewPage({ session, onDone, onBack, bridgeSyncStatus, onBridgeSyncStatus }) {
  const { profile } = useAuth()
  const { syncNavigation, syncSetPlaying, syncSeek } = useSync(onBridgeSyncStatus, session.sessionId)

  const videoRef  = useRef(null)
  const rootRef   = useRef(null)
  // Stays true from drag-start until onSeeked fires — gates onTimeUpdate
  // so the video's lagging position cannot snap the ball back after a seek
  const isDraggingRef = useRef(false)
  const [videoLoaded,   setVideoLoaded]   = useState(false)
  const [reviewStarted, setReviewStarted] = useState(false)
  const [playing,  setPlaying]  = useState(false)
  const [muted,    setMuted]    = useState(false)
  const [speed,    setSpeed]    = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration,    setDuration]    = useState(0)

  const [tags,       setTags]       = useState([])
  const [pendingTag, setPendingTag] = useState(null)
  const [editTag,    setEditTag]    = useState(null)
  const syncStatus   = bridgeSyncStatus
  const [injecting,  setInjecting]  = useState(false)
  const [activeKey,  setActiveKey]  = useState(null)

  // Done modal
  const [showDoneModal,   setShowDoneModal]   = useState(false)
  const [reviewedEvents,  setReviewedEvents]  = useState('')
  const [submitting,      setSubmitting]      = useState(false)
  const [submitted,       setSubmitted]       = useState(false)

  // ── Keyboard handler — matches collection app shortcuts exactly ─────────
  useEffect(() => {
    function handleKey(e) {
      if (!reviewStarted) return
      if (pendingTag || showDoneModal || editTag) return

      const key   = e.key
      const shift = e.shiftKey
      const upper = key.toUpperCase()

      // ↑  Play / Pause  (matches collection app)
      if (key === 'ArrowUp') {
        e.preventDefault()
        togglePlay()
        return
      }

      // → / ←  Fast forward / backward 400ms
      // Shift+→ / Shift+←  Slow forward / backward 40ms
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        e.preventDefault()
        const ms  = shift ? 40 : 400
        const dir = key === 'ArrowRight' ? 1 : -1
        seekBy(dir * ms / 1000)
        syncNavigation(key === 'ArrowRight' ? 'forward' : 'backward', shift)
        return
      }

      // 0  Fifty Fifty event (replaces speed reset — use keyboard shortcut + / - to control speed)
      if (key === '0') {
        e.preventDefault()
        setActiveKey('0')
        setTimeout(() => setActiveKey(null), 600)
        setPendingTag({ key: '0', isMissing: false, videoTime: videoRef.current?.currentTime || 0 })
        return
      }

      // + or =  Increase speed by 0.25 (max 2x)
      if (key === '+' || key === '=') {
        e.preventDefault()
        changeSpeed(prev => Math.min(SPEED_MAX, Math.round((prev + SPEED_STEP) * 100) / 100))
        return
      }

      // - or _  Decrease speed by 0.25 (min 0.25x)
      if (key === '-' || key === '_') {
        e.preventDefault()
        changeSpeed(prev => Math.max(SPEED_MIN, Math.round((prev - SPEED_STEP) * 100) / 100))
        return
      }

      // Error tagging
      if (upper === MISSING_EVENT_KEY) {
        e.preventDefault()
        setActiveKey(upper)
        setTimeout(() => setActiveKey(null), 600)
        setPendingTag({ key: upper, isMissing: true, videoTime: videoRef.current?.currentTime || 0 })
        return
      }
      if (KEY_TO_EVENT[upper]) {
        e.preventDefault()
        setActiveKey(upper)
        setTimeout(() => setActiveKey(null), 600)
        setPendingTag({ key: upper, isMissing: false, videoTime: videoRef.current?.currentTime || 0 })
        return
      }

      // ESC = cancel
      if (key === 'Escape') {
        setPendingTag(null)
        setShowDoneModal(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [pendingTag, showDoneModal, editTag, syncNavigation, reviewStarted])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play()
      setPlaying(true)
      syncSetPlaying(true, videoRef)
    } else {
      v.pause()
      setPlaying(false)
      syncSetPlaying(false, videoRef)
    }
  }

  // changeSpeed accepts a value or an updater function (same API as setState)
  function changeSpeed(valueOrUpdater) {
    const v = videoRef.current
    if (!v) return
    const current = v.playbackRate
    const next = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(current)
      : valueOrUpdater
    v.playbackRate = next
    setSpeed(next)
  }

  function seekBy(seconds) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + seconds))
    setCurrentTime(v.currentTime)
  }

  function seekTo(seconds) {
    const v = videoRef.current
    if (!v) return
    // Guard both seconds and v.duration against Infinity/NaN
    // v.duration is Infinity for live streams or before metadata loads fully
    if (!isFinite(seconds) || !isFinite(v.duration)) return
    const t = Math.max(0, Math.min(v.duration, seconds))
    console.log('[MARK seekTo] seconds=', seconds, 'v.duration=', v.duration, 't=', t, 'v=', !!v)
    v.currentTime = t
    setCurrentTime(t)
  }

  function seekToAndSync(seconds) {
    seekTo(seconds)
    syncSeek(seconds)
  }

  function toggleMute() {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  // pick_video_file (Rust/rfd) returns the real file path.
  // get_video_url passes it to the embedded HTTP server which serves it
  // with proper 206 Partial Content + range request support.
  // This gives WebView2 a seekable video with a real finite duration.
  async function handleVideoFile() {
    try {
      const path = await invoke('pick_video_file')
      if (!path) return
      const url = await invoke('get_video_url', { path })
      console.log('[MARK] loading video via HTTP server:', url)
      const v = videoRef.current
      if (v) { v.src = url; v.load(); setVideoLoaded(true) }
    } catch (e) {
      console.error('[MARK] handleVideoFile failed:', e)
    }
  }

  function handleMouseEvent(ev) {
    if (!reviewStarted) return
    setPendingTag({ key: ev.key || '•', isMissing: false, videoTime: videoRef.current?.currentTime || 0, id: ev.id, label: ev.label })
  }

  // Called by the "Start Reviewing" button. This is a REAL user click, so it
  // properly wakes the webview's keyboard — after this, arrow keys register
  // immediately without any further clicks for the whole session.
  function startReview() {
    setReviewStarted(true)
    // Grab focus on both layers so keys flow right away
    try { rootRef.current?.focus() } catch(_) {}
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setFocus())
      .catch(() => {})
  }

  async function handleTagSave(tagData) {
    setPendingTag(null)
    const id = `tag_${Date.now()}_${Math.random().toString(36).slice(2,7)}`
    const docData = {
      ...tagData,
      id,
      sessionId:     session.sessionId,
      matchId:       session.matchId,
      half:          session.half,
      reviewerId:    profile.uid,
      reviewerEmail: profile.email,
      createdAt:     serverTimestamp(),
    }
    try {
      await addDoc(collection(db, 'mark_error_tags'), { ...docData })
      await updateDoc(doc(db, 'mark_sessions', session.sessionId), {
        totalTaggedErrors: increment(1)
      })
      setTags(prev => [...prev, { ...docData, _firestoreId: id }])
    } catch (e) {
      console.error('[MARK] Failed to save tag:', e)
    }
  }

  async function handleTagEdit(updatedTag) {
    setEditTag(null)
    try {
      // Find the Firestore doc by querying our local state for the _firestoreId
      const existing = tags.find(t => t.id === updatedTag.id)
      if (existing?._firestoreId) {
        // Find firestore doc ref — we stored it as _firestoreId
        const q = await import('firebase/firestore').then(m =>
          m.query(m.collection(db, 'mark_error_tags'), m.where('id', '==', updatedTag.id))
        )
        const snap = await import('firebase/firestore').then(m => m.getDocs(q))
        snap.forEach(async d => {
          await updateDoc(d.ref, {
            extras: updatedTag.extras,
            team:   updatedTag.team,
          })
        })
      }
      setTags(prev => prev.map(t => t.id === updatedTag.id ? { ...t, ...updatedTag } : t))
    } catch (e) {
      console.error('[MARK] Failed to edit tag:', e)
    }
  }

  async function handleTagDelete(tag) {
    setEditTag(null)
    try {
      const { query, where, getDocs, deleteDoc: del } = await import('firebase/firestore')
      const q = query(collection(db, 'mark_error_tags'), where('id', '==', tag.id))
      const snap = await getDocs(q)
      snap.forEach(async d => { await del(d.ref) })
      await updateDoc(doc(db, 'mark_sessions', session.sessionId), {
        totalTaggedErrors: increment(-1)
      })
      setTags(prev => prev.filter(t => t.id !== tag.id))
    } catch (e) {
      console.error('[MARK] Failed to delete tag:', e)
    }
  }

  async function handleDoneSubmit() {
    if (!reviewedEvents || isNaN(parseInt(reviewedEvents))) return
    setSubmitting(true)
    const total    = parseInt(reviewedEvents)
    const tagCount = tags.length
    const quality  = Math.round(100 - ((tagCount / Math.max(total, 1)) * 100))

    try {
      await updateDoc(doc(db, 'mark_sessions', session.sessionId), {
        status: 'completed',
        totalReviewedEvents: total,
        totalTaggedErrors: tagCount,
        qualityScore: quality,
        completedAt: serverTimestamp(),
      })

      // Export to .xlsx and get the saved file path
      let filePath = null
      try {
        filePath = await exportSessionToXlsx({ session, tags, quality, tagCount, total })
      } catch (exportErr) {
        console.error('[MARK] Export failed:', exportErr)
      }

      setSubmitted(true)
      setTimeout(() => onDone({ quality, tagCount, total, filePath }), 1500)
    } catch (e) {
      setSubmitting(false)
    }
  }

  const formatTime = (s) => {
    if (!isFinite(s) || isNaN(s)) return '-:--.---'
    const m   = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    const ms  = Math.floor((s % 1) * 1000)
    return `${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      style={{height:'100vh',display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden',outline:'none'}}
    >

      {/* Topbar */}
      <header style={{
        height:52, flexShrink:0,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0 16px', borderBottom:'1px solid var(--b-1)',
        background:'var(--bg-2)',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button className="btn-ghost" style={{padding:'5px 10px',fontSize:12}} onClick={onBack}>← Back</button>
          <div style={{width:1,height:20,background:'var(--b-1)'}}/>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:'var(--t-1)'}}>{session.matchName}</div>
            <div style={{fontSize:11,color:'var(--t-3)'}}>{session.half} · {session.matchDate || ''}</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--t-3)'}}>
            <span className={`status-dot ${syncStatus === 'connected' ? 'green' : 'gray'}`}/>
            Collection app {syncStatus === 'connected' ? 'synced' : 'not detected'}
          </div>
          <div className="tag-pill">{tags.length} errors tagged</div>
          {speed !== 1 && (
            <div className="tag-pill" style={{background:'rgba(10,132,255,0.15)',color:'#0A84FF',borderColor:'rgba(10,132,255,0.3)'}}>
              {speed}x
            </div>
          )}
          <button
            className="btn-ghost"
            style={{padding:'7px 14px',fontSize:12}}
            disabled={injecting}
            onClick={async () => {
              setInjecting(true)
              try {
                await invoke('inject_bridge_script', { sessionId: session.sessionId })
              } catch (e) {
                console.error('[MARK] inject failed:', e)
              } finally {
                setInjecting(false)
              }
            }}
          >
            {injecting ? 'Injecting…' : '⚡ Inject Bridge'}
          </button>
          <button className="btn-orange" style={{padding:'7px 18px',fontSize:13}} onClick={() => setShowDoneModal(true)}>
            Done ✓
          </button>
        </div>
      </header>

      {/* Middle row: left sidebar + video + right sidebar */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        <EventsSidebar side="left" activeKey={activeKey} onMouseEvent={handleMouseEvent} />

        {/* Video */}
        <div style={{flex:1,position:'relative',background:'#000',overflow:'hidden'}}>
          <video
            ref={videoRef}
            style={{width:'100%',height:'100%',objectFit:'contain'}}
            onTimeUpdate={() => {
              if (isDraggingRef.current) return // gated during drag — prevents snap-back
              setCurrentTime(videoRef.current?.currentTime || 0)
            }}
            onSeeked={() => {
              isDraggingRef.current = false // seek complete — safe to re-enable onTimeUpdate
              setCurrentTime(videoRef.current?.currentTime || 0)
            }}
            onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
            onPlay={() => { setPlaying(true); syncSetPlaying(true, videoRef) }}
            onPause={() => { setPlaying(false); syncSetPlaying(false, videoRef) }}
          />

          {!videoLoaded && (
            <div
              style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,cursor:'pointer'}}
              onClick={handleVideoFile}
              onDragOver={e => e.preventDefault()}
              onDrop={async e => {
                e.preventDefault()
                const file = e.dataTransfer.files?.[0]
                if (file?.path) {
                  try {
                    const url = await invoke('get_video_url', { path: file.path })
                    const v = videoRef.current
                    if (v) { v.src = url; v.load(); setVideoLoaded(true) }
                  } catch(_) { handleVideoFile() }
                } else {
                  handleVideoFile()
                }
              }}
            >
              <div style={{width:80,height:80,borderRadius:20,border:'2px dashed var(--b-2)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M5 3l14 9-14 9V3z" stroke="var(--t-3)" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--t-2)'}}>Drop video here or click to browse</div>
                <div style={{fontSize:12,color:'var(--t-3)',marginTop:4}}>mp4 · mkv · mov · avi · webm · mts</div>
              </div>
            </div>
          )}

          {/* Start Reviewing gate — video is loaded but review not yet started.
              The button click is a real user interaction that wakes the keyboard,
              so arrow keys sync immediately for the rest of the session. */}
          {videoLoaded && !reviewStarted && (
            <div style={{
              position:'absolute', inset:0, zIndex:50,
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:20,
              background:'rgba(10,10,12,0.92)', backdropFilter:'blur(4px)',
            }}>
              <div style={{width:64,height:64,borderRadius:18,background:'var(--p2)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                  <path d="M5 3l14 9-14 9V3z" fill="white"/>
                </svg>
              </div>
              <div style={{textAlign:'center'}}>
                <div style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'var(--t-1)'}}>Ready to Review</div>
                <div style={{fontSize:13,color:'var(--t-3)',marginTop:6,maxWidth:340,lineHeight:1.5}}>
                  Make sure the collection app is open, then click below to begin. Keyboard controls activate when you start.
                </div>
              </div>
              <button className="btn-orange" style={{padding:'14px 40px',fontSize:16,fontWeight:700}} onClick={startReview}>
                Start Reviewing →
              </button>
              <div style={{fontSize:11,color:'var(--t-3)',display:'flex',gap:16,marginTop:4,flexWrap:'wrap',justifyContent:'center'}}>
                <span><span className="mono" style={{color:'var(--p2)'}}>↑</span> play/pause</span>
                <span><span className="mono" style={{color:'var(--p2)'}}>← →</span> ±400ms</span>
                <span><span className="mono" style={{color:'var(--p2)'}}>Shift+← →</span> ±40ms</span>
                <span><span className="mono" style={{color:'var(--p2)'}}>+ / -</span> speed</span>
                <span><span className="mono" style={{color:'var(--p2)'}}>0</span> reset speed</span>
              </div>
            </div>
          )}

        </div>

        <EventsSidebar side="right" activeKey={activeKey} onMouseEvent={handleMouseEvent} />

      </div>

      {/* Controls bar */}
      <div style={{flexShrink:0,background:'var(--bg-2)',borderTop:'1px solid var(--b-1)',padding:'4px 16px 8px'}}>
        <ErrorTimeline
          errors={tags}
          videoDuration={duration}
          videoRef={videoRef}
          currentTime={currentTime}
          playing={playing}
          muted={muted}
          onSeek={seekToAndSync}
          onSyncSeek={syncSeek}
          onTogglePlay={togglePlay}
          onToggleMute={toggleMute}
          onDragStart={() => { isDraggingRef.current = true }}
        />
      </div>

      {/* Tagged Events List */}
      <TaggedEventsList
        tags={tags}
        videoDuration={duration}
        currentTime={currentTime}
        matchName={session.matchName}
        onEdit={tag => setEditTag(tag)}
        onDelete={handleTagDelete}
      />

      {/* Tag Panel — slides up when event key pressed */}
      <TagPanel
        pendingTag={pendingTag}
        onSave={handleTagSave}
        onCancel={() => setPendingTag(null)}
        editTag={editTag}
        onEditSave={handleTagEdit}
        onEditDelete={handleTagDelete}
        onEditCancel={() => setEditTag(null)}
      />

      {/* Done Modal */}
      {showDoneModal && (
        <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div className="card slide-up" style={{width:380,padding:28}}>
            {submitted ? (
              <div style={{textAlign:'center',padding:'20px 0'}}>
                <div style={{fontSize:48,marginBottom:12}}>✅</div>
                <div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'var(--t-1)'}}>Session Complete</div>
                <div style={{fontSize:13,color:'var(--t-3)',marginTop:6}}>Saving results to FIELD…</div>
              </div>
            ) : (
              <>
                <h3 style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'var(--t-1)',marginBottom:6}}>Finish Review Session</h3>
                <p style={{fontSize:13,color:'var(--t-3)',marginBottom:20}}>Enter how many events you reviewed to calculate the quality score.</p>
                <div style={{background:'var(--bg-3)',borderRadius:10,padding:14,marginBottom:20,display:'flex',gap:20}}>
                  <div style={{textAlign:'center',flex:1}}>
                    <div style={{fontSize:28,fontWeight:800,color:'var(--p2)'}}>{tags.length}</div>
                    <div style={{fontSize:11,color:'var(--t-3)'}}>Errors Tagged</div>
                  </div>
                  <div style={{width:1,background:'var(--b-1)'}}/>
                  <div style={{textAlign:'center',flex:1}}>
                    <div style={{fontSize:28,fontWeight:800,color:'var(--t-1)'}}>
                      {reviewedEvents ? Math.round(100 - (tags.length / Math.max(parseInt(reviewedEvents),1)) * 100) : '—'}
                    </div>
                    <div style={{fontSize:11,color:'var(--t-3)'}}>Quality Score</div>
                  </div>
                </div>
                <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>TOTAL REVIEWED EVENTS</label>
                <input
                  className="mark-input"
                  type="number"
                  min="1"
                  placeholder="e.g. 40"
                  value={reviewedEvents}
                  onChange={e => setReviewedEvents(e.target.value)}
                  autoFocus
                  style={{marginBottom:20}}
                />
                <div style={{display:'flex',gap:10}}>
                  <button className="btn-ghost" style={{flex:1,padding:'10px 0',fontSize:13}} onClick={() => setShowDoneModal(false)}>Cancel</button>
                  <button className="btn-orange" style={{flex:2,padding:'10px 0',fontSize:13}} disabled={!reviewedEvents || submitting} onClick={handleDoneSubmit}>
                    {submitting ? 'Saving…' : 'Submit & Close Session'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}