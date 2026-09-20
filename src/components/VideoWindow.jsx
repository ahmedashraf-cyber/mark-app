/**
 * VideoWindow.jsx — the pop-out player window
 * ============================================================================
 * Rendered when index.html is opened with the #video-player hash, which
 * main.jsx routes BEFORE importing App at all. That matters: App statically
 * imports every page module plus Firebase and the auth provider, so a guard
 * inside App() stopped them rendering but not loading. Here, nothing of the
 * application is fetched — only this component and VideoPanel.
 *
 * It takes no props. Everything it needs arrives in the query string, because
 * the two windows share no memory:
 *     #video-player?url=<proxy url>&name=<filename>&status=<videoMatchStatus>
 *
 * Seeks arrive as Tauri events on 'mark:video-seek' from the main window.
 */
import { useEffect, useRef, useState } from 'react'
import VideoPanel from './VideoPanel'

export default function VideoWindow() {
  // Params live in the HASH — see main.jsx for why. Falls back to the query
  // string so an older pop-out URL still works.
  const hash = window.location.hash || ''
  const params = new URLSearchParams(
    hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : window.location.search)
  // Seeded from the query string, then replaceable by a mark:video-load event —
  // the main window reuses this window rather than recreating it, so the file
  // can change without a reload.
  const [src, setSrc] = useState({
    url:    params.get('url') || '',
    name:   params.get('name') || 'video',
    status: params.get('status') || 'unknown',
  })

  const playerRef = useRef(null)
  const [lastSeek, setLastSeek] = useState(null)
  const [listening, setListening] = useState(false)

  const [linkError, setLinkError] = useState('')

  useEffect(() => {
    let unlisten = null, unlistenLoad = null, unlistenPing = null
    let alive = true
    ;(async () => {
      try {
        console.log('[VIDEO WIN] registering listeners…')
        const { listen, emit } = await import('@tauri-apps/api/event')

        unlistenLoad = await listen('mark:video-load', ev => {
          console.log('[VIDEO WIN] received mark:video-load', ev.payload)
          const { url, name, status } = ev.payload || {}
          if (url) setSrc({ url, name: name || 'video', status: status || 'unknown' })
        })

        unlisten = await listen('mark:video-seek', ev => {
          console.log('[VIDEO WIN] received mark:video-seek', ev.payload)
          const { ms, label } = ev.payload || {}
          if (ms == null) { console.warn('[VIDEO WIN] seek had no ms, ignoring'); return }
          const ok = playerRef.current?.seekTo(ms, label)
          console.log('[VIDEO WIN] seekTo applied:', ok)
          // seek then play — the reviewer clicks a row in the other window and
          // the moment plays here rather than sitting on a frozen frame
          setTimeout(() => playerRef.current?.play?.(), 60)
          setLastSeek({ ms, label, at: Date.now() })
        })

        // The main window pings; replying is what proves the channel works in
        // BOTH directions instead of the pop-out assuming it does because
        // listen() happened to resolve.
        unlistenPing = await listen('mark:video-ping', async () => {
          console.log('[VIDEO WIN] received ping, replying')
          try { await emit('mark:video-pong', { at: Date.now() }) }
          catch (e) { console.warn('[VIDEO WIN] could not reply:', e) }
        })

        if (alive) {
          setListening(true)
          console.log('[VIDEO WIN] listeners registered — linked')
          // announce ourselves, in case the opener is already waiting
          try { await emit('mark:video-pong', { at: Date.now(), hello: true }) } catch {}
        }
      } catch (e) {
        // What actually happened before v7.9.3: Tauri capabilities are scoped
        // by WINDOW LABEL and only "main" was listed, so listen() was denied
        // here. The pop-out could never link, while the main window's emit
        // still succeeded — hence a link that looked one-directional.
        console.error('[VIDEO WIN] could not register listeners:', e)
        if (alive) setLinkError(e?.message || String(e))
      }
    })()
    return () => {
      alive = false
      if (unlisten) unlisten()
      if (unlistenLoad) unlistenLoad()
      if (unlistenPing) unlistenPing()
    }
  }, [])

  if (!src.url) return (
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
          textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{src.name}</span>
        <span style={{ fontSize:9, color: listening ? '#30D158' : '#FF453A' }}
          title={linkError || ''}>
          {listening ? 'linked to results'
            : linkError ? 'not linked — ' + linkError.slice(0, 60)
            : 'linking…'}
        </span>
      </div>

      <div style={{ flex:1, minHeight:0, padding:12 }}>
        <VideoPanel key={src.url} ref={playerRef} url={src.url} filename={src.name}
          matchStatus={src.status} fill/>
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
