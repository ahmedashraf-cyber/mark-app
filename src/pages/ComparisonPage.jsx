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
import { useState, useEffect } from 'react'
import { db } from '../firebase/config'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { invoke } from '@tauri-apps/api/core'
import { useAuth } from '../hooks/useAuth.jsx'
import { compare } from '../utils/compareEngine'
import { writeComparisonResults } from '../utils/comparisonSheet'
import { FIELD_SHEET_ID, EVENT_COLUMNS } from '../config/fieldConfig'
import { CURRENT_VERSION } from '../hooks/useUpdateCheck'

const SHEETS_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${FIELD_SHEET_ID}`

async function getToken() {
  const token = await invoke('get_google_access_token_cmd')
  if (!token) throw new Error('Google auth required.')
  return token
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

  async function handleRun() {
    setError(''); setResult(null); setWritten(false)
    if (!matchId.trim() || !half || !hrCode.trim()) {
      setError('Match ID, Half and Collector HR-Code are all required.'); return
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

      // 4. Scope
      const scopeRaw  = mSess.scope_event_ids || ''
      const scopeIds  = scopeRaw ? scopeRaw.split('|').filter(Boolean) : []
      console.log('[COMPARE] scopeIds:', scopeIds)

      // 5. Run comparison
      setLoadingMsg('Running comparison…')
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
      console.log('[COMPARE] calling compare(), modelSessionId:', mSess.session_id)
      const compResult = compare(
        { ...mSess, session_id: mSess.session_id },
        mEvents,
        { ...cSess, session_id: cSess.session_id },
        cEvents,
        { modelSessionId: mSess.session_id, runId, scopeEventIds: scopeIds }
      )
      console.log('[COMPARE] result:', compResult.score, compResult.verdictCounts)
      setResult({ ...compResult, runId, scopeIds })

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
      await writeComparisonResults(mSessNorm, cSessNorm, result, result.scopeIds, result.runId)
      setWritten(true)
    } catch(e) {
      console.error('[COMPARE WRITE CRASH]', e, e?.stack)
      setError(e.message || String(e))
    } finally { setLoading(false); setLoadingMsg('') }

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
      <div style={{ flex:1, overflowY:'auto', padding:24, maxWidth:760, margin:'0 auto', width:'100%' }}>

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
                <div style={{ background:'var(--bg-3)', borderRadius:8, padding:'8px', textAlign:'center' }}>
                  <div style={{ fontSize:20, fontWeight:800, color:'var(--t-3)' }}>
                    {result.excludedCollectorCount}
                  </div>
                  <div style={{ fontSize:9, color:'var(--t-3)', marginTop:2 }}>Out of scope</div>
                </div>
              </div>

              <div style={{ marginTop:12, fontSize:10, color:'var(--t-3)' }}>
                Scope: {result.scopeIds.join(', ')} ·
                Model: {result.modelEventCount} events ·
                Collector (scoped): {result.collectorEventCount} events
              </div>
            </div>

            {/* Detail table */}
            <div className="card" style={{ padding:16, marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:12 }}>
                Event Detail ({result.detailRows.length} rows)
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr style={{ borderBottom:'1px solid var(--b-1)' }}>
                      {['Verdict','Event','Model ms','Collector ms','Δms','Model team','Coll team','Shape'].map(h => (
                        <th key={h} style={{ padding:'4px 8px', textAlign:'left',
                          fontSize:9, fontWeight:700, color:'var(--t-3)', letterSpacing:0.5,
                          textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.detailRows.slice(0,100).map((row, i) => (
                      <tr key={i} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding:'4px 8px' }}><VerdictBadge verdict={row.verdict}/></td>
                        <td style={{ padding:'4px 8px', fontFamily:'JetBrains Mono,monospace',
                          color:'var(--t-2)' }}>{row.event_code}</td>
                        <td style={{ padding:'4px 8px', fontFamily:'JetBrains Mono,monospace',
                          color:'var(--t-3)', fontSize:10 }}>{row.model_video_time_ms}</td>
                        <td style={{ padding:'4px 8px', fontFamily:'JetBrains Mono,monospace',
                          color:'var(--t-3)', fontSize:10 }}>{row.collector_video_time_ms}</td>
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
  )
}
