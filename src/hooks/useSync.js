import { useCallback } from 'react'

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
      // CDP — sends key directly into collection app's Chromium engine
      // Zero focus stealing — MARK keeps focus completely
      const result = await invoke('send_key_via_cdp', {
        keyCode: keyMap[action] || '',
      })
      if (onStatusChange) {
        onStatusChange(result === 'sent' ? 'connected' : 'disconnected')
      }
    } catch (e) {
      if (onStatusChange) onStatusChange('disconnected')
    }
  }, [onStatusChange])

  return { syncNavigation }
}

// Helper exports for SessionSetupPage
export async function checkCdpAvailable() {
  const invoke = await getTauri()
  if (!invoke) return false
  try {
    return await invoke('check_cdp_available')
  } catch {
    return false
  }
}

export async function launchCollectionApp(exePath) {
  const invoke = await getTauri()
  if (!invoke) throw new Error('Tauri not available')
  return await invoke('launch_collection_app', { exePath })
}
