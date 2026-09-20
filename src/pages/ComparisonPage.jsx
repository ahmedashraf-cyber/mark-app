/**
 * ComparisonPage.jsx — run comparisons between Field sessions
 * ============================================================================
 * Separate mode — collector never sees model answer before submitting.
 * Reads from Firestore (mark_collected_events + mark_field_sessions).
 * Falls back to Sheet for the 6 legacy model imports (no Firestore record).
 *
 * Flow:
 *   1. Enter match_id + half → resolve model session + list collector sessions
 *   2. Select collector session (or enter HR-code)
 *   3. Run comparison → show results inline
 *   4. Write to Sheet (comparison_detail + scores tabs)
 *
 * FIELD only. Scout and Audit untouched.
 */
import { useState, useEffect, useRef } from 'react'
import { db } from '../firebase/config'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { invoke } from '@tauri-apps/api/core'
import { useAuth } from '../hooks/useAuth.jsx'
import { compare } from '../utils/compareEngine'
import { MODULES_SPLIT, MODULE_LABELS } from '../utils/defectTypes'
import { writeComparisonResults, findExistingRun } from '../utils/comparisonSheet'
import { FIELD_SHEET_ID, EVENT_COLUMNS, GROUP_TO_ATTR_COL } from '../config/fieldConfig'
import { CURRENT_VERSION } from '../hooks/useUpdateCheck'
import { msToReadable } from '../utils/fieldSheetSync'

