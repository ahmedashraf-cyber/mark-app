import { useCallback, useRef } from 'react'

const COLLECTION_APP_EXE = 'Statsbomb Tag Once collection app.exe'

let tauriInvoke = null
async function getTauri() {
  if (tauriInvoke) return tauriInvoke
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    tauriInvoke = invoke
    return invoke
  } catch {
    return null
  }
}

export function useSync(onStatusChange) {
  const syncNavigation = useCallback(async (action, shiftHeld) => {
    const invoke = await getTauri()
    if (!invoke) return

    const keyMap = {
      forward:   shiftHeld ? 'SHIFT_RIGHT' : 'RIGHT',
      backward:  shiftHeld ? 'SHIFT_LEFT'  : 'LEFT',
      playpause: 'SPACE',
    }
    try {
      const result = await invoke('send_key_to_collection_app', {
        exeName: COLLECTION_APP_EXE,
        keyCode: keyMap[action] || '',
      })
      // Restore keyboard focus from inside Chromium after focus steal
      // Running inside the webview — Chromium trusts this completely
      try {
        window.focus()
        document.body.focus()
        if (document.activeElement && document.activeElement !== document.body) {
          document.activeElement.blur()
        }
        document.body.focus()
      } catch(_) {}
      // Update connection status based on result
      if (onStatusChange) {
        onStatusChange(result === 'sent' ? 'connected' : 'disconnected')
      }
    } catch (e) {
      if (onStatusChange) onStatusChange('disconnected')
    }
  }, [onStatusChange])

  return { syncNavigation }
}
