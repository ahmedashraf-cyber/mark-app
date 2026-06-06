import { useCallback, useEffect, useRef } from 'react'
import { db } from '../firebase/config'
import { doc, updateDoc } from 'firebase/firestore'

// Sync flows through Firestore. Two command types:
//   navCommand  — discrete seek/playpause (arrow keys, space)
//   posSync     — periodic position heartbeat while playing, so the collection
//                 app bar moves in real time and both videos stay time-locked.

const HEARTBEAT_MS = 1000 // write position every 1s while playing

export function useSync(onStatusChange, sessionId) {

  const heartbeatRef = useRef(null)

  // Write a single Firestore command
  const writeCommand = useCallback(async (fields) => {
    if (!sessionId) return
    try {
      await updateDoc(doc(db, 'mark_sessions', sessionId), fields)
      if (onStatusChange) onStatusChange('connected')
    } catch (e) {
      if (onStatusChange) onStatusChange('disconnected')
    }
  }, [sessionId, onStatusChange])

  // Discrete nav command (arrow keys, space)
  const syncNavigation = useCallback(async (action, shiftHeld) => {
    await writeCommand({
      navCommand: { action, shift: shiftHeld, ts: Date.now() },
    })
  }, [writeCommand])

  // Start/stop the position heartbeat
  // videoRef — ref to the <video> element so we can read currentTime
  // playing  — whether MARK's video is currently playing
  const syncSetPlaying = useCallback((playing, videoRef) => {
    // Clear any existing heartbeat first
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }

    if (playing) {
      // Send position immediately on play, then every HEARTBEAT_MS
      const sendPos = () => {
        const t = videoRef.current?.currentTime
        if (t == null || !isFinite(t)) return
        writeCommand({
          posSync: { currentTime: t, playing: true, ts: Date.now() },
        })
      }
      sendPos()
      heartbeatRef.current = setInterval(sendPos, HEARTBEAT_MS)
    } else {
      // Send a final position on pause so collection app lands on same frame
      const t = videoRef.current?.currentTime
      if (t != null && isFinite(t)) {
        writeCommand({
          posSync: { currentTime: t, playing: false, ts: Date.now() },
        })
      }
    }
  }, [writeCommand])

  // Clean up interval on unmount
  useEffect(() => () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
  }, [])

  return { syncNavigation, syncSetPlaying }
}
