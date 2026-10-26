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
// Returns { ok, verifyFailed, fallback, error }
//   ok          — install succeeded (Windows: process already exited, unreachable here)
//   verifyFailed — signature check explicitly rejected; must NOT fall back to browser
//   fallback    — plugin unavailable or endpoint unreachable; caller should use browser
//   error       — human-readable message
async function pluginInstall(onProgress) {
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    onProgress({ phase: 'checking', pct: 0 })

    let update
    try {
      update = await check()
    } catch (e) {
      // Endpoint unreachable, latest.json missing, pubkey placeholder, network error —
      // all of these mean the plugin path isn't set up yet. Fall back silently.
      console.warn('[MARK updater] check() failed, falling back to browser:', e?.message || e)
      return { ok: false, fallback: true, error: e?.message || String(e) }
    }

    if (!update) {
      // check() resolved but found no update — edge case if the manifest version
      // matches current. Fall back to browser so the user can still install.
      console.warn('[MARK updater] check() returned null — falling back to browser')
      return { ok: false, fallback: true, error: 'No update found in manifest' }
    }

    let downloaded = 0, total = 0
    onProgress({ phase: 'downloading', pct: 0 })

    try {
      await update.download(ev => {
        if (ev.event === 'Started')  { total = ev.data.contentLength || 0 }
        if (ev.event === 'Progress') {
          downloaded += ev.data.chunkLength
          onProgress({ phase: 'downloading', pct: total ? Math.round(downloaded / total * 100) : -1 })
        }
        if (ev.event === 'Finished') { onProgress({ phase: 'installing', pct: 100 }) }
      })
    } catch (e) {
      const msg = e?.message || String(e)
      console.error('[MARK updater] download failed:', msg)
      // Signature verification failure — security: do NOT fall back
      if (msg.includes('signature') || msg.includes('verify') || msg.includes('SignatureError')
          || msg.includes('invalid signature') || msg.includes('PublicKey')) {
        return {
          ok: false, verifyFailed: true,
          error: "The update couldn't be verified, so it wasn't installed. Try again or contact Fady.",
        }
      }
      // Network or other download error — fall back to browser
      return { ok: false, fallback: true, error: msg }
    }

    onProgress({ phase: 'installing', pct: 100 })
    await update.install()
    // Unreachable on Windows (install() exits the process)
    return { ok: true }
  } catch (e) {
    // Top-level catch: plugin module unavailable, import failed, unexpected error
    const msg = e?.message || String(e)
    console.warn('[MARK updater] unexpected error, falling back:', msg)
    return { ok: false, fallback: true, error: msg }
  }
}

export default function UpdateBanner({ update, onDismiss, hasUnsavedWork }) {
  const [phase, setPhase]   = useState(null)  // null | 'checking' | 'downloading' | 'installing' | 'done' | 'error' | 'fallback'
  const [pct, setPct]       = useState(0)
  const [errMsg, setErrMsg] = useState('')
  const [installerPath, setInstallerPath] = useState('')
  // After the hooks, not before: an early return ahead of them breaks React's hook-order rule.
  // (App only mounts this with an `update`, so the result is the same.)
  if (!update) return null
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing'

  async function handleInstall() {
    if (busy) return

    if (hasUnsavedWork?.()) {
      const ok = window.confirm(
        'You have unsaved work. Installing the update will close MARK.\n\nInstall now and lose unsaved work?'
      )
      if (!ok) return
    }

    setPhase('checking'); setPct(0); setErrMsg('')

    const result = await pluginInstall(ev => {
      setPhase(ev.phase)
      if (ev.pct != null) setPct(ev.pct)
    })

    if (result.ok) {
      setPhase('done')
      return
    }

    // Signature verification failed — show error, do NOT fall back to browser.
    // A tampered file must never be offered as an alternative.
    if (result.verifyFailed) {
      setPhase('error')
      setErrMsg(result.error)
      return
    }

    // Plugin path unavailable (endpoint 404, latest.json missing, pubkey placeholder,
    // network error, etc.) — fall back to browser silently, show informational message.
    if (result.fallback) {
      console.warn('[MARK updater] using browser fallback. Reason:', result.error)
      setPhase('fallback')
      setErrMsg("Automatic install isn't available right now — downloading the installer instead.")
      await openExternal(update.downloadUrl || update.url)
      return
    }

    // Other error — show it
    setPhase('error')
    setErrMsg(result.error || 'Update failed.')
    if (result.installerPath) setInstallerPath(result.installerPath)
  }

  const label =
    phase === 'checking'    ? 'Checking…' :
    phase === 'downloading' ? (pct > 0 ? `Downloading… ${pct}%` : 'Downloading…') :
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
                width: phase === 'installing' ? '100%' : pct > 0 ? `${pct}%` : '20%',
                transition: 'width 0.3s',
                animation: (pct === 0 || phase === 'installing') ? 'pulse 1s ease infinite' : 'none',
              }}/>
            </div>
          )}

          {/* Fallback info message — not an error */}
          {phase === 'fallback' && (
            <div style={{ fontSize:11, color:'var(--t-2)', marginBottom:10, lineHeight:1.5,
              background:'rgba(255,255,255,0.05)', borderRadius:6, padding:'7px 10px' }}>
              {errMsg}
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
            {/* Primary: plugin install — falls back to browser automatically on any non-security failure */}
            <button
              onClick={handleInstall}
              disabled={busy || phase === 'done' || phase === 'fallback'}
              style={{
                flex:2, background:'#30D158', color:'#000', border:'none', borderRadius:8,
                padding:'8px 0', fontSize:12, fontWeight:700,
                cursor: busy ? 'wait' : (phase === 'done' || phase === 'fallback') ? 'default' : 'pointer',
                textAlign:'center', opacity: busy ? 0.7 : 1,
              }}
            >
              {label}
            </button>

            {/* Manual browser fallback — always visible unless installing or done */}
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
