/**
 * DrillBuilderPage.jsx — quiz creation (steps 1 and 2 of 5)
 * ============================================================================
 * DRILL only. Creator role required; the caller gates that.
 *
 * Step 1  setup      name, folder, time limit, pass mark, scope
 * Step 2  scan       list clips, pre-flight playability
 * Step 3  answer key (next build)
 * Step 4  assign     (next build)
 * Step 5  publish    (next build)
 *
 * Scope is ticked manually — no guessing from the folder name. It will
 * auto-EXPAND later if the trainer tags an event outside it, otherwise a
 * trainee would be marked wrong on an event they had no button for.
 */
import { useState } from 'react'
import { FIELD_EVENTS } from '../utils/fieldExtras'
import { scanFolder, checkAllPlayable, totalSizeBytes, formatBytes, parseFolderId } from '../utils/drillDrive'
import { SUPPORTED_VIDEO_EXT } from '../config/drillConfig'

const SA_EMAIL = 'mark-reporter@mark-app-498618.iam.gserviceaccount.com'

export default function DrillBuilderPage({ person, onBack }) {
  const [step, setStep] = useState(1)

  // step 1
  const [name,      setName]      = useState('')
  const [folder,    setFolder]    = useState('')
  const [timeLimit, setTimeLimit] = useState('20')
  const [passMark,  setPassMark]  = useState('80')
  const [scope,     setScope]     = useState(new Set())
  const [err,       setErr]       = useState('')

  // step 2
  const [scanning,  setScanning]  = useState(false)
  const [scanMsg,   setScanMsg]   = useState('')
  const [clips,     setClips]     = useState([])
  const [checked,   setChecked]   = useState(false)

  const taggable = FIELD_EVENTS.filter(e => e.panel)   // skip admin-only events
  const panels = [...new Set(taggable.map(e => e.panel))]

  function toggle(id) {
    setScope(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleScan() {
    setErr('')
    if (!name.trim())            return setErr('Give the quiz a name.')
    if (!parseFolderId(folder))  return setErr('That does not look like a Drive folder link or ID.')
    const tl = parseInt(timeLimit), pm = parseInt(passMark)
    if (!tl || tl < 1)           return setErr('Time limit must be at least 1 minute.')
    if (isNaN(pm) || pm < 0 || pm > 100) return setErr('Pass mark must be between 0 and 100.')
    if (!scope.size)             return setErr('Tick at least one event type for the scope.')

    setScanning(true); setChecked(false); setClips([])
    try {
      setScanMsg('Scanning the folder…')
      const { clips: found } = await scanFolder(folder)
      if (!found.length) {
        setErr(`No videos found. Either the folder is empty, or it is not shared with ${SA_EMAIL} — an unshared folder looks identical to an empty one.`)
        setScanning(false); return
      }
      setClips(found)
      setStep(2)

      // Pre-flight: extension is not enough. .mov and .mkv are containers, so a
      // ProRes .mov opens and then fails silently. Only loading it proves it.
      setScanMsg(`Checking clip 1 of ${found.length}…`)
      const verified = await checkAllPlayable(found, (done, total) => {
        setScanMsg(`Checking clip ${done} of ${total}…`)
      })
      setClips(verified)
      setChecked(true)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setScanning(false); setScanMsg('')
    }
  }

  const playable   = clips.filter(c => c.playable)
  const unplayable = clips.filter(c => c.playable === false)

  const Field = ({ label, children }) => (
    <div>
      <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
        marginBottom:5, textTransform:'uppercase' }}>{label}</div>
      {children}
    </div>
  )
  const inputStyle = {
    width:'100%', background:'var(--bg-3)', border:'1px solid var(--b-1)',
    borderRadius:7, padding:'9px 12px', fontSize:13, color:'var(--t-1)',
    outline:'none', boxSizing:'border-box',
  }

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', color:'var(--t-1)', overflow:'hidden' }}>

      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 16px', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none',
          color:'var(--t-3)', cursor:'pointer', fontSize:11, padding:'4px 8px' }}>
          ← Cancel
        </button>
        <div style={{ width:1, height:20, background:'var(--b-1)' }}/>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800,
          color:'var(--p2)', letterSpacing:1.5, background:'rgba(232,89,12,0.12)',
          padding:'2px 8px', borderRadius:4 }}>NEW QUIZ</div>
        <div style={{ flex:1 }}/>
        {[1,2,3,4,5].map(n => (
          <div key={n} style={{ width:22, height:4, borderRadius:2,
            background: n <= step ? 'var(--p2)' : 'var(--b-2)' }}/>
        ))}
        <span style={{ fontSize:10, color:'var(--t-3)', marginLeft:4 }}>step {step} of 5</span>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:24,
        maxWidth:820, margin:'0 auto', width:'100%' }}>

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <>
            <div className="card" style={{ padding:20, marginBottom:14 }}>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>Quiz setup</div>
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <Field label="Quiz name">
                  <input style={inputStyle} value={name} placeholder="e.g. Pressure — Batch 7"
                    onChange={e => { setName(e.target.value); setErr('') }}/>
                </Field>
                <Field label="Drive folder with the clips">
                  <input style={{ ...inputStyle, fontFamily:'JetBrains Mono,monospace', fontSize:11 }}
                    value={folder} placeholder="https://drive.google.com/drive/folders/…"
                    onChange={e => { setFolder(e.target.value); setErr('') }}/>
                  <div style={{ fontSize:10, color:'var(--t-3)', marginTop:5, lineHeight:1.5 }}>
                    Must be shared with <span style={{ fontFamily:'JetBrains Mono,monospace' }}>{SA_EMAIL}</span> as Viewer.
                    Subfolders are scanned too.
                  </div>
                </Field>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Field label="Time limit (minutes)">
                    <input style={inputStyle} type="number" min="1" value={timeLimit}
                      onChange={e => { setTimeLimit(e.target.value); setErr('') }}/>
                  </Field>
                  <Field label="Pass mark (%)">
                    <input style={inputStyle} type="number" min="0" max="100" value={passMark}
                      onChange={e => { setPassMark(e.target.value); setErr('') }}/>
                  </Field>
                </div>
              </div>
            </div>

            <div className="card" style={{ padding:20, marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:6 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>Scope</div>
                <div style={{ fontSize:11, color:'var(--t-3)' }}>
                  {scope.size} selected
                </div>
              </div>
              <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:14, lineHeight:1.5 }}>
                Which events this quiz tests. Only these buttons appear while tagging —
                for you and for the trainee.
              </div>
              {panels.map(panel => (
                <div key={panel} style={{ marginBottom:14 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--p2)',
                    letterSpacing:1, textTransform:'uppercase', marginBottom:7 }}>{panel}</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                    {taggable.filter(e => e.panel === panel).map(e => {
                      const on = scope.has(e.id)
                      return (
                        <button key={e.id} onClick={() => { toggle(e.id); setErr('') }}
                          style={{ padding:'6px 10px', fontSize:11, fontWeight:600,
                            borderRadius:6, cursor:'pointer',
                            background: on ? 'rgba(232,89,12,0.15)' : 'var(--bg-3)',
                            border:`1px solid ${on ? 'var(--p2)' : 'var(--b-1)'}`,
                            color: on ? 'var(--p2)' : 'var(--t-2)' }}>
                          {e.label}
                          {e.hotkey && <span style={{ opacity:0.5, marginLeft:5,
                            fontFamily:'JetBrains Mono,monospace' }}>{e.hotkey}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {err && (
              <div style={{ background:'rgba(255,69,58,0.08)', border:'1px solid rgba(255,69,58,0.3)',
                borderRadius:8, padding:'10px 12px', fontSize:12, color:'#FF453A',
                marginBottom:14, lineHeight:1.5 }}>{err}</div>
            )}

            <button className="btn-orange" style={{ width:'100%', padding:'12px 0', fontSize:13 }}
              disabled={scanning} onClick={handleScan}>
              {scanning ? (scanMsg || 'Scanning…') : 'Scan the folder →'}
            </button>
          </>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <>
            <div className="card" style={{ padding:20, marginBottom:14 }}>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>{name}</div>
              <div style={{ fontSize:11, color:'var(--t-3)' }}>
                {clips.length} clips · {formatBytes(totalSizeBytes(clips))} ·
                {' '}{timeLimit} min · pass {passMark}% ·
                {' '}{scope.size} event type{scope.size === 1 ? '' : 's'} in scope
              </div>
            </div>

            {scanning && (
              <div className="card" style={{ padding:16, marginBottom:14,
                fontSize:12, color:'var(--t-2)' }}>
                {scanMsg}
                <div style={{ fontSize:10, color:'var(--t-3)', marginTop:6, lineHeight:1.5 }}>
                  Each clip is loaded once to confirm it actually plays. A .mov or .mkv
                  can open its container and still have no decodable track, and that
                  fails silently — better to catch it now than mid-quiz.
                </div>
              </div>
            )}

            {checked && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
                <div className="card" style={{ padding:14, textAlign:'center' }}>
                  <div style={{ fontSize:24, fontWeight:900, color:'#30D158' }}>{playable.length}</div>
                  <div style={{ fontSize:10, color:'var(--t-3)', marginTop:2 }}>PLAYABLE</div>
                </div>
                <div className="card" style={{ padding:14, textAlign:'center',
                  border: unplayable.length ? '1px solid rgba(255,69,58,0.3)' : undefined }}>
                  <div style={{ fontSize:24, fontWeight:900,
                    color: unplayable.length ? '#FF453A' : 'var(--t-3)' }}>{unplayable.length}</div>
                  <div style={{ fontSize:10, color:'var(--t-3)', marginTop:2 }}>WILL NOT PLAY</div>
                </div>
              </div>
            )}

            {checked && unplayable.length > 0 && (
              <div style={{ background:'rgba(255,69,58,0.08)', border:'1px solid rgba(255,69,58,0.3)',
                borderRadius:8, padding:'12px 14px', marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#FF453A', marginBottom:6 }}>
                  {unplayable.length} clip{unplayable.length === 1 ? '' : 's'} cannot be played
                </div>
                <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:8, lineHeight:1.5 }}>
                  Re-export these as h264 mp4. They will be excluded from the quiz otherwise.
                </div>
                {unplayable.slice(0, 10).map(c => (
                  <div key={c.drive_file_id} style={{ fontSize:11, color:'var(--t-2)',
                    fontFamily:'JetBrains Mono,monospace' }}>
                    {c.video_filename} — {c.unplayable_reason}
                  </div>
                ))}
              </div>
            )}

            <div className="card" style={{ padding:16, marginBottom:14 }}>
              <div style={{ fontSize:12, fontWeight:700, marginBottom:10 }}>
                Clips ({clips.length})
              </div>
              <div style={{ maxHeight:320, overflowY:'auto' }}>
                {clips.map((c, i) => (
                  <div key={c.drive_file_id} style={{ display:'flex', alignItems:'center',
                    gap:10, padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize:10, color:'var(--t-3)', width:28,
                      fontFamily:'JetBrains Mono,monospace' }}>{i + 1}</span>
                    <span style={{ flex:1, fontSize:12, color:'var(--t-2)',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {c.video_filename}
                    </span>
                    {!c.supported_ext && (
                      <span style={{ fontSize:9, color:'#FF9500' }}>.{c.extension}</span>
                    )}
                    <span style={{ fontSize:10, color:'var(--t-3)', width:56, textAlign:'right' }}>
                      {c.size_bytes ? (c.size_bytes / 1048576).toFixed(1) + ' MB' : '—'}
                    </span>
                    <span style={{ width:58, textAlign:'right', fontSize:9, fontWeight:700,
                      color: c.playable === true ? '#30D158'
                           : c.playable === false ? '#FF453A' : 'var(--t-3)' }}>
                      {c.playable === true ? 'PLAYS'
                       : c.playable === false ? 'FAILS' : '…'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display:'flex', gap:10 }}>
              <button style={{ flex:1, padding:'11px 0', fontSize:13, background:'transparent',
                border:'1px solid var(--b-1)', borderRadius:8, color:'var(--t-3)', cursor:'pointer' }}
                onClick={() => setStep(1)}>
                ← Back to setup
              </button>
              <button className="btn-orange" style={{ flex:2, padding:'11px 0', fontSize:13 }}
                disabled={!checked || !playable.length}
                onClick={() => alert(
                  `Step 3 — the answer key — is the next build.\n\n` +
                  `${playable.length} playable clips are ready to tag.\n` +
                  `Scope: ${[...scope].join(', ')}`
                )}>
                {checked
                  ? `Tag the answer key (${playable.length} clips) →`
                  : 'Checking clips…'}
              </button>
            </div>
            {checked && (
              <div style={{ fontSize:10, color:'var(--t-3)', textAlign:'center', marginTop:10 }}>
                Step 3 arrives in the next build. Nothing is saved yet.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
