import { useState, useEffect } from 'react'
import { db } from '../firebase/config'
import { collection, query, where, getDocs, doc, setDoc, getDoc, serverTimestamp, orderBy, limit } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { CURRENT_VERSION } from '../hooks/useUpdateCheck'

const SHEETS_API_KEY   = 'AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI'
const MATCHES_SHEET_ID = '1zoh7CmoQKPMLGBEklHXznG1Y8xBS-iuu0phRWn8-wXc'

// Column aliases — exact sheet headers: Production ID, Staging ID, Game Week,
// Competition, Country, Match Date, Match Name, Home Team, Away Team, Season, Trainer
const COL_ALIASES = {
  productionId: ['production id','productionid','production_id','prod id','prodid','production','match id','matchid','id'],
  stagingId:    ['staging id','stagingid','staging_id','staging'],
  matchName:    ['match name','matchname','match_name','name','match','game','fixture'],
  homeTeam:     ['home team','hometeam','home_team','home'],
  awayTeam:     ['away team','awayteam','away_team','away'],
  matchDate:    ['match date','matchdate','match_date','date','game date','gamedate'],
  competition:  ['competition','league','tournament','comp'],
  country:      ['country'],
  season:       ['season'],
  trainer:      ['trainer','assigned to','assignedto','analyst','collector'],
  gameWeek:     ['game week','gameweek','game_week','week','gw','round','matchday'],
}

function resolveCol(headers, aliases) {
  for (const alias of aliases) {
    const idx = headers.findIndex(h => h.toLowerCase().replace(/[^a-z0-9]/g,'') === alias.replace(/[^a-z0-9]/g,''))
    if (idx !== -1) return idx
  }
  return -1
}

// Auto-detect column positions by scanning content (fallback when headers don't match)
function autoDetectCols(rows) {
  // Find column with 7-digit production IDs
  const dataRows = rows.slice(0, 10)
  let prodCol = -1
  for (let c = 0; c < 20; c++) {
    const vals = dataRows.map(r => String(r[c] || '').trim())
    if (vals.filter(v => /^\d{7}$/.test(v)).length >= 3) { prodCol = c; break }
  }
  if (prodCol === -1) return null

  // Find column with "X vs Y" pattern for match name
  let nameCol = -1
  for (let c = 0; c < 20; c++) {
    const vals = dataRows.map(r => String(r[c] || '').trim())
    if (vals.filter(v => v.includes(' vs ')).length >= 3) { nameCol = c; break }
  }

  // Find column with date pattern YYYY-MM-DD
  let dateCol = -1
  for (let c = 0; c < 20; c++) {
    const vals = dataRows.map(r => String(r[c] || '').trim())
    if (vals.filter(v => /^\d{4}-\d{2}-\d{2}/.test(v)).length >= 3) { dateCol = c; break }
  }

  console.log('[MARK] Auto-detected cols: prodId=', prodCol, 'name=', nameCol, 'date=', dateCol)
  return { productionId: prodCol, matchName: nameCol, matchDate: dateCol,
           stagingId: -1, homeTeam: -1, awayTeam: -1, competition: -1,
           country: -1, season: -1, trainer: -1, gameWeek: -1 }
}