const SHEETS_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${FIELD_SHEET_ID}`

async function getToken() {
  const token = await invoke('get_google_access_token_cmd')
  if (!token) throw new Error('Google auth required.')
  return token
}

/**
 * Flatten a Firestore event's nested `groups` into attr_* columns.
 *
 * Mirrors fieldSheetSync.buildEventRows exactly — same GROUP_TO_ATTR_COL
 * mapping, same pipe-joining, same legacy `extras` fallback — so an event
 * compared here and the same event written to the sheet produce identical
 * attribute values.
 */
function groupsToAttrCols(ev) {
  const out = Object.fromEntries(
    EVENT_COLUMNS.filter(c => c.startsWith('attr_')).map(c => [c, '']))

  if (ev.groups && ev.groups.length > 0) {
    ev.groups.forEach(g => {
      const col = GROUP_TO_ATTR_COL[g.groupId]
      if (!col) return
      const codes = (g.selections || []).map(sel => sel.code || sel.label || '').filter(Boolean)
      if (codes.length > 0) out[col] = codes.join('|')
    })
  } else if (ev.extras && ev.extras.length > 0) {
    // legacy v1/v2 events kept a flat extras array
    out['attr_extras'] = ev.extras.map(x => String(x)).join('|')
  }

  // an already-flat event (re-read from the sheet) keeps its own values
  Object.keys(out).forEach(c => { if (ev[c]) out[c] = ev[c] })
  return out
}

// Read events from Firestore by session_id
async function loadFirestoreEvents(sessionId) {
  const snap = await getDocs(query(
    collection(db, 'mark_collected_events'),
    where('sessionId', '==', sessionId)
  ))
  return snap.docs.map(d => d.data())
}

// Read events from Sheet for legacy model sessions
async function loadSheetEvents(sessionId) {
  const token = await getToken()
  const range = encodeURIComponent('field_events!A:AK')
  const res = await fetch(`${SHEETS_BASE}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Sheet read failed for field_events: ${res.status}`)
  const data = await res.json()
  const rows  = data.values || []
  if (!rows.length) return []
  const headers = rows[0]
  // col A (index 0) = session_id per EVENT_COLUMNS definition
  const sidIdx = headers.indexOf('session_id')
  if (sidIdx === -1) throw new Error('field_events sheet missing session_id column — check header row')
  const events = rows.slice(1)
    .filter(r => (r[sidIdx] || '') === sessionId)
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ''])))
  if (events.length === 0)
    throw new Error(`No events found in field_events sheet for session_id "${sessionId}". Check the tab has data and headers match.`)
  return events
}

// Load a session from Sheet
async function loadSheetSession(sessionId) {
  const token = await getToken()
  const range = encodeURIComponent('field_sessions!A:V')
  const res = await fetch(`${SHEETS_BASE}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Sheet read failed: ${res.status}`)
  const data = await res.json()
  const rows  = data.values || []
  if (!rows.length) return null
  const headers = rows[0]
  const row = rows.slice(1).find(r => r[1] === sessionId)  // col B = session_id
  if (!row) return null
  return Object.fromEntries(headers.map((h, i) => [h, row[i] || '']))
}

// Resolve model session for match_id + half
async function resolveModelSession(matchId, half) {
  // Normalise to string — Sheet cells are always strings; Firestore may have been
  // written as number by older code. String comparison is the standard here.
  const mid = String(matchId).trim()

  // Try Firestore first
  const snap = await getDocs(query(
    collection(db, 'mark_field_sessions'),
    where('matchId', '==', mid),
    where('half',    '==', half),
    where('is_model','==', '1'),
  ))
  const approved = snap.docs
    .map(d => d.data())
    .filter(s => s.model_status === 'approved')
    .sort((a, b) => parseInt(b.model_version || 0) - parseInt(a.model_version || 0))
  if (approved.length > 0) return { session: { ...approved[0], session_id: approved[0].sessionId || approved[0].session_id }, source: 'firestore' }

  // Fall back to Sheet (legacy imports)
  const token = await getToken()
  const range = encodeURIComponent('field_sessions!A:V')
  const res = await fetch(`${SHEETS_BASE}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Sheet read failed: ${res.status}`)
  const data = await res.json()
  const rows  = data.values || []
  if (!rows.length) return null
  const headers = rows[0]
  const candidates = rows.slice(1)
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ''])))
    .filter(s =>
      String(s.match_id).trim() === mid &&   // normalise both sides to string
      s.half === half &&
      s.is_model === '1' &&
      s.model_status === 'approved'
    )
    .sort((a, b) => parseInt(b.model_version || 0) - parseInt(a.model_version || 0))

  if (!candidates.length) return null
  return { session: candidates[0], source: 'sheet' }
}

// Load events for a session (Firestore or Sheet)
async function loadSessionEvents(sessionId, source) {
  if (source === 'firestore') {
    const evs = await loadFirestoreEvents(sessionId)
    // Normalise field names to match EVENT_COLUMNS schema
    return evs.map(ev => ({
      ...ev,
      session_id:     ev.sessionId || ev.session_id || '',
      event_seq:      String(ev.event_seq || ''),
      event_id:       String(ev.event_id  || ''),
      event_code:     ev.eventId    || ev.event_code    || '',
      event_label:    ev.eventLabel || ev.event_label   || '',
      video_time_ms:  String(ev.video_time_ms || Math.round((ev.videoTimeSec||0)*1000)),
      time_from_half_start_ms: String(ev.time_from_half_start_ms || ''),
      team:           ev.team || '',
      team_source:    ev.teamSource || ev.team_source || '',
      model_shape:    ev.model_shape || '',
      // ── Attributes ──────────────────────────────────────────────────────
      // Firestore stores them as a nested `groups` array; the sheet stores flat
      // attr_* columns. This normaliser mapped the field NAMES but never the
      // attributes, so every collector event reached the engine with
      // attr_direction and friends undefined.
      //
      // The engine then read the collector value as empty and returned
      // missing_extra for every attribute the model had populated — even when
      // the two were identical, and even when they genuinely differed (which
      // should have been wrong_extra). Same mapping as fieldSheetSync uses when
      // writing these events to the sheet, so both paths agree.
      ...groupsToAttrCols(ev),
    }))
  }
  return loadSheetEvents(sessionId)
}

function VerdictBadge({ verdict }) {
  const colors = {
    correct:       { bg:'rgba(48,209,88,0.15)',   color:'#30D158' },
    missing_event: { bg:'rgba(255,69,58,0.15)',   color:'#FF453A' },
    extra_event:   { bg:'rgba(255,149,0,0.15)',   color:'#FF9500' },
    wrong_side:    { bg:'rgba(191,90,242,0.15)',  color:'#BF5AF2' },
    wrong_timestamp:{ bg:'rgba(100,210,255,0.15)',color:'#64D2FF' },
    wrong_extra:   { bg:'rgba(255,159,10,0.15)', color:'#FF9F0A' },
    missing_extra: { bg:'rgba(255,69,58,0.1)',   color:'#FF6B6B' },
  }
  const s = colors[verdict] || { bg:'rgba(255,255,255,0.08)', color:'var(--t-3)' }
  return (
    <span style={{ fontSize:10, fontWeight:700, background:s.bg, color:s.color,
      padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap' }}>
      {verdict}
    </span>
  )
}

export default function ComparisonPage({ onBack }) {
  const { profile } = useAuth()

  const [matchId,      setMatchId]      = useState('')
  const [half,         setHalf]         = useState('')
  const [hrCode,       setHrCode]       = useState('')
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [loadingMsg,   setLoadingMsg]   = useState('')

  const [modelSess,    setModelSess]    = useState(null)
  const [collSess,     setCollSess]     = useState(null)
  const [result,       setResult]       = useState(null)
  const [written,      setWritten]      = useState(false)
  const [existingRun,  setExistingRun]  = useState(null)   // an identical run already in the sheet
  // Local review video. Cleared at the start of every run so a new picker
  // opens and the previous file is unloaded — the next comparison may be a
  // different match entirely.
  const [videoUrl,  setVideoUrl]  = useState('')
  const [videoName, setVideoName] = useState('')
  // Remembered so "Reopen video" needs no second file picker.
  const [videoPath, setVideoPath] = useState('')
  const [popOpen,   setPopOpen]   = useState(false)
  const [videoNote, setVideoNote] = useState('')
  const resultsScrollRef = useRef(null)
  const [seekRow, setSeekRow] = useState(-1)   // briefly highlighted row

  /**
   * Open the player in its own OS window.
   *
   * A second Tauri window loads index.html fresh, so the video URL, filename
   * and match status are passed in the query string — the two windows share no
   * React state. Seeks then travel as Tauri events.
   *
   * The URL is MARK's own local server (http://127.0.0.1:port/video), which is
   * reachable from either window, so nothing needs re-serving.
   */
  async function openVideoWindow(url, name, status) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      // close any existing one first: a new run means a new match
      const existing = await WebviewWindow.getByLabel('mark-video')
      if (existing) { try { await existing.close() } catch {} }

      const qs = new URLSearchParams({
        window: 'video', url, name: name || '', status: status || 'unknown',
      })
      const win = new WebviewWindow('mark-video', {
        url: 'index.html?' + qs.toString(),
        title: 'MARK — ' + (name || 'video'),
        width: 960, height: 620, resizable: true, maximizable: true,
        // dies with the parent, so no orphan window is left behind
        parent: 'main',
      })
      win.once('tauri://created', () => setPopOpen(true))
      win.once('tauri://error', e => {
        console.error('[COMPARE] video window failed:', e)
        setVideoNote('Could not open the video window: ' + (e?.payload || 'unknown error'))
        setPopOpen(false)
      })
      win.once('tauri://destroyed', () => setPopOpen(false))
      return true
    } catch (e) {
      setVideoNote('Could not open the video window: ' + (e?.message || e))
      setPopOpen(false)
      return false
    }
  }

  async function closeVideoWindow() {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const w = await WebviewWindow.getByLabel('mark-video')
      if (w) await w.close()
    } catch {}
    setPopOpen(false)
  }

  async function handleRun() {
    setError(''); setResult(null); setWritten(false)
    if (!matchId.trim() || !half || !hrCode.trim()) {
      setError('Match ID, Half and Collector HR-Code are all required.'); return
    }

    // Fresh video every run — never reuse the previous file.
    // a new run closes the old pop-out and forgets the old file
    await closeVideoWindow()
    setVideoUrl(''); setVideoName(''); setVideoPath(''); setVideoNote('')
    try {
      setLoadingMsg('Choose the match video…')
      const path = await invoke('pick_video_file')
      if (path) {
        const url = await invoke('get_video_url', { path })
        const name = String(path).split(/[/\\]/).pop()
        setVideoUrl(url); setVideoName(name); setVideoPath(path)
      } else {
        // Cancelling does not block the run: the scores never needed the video,
        // it is only there for the reviewer to verify events by eye.
        setVideoNote('No video loaded — the seek buttons are disabled. Results are unaffected.')
      }
    } catch (e) {
      setVideoNote('Could not open that video: ' + (e?.message || e))
    }

    setLoading(true)

    try {
      // 1. Resolve model session
      setLoadingMsg('Looking up model answer…')
      const modelResult = await resolveModelSession(matchId.trim(), half)
      if (!modelResult) {
        setError(`No approved model answer found for match ${matchId} ${half}.`); return
      }
      const { session: mSess, source: mSource } = modelResult
      setModelSess(mSess)

      // 2. Resolve collector session
      setLoadingMsg('Looking up collector session…')
      const mid = String(matchId.trim())
      const collSnap = await getDocs(query(
        collection(db, 'mark_field_sessions'),
        where('matchId',         '==', mid),
        where('half',            '==', half),
        where('collectorHrCode', '==', hrCode.trim()),
      ))
      const halfAlt = half.replace('H','')
      const collSnap2 = await getDocs(query(
        collection(db, 'mark_field_sessions'),
        where('matchId',         '==', mid),
        where('half',            '==', halfAlt),
        where('collectorHrCode', '==', hrCode.trim()),
      ))
      const allColl = [...collSnap.docs, ...collSnap2.docs]
        .map(d => d.data())
        .filter(s => s.status === 'completed' || s.totalEvents > 0)

      if (allColl.length === 0) {
        setError(`No collector session found for match ${matchId} ${half} HR-Code ${hrCode}.`); return
      }
      if (allColl.length > 1) {
        setError(`Multiple collector sessions found. HR-Code ${hrCode} has ${allColl.length} sessions for this half.`); return
      }
      const cSess = { ...allColl[0], session_id: allColl[0].sessionId || allColl[0].session_id }
      setCollSess(cSess)

      // 3. Load events
      setLoadingMsg('Loading model events…')
      console.log('[COMPARE] mSess:', JSON.stringify({session_id:mSess.session_id, source:mSource, match_id:mSess.match_id, half:mSess.half}))
      const mEvents = await loadSessionEvents(mSess.session_id, mSource)
      console.log('[COMPARE] mEvents loaded:', mEvents.length)
      if (mEvents.length === 0)
        throw new Error(`Model session "${mSess.session_id}" loaded 0 events. Check the field_events tab contains data for this session.`)

      setLoadingMsg('Loading collector events…')
      console.log('[COMPARE] cSess:', JSON.stringify({session_id:cSess.session_id, matchId:cSess.matchId, half:cSess.half}))
      const cEvents = await loadSessionEvents(cSess.session_id, 'firestore')
      console.log('[COMPARE] cEvents loaded:', cEvents.length)

      // 4. Run comparison
      setLoadingMsg('Running comparison…')
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
      console.log('[COMPARE] calling compare(), modelSessionId:', mSess.session_id)
      const compResult = compare(
        { ...mSess, session_id: mSess.session_id },
        mEvents,
        { ...cSess, session_id: cSess.session_id },
        cEvents,
        { modelSessionId: mSess.session_id, runId }
      )
      console.log('[COMPARE] result:', compResult.score, compResult.verdictCounts)
      setResult({ ...compResult, runId })

      // The pop-out needs videoMatchStatus, which only exists after compare(),
      // so it opens here rather than at file-pick time.
      if (videoUrl) {
        await openVideoWindow(videoUrl, videoName, compResult.videoMatchStatus)
      }
      setWritten(false); setExistingRun(null)

    } catch(e) {
      console.error('[COMPARE CRASH]', e, e?.stack)
      setError(e.message || String(e))
    } finally {
      setLoading(false); setLoadingMsg('')
    }
  }

  async function handleWriteToSheet() {
    if (!result || !modelSess || !collSess) return
    setLoading(true); setLoadingMsg('Writing to Sheet…')
    try {
      const mSessNorm = { ...modelSess,
        session_id: modelSess.sessionId || modelSess.session_id,  // Firestore uses sessionId
        collector_hr_code: modelSess.collectorHrCode || modelSess.collector_hr_code || '',
      }
      const cSessNorm = { ...collSess,
        session_id: collSess.sessionId || collSess.session_id,
        collector_hr_code: collSess.collectorHrCode || collSess.collector_hr_code || '',
      }
      // Same model + collector + tolerance version + algorithm version means
      // byte-identical rows, so show the earlier run rather than appending a
      // duplicate the cross-collector report would double-count.
      //
      // FAIL CLOSED. If the check itself cannot complete we do not know whether
      // a duplicate exists, and writing on a guess is the worse outcome — it is
      // what produced the duplicate rows. So a failed check blocks the write
      // and reports it.
      let prior
      try {
        prior = await findExistingRun(mSessNorm.session_id, cSessNorm.session_id)
      } catch (checkErr) {
        console.error('[COMPARE] duplicate check failed', checkErr)
        setError('Could not check for an existing run, so nothing was written: '
          + (checkErr.message || String(checkErr))
          + ' — the sheet is unchanged. Try again.')
        return
      }

      if (prior) {
        setExistingRun(prior)
        setWritten(true)
        return
      }

      setExistingRun(null)
      await writeComparisonResults(mSessNorm, cSessNorm, result, result.runId)
      setWritten(true)
    } catch(e) {
      console.error('[COMPARE WRITE CRASH]', e, e?.stack)
      setError(e.message || String(e))
    } finally { setLoading(false); setLoadingMsg('') }
  }

  const vc = result?.verdictCounts || {}

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', color:'var(--t-1)', overflow:'hidden' }}>

      {/* Top bar */}
      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 16px', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none',
          color:'var(--t-3)', cursor:'pointer', fontSize:11, padding:'4px 8px', borderRadius:6 }}>
          ← Back
        </button>
        <div style={{ width:1, height:20, background:'var(--b-1)' }}/>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800,
          color:'#64D2FF', letterSpacing:1.5, background:'rgba(100,210,255,0.1)',
          padding:'2px 8px', borderRadius:4 }}>
          COMPARISON
        </div>
        <div style={{ flex:1 }}/>
      </div>

      {/* Content */}
      {/* Video on top at full width, results scrolling independently beneath.
          The video is OUTSIDE the scroll container so it stays put while the
          reviewer works down the table — that is the whole point of the layout.
          minHeight:0 on both is what lets the lower pane actually scroll rather
          than growing the page. */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minHeight:0 }}>

        {/* The player lives in its own OS window now, so the main window only
            reports the link and offers to reopen it. Reopening reuses the
            remembered path — no second file picker. */}
        {result && videoPath && (
          <div style={{ flexShrink:0, padding:'10px 24px 0' }}>
            <div className="card" style={{ padding:'9px 14px', display:'flex',
              alignItems:'center', gap:10 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0,
                background: popOpen ? '#30D158' : 'var(--t-3)' }}/>
              <span style={{ fontSize:11, color:'var(--t-2)', flex:1, overflow:'hidden',
                textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {popOpen
                  ? <>Video window open — <b>{videoName}</b>. Seek buttons control it.</>
                  : <>Video window closed. Seek buttons are disabled.</>}
              </span>
              {popOpen ? (
                <button onClick={closeVideoWindow}
                  style={{ padding:'5px 11px', fontSize:11, background:'transparent',
                    border:'1px solid var(--b-1)', borderRadius:6, color:'var(--t-3)',
                    cursor:'pointer' }}>Close video</button>
              ) : (
                <button onClick={async () => {
                    setVideoNote('')
                    const url = videoUrl || await invoke('get_video_url', { path: videoPath })
                    setVideoUrl(url)
                    await openVideoWindow(url, videoName, result.videoMatchStatus)
                  }}
                  className="btn-orange"
                  style={{ padding:'5px 12px', fontSize:11 }}>Reopen video</button>
              )}
            </div>
          </div>
        )}

        <div style={{ flex:1, overflowY:'auto', minHeight:0, padding:24,
          maxWidth:760, margin:'0 auto', width:'100%' }} ref={resultsScrollRef}>

        {/* Input form */}
        <div className="card" style={{ padding:20, marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--t-1)', marginBottom:16 }}>
            Run Comparison
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14 }}>
            <div>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)',
                letterSpacing:0.8, marginBottom:4, textTransform:'uppercase' }}>
                Match ID
              </div>
              <input value={matchId} onChange={e=>setMatchId(e.target.value)}
                placeholder="e.g. 1454815"
                style={{ width:'100%', background:'var(--bg-3)', border:'1px solid var(--b-1)',
                  borderRadius:7, padding:'8px 12px', fontSize:13, color:'var(--t-1)',
                  fontFamily:'JetBrains Mono,monospace', outline:'none', boxSizing:'border-box' }}/>
            </div>
            <div>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)',
                letterSpacing:0.8, marginBottom:4, textTransform:'uppercase' }}>
                Half
              </div>
              <div style={{ display:'flex', gap:6 }}>
                {['1H','2H'].map(h => (
                  <button key={h} onClick={()=>setHalf(h)}
                    style={{ flex:1, padding:'8px 0', fontSize:13, fontWeight:700,
                      background: half===h ? 'rgba(100,210,255,0.15)' : 'var(--bg-3)',
                      border:`1px solid ${half===h ? '#64D2FF' : 'var(--b-1)'}`,
                      borderRadius:7, color:half===h?'#64D2FF':'var(--t-2)', cursor:'pointer' }}>
                    {h}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)',
                letterSpacing:0.8, marginBottom:4, textTransform:'uppercase' }}>
                Collector HR-Code
              </div>
              <input value={hrCode} onChange={e=>setHrCode(e.target.value)}
                placeholder="e.g. 3416"
                style={{ width:'100%', background:'var(--bg-3)', border:'1px solid var(--b-1)',
                  borderRadius:7, padding:'8px 12px', fontSize:13, color:'var(--t-1)',
                  fontFamily:'JetBrains Mono,monospace', outline:'none', boxSizing:'border-box' }}/>
            </div>
          </div>

          {error && (
            <div style={{ fontSize:11, color:'#FF453A', background:'rgba(255,69,58,0.08)',
              padding:'8px 12px', borderRadius:6, marginBottom:12 }}>
              {error}
            </div>
          )}

          <button className="btn-orange" style={{ width:'100%', padding:'10px 0', fontSize:13 }}
            disabled={loading} onClick={handleRun}>
            {loading ? loadingMsg : 'Run Comparison'}
          </button>
        </div>

        {/* Results */}
        {videoNote && (
          <div style={{ background:'rgba(255,214,10,0.07)', border:'1px solid rgba(255,214,10,0.25)',
            borderRadius:7, padding:'9px 12px', marginBottom:12, fontSize:11, color:'var(--t-2)' }}>
            {videoNote}
          </div>
        )}

        {result && (
          <>
            {/* Session info */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
              {[
                { label:'Model', sess:modelSess, color:'#30D158' },
                { label:'Collector', sess:collSess, color:'#64D2FF' },
              ].map(({ label, sess, color }) => (
                <div key={label} className="card" style={{ padding:12 }}>
                  <div style={{ fontSize:9, fontWeight:800, color, letterSpacing:1,
                    marginBottom:6, textTransform:'uppercase' }}>{label}</div>
                  <div style={{ fontSize:11, color:'var(--t-2)', fontFamily:'JetBrains Mono,monospace' }}>
                    {sess?.session_id?.slice(0,24)}…
                  </div>
                  <div style={{ fontSize:10, color:'var(--t-3)', marginTop:2 }}>
                    v{sess?.model_version || '—'} · {sess?.model_source || (sess?.is_model==='1'?'model':'collector')}
                  </div>
                </div>
              ))}
            </div>

            {/* Score card */}
            <div className="card" style={{ padding:20, marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                marginBottom:12 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>Score</div>
                {result.videoMatchStatus !== 'ok' && (
                  <div style={{ fontSize:10, color:'#FF9500', background:'rgba(255,149,0,0.1)',
                    padding:'3px 8px', borderRadius:4 }}>
                    ⚠ video: {result.videoMatchStatus}
                  </div>
                )}
              </div>
              <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:16 }}>
                <span style={{ fontSize:48, fontWeight:900,
                  color: result.score >= 90 ? '#30D158' : result.score >= 75 ? '#FFD60A' : '#FF453A' }}>
                  {result.score !== null ? result.score : '—'}
                </span>
                {result.score !== null && <span style={{ fontSize:20, color:'var(--t-3)' }}>%</span>}
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
                {[
                  { key:'correct',       label:'Correct',    color:'#30D158' },
                  { key:'missing_event', label:'Missing',    color:'#FF453A' },
                  { key:'extra_event',   label:'Extra',      color:'#FF9500' },
                  { key:'wrong_side',    label:'Wrong side', color:'#BF5AF2' },
                  { key:'wrong_timestamp',label:'Wrong time',color:'#64D2FF' },
                  { key:'wrong_extra',   label:'Wrong extra',color:'#FF9F0A' },
                  { key:'missing_extra', label:'Miss extra', color:'#FF6B6B' },
                ].map(({ key, label, color }) => (
                  <div key={key} style={{ background:'var(--bg-3)', borderRadius:8,
                    padding:'8px', textAlign:'center' }}>
                    <div style={{ fontSize:20, fontWeight:800, color }}>{vc[key] || 0}</div>
                    <div style={{ fontSize:9, color:'var(--t-3)', marginTop:2 }}>{label}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop:12, fontSize:10, color:'var(--t-3)' }}>
                Model: {result.modelEventCount} events ·
                Collector: {result.collectorEventCount} events
              </div>
            </div>

            {/* ── Module breakdown ─────────────────────────────────────────
                Pressure is its own module here, lifted out of C, so this will
                NOT match Audit's C. Deliberate — Audit can follow later.
                A module the model answer does not cover reads "no data", never
                0% and never 100%. ───────────────────────────────────────── */}
            {result.moduleStats && (
              <div className="card" style={{ padding:16, marginBottom:14 }}>
                <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:4 }}>
                  <div style={{ fontSize:14, fontWeight:700 }}>By module</div>
                  <div style={{ fontSize:10, color:'var(--t-3)' }}>
                    denominator is the model answer's events for that module
                  </div>
                </div>

                {/* Scope filtering is gone, so a collector who only worked one
                    module now shows 0% on the rest and a low overall. That is
                    arithmetically right but easy to misread as bad work, so say
                    plainly what the collector actually covered. */}
                {(() => {
                  // A detail row exists for every model event; verdict
                  // 'missing_event' means the collector tagged nothing there.
                  // So a module is "covered" if it has any row that is NOT
                  // missing_event — that is the only evidence the collector
                  // worked in it. There is no collector_event_code field.
                  const rows = result.detailRows || []
                  const covered = MODULES_SPLIT.filter(m =>
                    rows.some(r => r.event_module === m && r.verdict !== 'missing_event'))
                  const withModel = MODULES_SPLIT.filter(m => (result.moduleStats?.[m]?.events || 0) > 0)
                  if (!withModel.length || !covered.length || covered.length === withModel.length) return null
                  return (
                    <div style={{ background:'rgba(255,214,10,0.07)',
                      border:'1px solid rgba(255,214,10,0.25)', borderRadius:7,
                      padding:'9px 12px', marginTop:10, fontSize:11,
                      color:'var(--t-2)', lineHeight:1.5 }}>
                      Collector covered{' '}
                      <b>{covered.map(m => MODULE_LABELS[m]).join(', ')}</b> only —
                      read the module scores rather than the overall. The other modules
                      are 0% because every model event in them is missing, which drags
                      the overall down.
                    </div>
                  )
                })()}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:8, marginTop:10 }}>
                  {/* Overall first, then the six modules */}
                  {(() => {
                    const coveredMods = MODULES_SPLIT.filter(m => {
                      const st = result.moduleStats?.[m]
                      return st && st.events > 0 && st.score > 0
                    })
                    const modelMods = MODULES_SPLIT.filter(m => {
                      const st = result.moduleStats?.[m]
                      return st && st.events > 0
                    })
                    const partialCoverage = coveredMods.length > 0 && coveredMods.length < modelMods.length
                    return (
                      <div style={{ background:'var(--bg-3)', borderRadius:8, padding:'10px 6px',
                        textAlign:'center', border:'1px solid var(--b-1)' }}>
                        <div style={{ fontSize:18, fontWeight:900,
                          color: result.score === null ? 'var(--t-3)'
                            : result.score >= 90 ? '#30D158' : result.score >= 75 ? '#FFD60A' : '#FF453A' }}>
                          {result.score !== null ? result.score + '%' : '—'}
                        </div>
                        <div style={{ fontSize:9, fontWeight:800, color:'var(--t-2)', marginTop:3,
                          letterSpacing:0.6 }}>OVERALL</div>
                        <div style={{ fontSize:8, color:'var(--t-3)', marginTop:2 }}>
                          {(result.verdictCounts?.correct || 0)}/{result.modelEventCount}
                        </div>
                        {partialCoverage && (
                          <div style={{ fontSize:8, color:'#FF9500', marginTop:4, lineHeight:1.4 }}>
                            {coveredMods.length === 1
                              ? `${MODULE_LABELS[coveredMods[0]]} only`
                              : coveredMods.map(m => MODULE_LABELS[m]).join(', ')}
                            {' — see modules'}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  {MODULES_SPLIT.map(mod => {
                    const st = result.moduleStats[mod] || { score:null, correct:0, errors:0, events:0 }
                    const noData = st.events === 0
                    return (
                      <div key={mod} style={{ background:'var(--bg-3)', borderRadius:8,
                        padding:'10px 6px', textAlign:'center',
                        opacity: noData ? 0.45 : 1 }}>
                        <div style={{ fontSize:18, fontWeight:900,
                          color: noData ? 'var(--t-3)'
                            : st.score >= 90 ? '#30D158' : st.score >= 75 ? '#FFD60A' : '#FF453A' }}>
                          {noData ? '—' : st.score + '%'}
                        </div>
                        <div style={{ fontSize:9, fontWeight:800, color:'var(--t-2)', marginTop:3,
                          letterSpacing:0.6 }}>{MODULE_LABELS[mod].toUpperCase()}</div>
                        <div style={{ fontSize:8, color:'var(--t-3)', marginTop:2 }}>
                          {noData ? 'no data' : `${st.correct}/${st.events} · ${st.errors} err`}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop:10, fontSize:9, color:'var(--t-3)', lineHeight:1.5 }}>
                  Module correct counts sum to the overall correct count — the overall score is
                  across all events, not an average of the module scores. Pressure is separated
                  from C here, so C covers ball recovery and pass recovery only.
                </div>
              </div>
            )}

            {/* Detail table */}
            <div className="card" style={{ padding:16, marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:12 }}>
                Event Detail ({result.detailRows.length} rows)
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr style={{ borderBottom:'1px solid var(--b-1)' }}>
                      <th style={{ width:30 }}/>
                      {['Verdict','Event','Model time','Collector time','Δms','Model team','Coll team','Shape'].map(h => (
                        <th key={h} style={{ padding:'4px 8px', textAlign:'left',
                          fontSize:9, fontWeight:700, color:'var(--t-3)', letterSpacing:0.5,
                          textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.detailRows.slice(0,100).map((row, i) => (
                      <tr key={i} style={{
                        borderBottom:'1px solid rgba(255,255,255,0.04)',
                        background: seekRow === i ? 'rgba(232,89,12,0.13)' : 'transparent',
                        transition: 'background .25s',
                      }}>
                        <td style={{ padding:'4px 4px 4px 8px' }}>
                          {(() => {
                            // extra_event has no model timestamp — the collector
                            // tagged something the model does not have, so the
                            // moment to inspect is theirs. Everything else is
                            // anchored on the model, which is the reference.
                            const ms = row.verdict === 'extra_event'
                              ? row.collector_video_time_ms
                              : (row.model_video_time_ms || row.collector_video_time_ms)
                            const has = ms !== '' && ms != null
                            const ready = popOpen
                            return (
                              <button
                                disabled={!ready || !has}
                                title={!ready ? 'Load video to seek'
                                  : !has ? 'No timestamp on this row'
                                  : `Seek to ${msToReadable(ms)}`}
                                onClick={async e => {
                                  // cross-window: the player is a separate
                                  // React root, so this goes over Tauri events
                                  try {
                                    const { emit } = await import('@tauri-apps/api/event')
                                    await emit('mark:video-seek',
                                      { ms: Number(ms), label: row.event_code })
                                  } catch (err) {
                                    console.warn('[COMPARE] seek emit failed:', err)
                                  }
                                  // bring the row into view and mark it, so the
                                  // reviewer sees the verdict and the video
                                  // moment together without hunting for either
                                  setSeekRow(i)
                                  setTimeout(() => setSeekRow(r => r === i ? -1 : r), 2200)
                                  e.currentTarget.closest('tr')?.scrollIntoView({
                                    block: 'center', behavior: 'smooth',
                                  })
                                }}
                                style={{ width:22, height:22, borderRadius:5, cursor: (ready && has) ? 'pointer' : 'default',
                                  background: (ready && has) ? 'rgba(232,89,12,0.14)' : 'transparent',
                                  border:`1px solid ${(ready && has) ? 'var(--p2)' : 'var(--b-1)'}`,
                                  color: (ready && has) ? 'var(--p2)' : 'var(--b-2)',
                                  fontSize:9, lineHeight:1, padding:0 }}>
                                ▶
                              </button>
                            )
                          })()}
                        </td>
                        <td style={{ padding:'4px 8px' }}><VerdictBadge verdict={row.verdict}/></td>
                        <td style={{ padding:'4px 8px', fontFamily:'JetBrains Mono,monospace',
                          color:'var(--t-2)' }}>{row.event_code}</td>
                        <td style={{ padding:'4px 8px', fontFamily:'JetBrains Mono,monospace',
                          color:'var(--t-3)', fontSize:10 }}>{msToReadable(row.model_video_time_ms)}</td>
                        <td style={{ padding:'4px 8px', fontFamily:'JetBrains Mono,monospace',
                          color:'var(--t-3)', fontSize:10 }}>{msToReadable(row.collector_video_time_ms)}</td>
                        <td style={{ padding:'4px 8px', fontFamily:'JetBrains Mono,monospace',
                          color: parseInt(row.delta_ms)>1000?'#FF9500':'var(--t-3)',
                          fontSize:10 }}>{row.delta_ms}</td>
                        <td style={{ padding:'4px 8px', color:'var(--t-2)' }}>{row.model_team}</td>
                        <td style={{ padding:'4px 8px',
                          color: row.collector_team !== row.model_team && row.model_team
                            ? '#FF453A' : 'var(--t-2)' }}>{row.collector_team}</td>
                        <td style={{ padding:'4px 8px', fontFamily:'JetBrains Mono,monospace',
                          color:'#BF5AF2', fontSize:10 }}>{row.model_shape}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.detailRows.length > 100 && (
                  <div style={{ textAlign:'center', fontSize:11, color:'var(--t-3)',
                    padding:'8px 0' }}>
                    Showing first 100 of {result.detailRows.length} rows.
                    Write to Sheet to see all.
                  </div>
                )}
              </div>
            </div>

            {/* Write to Sheet */}
            {!written ? (
              <button className="btn-orange" style={{ width:'100%', padding:'12px 0', fontSize:13 }}
                disabled={loading} onClick={handleWriteToSheet}>
                {loading ? loadingMsg : 'Write Results to Sheet'}
              </button>
            ) : existingRun ? (
              <div style={{ textAlign:'center', fontSize:13, color:'#FFD60A',
                padding:'12px 14px', background:'rgba(255,214,10,0.07)',
                border:'1px solid rgba(255,214,10,0.28)', borderRadius:8, lineHeight:1.6 }}>
                Showing previous run from{' '}
                {existingRun.run_timestamp_iso
                  ? new Date(existingRun.run_timestamp_iso).toLocaleString()
                  : 'an earlier session'} — no changes detected.
                <div style={{ fontSize:10, color:'var(--t-3)', marginTop:6 }}>
                  Same model and collector sessions, tolerance v{existingRun.tolerance_config_version}
                  {' '}and algorithm v{existingRun.algorithm_version}, so the rows would be identical.
                  Nothing was written.
                  {existingRun.score !== '' && existingRun.score != null &&
                    ` That run scored ${existingRun.score}%.`}
                </div>
                <div style={{ fontSize:10, color:'var(--t-3)', marginTop:4,
                  fontFamily:'JetBrains Mono,monospace' }}>
                  run_id {existingRun.run_id}
                </div>
              </div>
            ) : (
              <div style={{ textAlign:'center', fontSize:13, color:'#30D158',
                padding:'12px', background:'rgba(48,209,88,0.08)',
                border:'1px solid rgba(48,209,88,0.2)', borderRadius:8 }}>
                ✓ Written to Sheet — comparison_detail + scores tabs updated
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  )
}
