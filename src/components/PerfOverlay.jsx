/**
 * PerfOverlay.jsx — dev-only readout for the Tag-mode video
 * ============================================================================
 * Off unless localStorage.mark_perf === '1' (or the URL carries ?perf=1), so it
 * costs nothing in normal use. It measures what the user feels, in the real
 * WebView, on the real video file:
 *
 *   renders/s      how often FieldPage re-rendered
 *   seek→seeked    how long the decoder took to land after each currentTime write
 *   dropped fr/s   frames the video pipeline dropped (getVideoPlaybackQuality)
 *   timeupdate/s   the real rate of the video's clock events
 *   long tasks/s   main-thread blocks over 50 ms (PerformanceObserver 'longtask')
 *
 * "Copy" puts the last 20 seconds of readings on the clipboard as JSON, so
 * before/after numbers can be pasted into a message instead of read off a screen.
 */
import { useEffect, useRef, useState } from 'react'

export function perfEnabled() {
  try {
    return localStorage.getItem('mark_perf') === '1' ||
      /[?&]perf=1/.test(window.location.search + window.location.hash)
  } catch { return false }
}

export default function PerfOverlay({ videoRef, renderCountRef, eventCount }) {
  const [s, setS] = useState(null)
  const history = useRef([])
  const evRef = useRef(eventCount)
  evRef.current = eventCount

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let seekStart = 0, tu = 0, longTasks = 0
    // Seek bookkeeping (per second, reset on each tick): how many seeks started, how many started while the previous
    // one had NOT finished (the browser abandons the old one and starts again), how many started during playback,
    // how many were slow, and how many stalls (`waiting` = the decoder ran out of data). `recent` keeps the last
    // seeks for the JSON copy.
    let seeks = 0, overlaps = 0, whilePlaying = 0, waits = 0, slow = 0, pending = false
    const recent = []
    const lat = []
    const onSeeking = () => {
      if (pending) overlaps++
      pending = true; seeks++; if (!v.paused) whilePlaying++
      seekStart = performance.now()
      recent.push({ target: +v.currentTime.toFixed(2), playing: !v.paused, ms: null }); if (recent.length > 12) recent.shift()
    }
    const onSeeked = () => {
      pending = false
      if (!seekStart) return
      const ms = performance.now() - seekStart
      lat.push(ms); if (lat.length > 60) lat.shift(); seekStart = 0
      if (ms > 200) slow++
      if (recent.length) recent[recent.length - 1].ms = +ms.toFixed(1)
    }
    const onWaiting = () => { waits++ }
    const onTU = () => { tu++ }
    v.addEventListener('seeking', onSeeking)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('timeupdate', onTU)
    let obs = null
    try {
      obs = new PerformanceObserver(list => { longTasks += list.getEntries().length })
      obs.observe({ entryTypes: ['longtask'] })
    } catch {}
    let lastRenders = renderCountRef.current, lastDropped = 0
    const iv = setInterval(() => {
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {}
      const dropped = q.droppedVideoFrames || 0
      const sorted = [...lat].sort((a, b) => a - b)
      const row = {
        events: evRef.current,
        rendersPerSec: renderCountRef.current - lastRenders,
        timeupdatePerSec: tu,
        longTasksPerSec: longTasks,
        droppedPerSec: dropped - lastDropped,
        droppedTotal: dropped,
        seekMsLast: lat.length ? +lat[lat.length - 1].toFixed(1) : null,
        seekMsMedian: sorted.length ? +sorted[sorted.length >> 1].toFixed(1) : null,
        seekMsMax: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : null,
        playing: !v.paused,
        seeksPerSec: seeks,
        overlappingSeeksPerSec: overlaps,     // a seek started before the previous one finished
        seeksWhilePlayingPerSec: whilePlaying,
        slowSeeksPerSec: slow,                // took longer than 200 ms
        waitingPerSec: waits,                 // the decoder ran out of data
        recentSeeks: recent.map(r => ({ ...r })),
      }
      lastRenders = renderCountRef.current; lastDropped = dropped; tu = 0; longTasks = 0
      seeks = 0; overlaps = 0; whilePlaying = 0; waits = 0; slow = 0
      history.current.push(row); if (history.current.length > 20) history.current.shift()
      setS(row)
    }, 1000)
    return () => {
      clearInterval(iv)
      v.removeEventListener('seeking', onSeeking); v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('timeupdate', onTU)
      try { obs && obs.disconnect() } catch {}
    }
  }, [videoRef, renderCountRef])

  if (!s) return null
  const row = (k, v) => (<div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}><span style={{ opacity: .6 }}>{k}</span><span>{v ?? '—'}</span></div>)
  return (
    <div style={{ position: 'fixed', right: 10, bottom: 10, zIndex: 3000, minWidth: 190, padding: '8px 10px',
      background: 'rgba(0,0,0,0.82)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#d0d0d8', pointerEvents: 'none' }}>
      <div style={{ fontWeight: 800, letterSpacing: 1, marginBottom: 4, color: '#E8590C' }}>PERF · {s.events} events{s.playing ? ' · playing' : ''}</div>
      {row('renders/s', s.rendersPerSec)}
      {row('timeupdate/s', s.timeupdatePerSec)}
      {row('long tasks/s', s.longTasksPerSec)}
      {row('dropped frames/s', s.droppedPerSec)}
      {row('seek→seeked ms (last)', s.seekMsLast)}
      {row('seek→seeked ms (median)', s.seekMsMedian)}
      {row('seek→seeked ms (max)', s.seekMsMax)}
      {row('seeks/s · overlapping · while playing', `${s.seeksPerSec} · ${s.overlappingSeeksPerSec} · ${s.seeksWhilePlayingPerSec}`)}
      {row('slow seeks/s (>200 ms) · stalls/s', `${s.slowSeeksPerSec} · ${s.waitingPerSec}`)}
      <button style={{ pointerEvents: 'auto', marginTop: 6, width: '100%', fontSize: 9, padding: '3px 0', cursor: 'pointer',
        background: 'transparent', color: '#d0d0d8', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4 }}
        onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(history.current)) } catch {} }}>
        Copy last 20 s as JSON
      </button>
    </div>
  )
}