async function fetchMatchesFromSheet() {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${MATCHES_SHEET_ID}`

  // Step 1: get metadata to find the first sheet's real tab name
  const metaRes = await fetch(`${base}?key=${SHEETS_API_KEY}`)
  if (!metaRes.ok) throw new Error(`Sheets API error ${metaRes.status}`)
  const meta     = await metaRes.json()
  const firstTab = meta?.sheets?.[0]?.properties?.title || 'Sheet1'
  console.log('[MARK] Matches sheet tab:', firstTab)

  // Step 2: fetch data
  const range   = encodeURIComponent(`${firstTab}!A1:Z`)
  const dataRes = await fetch(`${base}/values/${range}?key=${SHEETS_API_KEY}`)
  if (!dataRes.ok) throw new Error(`Sheets API error ${dataRes.status}`)
  const data = await dataRes.json()
  const rows = data.values || []
  console.log('[MARK] Sheet rows:', rows.length, '| Row 1 (headers):', rows[0])

  if (rows.length < 2) return []

  // Try header-based mapping first
  const headers = rows[0].map(h => String(h).toLowerCase().trim())
  let idx = {}
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    idx[field] = resolveCol(headers, aliases)
  }
  console.log('[MARK] Column index map:', idx)

  // If productionId not found via headers, try auto-detect on data rows
  if (idx.productionId === -1) {
    console.log('[MARK] Header match failed, trying auto-detect...')
    const detected = autoDetectCols(rows.slice(1))
    if (detected) idx = detected
  }

  // If still no productionId column found, treat row 1 as data (no header row)
  let dataStart = 1
  if (idx.productionId === -1) {
    console.log('[MARK] Trying no-header mode (row 1 is data)')
    const detected = autoDetectCols(rows)
    if (detected) { idx = detected; dataStart = 0 }
  }

  const get = (row, field) => {
    const i = idx[field]
    return (i !== undefined && i !== -1 && i < row.length) ? String(row[i] || '').trim() : ''
  }

  const result = rows.slice(dataStart)
    .filter(r => r.length > 0 && get(r, 'productionId'))
    .map(r => {
      const matchName = get(r, 'matchName')
      // If matchName col found but homeTeam col not found, parse from "Home vs Away"
      let homeTeam = get(r, 'homeTeam')
      let awayTeam = get(r, 'awayTeam')
      if (matchName.includes(' vs ') && (!homeTeam || !awayTeam)) {
        const parts = matchName.split(' vs ')
        homeTeam = homeTeam || parts[0]?.trim() || ''
        awayTeam = awayTeam || parts[1]?.trim() || ''
      }
      return {
        productionId: get(r, 'productionId'),
        stagingId:    get(r, 'stagingId'),
        matchName,
        homeTeam,
        awayTeam,
        matchDate:    get(r, 'matchDate'),
        competition:  get(r, 'competition'),
        country:      get(r, 'country'),
        season:       get(r, 'season'),
        trainer:      get(r, 'trainer'),
        gameWeek:     get(r, 'gameWeek') ? Number(get(r, 'gameWeek')) : null,
      }
    })

  console.log('[MARK] Parsed matches:', result.length, '| First:', result[0])
  return result
}

const HALVES = [
  { id: '1H', label: '1st Half' },
  { id: '2H', label: '2nd Half' },
  { id: 'ET1', label: 'Extra Time 1' },
  { id: 'ET2', label: 'Extra Time 2' },
]

export default function SessionSetupPage({ onSessionStart, lastResult, onShowHistory }) {
  const { profile, logout } = useAuth()
  const [matchSearch, setMatchSearch]     = useState('')
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [selectedHalf, setSelectedHalf]   = useState(null)
  const [lockStatus, setLockStatus]       = useState(null)
  const [lockedBy, setLockedBy]           = useState('')
  const [completedSession, setCompletedSession] = useState(null)
  const [recentSessions, setRecentSessions]     = useState([])
  const [sessionsLoading, setSessionsLoading]   = useState(false)
  const [reviewMode, setReviewMode]             = useState(null) // null | 'scout' | 'audit'
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')
  const [matches, setMatches]             = useState([])
  const [matchesLoading, setMatchesLoading] = useState(true)
  const [matchesError, setMatchesError]   = useState('')
  const [debugInfo, setDebugInfo]         = useState('')

  useEffect(() => {
    if (!profile?.uid) return
    setSessionsLoading(true)
    getDocs(query(
      collection(db, 'mark_sessions'),
      where('reviewerId', '==', profile.uid),
      where('status', '==', 'completed')
    )).then(snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (b.completedAt?.toDate?.()?.getTime() || 0) - (a.completedAt?.toDate?.()?.getTime() || 0))
      setRecentSessions(list.slice(0, 10))
    }).catch(() => {}).finally(() => setSessionsLoading(false))
  }, [profile?.uid])

  useEffect(() => {
    setMatchesLoading(true)
    fetchMatchesFromSheet()
      .then(rows => {
        setMatches(rows)
        setMatchesLoading(false)
        if (rows.length === 0) setDebugInfo('Sheet returned 0 rows — check console for header details')
      })
      .catch(e => { setMatchesError(e.message); setMatchesLoading(false) })
  }, [])

  useEffect(() => {
    if (selectedMatch && selectedHalf) checkHalfLock()
  }, [selectedMatch, selectedHalf])

  const filteredMatches = matches.filter(m => {
    const q = matchSearch.toLowerCase()
    return !q ||
      m.matchName.toLowerCase().includes(q) ||
      m.productionId.includes(q) ||
      m.homeTeam.toLowerCase().includes(q) ||
      m.awayTeam.toLowerCase().includes(q) ||
      m.competition.toLowerCase().includes(q)
  })

  async function checkHalfLock() {
    if (!selectedMatch || !selectedHalf) return
    setLockStatus('checking')
    const lockId = `${selectedMatch.productionId}_${selectedHalf.id}`
    try {
      // Check 1: in-progress lock
      const lockDoc = await getDoc(doc(db, 'mark_locks', lockId))
      if (lockDoc.exists()) {
        const data = lockDoc.data()
        if (data.reviewerId !== profile?.uid) {
          setLockStatus('locked')
          setLockedBy(data.reviewerName || data.reviewerEmail || 'Another reviewer')
          return
        }
      }

      // Check 2: completed session by any reviewer
      const completedQ = query(
        collection(db, 'mark_sessions'),
        where('matchId', '==', String(selectedMatch.productionId)),
        where('half', '==', selectedHalf.id),
        where('status', '==', 'completed')
      )
      const completedSnap = await getDocs(completedQ)
      if (!completedSnap.empty) {
        const completedData = completedSnap.docs[0].data()
        setLockStatus('completed')
        setLockedBy(completedData.reviewerName || completedData.reviewerEmail || 'A reviewer')
        setCompletedSession({ id: completedSnap.docs[0].id, ...completedData })
        return
      }

      setLockStatus('free')
    } catch (e) {
      setLockStatus('free')
    }
  }

  async function handleStartSession() {
    if (!selectedMatch || !selectedHalf || lockStatus === 'locked') return
    setLoading(true); setError('')
    const matchId  = selectedMatch.productionId
    const lockId   = `${matchId}_${selectedHalf.id}`
    const sessionId = `${profile.uid}_${matchId}_${selectedHalf.id}_${Date.now()}`
    try {
      await setDoc(doc(db, 'mark_locks', lockId), {
        reviewerId:    profile.uid,
        reviewerEmail: profile.email,
        reviewerName:  profile.displayName || profile.email.split('@')[0],
        matchId,
        half: selectedHalf.id,
        claimedAt: serverTimestamp(),
      })
      await setDoc(doc(db, 'mark_sessions', sessionId), {
        sessionId,
        matchId,
        half:          selectedHalf.id,
        matchName:     selectedMatch.matchName,
        homeTeam:      selectedMatch.homeTeam,
        awayTeam:      selectedMatch.awayTeam,
        matchDate:     selectedMatch.matchDate,
        competition:   selectedMatch.competition,
        reviewerId:    profile.uid,
        reviewerEmail: profile.email,
        reviewerName:  profile.displayName || profile.email.split('@')[0],
        collectorId:   '',
        collectorCode: '',
        status:        'in_progress',
        isFirstReview: true,
        totalTaggedErrors:    0,
        totalReviewedEvents:  0,
        qualityScore:         null,
        startedAt:     serverTimestamp(),
        completedAt:   null,
      })
      onSessionStart({
        sessionId, matchId,
        half:      selectedHalf.id,
        matchName: selectedMatch.matchName,
        homeTeam:  selectedMatch.homeTeam,
        awayTeam:  selectedMatch.awayTeam,
        matchDate: selectedMatch.matchDate,
        mode:      reviewMode || 'scout',
      })
    } catch (e) {
      setError('Failed to start session: ' + e.message)
      setLoading(false)
    }
  }

  const canStart = selectedMatch && selectedHalf && lockStatus === 'free' && !loading
  // Reset completedSession when selection changes
  // (handled inline via setCompletedSession(null) on selection change)

  return (
    <div style={{height:'100vh',display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden'}}>
      {/* ── Topbar ── */}
      <header style={{
        flexShrink:0, height:52,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0 20px', borderBottom:'1px solid var(--b-1)', background:'var(--bg-2)',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{
            width:30,height:30,borderRadius:9,background:'var(--p2)',
            display:'flex',alignItems:'center',justifyContent:'center',
            boxShadow:'0 2px 10px rgba(232,89,12,0.4)',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7l9 5 9-5-9-5z" fill="white"/>
              <path d="M3 12l9 5 9-5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <span style={{fontFamily:'Inter',fontWeight:900,fontSize:15,color:'var(--t-1)',letterSpacing:-0.3}}>MARK</span>
            <span style={{fontSize:10,color:'var(--t-3)',fontWeight:500,marginLeft:6}}>v{CURRENT_VERSION}</span>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{
            display:'flex',alignItems:'center',gap:6,
            padding:'4px 10px',borderRadius:20,
            background:'rgba(255,255,255,0.04)',border:'1px solid var(--b-1)',
          }}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'#30D158',boxShadow:'0 0 6px rgba(48,209,88,0.5)'}}/>
            <span style={{fontSize:11,color:'var(--t-3)'}}>{profile?.email}</span>
          </div>
          <button className="btn-ghost" style={{padding:'5px 14px',fontSize:11,display:'flex',alignItems:'center',gap:5}} onClick={() => onShowHistory && onShowHistory(null)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
            History
          </button>
          <button className="btn-ghost" style={{padding:'5px 14px',fontSize:11}} onClick={logout}>Sign out</button>
        </div>
      </header>

      {/* Last result banner */}
      {lastResult && (
        <div className="slide-down" style={{
          background:'rgba(48,209,88,0.08)', borderBottom:'1px solid rgba(48,209,88,0.15)',
          padding:'8px 20px', display:'flex', alignItems:'center', gap:12,
        }}>
          <div style={{width:6,height:6,borderRadius:'50%',background:'#30D158',boxShadow:'0 0 6px rgba(48,209,88,0.6)',flexShrink:0}}/>
          <span style={{fontSize:12,color:'#30D158',fontWeight:700}}>Session complete</span>
          <span style={{fontSize:12,color:'var(--t-3)'}}>Quality: <strong style={{color:'var(--t-2)'}}>{lastResult.quality}%</strong> · {lastResult.tagCount} errors / {lastResult.total} events</span>
          {lastResult.filePath && (
            <button onClick={async () => { try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('open_file', { path: lastResult.filePath }) } catch(e) {} }}
              style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:6, cursor:'pointer', border:'1px solid rgba(48,209,88,0.3)', background:'rgba(48,209,88,0.08)', color:'#30D158', fontSize:11, fontWeight:600 }}>
              Open .xlsx
            </button>
          )}
        </div>
      )}

      <div style={{flex:1,overflow:'auto',display:'flex',flexDirection:'column'}}>
        {/* ── Mode selector ── */}
        {!reviewMode && (
          <div className="scale-in" style={{
            flex:1, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center',
            padding:'32px 24px', gap:28,
          }}>
            {/* Header */}
            <div style={{textAlign:'center'}}>
              <div style={{
                fontFamily:'JetBrains Mono, monospace', fontSize:10, fontWeight:700,
                color:'var(--p2)', letterSpacing:3, marginBottom:10, textTransform:'uppercase',
              }}>Hudl Egypt · Quality Review</div>
              <div style={{fontFamily:'Inter',fontWeight:900,fontSize:26,color:'var(--t-1)',letterSpacing:-0.5,marginBottom:6}}>
                How are you reviewing?
              </div>
              <div style={{fontSize:13,color:'var(--t-3)'}}>Choose your review mode to get started</div>
            </div>

            {/* Mode cards */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,width:'100%',maxWidth:600}}>
              {[
                {
                  mode:'scout',
                  color:'#E8590C',
                  glyph: (
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                      <circle cx="14" cy="14" r="9" stroke="#E8590C" strokeWidth="2"/>
                      <circle cx="14" cy="14" r="4" stroke="#E8590C" strokeWidth="2"/>
                      <circle cx="14" cy="14" r="1.5" fill="#E8590C"/>
                      <line x1="14" y1="2" x2="14" y2="6" stroke="#E8590C" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="14" y1="22" x2="14" y2="26" stroke="#E8590C" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="2" y1="14" x2="6" y2="14" stroke="#E8590C" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="22" y1="14" x2="26" y2="14" stroke="#E8590C" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="21" y1="21" x2="29" y2="29" stroke="#E8590C" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  ),
                  title:'Scout',
                  sub:'Tag errors as you watch',
                  desc:'Watch the video and flag collection errors using keyboard shortcuts — no collection app needed.',
                  steps:['Open video in MARK','Press shortcut keys to tag','Done — score calculated'],
                },
                {
                  mode:'audit',
                  color:'#0A84FF',
                  glyph: (
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                      <rect x="4" y="4" width="24" height="24" rx="4" stroke="#0A84FF" strokeWidth="2"/>
                      <path d="M10 16l4 4 8-8" stroke="#0A84FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <line x1="10" y1="10" x2="22" y2="10" stroke="#0A84FF" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
                      <line x1="10" y1="22" x2="16" y2="22" stroke="#0A84FF" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
                    </svg>
                  ),
                  title:'Audit',
                  sub:'Correct errors in collection app',
                  desc:'Edit events directly in the collection app. MARK reads your corrections and calculates quality scores.',
                  steps:['Open match in collection app','Edit events as you review','Get results in MARK instantly'],
                },
              ].map(m => (
                <div key={m.mode}
                  onClick={() => setReviewMode(m.mode)}
                  style={{
                    background:'var(--bg-2)', borderRadius:14, padding:'22px 20px',
                    border:`1px solid rgba(255,255,255,0.06)`,
                    cursor:'pointer', position:'relative', overflow:'hidden',
                    transition:'all .22s var(--ease-out-expo)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = m.color + '50'
                    e.currentTarget.style.transform = 'translateY(-3px)'
                    e.currentTarget.style.boxShadow = `0 12px 32px ${m.color}18`
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  {/* Top accent line */}
                  <div style={{
                    position:'absolute', top:0, left:0, right:0, height:2,
                    background:`linear-gradient(90deg, transparent, ${m.color}, transparent)`,
                    opacity:0.6,
                  }}/>

                  {/* Glyph */}
                  <div style={{marginBottom:14}}>{m.glyph}</div>

                  {/* Title */}
                  <div style={{fontFamily:'Inter',fontWeight:900,fontSize:18,color:'var(--t-1)',marginBottom:2,letterSpacing:-0.3}}>
                    {m.title}
                  </div>
                  <div style={{fontSize:11,fontWeight:700,color:m.color,marginBottom:12,letterSpacing:0.3}}>
                    {m.sub}
                  </div>
                  <div style={{fontSize:12,color:'var(--t-3)',lineHeight:1.7,marginBottom:16}}>
                    {m.desc}
                  </div>

                  {/* Steps */}
                  <div style={{display:'flex',flexDirection:'column',gap:5}}>
                    {m.steps.map((step, i) => (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{
                          width:16,height:16,borderRadius:5,flexShrink:0,
                          background:`${m.color}18`,border:`1px solid ${m.color}30`,
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontFamily:'JetBrains Mono, monospace',fontSize:8,fontWeight:700,color:m.color,
                        }}>{i+1}</div>
                        <span style={{fontSize:11,color:'var(--t-3)'}}>{step}</span>
                      </div>
                    ))}
                  </div>

                  {/* Arrow */}
                  <div style={{
                    position:'absolute', bottom:18, right:18,
                    width:28,height:28,borderRadius:8,
                    background:`${m.color}14`,border:`1px solid ${m.color}30`,
                    display:'flex',alignItems:'center',justifyContent:'center',
                  }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={m.color} strokeWidth="2.5" strokeLinecap="round">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {reviewMode && (
          <div className="fade-in" style={{
            flex:1, display:'flex', flexDirection:'column', overflow:'hidden',
          }}>
            {/* Mode strip */}
            <div style={{
              display:'flex', alignItems:'center', gap:10, padding:'10px 24px',
              borderBottom:'1px solid var(--b-1)', background:'var(--bg-2)', flexShrink:0,
            }}>
              <button className="btn-ghost" style={{padding:'4px 10px',fontSize:11,display:'flex',alignItems:'center',gap:5}}
                onClick={() => setReviewMode(null)}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                Change mode
              </button>
              <div style={{width:1,height:14,background:'var(--b-2)'}}/>
              <div style={{
                display:'flex',alignItems:'center',gap:7,padding:'3px 12px',borderRadius:20,
                background: reviewMode==='audit' ? 'rgba(10,132,255,0.1)' : 'rgba(232,89,12,0.1)',
                border: `1px solid ${reviewMode==='audit' ? 'rgba(10,132,255,0.3)' : 'rgba(232,89,12,0.3)'}`,
              }}>
                <div style={{width:6,height:6,borderRadius:'50%',background:reviewMode==='audit'?'#0A84FF':'var(--p2)',boxShadow:`0 0 5px ${reviewMode==='audit'?'#0A84FF':'var(--p2)'}`}}/>
                <span style={{fontSize:11,fontWeight:700,color:reviewMode==='audit'?'#0A84FF':'var(--p2)'}}>
                  {reviewMode==='audit' ? 'Audit' : 'Scout'} mode
                </span>
              </div>
              <span style={{fontSize:11,color:'var(--t-3)',marginLeft:4}}>Select a match and half to begin</span>
            </div>

            {/* Match + half grid */}
            <div style={{flex:1,display:'flex',gap:0,overflow:'hidden'}}>

        {/* Left — Match list */}
        <div style={{flex:1,display:'flex',flexDirection:'column',gap:0,borderRight:'1px solid var(--b-1)',overflow:'hidden'}}>
          <div style={{padding:'14px 20px',borderBottom:'1px solid var(--b-1)',flexShrink:0}}>
            <div style={{fontFamily:'Inter',fontWeight:800,fontSize:15,color:'var(--t-1)',marginBottom:10,letterSpacing:-0.2}}>Select Match</div>
            <div style={{position:'relative'}}>
              <svg style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--t-3)" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input className="mark-input" placeholder={matchesLoading ? 'Loading matches…' : `Search ${filteredMatches.length} matches…`}
                value={matchSearch} onChange={e => { setMatchSearch(e.target.value); setSelectedMatch(null); setLockStatus(null) }}
                style={{paddingLeft:30}} autoFocus/>
            </div>
          </div>
          <div style={{flex:1,overflowY:'auto'}}>
            {matchesLoading ? (
              <div style={{padding:24,textAlign:'center',color:'var(--t-3)',fontSize:13}}>Loading matches…</div>
            ) : matchesError ? (
              <div style={{padding:24,textAlign:'center',color:'#FF453A',fontSize:13}}>Failed to load matches: {matchesError}</div>
            ) : filteredMatches.length === 0 && debugInfo ? (
              <div style={{padding:24,textAlign:'center',color:'#FF9F0A',fontSize:12}}>{debugInfo}<br/>Open DevTools (F12) → Console for details</div>
            ) : filteredMatches.length === 0 ? (
              <div style={{padding:24,textAlign:'center',color:'var(--t-3)',fontSize:13}}>No matches match your search</div>
            ) : filteredMatches.map((m, i) => {
              const isSelected = selectedMatch?.productionId === m.productionId
              return (
                <div key={i} onClick={() => { setSelectedMatch(m); setLockStatus(null); setSelectedHalf(null); setCompletedSession(null) }}
                  style={{
                    padding:'11px 20px', borderBottom:'1px solid var(--b-1)', cursor:'pointer',
                    background: isSelected ? 'rgba(232,89,12,0.08)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--p2)' : '3px solid transparent',
                    transition:'background .1s',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background='rgba(255,255,255,0.02)' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background='transparent' }}
                >
                  <div style={{fontSize:13,fontWeight:isSelected?700:500,color:isSelected?'var(--t-1)':'var(--t-2)',marginBottom:2}}>{m.matchName}</div>
                  <div style={{display:'flex',alignItems:'center',gap:6,fontSize:10,color:'var(--t-3)'}}>
                    <span style={{fontFamily:'JetBrains Mono, monospace',color:isSelected?'var(--p2)':'var(--t-3)',fontWeight:600}}>{m.productionId}</span>
                    <span>·</span><span>{m.competition}</span>
                    <span>·</span><span>{m.matchDate}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right — Half + status + start */}
        <div style={{width:300,flexShrink:0,display:'flex',flexDirection:'column',background:'var(--bg-2)',borderLeft:'1px solid var(--b-1)'}}>

          {/* Match summary */}
          <div style={{padding:'16px 20px',borderBottom:'1px solid var(--b-1)',flexShrink:0}}>
            <div style={{fontSize:9,fontWeight:800,color:'var(--t-3)',letterSpacing:1.5,marginBottom:8}}>MATCH</div>
            {selectedMatch ? (
              <div>
                <div style={{fontFamily:'Inter',fontWeight:700,fontSize:13,color:'var(--t-1)',marginBottom:3,lineHeight:1.3}}>{selectedMatch.matchName}</div>
                <div style={{fontSize:10,color:'var(--t-3)'}}>{selectedMatch.competition} · {selectedMatch.matchDate}</div>
                <div style={{fontFamily:'JetBrains Mono, monospace',fontSize:9,color:'var(--p2)',fontWeight:600,marginTop:4}}>#{selectedMatch.productionId}</div>
              </div>
            ) : (
              <div style={{fontSize:12,color:'var(--t-3)',fontStyle:'italic'}}>No match selected</div>
            )}
          </div>

          {/* Half selector */}
          <div style={{padding:'16px 20px',borderBottom:'1px solid var(--b-1)',flexShrink:0}}>
            <div style={{fontSize:9,fontWeight:800,color:'var(--t-3)',letterSpacing:1.5,marginBottom:10}}>HALF</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {HALVES.map(h => {
                const isSelected = selectedHalf?.id === h.id
                return (
                  <button key={h.id}
                    onClick={() => { setSelectedHalf(h); setLockStatus(null); setCompletedSession(null) }}
                    disabled={!selectedMatch}
                    style={{
                      padding:'12px 8px', borderRadius:10, cursor: selectedMatch ? 'pointer' : 'not-allowed',
                      border: isSelected ? '2px solid var(--p2)' : '2px solid var(--b-1)',
                      background: isSelected ? 'rgba(232,89,12,0.1)' : 'var(--bg-3)',
                      color: isSelected ? 'var(--p2)' : 'var(--t-3)',
                      fontSize:13, fontWeight: isSelected ? 800 : 400,
                      opacity: selectedMatch ? 1 : 0.3,
                      transition:'all .15s',
                    }}>
                    {h.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Availability status */}
          {selectedMatch && selectedHalf && (
            <div style={{padding:'14px 20px',borderBottom:'1px solid var(--b-1)',flexShrink:0}}>
              {lockStatus === 'checking' && (
                <div style={{display:'flex',alignItems:'center',gap:7,fontSize:12,color:'var(--t-3)'}}>
                  <svg style={{animation:'spin 1s linear infinite'}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" strokeOpacity=".2"/><path d="M12 2a10 10 0 0 1 10 10"/>
                  </svg>
                  Checking availability…
                </div>
              )}
              {lockStatus === 'free' && (
                <div style={{display:'flex',alignItems:'center',gap:7}}>
                  <div style={{width:7,height:7,borderRadius:'50%',background:'#30D158',boxShadow:'0 0 6px rgba(48,209,88,0.5)'}}/>
                  <span style={{fontSize:12,color:'#30D158',fontWeight:600}}>Available to review</span>
                </div>
              )}
              {lockStatus === 'locked' && (
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:4}}>
                    <div style={{width:7,height:7,borderRadius:'50%',background:'#FF453A',boxShadow:'0 0 6px rgba(255,69,58,0.5)'}}/>
                    <span style={{fontSize:12,color:'#FF453A',fontWeight:600}}>In progress</span>
                  </div>
                  <div style={{fontSize:11,color:'var(--t-3)',paddingLeft:14}}>Being reviewed by {lockedBy}</div>
                </div>
              )}
              {lockStatus === 'completed' && (
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:6}}>
                    <div style={{width:7,height:7,borderRadius:'50%',background:'#30D158'}}/>
                    <span style={{fontSize:12,color:'#30D158',fontWeight:600}}>Already reviewed</span>
                  </div>
                  {completedSession && (
                    <div style={{
                      background:'rgba(48,209,88,0.06)',border:'1px solid rgba(48,209,88,0.15)',
                      borderRadius:8,padding:'8px 10px',fontSize:11,color:'var(--t-3)',
                    }}>
                      <span style={{color:'var(--t-2)'}}>{lockedBy}</span> ·{' '}
                      <span style={{color:'var(--p2)',fontWeight:700}}>{completedSession.qualityScore || 0}%</span> quality
                      <span style={{color:'var(--t-3)'}}> · {completedSession.totalTaggedErrors || 0} errors</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{margin:'12px 20px',padding:'8px 12px',borderRadius:8,background:'rgba(255,69,58,0.08)',border:'1px solid rgba(255,69,58,0.2)',fontSize:11,color:'#FF453A'}}>
              {error}
            </div>
          )}

          {/* Spacer */}
          <div style={{flex:1}}/>

          {/* Start button */}
          <div style={{padding:'16px 20px',borderTop:'1px solid var(--b-1)',flexShrink:0}}>
            {lockStatus === 'completed' ? (
              <button className="btn-ghost" style={{width:'100%',padding:'13px',fontSize:13,fontWeight:600}}
                onClick={() => completedSession && onShowHistory && onShowHistory(completedSession)}>
                View Review →
              </button>
            ) : (
              <button className="btn-orange" style={{width:'100%',padding:'13px',fontSize:14,fontWeight:700}}
                disabled={!canStart} onClick={handleStartSession}>
                {loading ? 'Starting…' : reviewMode==='audit' ? 'Start Audit →' : 'Start Scout →'}
              </button>
            )}
            {!selectedMatch && (
              <div style={{textAlign:'center',fontSize:10,color:'var(--t-3)',marginTop:8}}>Select a match to continue</div>
            )}
            {selectedMatch && !selectedHalf && (
              <div style={{textAlign:'center',fontSize:10,color:'var(--t-3)',marginTop:8}}>Select a half to continue</div>
            )}
          </div>
        </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Recent sessions ── */}
      {recentSessions.length > 0 && (
        <div style={{flexShrink:0,borderTop:'1px solid var(--b-1)',background:'var(--bg-2)',padding:'12px 24px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <span style={{fontSize:9,fontWeight:800,color:'var(--t-3)',letterSpacing:1.5}}>RECENT SESSIONS</span>
            <button className="btn-ghost" style={{fontSize:10,padding:'2px 8px'}} onClick={() => onShowHistory && onShowHistory(null)}>
              View all →
            </button>
          </div>
          <div style={{display:'flex',gap:8,overflowX:'auto',paddingBottom:4,scrollbarWidth:'none'}}>
            {recentSessions.map(s => {
              const score = s.qualityScore || 0
              const color = score >= 80 ? '#30D158' : score >= 60 ? '#FFD60A' : '#FF453A'
              const date = s.completedAt?.toDate?.()
                ? s.completedAt.toDate().toLocaleDateString('en-GB',{day:'2-digit',month:'short'})
                : ''
              const isAudit = s.type === 'audit'
              return (
                <div key={s.id}
                  onClick={() => onShowHistory && onShowHistory(s)}
                  style={{
                    display:'flex', alignItems:'center', gap:10,
                    padding:'8px 12px', borderRadius:10, cursor:'pointer',
                    border:'1px solid var(--b-1)', background:'var(--bg-3)',
                    transition:'all .15s', flexShrink:0, minWidth:220, maxWidth:260,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background='rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor='var(--b-2)' }}
                  onMouseLeave={e => { e.currentTarget.style.background='var(--bg-3)'; e.currentTarget.style.borderColor='var(--b-1)' }}
                >
                  <div style={{
                    width:34,height:34,borderRadius:9,flexShrink:0,
                    background:`${color}12`,border:`1.5px solid ${color}33`,
                    display:'flex',alignItems:'center',justifyContent:'center',
                  }}>
                    <span style={{fontFamily:'Inter',fontWeight:900,fontSize:11,color}}>{score}%</span>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:'var(--t-1)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginBottom:2}}>
                      {s.matchName}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:5,fontSize:9,color:'var(--t-3)'}}>
                      <span style={{
                        padding:'1px 5px',borderRadius:4,fontWeight:700,fontSize:8,
                        background:isAudit?'rgba(10,132,255,0.12)':'rgba(232,89,12,0.12)',
                        color:isAudit?'#0A84FF':'var(--p2)',
                        border:`1px solid ${isAudit?'rgba(10,132,255,0.2)':'rgba(232,89,12,0.2)'}`,
                      }}>{isAudit?'AUDIT':'SCOUT'}</span>
                      <span>{s.half}</span>
                      <span>·</span>
                      <span>{s.totalTaggedErrors || 0} errors</span>
                      <span>·</span>
                      <span>{date}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
