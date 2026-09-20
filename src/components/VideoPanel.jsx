/**
 * VideoPanel.jsx — local video player for Comparison mode
 * ============================================================================
 * Standalone by choice. ClipTagger owns a player but also owns tagging,
 * keyboard capture and pending-attribute state, and Drill's builder and session
 * both depend on it — extracting from it to serve a read-only reviewer would
 * put that at risk for no gain here.
 *
 * No Tornado bridge. The file is picked locally and served by MARK's own HTTP
 * server (pick_video_file + get_video_url), the same path FIELD uses, so
 * whatever formats FIELD plays this plays.
 *
 * The parent seeks via a ref rather than a prop:
 *     videoRef.current.seekTo(ms)
 * A prop would re-render the video element on every click and interrupt
 * playback, which is exactly what a reviewer scanning a table does not want.
 */
import { useRef, useState, useImperativeHandle, forwardRef, useEffect } from 'react'

const FRAME = 1 / 25   // one frame at 25fps, matching FIELD

function fmt(sec) {
  if (!isFinite(sec) || sec < 0) return '00:00.000'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 1000)
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`
}

const VideoPanel = forwardRef(function VideoPanel({ url, filename, matchStatus, onClose, fill = false }, ref) {
  const vidRef = useRef(null)
  const [time, setTime]         = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying]   = useState(false)
  const [flash, setFlash]       = useState(null)   // brief confirmation of a seek
  const [isFs, setIsFs]         = useState(false)
  const [showCtl, setShowCtl]   = useState(true)   // controls visible in fullscreen
  const hideTimer = useRef(null)
  const shellRef  = useRef(null)

  useImperativeHandle(ref, () => ({
    /** Seek to an absolute position in milliseconds. */
    seekTo(ms, label) {
      const v = vidRef.current
      if (!v) return false
      const sec = Math.max(0, Number(ms) / 1000)
      v.pause()
      setPlaying(false)
      v.currentTime = sec
      setTime(sec)
      setFlash(label ? `${label} @ ${fmt(sec)}` : fmt(sec))
      setTimeout(() => setFlash(null), 2200)
      return true
    },
    /** Start playback. The pop-out seeks then plays, so a clicked row shows
        the moment moving rather than a frozen frame. */
    play() {
      const v = vidRef.current
      if (!v) return
      v.play().then(() => setPlaying(true)).catch(() => {})
    },
    pause() {
      const v = vidRef.current
      if (!v) return
      v.pause(); setPlaying(false)
    },
    isReady: () => !!vidRef.current,
  }), [])

  // a new file replaces the old one outright
  useEffect(() => {
    setTime(0); setDuration(0); setPlaying(false); setFlash(null)
  }, [url])

  /**
   * True OS fullscreen via the HTML5 API, not Tauri's setFullscreen.
   *
   * Tauri's version fullscreens the WINDOW, so the video would still sit inside
   * the app's own chrome. requestFullscreen on the wrapper puts the video
   * itself edge to edge, hides the title bar and taskbar, and ESC exits
   * natively — and it needs no extra permission.
   *
   * The wrapper is the target rather than the <video> element so the overlay
   * controls remain part of the fullscreen surface; fullscreening the video
   * element alone would leave the controls behind on the desktop.
   */
  const toggleFullscreen = async () => {
    const el = shellRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await el.requestFullscreen()
    } catch (e) {
      console.warn('[MARK] fullscreen refused:', e?.message || e)
    }
  }

  useEffect(() => {
    const onFs = () => {
      const on = !!document.fullscreenElement
      setIsFs(on)
      setShowCtl(true)
      if (!on && hideTimer.current) clearTimeout(hideTimer.current)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // In fullscreen the controls fade after 3s of stillness and return on any
  // movement — a projector audience should see the match, not the chrome.
  useEffect(() => {
    if (!isFs) return
    const bump = () => {
      setShowCtl(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setShowCtl(false), 3000)
    }
    bump()
    window.addEventListener('mousemove', bump)
    window.addEventListener('keydown', bump)
    return () => {
      window.removeEventListener('mousemove', bump)
      window.removeEventListener('keydown', bump)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [isFs])

  const toggle = () => {
    const v = vidRef.current; if (!v) return
    if (v.paused) { v.play().catch(() => {}); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }
  const step = d => {
    const v = vidRef.current; if (!v) return
    v.pause(); setPlaying(false)
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d))
    setTime(v.currentTime)
  }

  // keyboard, only while this panel has focus — Comparison has no other
  // shortcuts, but claiming space globally would fight the results table
  const wrapRef = useRef(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onKey = e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
      if (e.code === 'Space')      { e.preventDefault(); toggle() }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); step(e.shiftKey ? -1 : -FRAME) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ?  1 :  FRAME) }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen() }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [])

  const STATUS = {
    ok:                 { c:'#30D158', t:'same video on both sessions' },
    size_mismatch:      { c:'#FFD60A', t:'re-encoded file — timestamps may drift' },
    duration_mismatch:  { c:'#FF453A', t:'different cut — seeks will be off' },
    unknown:            { c:'var(--t-3)', t:'video identity not recorded — seeks unverified' },
  }
  const st = STATUS[matchStatus] || STATUS.unknown

  const fsBtn = {
    padding:'7px 12px', fontSize:12, fontWeight:600, background:'rgba(255,255,255,0.14)',
    border:'1px solid rgba(255,255,255,0.28)', borderRadius:6, color:'#fff',
    cursor:'pointer', whiteSpace:'nowrap',
  }
  const btn = {
    padding:'6px 10px', fontSize:11, fontWeight:600, background:'var(--bg-3)',
    border:'1px solid var(--b-1)', borderRadius:6, color:'var(--t-2)', cursor:'pointer',
    whiteSpace:'nowrap',
  }

  return (
    <div ref={wrapRef} tabIndex={-1}
      style={{ display:'flex', flexDirection:'column', gap:8, height:'100%', outline:'none' }}>

      {!isFs && <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:11, fontWeight:700, flex:1, overflow:'hidden',
          textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {filename || 'video'}
        </span>
        {onClose && (
          <button onClick={onClose} style={{ ...btn, padding:'4px 8px' }}
            title="Unload the video. Results stay visible.">Close</button>
        )}
      </div>}

      {/* Video identity. The engine already computes this; surfacing it matters
          because a mismatched cut makes every model-timestamp seek land in the
          wrong place, which reads as a mis-tagged event. */}
      <div style={{ fontSize:9, color:st.c, display:'flex', alignItems:'center', gap:5 }}>
        <span style={{ width:6, height:6, borderRadius:'50%', background:st.c, flexShrink:0 }}/>
        {matchStatus || 'unknown'} — {st.t}
      </div>

      <div ref={shellRef} style={{ position:'relative', background:'#000',
        borderRadius: isFs ? 0 : 8, overflow:'hidden',
        ...(isFs ? { flex:1, minHeight:0, display:'flex', alignItems:'center',
                     justifyContent:'center', cursor: showCtl ? 'default' : 'none' }
                 : fill ? { flex:1, minHeight:0, display:'flex', alignItems:'center',
                            justifyContent:'center' } : {}) }}>
        <video ref={vidRef} src={url} playsInline muted
          onTimeUpdate={() => setTime(vidRef.current?.currentTime || 0)}
          onLoadedMetadata={() => setDuration(vidRef.current?.duration || 0)}
          onClick={toggle}
          style={(isFs || fill)
            ? { maxWidth:'100%', maxHeight:'100%', display:'block', cursor:'pointer' }
            : { width:'100%', display:'block', maxHeight:'46vh', cursor:'pointer' }}/>
        {/* In fullscreen the controls overlay the video and fade with it, so
            nothing outside the shell is needed — and nothing is left behind on
            the desktop. */}
        {isFs && (
          <div style={{ position:'absolute', left:0, right:0, bottom:0,
            padding:'14px 18px 16px',
            background:'linear-gradient(transparent, rgba(0,0,0,0.78))',
            opacity: showCtl ? 1 : 0, transition:'opacity .35s',
            pointerEvents: showCtl ? 'auto' : 'none',
            display:'flex', flexDirection:'column', gap:8 }}>
            <input type="range" min="0" max={duration || 0} step="0.001" value={time}
              onChange={e => {
                const v = vidRef.current; if (!v) return
                v.pause(); setPlaying(false)
                v.currentTime = parseFloat(e.target.value); setTime(v.currentTime)
              }}
              style={{ width:'100%', accentColor:'var(--p2)' }}/>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:20,
                fontWeight:800, color:'#fff', minWidth:140 }}>
                {fmt(time)}
                <span style={{ fontSize:11, opacity:0.6, fontWeight:400 }}> / {fmt(duration)}</span>
              </span>
              <div style={{ flex:1 }}/>
              <button onClick={() => step(-1)}     style={fsBtn}>−1s</button>
              <button onClick={() => step(-FRAME)} style={fsBtn}>◀</button>
              <button onClick={toggle} style={{ ...fsBtn, minWidth:66, fontWeight:800 }}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <button onClick={() => step(FRAME)}  style={fsBtn}>▶</button>
              <button onClick={() => step(1)}      style={fsBtn}>+1s</button>
              <button onClick={toggleFullscreen} style={fsBtn} title="Exit full screen (Esc)">
                Exit full screen
              </button>
            </div>
          </div>
        )}

        {flash && (
          <div style={{ position:'absolute', top:8, left:8, background:'rgba(232,89,12,0.92)',
            color:'#fff', fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5,
            fontFamily:'JetBrains Mono,monospace' }}>
            {flash}
          </div>
        )}
      </div>

      {/* prominent timestamp — the reviewer checks it against the table */}
      <div style={{ textAlign:'center', fontFamily:'JetBrains Mono,monospace',
        fontSize:22, fontWeight:800, color:'var(--p2)', lineHeight:1 }}>
        {fmt(time)}
        <span style={{ fontSize:10, color:'var(--t-3)', fontWeight:400, marginLeft:8 }}>
          / {fmt(duration)}
        </span>
      </div>

      <input type="range" min="0" max={duration || 0} step="0.001" value={time}
        onChange={e => {
          const v = vidRef.current; if (!v) return
          v.pause(); setPlaying(false)
          v.currentTime = parseFloat(e.target.value); setTime(v.currentTime)
        }}
        style={{ width:'100%', accentColor:'var(--p2)' }}/>

      <div style={{ display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap' }}>
        <button onClick={() => step(-1)}     style={btn} title="Back 1 second">−1s</button>
        <button onClick={() => step(-FRAME)} style={btn} title="Back one frame">◀</button>
        <button onClick={toggle} style={{ ...btn, minWidth:62, fontWeight:800 }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => step(FRAME)}  style={btn} title="Forward one frame">▶</button>
        <button onClick={() => step(1)}      style={btn} title="Forward 1 second">+1s</button>
        <button onClick={toggleFullscreen} style={{ ...btn, fontWeight:800 }}
          title="Full screen (F) — video fills the screen, Esc to exit">
          ⛶ Full screen
        </button>
      </div>

      <div style={{ fontSize:9, color:'var(--t-3)', textAlign:'center' }}>
        click the video or press space to play · ← → step a frame · shift + ← → one second · F full screen
      </div>
    </div>
  )
})

export default VideoPanel
