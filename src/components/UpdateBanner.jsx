import { useState } from 'react'

// ── Fallback: open the GitHub download URL in the system browser ────────────
async function openExternal(url) {
  if (!url) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_file', { path: url })
  } catch (e) {
    console.error('[MARK] could not open', url, e)
    alert('Could not open the download. Copy this link into your browser:\n\n' + url)
  }
}

async function showInFolder(path) {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_folder', { path })
  } catch (e) {
    console.error('[MARK] could not open folder', e)
  }
}

// ── Plugin-based download → verify → install → close ────────────────────────
// Uses tauri-plugin-updater. The plugin:
//   1. Downloads from the GitHub release asset
//   2. Verifies the signature against the pubkey in tauri.conf.json
//   3. Launches the installer (on Windows this exits the app automatically)
//
// This only runs when checkForUpdate() already confirmed a newer approved
// version exists — the approval gate (GitHub non-draft main-branch release)
// is already enforced before this button is clicked.
//
// Returns { ok, installerPath, error }
async function pluginInstall(onProgress) {
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    onProgress({ phase: 'checking', pct: 0 })
    const update = await check()
    if (!update) {
      // Shouldn't happen (checkForUpdate already found one), but handle it.
      return { ok: false, error: 'No update found via plugin — the release may still be processing. Try again in a minute.' }
    }

    let downloaded = 0, total = 0
    onProgress({ phase: 'downloading', pct: 0 })

    await update.download(ev => {
      if (ev.event === 'Started')  { total = ev.data.contentLength || 0; onProgress({ phase: 'downloading', pct: 0 }) }
      if (ev.event === 'Progress') { downloaded += ev.data.chunkLength; onProgress({ phase: 'downloading', pct: total ? Math.round(downloaded / total * 100) : -1 }) }
      if (ev.event === 'Finished') { onProgress({ phase: 'installing', pct: 100 }) }
    })

    // install() on Windows exits the process after launching the installer.
    // The MARK window closes, the installer opens, and the new version starts.
    onProgress({ phase: 'installing', pct: 100 })
    await update.install()

    // Unreachable on Windows (install() exits), reached on macOS/Linux
    return { ok: true }
  } catch (e) {
    const msg = e?.message || String(e)
    console.error('[MARK updater] plugin install failed:', msg)

    // Signature verification failure — must not install
    if (msg.includes('signature') || msg.includes('verify') || msg.includes('invalid')) {
      return {
        ok: false,
        verified: false,
        error: "The update couldn't be verified, so it wasn't installed. Try again or contact Fady.",
      }
    }
    // Plugin not configured yet (pubkey placeholder or plugin missing)
    if (msg.includes('REPLACE_WITH') || msg.includes('pubkey') || msg.includes('plugin:updater')) {
      return { ok: false, notConfigured: true, error: msg }
    }
    return { ok: false, error: msg }
  }
}

