import { useState, useEffect, useRef, useCallback } from 'react'
import { db } from '../firebase/config'
import { collection, addDoc, updateDoc, doc, serverTimestamp, increment } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { useSync } from '../hooks/useSync'
import { KEY_TO_EVENT, MISSING_EVENT_KEY, NAV_SHORTCUTS, NAV_SHIFT_SHORTCUTS } from '../data/shortcuts'
import ErrorTagModal from '../components/ErrorTagModal'
import ErrorTimeline from '../components/ErrorTimeline'

export default function ReviewPage({ session, onDone, onBack }) {
  const { profile } = useAuth()
  const { syncNavigation } = useSync()

  const videoRef  = useRef(null)
  const fileInputRef = useRef(null)
  const [videoLoaded, setVideoLoaded] = useState(false)
  const [playing, setPlaying]         = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration]       = useState(0)

  const [errors, setErrors]           = useState([])
  const [pendingTag, setPendingTag]   = useState(null) // { key, isMissing, videoTime }
  const [syncStatus, setSyncStatus]   = useState('disconnected') // disconnected | connected

  // Done modal
  const [showDoneModal, setShowDoneModal]     = useState(false)
  const [reviewedEvents, setReviewedEvents]   = useState('')
  const [submitting, setSubmitting]           = useState(false)
  const [submitted, setSubmitted]             = useState(false)

  // Handle keyboard
  useEffect(() => {
    function handleKey(e) {
      // Block if modal open
      if (pendingTag || showDoneModal) return

      const key = e.key
      const shift = e.shiftKey

      // Navigation shortcuts
      if (key === ' ') {
        e.preventDefault()
        togglePlay()
        syncNavigation('playpause', false)
        return
      }
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        e.preventDefault()
        const ms = shift ? 200 : 600
        const dir = key === 'ArrowRight' ? 1 : -1
        seekBy(dir * ms / 1000)
        syncNavigation(key === 'ArrowRight' ? 'forward' : 'backward', shift)
        return
      }

      // Error tagging
      const upper = key.toUpperCase()
      if (upper === MISSING_EVENT_KEY) {
        e.preventDefault()
        setPendingTag({ key: upper, isMissing: true, videoTime: videoRef.current?.currentTime || 0 })
        return
      }
      if (KEY_TO_EVENT[upper]) {
        e.preventDefault()
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
  }, [pendingTag, showDoneModal, syncNavigation])

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
  }

  function seekTo(seconds) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, seconds))
  }

  function handleVideoFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const v = videoRef.current
    if (v) { v.src = url; v.load(); setVideoLoaded(true) }
  }

  async function handleTagConfirm(tagData) {
    setPendingTag(null)
    const errorDoc = {
      ...tagData,
      sessionId:   session.sessionId,
      matchId:     session.matchId,
      half:        session.half,
      reviewerId:  profile.uid,
      reviewerEmail: profile.email,
      createdAt:   serverTimestamp(),
    }
    try {
      await addDoc(collection(db, 'mark_error_tags'), errorDoc)
      await updateDoc(doc(db, 'mark_sessions', session.sessionId), {
        totalTaggedErrors: increment(1)
      })
      setErrors(prev => [...prev, tagData])
    } catch (e) {
      console.error('Failed to save tag:', e)
    }
  }

  async function handleDoneSubmit() {
    if (!reviewedEvents || isNaN(parseInt(reviewedEvents))) return
    setSubmitting(true)
    const total = parseInt(reviewedEvents)
    const tagCount = errors.length
    const quality = Math.round(100 - ((tagCount / Math.max(total, 1)) * 100))

    try {
      await updateDoc(doc(db, 'mark_sessions', session.sessionId), {
        status: 'completed',
        totalReviewedEvents: total,
        totalTaggedErrors: tagCount,
        qualityScore: quality,
        completedAt: serverTimestamp(),
      })
      setSubmitted(true)
      setTimeout(() => onDone({ quality, tagCount, total }), 1500)
    } catch (e) {
      setSubmitting(false)
    }
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2,'0')}`
  }

  return (
    <div style={{height:'100vh',display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden'}}>

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
          {/* Sync status */}
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--t-3)'}}>
            <span className={`status-dot ${syncStatus === 'connected' ? 'green' : 'gray'}`}/>
            Collection app {syncStatus === 'connected' ? 'synced' : 'not detected'}
          </div>
          {/* Error count */}
          <div className="tag-pill">{errors.length} errors tagged</div>
          {/* Done button */}
          <button
            className="btn-orange"
            style={{padding:'7px 18px',fontSize:13}}
            onClick={() => setShowDoneModal(true)}
          >
            Done ✓
          </button>
        </div>
      </header>

      {/* Main — Video */}
      <div style={{flex:1,position:'relative',background:'#000',overflow:'hidden'}}>

        {/* Video element */}
        <video
          ref={videoRef}
          style={{width:'100%',height:'100%',objectFit:'contain'}}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
          onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />

        {/* Drop zone overlay — shown when no video */}
        {!videoLoaded && (
          <div
            style={{
              position:'absolute', inset:0,
              display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'center',
              gap:16, cursor:'pointer',
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              const file = e.dataTransfer.files?.[0]
              if (file) {
                const url = URL.createObjectURL(file)
                const v = videoRef.current
                if (v) { v.src = url; v.load(); setVideoLoaded(true) }
              }
            }}
          >
            <div style={{
              width:80, height:80, borderRadius:20,
              border:'2px dashed var(--b-2)',
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M5 3l14 9-14 9V3z" stroke="var(--t-3)" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:14,fontWeight:600,color:'var(--t-2)'}}>Drop video file here</div>
              <div style={{fontSize:12,color:'var(--t-3)',marginTop:4}}>or click to browse</div>
            </div>
          </div>
        )}

        <input ref={fileInputRef} type="file" accept="video/*" style={{display:'none'}} onChange={handleVideoFile}/>

        {/* Keyboard hint overlay */}
        {videoLoaded && errors.length === 0 && (
          <div style={{
            position:'absolute', bottom:80, left:'50%', transform:'translateX(-50%)',
            background:'rgba(0,0,0,0.7)', borderRadius:12, padding:'10px 20px',
            display:'flex', gap:16, alignItems:'center',
          }}>
            {[
              ['←→', 'Navigate 600ms'],
              ['Shift+←→', '200ms'],
              ['Space', 'Play/Pause'],
              ['E/Q/D…', 'Tag Error'],
              ['Y', 'Missing Event'],
            ].map(([key, label]) => (
              <div key={key} style={{textAlign:'center'}}>
                <span className="kbd">{key}</span>
                <div style={{fontSize:10,color:'var(--t-3)',marginTop:3}}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div style={{
        flexShrink:0, background:'var(--bg-2)',
        borderTop:'1px solid var(--b-1)',
        padding:'8px 16px 12px',
      }}>
        {/* Timeline */}
        <ErrorTimeline
          errors={errors}
          videoDuration={duration}
          currentTime={currentTime}
          onSeek={seekTo}
        />
        {/* Time display */}
        <div style={{display:'flex',justifyContent:'space-between',marginTop:6}}>
          <span className="mono" style={{fontSize:11,color:'var(--t-3)'}}>
            {formatTime(currentTime)}
          </span>
          <span className="mono" style={{fontSize:11,color:'var(--t-3)'}}>
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Error Tag Modal */}
      {pendingTag && (
        <ErrorTagModal
          triggeredKey={pendingTag.key}
          isMissing={pendingTag.isMissing}
          videoTime={pendingTag.videoTime}
          onConfirm={handleTagConfirm}
          onCancel={() => setPendingTag(null)}
        />
      )}

      {/* Done Modal */}
      {showDoneModal && (
        <div style={{
          position:'fixed', inset:0, zIndex:1000,
          background:'rgba(0,0,0,0.8)',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
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
                    <div style={{fontSize:28,fontWeight:800,color:'var(--p2)'}}>{errors.length}</div>
                    <div style={{fontSize:11,color:'var(--t-3)'}}>Errors Tagged</div>
                  </div>
                  <div style={{width:1,background:'var(--b-1)'}}/>
                  <div style={{textAlign:'center',flex:1}}>
                    <div style={{fontSize:28,fontWeight:800,color:'var(--t-1)'}}>
                      {reviewedEvents ? Math.round(100 - (errors.length / Math.max(parseInt(reviewedEvents),1)) * 100) : '—'}
                    </div>
                    <div style={{fontSize:11,color:'var(--t-3)'}}>Quality Score</div>
                  </div>
                </div>

                <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>
                  TOTAL REVIEWED EVENTS
                </label>
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
                  <button className="btn-ghost" style={{flex:1,padding:'10px 0',fontSize:13}} onClick={() => setShowDoneModal(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn-orange"
                    style={{flex:2,padding:'10px 0',fontSize:13}}
                    disabled={!reviewedEvents || submitting}
                    onClick={handleDoneSubmit}
                  >
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
