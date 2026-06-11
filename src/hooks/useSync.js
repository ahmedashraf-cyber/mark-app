import { useCallback, useEffect, useRef } from 'react'

// v4.3.0 — All sync commands go through localhost WebSocket (port 9001).
// Firebase is no longer used for any sync signal.
// Only meaningful data (sessions, error tags, scores) stays in Firestore.

const WS_PORT = 9001
const HEARTBEAT_MS = 1000

// Module-level singleton WebSocket — shared across all useSync instances
let _ws = null
let _wsReady = false
let _onStatusChange = null

function getWs(onStatusChange) {
  _onStatusChange = onStatusChange
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
    return _ws
  }
  _ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`)
  _ws.onopen = () => {
    _wsReady = true
    if (_onStatusChange) _onStatusChange('connected')
    console.log('[MARK] sync WebSocket connected')
  }
  _ws.onclose = () => {
    _wsReady = false
    if (_onStatusChange) _onStatusChange('disconnected')
    console.log('[MARK] sync WebSocket closed — will retry on next send')
    _ws = null
  }
  _ws.onerror = () => {
    _wsReady = false
    if (_onStatusChange) _onStatusChange('disconnected')
    _ws = null
  }
  return _ws
}

function send(fields, onStatusChange) {
  const ws = getWs(onStatusChange)
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(fields))
    if (onStatusChange) onStatusChange('connected')
  }
  // If not open yet (CONNECTING), the message is dropped — acceptable for
  // fire-and-forget sync signals. No queue needed.
}

export function useSync(onStatusChange, sessionId) {
  const heartbeatRef = useRef(null)

  // Connect eagerly when the hook mounts with a sessionId
  useEffect(() => {
    if (!sessionId) return
    getWs(onStatusChange)
  }, [sessionId, onStatusChange])

  // Arrow key discrete nav
  const syncNavigation = useCallback((action, shiftHeld) => {
    if (!sessionId) return
    send({ type: 'navCommand', action, shift: shiftHeld, ts: Date.now() }, onStatusChange)
  }, [sessionId, onStatusChange])

  // Explicit seek — scrubber drag / click
  const syncSeek = useCallback((currentTime) => {
    if (!sessionId) return
    send({ type: 'seekCommand', currentTime, ts: Date.now() }, onStatusChange)
  }, [sessionId, onStatusChange])

  // Start/stop the position heartbeat when play state changes
  const syncSetPlaying = useCallback((playing, videoRef) => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    if (!sessionId) return
    if (playing) {
      const sendPos = () => {
        const t = videoRef.current?.currentTime
        if (t == null || !isFinite(t)) return
        send({ type: 'posSync', currentTime: t, playing: true, ts: Date.now() }, onStatusChange)
      }
      sendPos()
      heartbeatRef.current = setInterval(sendPos, HEARTBEAT_MS)
    } else {
      const t = videoRef.current?.currentTime
      if (t != null && isFinite(t)) {
        send({ type: 'posSync', currentTime: t, playing: false, ts: Date.now() }, onStatusChange)
      }
    }
  }, [sessionId, onStatusChange])

  useEffect(() => () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
  }, [])

  return { syncNavigation, syncSetPlaying, syncSeek }
}
