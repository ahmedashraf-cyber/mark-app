/**
 * LocalVideoDrop.jsx — "drop your own video here" for the read-only My halves screen.
 *
 * The person picks (or drops) a file from their own disk and it is played in this window through a browser blob URL.
 * NOTHING IS UPLOADED and nothing is copied: the file stays where it is. (Same approach as the Insights screen; this
 * is a copy of the idea, so Insights is not edited.)
 *
 * The parent seeks through a ref, `ref.current.seekTo(ms)`, rather than a prop, so a click on a table row does not
 * re-render the player and interrupt playback.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

const VIDEO_NAME = /\.(mp4|mov|mkv|webm|avi|mts|m2ts)$/i

const LocalVideoDrop = forwardRef(function LocalVideoDrop({ expectedName = '', onChange }, ref) {
  const [src, setSrc] = useState('')
  const [name, setName] = useState('')
  const [over, setOver] = useState(false)
  const [err, setErr] = useState('')
  const vid = useRef(null), pick = useRef(null)

  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])
  useEffect(() => { onChange?.(!!src) }, [src])   // eslint-disable-line react-hooks/exhaustive-deps

  const load = file => {
    if (!file) return
    if (!(file.type || '').startsWith('video/') && !VIDEO_NAME.test(file.name || '')) { setErr('That is not a video file.'); return }
    setErr('')
    if (src) URL.revokeObjectURL(src)
    setSrc(URL.createObjectURL(file)); setName(file.name || '')
  }
  const clear = () => { if (src) URL.revokeObjectURL(src); setSrc(''); setName(''); setErr('') }

  useImperativeHandle(ref, () => ({
    hasVideo: () => !!src,
    seekTo(ms) {
      const el = vid.current
      if (!el || !src) return false
      const t = Math.max(0, Number(ms) / 1000)
      if (!Number.isFinite(t)) return false
      if (el.readyState >= 1) el.currentTime = t
      else el.addEventListener('loadedmetadata', () => { el.currentTime = t }, { once: true })
      return true
    },
  }), [src])

  const different = !!src && !!expectedName && name.toLowerCase() !== expectedName.toLowerCase()
  return (
    <div data-testid="video-drop" style={{ border: '1px solid var(--b-1)', borderRadius: 10, background: 'var(--bg-2)', overflow: 'hidden' }}>
      {!src ? (
        <div data-testid="drop-zone"
          onClick={() => pick.current?.click()}
          onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); load(e.dataTransfer?.files?.[0]) }}
          style={{ padding: '34px 16px', textAlign: 'center', cursor: 'pointer', fontSize: 12, color: 'var(--t-3)', lineHeight: 1.7,
            background: over ? 'rgba(232,89,12,0.10)' : 'transparent', border: `1px dashed ${over ? 'var(--p2)' : 'var(--b-2)'}`, margin: 10, borderRadius: 8 }}>
          Drop your video here or click to browse
          <div style={{ fontSize: 10, marginTop: 4 }}>The file stays on this PC. Nothing is uploaded.</div>
          {expectedName && <div style={{ fontSize: 10, marginTop: 6 }}>This half was tagged on <b style={{ color: 'var(--t-2)' }}>{expectedName}</b></div>}
        </div>
      ) : (
        <>
          <video data-testid="video" ref={vid} src={src} controls style={{ width: '100%', display: 'block', background: '#000', maxHeight: 280 }}/>
          <div style={{ padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: 'var(--t-3)' }}>
            <span title={name} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            <button onClick={clear} style={{ background: 'transparent', border: '1px solid var(--b-1)', borderRadius: 5, color: 'var(--t-2)', fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}>Change</button>
          </div>
          {different && <div data-testid="video-name-warning" style={{ padding: '0 10px 8px', fontSize: 10, color: '#FF9F0A' }}>This file is called {name}, but this half was tagged on {expectedName}. Make sure it is the same match video, or the moments will not line up.</div>}
        </>
      )}
      <input ref={pick} type="file" accept="video/*,.mkv,.mts,.m2ts" style={{ display: 'none' }} onChange={e => { load(e.target.files?.[0]); e.target.value = '' }}/>
      {err && <div style={{ padding: '0 10px 8px', fontSize: 10, color: '#FF453A' }}>{err}</div>}
    </div>
  )
})
export default LocalVideoDrop
