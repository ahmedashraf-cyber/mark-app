import { useCallback } from 'react'

// Sync mechanism — sends keystrokes to collection app via Tauri
// Falls back to no-op in browser dev mode
const COLLECTION_APP_EXE = 'Statsbomb Tag Once collection app.exe'

let tauriInvoke = null
// Lazy load Tauri API — only available in desktop context
async function getTauri() {
  if (tauriInvoke) return tauriInvoke
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    tauriInvoke = invoke
    return invoke
  } catch {
    return null // running in browser dev mode
  }
}

export function useSync() {
  const sendKey = useCallback(async (keyCode) => {
    const invoke = await getTauri()
    if (!invoke) {
      // Dev mode — log instead
      console.log('[SYNC]', keyCode, '→', COLLECTION_APP_EXE)
      return
    }
    try {
      await invoke('send_key_to_collection_app', {
        exeName: COLLECTION_APP_EXE,
        keyCode,
      })
    } catch (e) {
      console.warn('[SYNC] Failed to send key:', e)
    }
  }, [])

  const syncNavigation = useCallback(async (action, shiftHeld) => {
    // Map action to VK code
    const VK = {
      forward:   shiftHeld ? 'SHIFT_RIGHT' : 'RIGHT',
      backward:  shiftHeld ? 'SHIFT_LEFT'  : 'LEFT',
      playpause: 'SPACE',
    }
    const code = VK[action]
    if (code) await sendKey(code)
  }, [sendKey])

  return { syncNavigation, sendKey }
}
