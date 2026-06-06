import { useCallback, useEffect, useRef } from 'react'
import { db } from '../firebase/config'
import { doc, updateDoc } from 'firebase/firestore'

// Three command types written to Firestore:
//   navCommand  — discrete seek (arrow keys)
//   posSync     — periodic heartbeat while playing + play/pause state
//   seekCommand — explicit position seek (scrubber drag, click to seek)

const HEARTBEAT_MS = 1000

export function useSync(onStatusChange, sessionId) {
  const heartbeatRef = useRef(null)

  const writeCommand = useCallback(async (fields) => {
    if (!sessionId) return
    try {
      await updateDoc(doc(db, 'mark_sessions', sessionId), fields)
      if (onStatusChange) onStatusChange('connected')
    } catch (e) {
      if (onStatusChange) onStatusChange('disconnected')
    }
  }, [sessionId, onStatusChange])

  // Arrow key discrete nav
  const syncNavigation = useCallback(async (action, shiftHeld) => {
    await writeCommand({
      navCommand: { action, shift: shiftHeld, ts: Date.now() },
    })
  }, [writeCommand])

  // Explicit seek — scrubber drag / click. Sends exact timestamp.
  const syncSeek = useCallback(async (currentTime) => {
    await writeCommand({
      seekCommand: { currentTime, ts: Date.now() },
    })
  }, [writeCommand])

  // Start/stop the position heartbeat when play state changes
  const syncSetPlaying = useCallback((playing, videoRef) => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    if (playing) {
      const sendPos = () => {
        const t = videoRef.current?.currentTime
        if (t == null || !isFinite(t)) return
        writeCommand({ posSync: { currentTime: t, playing: true, ts: Date.now() } })
      }
      sendPos()
      heartbeatRef.current = setInterval(sendPos, HEARTBEAT_MS)
    } else {
      const t = videoRef.current?.currentTime
      if (t != null && isFinite(t)) {
        writeCommand({ posSync: { currentTime: t, playing: false, ts: Date.now() } })
      }
    }
  }, [writeCommand])

  useEffect(() => () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
  }, [])

  return { syncNavigation, syncSetPlaying, syncSeek }
}
