import { useCallback } from 'react'

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

export function useSync() {
  const syncNavigation = useCallback(async (action, shiftHeld) => {
    const invoke = await getTauri()
    if (!invoke) {
      console.log('[SYNC dev]', action, shiftHeld)
      return
    }
    const keyMap = {
      forward:   shiftHeld ? 'SHIFT_RIGHT' : 'RIGHT',
      backward:  shiftHeld ? 'SHIFT_LEFT'  : 'LEFT',
      playpause: 'SPACE',
    }
    try {
      await invoke('send_key_to_collection_app', {
        exeName: COLLECTION_APP_EXE,
        keyCode: keyMap[action] || '',
      })
    } catch (e) {
      console.warn('[SYNC]', e)
    }
  }, [])

  return { syncNavigation }
}
