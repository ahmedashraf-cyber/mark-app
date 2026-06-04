import { useCallback } from 'react'
import { db } from '../firebase/config'
import { doc, updateDoc } from 'firebase/firestore'

// Sync now flows through Firestore: MARK writes a navCommand to the session doc;
// the bridge script injected into the collection app listens and moves its video.
// No focus stealing → no click problem.
export function useSync(onStatusChange, sessionId) {
  const syncNavigation = useCallback(async (action, shiftHeld) => {
    if (!sessionId) return
    try {
      await updateDoc(doc(db, 'mark_sessions', sessionId), {
        navCommand: { action, shift: shiftHeld, ts: Date.now() },
      })
      if (onStatusChange) onStatusChange('connected')
    } catch (e) {
      if (onStatusChange) onStatusChange('disconnected')
    }
  }, [onStatusChange, sessionId])

  return { syncNavigation }
}
