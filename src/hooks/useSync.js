// Sync mechanism — Option C: WH_KEYBOARD_LL global keyboard hook
// start_sync() installs the hook once when session starts
// After that, arrow keys are automatically forwarded to collection app
// with NO focus switching — MARK keeps focus the entire time

const COLLECTION_APP_EXE = 'Statsbomb Tag Once collection app.exe'

let tauriInvoke = null
async function getTauri() {
  if (tauriInvoke) return tauriInvoke
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    tauriInvoke = invoke
    return invoke
  } catch {
    return null // dev mode
  }
}

export async function startSync(onStatusChange) {
  const invoke = await getTauri()
  if (!invoke) {
    console.log('[SYNC dev] startSync called')
    return
  }
  try {
    const result = await invoke('start_sync', { exeName: COLLECTION_APP_EXE })
    if (onStatusChange) {
      onStatusChange(result === 'hook_started' ? 'connected' : 'disconnected')
    }
  } catch (e) {
    console.warn('[SYNC] startSync failed:', e)
    if (onStatusChange) onStatusChange('disconnected')
  }
}

export function useSync(onStatusChange) {
  // No-op — hook handles everything now
  // Called from ReviewPage for compatibility
  const syncNavigation = () => {}
  return { syncNavigation }
}
