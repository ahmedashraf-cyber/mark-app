/**
 * VideoWindow.jsx — the pop-out player window
 * ============================================================================
 * Rendered when index.html is opened with ?window=video, which App.jsx checks
 * BEFORE any auth. A second Tauri window loads the bundle fresh — a separate
 * React root with no shared state — so without that guard it would boot
 * straight into the login screen.
 *
 * It takes no props. Everything it needs arrives in the query string, because
 * the two windows share no memory:
 *     ?window=video&url=<proxy url>&name=<filename>&status=<videoMatchStatus>
 *
 * Seeks arrive as Tauri events on 'mark:video-seek' from the main window.
 */
import { useEffect, useRef, useState } from 'react'
import VideoPanel from './VideoPanel'

export default function VideoWindow() {
  const params = new URLSearchParams(window.location.search)
  const url    = params.get('url') || ''
  const name   = params.get('name') || 'video'
  const status = params.get('status') || 'unknown'

  const playerRef = useRef(null)
  const [lastSeek, setLastSeek] = useState(null)
  const [listening, setListening] = useState(false)

  useEffect(() => {
    let unlisten = null
    let alive = true
    ;(async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen('mark:video-seek', ev => {
          const { ms, label } = ev.payload || {}
          if (ms == null) return
          playerRef.current?.seekTo(ms, label)
          // Seeking then playing is the point of the pop-out: the reviewer
          // clicks a row in the other window and the moment plays here.
          setTimeout(() => playerRef.current?.play?.(), 60)
          setLastSeek({ ms, label, at: Date.now() })
        })
        if (alive) setListening(true)
      } catch (e) {
        console.error('[MARK video window] could not listen for seeks:', e)
      }
    })()
    return () => { alive = false; if (unlisten) unlisten() }
  }, [])

  if (!url) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'var(--bg)', color:'var(--t-3)', fontSize:13, padding:24, textAlign:'center' }}>
      No video was passed to this window. Close it and press Run Comparison again.
    </div>
  )

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', color:'var(--t-1)', overflow:'hidden' }}>
      <div style={{ flexShrink:0, height:34, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 12px', gap:10 }}>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:8, fontWeight:800,
          color:'var(--p2)', letterSpacing:1.4, background:'rgba(232,89,12,0.12)',
          padding:'2px 7px', borderRadius:4 }}>MARK VIDEO</div>
        <span style={{ fontSize:10, color:'var(--t-3)', flex:1, overflow:'hidden',
          textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
        <span style={{ fontSize:9, color: listening ? '#30D158' : '#FF9500' }}>
          {listening ? 'linked to results' : 'not linked'}
        </span>
      </div>

      <div style={{ flex:1, minHeight:0, padding:12 }}>
        <VideoPanel ref={playerRef} url={url} filename={name}
          matchStatus={status} fill/>
      </div>

      {lastSeek && (
        <div style={{ flexShrink:0, padding:'6px 12px', fontSize:10, color:'var(--t-3)',
          borderTop:'1px solid var(--b-1)', background:'var(--bg-2)' }}>
          last seek: {lastSeek.label || 'event'} @ {(lastSeek.ms / 1000).toFixed(3)}s
        </div>
      )}
    </div>
  )
}