export default function UpdateBanner({ update, onDismiss, hasUnsavedWork }) {
  if (!update) return null

  const [phase, setPhase]     = useState(null)  // null | 'downloading' | 'installing' | 'done' | 'error'
  const [pct, setPct]         = useState(0)
  const [errMsg, setErrMsg]   = useState('')
  const [installerPath, setInstallerPath] = useState('')
  const busy = phase === 'downloading' || phase === 'installing'

  async function handleInstall() {
    if (busy) return

    // Unsaved work warning
    if (hasUnsavedWork?.()) {
      const ok = window.confirm(
        'You have unsaved work. Installing the update will close MARK.\n\nInstall now and lose unsaved work?'
      )
      if (!ok) return
    }

    setPhase('downloading'); setPct(0); setErrMsg('')

    const result = await pluginInstall(ev => {
      setPhase(ev.phase)
      setPct(ev.pct)
    })

    if (result.ok) {
      setPhase('done')
      return
    }

    // Not configured yet (pubkey placeholder) → fall back to browser download silently
    if (result.notConfigured) {
      console.warn('[MARK updater] plugin not fully configured, falling back to browser download')
      setPhase(null)
      await openExternal(update.downloadUrl || update.url)
      return
    }

    setPhase('error')
    setErrMsg(result.error || 'Update failed.')
    if (result.installerPath) setInstallerPath(result.installerPath)
  }

  const label =
    phase === 'downloading' ? (pct >= 0 ? `Downloading… ${pct}%` : 'Downloading…') :
    phase === 'installing'  ? 'Installing…' :
    phase === 'done'        ? 'Done ✓' :
    `Install v${update.version}`

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999, width: 320,
      background: 'var(--bg-2)', border: '1px solid rgba(48,209,88,0.4)',
      borderRadius: 14, padding: '14px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      animation: 'slideUp 0.3s ease both',
    }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:'#30D158',
              display:'inline-block', boxShadow:'0 0 8px rgba(48,209,88,0.6)' }}/>
            <span style={{ fontFamily:'Inter', fontWeight:700, fontSize:13, color:'var(--t-1)' }}>
              Update Available
            </span>
            <span style={{ fontSize:11, color:'#30D158', fontWeight:700 }}>v{update.version}</span>
          </div>

          <div style={{ fontSize:12, color:'var(--t-3)', marginBottom:10 }}>
            A new version of MARK is ready to install.
          </div>

          {/* Progress bar */}
          {(phase === 'downloading' || phase === 'installing') && (
            <div style={{ height:4, background:'var(--bg-3)', borderRadius:2, marginBottom:10, overflow:'hidden' }}>
              <div style={{
                height:'100%', borderRadius:2, background:'#30D158',
                width: phase === 'installing' ? '100%' : pct >= 0 ? `${pct}%` : '40%',
                transition: 'width 0.3s',
                animation: (pct < 0 || phase === 'installing') ? 'pulse 1s ease infinite' : 'none',
              }}/>
            </div>
          )}

          {/* Error message */}
          {phase === 'error' && (
            <div style={{ fontSize:11, color:'#FF453A', marginBottom:10, lineHeight:1.4 }}>
              {errMsg}
              {installerPath && (
                <button onClick={() => showInFolder(installerPath)}
                  style={{ display:'block', marginTop:6, background:'none', border:'none',
                    color:'var(--p2)', cursor:'pointer', fontSize:11, padding:0 }}>
                  Show installer in folder →
                </button>
              )}
            </div>
          )}

          <div style={{ display:'flex', gap:8 }}>
            {/* Primary: plugin-based install (auto-downloads, verifies, installs) */}
            <button
              onClick={handleInstall}
              disabled={busy || phase === 'done'}
              style={{
                flex:2, background: phase === 'done' ? '#30D158' : '#30D158',
                color:'#000', border:'none', borderRadius:8, padding:'8px 0',
                fontSize:12, fontWeight:700, cursor: busy ? 'wait' : 'pointer',
                textAlign:'center', opacity: busy ? 0.7 : 1,
              }}
            >
              {label}
            </button>

            {/* Fallback: open in browser (always available, keeps old flow working) */}
            {!busy && phase !== 'done' && (
              <button
                onClick={() => openExternal(update.downloadUrl || update.url)}
                style={{
                  flex:1, background:'none', color:'var(--t-3)',
                  border:'1px solid var(--b-1)', borderRadius:8,
                  padding:'8px 0', fontSize:11, cursor:'pointer',
                }}
                title="Open the download page in your browser instead"
              >
                Browser ↗
              </button>
            )}

            {!busy && phase !== 'done' && (
              <button onClick={onDismiss} className="btn-ghost"
                style={{ flex:1, padding:'8px 0', fontSize:12 }}>
                Later
              </button>
            )}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes slideUp { from{transform:translateY(20px);opacity:0} to{transform:none;opacity:1} }
      `}</style>
    </div>
  )
}
