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
    <div className="min-h-screen flex flex-col" style={{background:'var(--bg)'}}>
      {/* Topbar */}
      <header style={{height:52,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 20px',borderBottom:'1px solid var(--b-1)',background:'var(--bg-2)'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:28,height:28,borderRadius:8,background:'var(--p2)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7l9 5 9-5-9-5z" fill="white"/><path d="M3 12l9 5 9-5" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
          </div>
          <span style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:'var(--t-1)'}}>MARK</span>
          <span style={{fontSize:11,color:'var(--t-3)',fontWeight:600,marginLeft:2}}>Review App · v{CURRENT_VERSION}</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:12,color:'var(--t-3)'}}>{profile?.email}</span>
          <button className="btn-ghost" style={{padding:'5px 12px',fontSize:12}} onClick={onShowHistory}>
            Session History
          </button>
          <button className="btn-ghost" style={{padding:'5px 12px',fontSize:12}} onClick={logout}>Sign out</button>
        </div>
      </header>

      {/* Last result banner */}
      {lastResult && (
        <div style={{background:'rgba(48,209,88,0.1)',borderBottom:'1px solid rgba(48,209,88,0.2)',padding:'10px 20px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <span style={{fontSize:13,color:'#30D158',fontWeight:700}}>✅ Session complete — Quality Score: {lastResult.quality}%</span>
          <span style={{fontSize:12,color:'var(--t-3)'}}>{lastResult.tagCount} errors / {lastResult.total} events reviewed</span>
          <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
            {lastResult.filePath && (
              <button
                onClick={async () => {
                  try {
                    const { invoke } = await import('@tauri-apps/api/core')
                    await invoke('open_file', { path: lastResult.filePath })
                  } catch(e) { console.error('[MARK] Cannot open file:', e) }
                }}
                style={{
                  display:'flex', alignItems:'center', gap:6,
                  padding:'5px 12px', borderRadius:7, cursor:'pointer',
                  border:'1px solid rgba(48,209,88,0.4)',
                  background:'rgba(48,209,88,0.12)',
                  color:'#30D158', fontSize:12, fontWeight:600,
                  transition:'all .1s',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Open .xlsx
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{flex:1,overflow:'auto',padding:32,display:'flex',gap:24,maxWidth:1000,margin:'0 auto',width:'100%'}}>
        {/* Mode selector */}
        {!reviewMode && (
          <div className="scale-in" style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flex:1,gap:20,padding:'40px 20px'}}>
            <div style={{textAlign:'center',marginBottom:8}}>
              <div style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'var(--t-1)',marginBottom:6}}>Select Review Mode</div>
              <div style={{fontSize:12,color:'var(--t-3)'}}>How will you review this half?</div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,width:'100%',maxWidth:560}}>
              {[
                {
                  mode:'scout',
                  icon:'🎯',
                  title:'Scout',
                  sub:'Tag errors as you watch',
                  desc:'Watch the video and tag collection errors directly in MARK using keyboard shortcuts.',
                  color:'var(--p2)',
                },
                {
                  mode:'audit',
                  icon:'🔍',
                  title:'Audit',
                  sub:'Correct errors in collection app',
                  desc:'Edit events directly in the collection app. MARK captures your corrections and calculates the quality score.',
                  color:'#0A84FF',
                },
              ].map(m => (
                <div key={m.mode} onClick={() => setReviewMode(m.mode)}
                  className="card"
                  style={{
                    padding:'20px 18px',cursor:'pointer',
                    border:`1px solid rgba(255,255,255,0.06)`,
                    transition:'all .2s var(--ease-out-expo)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = m.color; e.currentTarget.style.boxShadow = `0 8px 24px ${m.color}22` }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.boxShadow = 'none' }}
                >
                  <div style={{fontSize:28,marginBottom:10}}>{m.icon}</div>
                  <div style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:'var(--t-1)',marginBottom:3}}>{m.title}</div>
                  <div style={{fontSize:11,fontWeight:600,color:m.color,marginBottom:8}}>{m.sub}</div>
                  <div style={{fontSize:11,color:'var(--t-3)',lineHeight:1.6}}>{m.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {reviewMode && (
          <div style={{padding:'8px 0 0',display:'flex',alignItems:'center',gap:8,paddingLeft:'0px'}}>
            <button className="btn-ghost" style={{padding:'4px 10px',fontSize:11}} onClick={() => setReviewMode(null)}>
              ← Change mode
            </button>
            <div style={{
              display:'flex',alignItems:'center',gap:6,padding:'3px 10px',borderRadius:20,
              background: reviewMode==='audit' ? 'rgba(10,132,255,0.1)' : 'rgba(232,89,12,0.1)',
              border: `1px solid ${reviewMode==='audit' ? 'rgba(10,132,255,0.3)' : 'rgba(232,89,12,0.3)'}`,
            }}>
              <span style={{fontSize:12}}>{reviewMode==='audit' ? '🔍' : '🎯'}</span>
              <span style={{fontSize:11,fontWeight:700,color: reviewMode==='audit' ? '#0A84FF' : 'var(--p2)'}}>
                {reviewMode==='audit' ? 'Audit mode' : 'Scout mode'}
              </span>
            </div>
          </div>
        )}

        {reviewMode && (
          <div style={{display:'flex',gap:16,flex:1,overflow:'hidden'}}>

        {/* Left — Match list */}
        <div style={{flex:1,display:'flex',flexDirection:'column',gap:16}}>
          <div>
            <h2 style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'var(--t-1)',marginBottom:4}}>New Review Session</h2>
            <p style={{fontSize:13,color:'var(--t-3)'}}>Select the match and half you want to review</p>
          </div>
          <div>
            <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>MATCH — {matchesLoading ? 'loading…' : `${filteredMatches.length} available`}</label>
            <input className="mark-input" placeholder="Search by match name, ID, or team…" value={matchSearch} onChange={e => { setMatchSearch(e.target.value); setSelectedMatch(null); setLockStatus(null) }} autoFocus />
          </div>
          <div className="card" style={{flex:1,overflow:'auto',maxHeight:400}}>
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
                  style={{padding:'12px 16px',borderBottom:'1px solid var(--b-1)',cursor:'pointer',
                    background: isSelected ? 'rgba(232,89,12,0.12)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--p2)' : '3px solid transparent',transition:'background .1s'}}>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--t-1)'}}>{m.matchName}</div>
                  <div style={{fontSize:11,color:'var(--t-3)',marginTop:2}}>
                    <span className="mono" style={{color:'var(--p2)'}}>{m.productionId}</span>
                    {' · '}{m.competition}{' · '}{m.matchDate}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right — Half + status + start */}
        <div style={{width:280,display:'flex',flexDirection:'column',gap:16}}>
          <div>
            <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:8,letterSpacing:.5}}>HALF</label>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {HALVES.map(h => {
                const isSelected = selectedHalf?.id === h.id
                return (
                  <button key={h.id} onClick={() => { setSelectedHalf(h); setLockStatus(null); setCompletedSession(null) }} disabled={!selectedMatch}
                    style={{padding:'10px 8px',borderRadius:10,border: isSelected ? '2px solid var(--p2)' : '2px solid var(--b-1)',
                      background: isSelected ? 'rgba(232,89,12,0.12)' : 'var(--bg-2)',color: isSelected ? 'var(--p2)' : 'var(--t-2)',
                      fontSize:13,fontWeight: isSelected ? 700 : 400,cursor: selectedMatch ? 'pointer' : 'not-allowed',
                      opacity: selectedMatch ? 1 : .4,transition:'all .15s'}}>
                    {h.label}
                  </button>
                )
              })}
            </div>
          </div>

          {selectedMatch && (
            <div className="card" style={{padding:14}}>
              <div style={{fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>SELECTED MATCH</div>
              <div style={{fontSize:13,fontWeight:700,color:'var(--t-1)'}}>{selectedMatch.matchName}</div>
              <div style={{fontSize:11,color:'var(--t-3)',marginTop:3}}>{selectedMatch.competition} · {selectedMatch.matchDate}</div>
            </div>
          )}

          {selectedMatch && selectedHalf && (
            <div className="card" style={{padding:14}}>
              {lockStatus === 'checking' && <div style={{fontSize:12,color:'var(--t-3)'}}>Checking availability…</div>}
              {lockStatus === 'free' && (
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span className="status-dot green"/>
                  <span style={{fontSize:12,color:'var(--t-2)'}}>Available</span>
                </div>
              )}
              {lockStatus === 'locked' && (
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span className="status-dot red"/>
                  <span style={{fontSize:12,color:'#FF453A'}}>Locked by {lockedBy}</span>
                </div>
              )}
              {lockStatus === 'completed' && (
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                    <span style={{width:8,height:8,borderRadius:'50%',background:'#30D158',display:'inline-block',flexShrink:0}}/>
                    <span style={{fontSize:12,color:'#30D158',fontWeight:700}}>Already reviewed by {lockedBy}</span>
                  </div>
                  {completedSession && (
                    <div style={{fontSize:11,color:'var(--t-3)'}}>
                      Score: <span style={{color:'var(--p2)',fontWeight:700}}>{completedSession.qualityScore || 0}%</span>
                      {' · '}{completedSession.totalTaggedErrors || 0} errors
                      {' · '}{completedSession.totalReviewedEvents || 0} events
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && <div style={{fontSize:12,color:'#FF453A',background:'rgba(255,69,58,0.1)',borderRadius:8,padding:'8px 12px'}}>{error}</div>}

          {lockStatus === 'completed' ? (
            <button className="btn-ghost" style={{padding:'14px 0',fontSize:14,marginTop:'auto'}}
              onClick={() => completedSession && onShowHistory && onShowHistory(completedSession)}>
              View Review →
            </button>
          ) : (
            <button className="btn-orange" style={{padding:'14px 0',fontSize:15,marginTop:'auto'}} disabled={!canStart} onClick={handleStartSession}>
              {loading ? 'Starting…' : reviewMode==='audit' ? 'Start Audit Session →' : 'Start Scout Session →'}
            </button>
          )}
        </div>
          </div>
        )}
      </div>

      {/* Recent sessions section */}
      {recentSessions.length > 0 && (
        <div style={{borderTop:'1px solid var(--b-1)',padding:'16px 24px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
            <span style={{fontSize:11,fontWeight:800,color:'var(--t-3)',letterSpacing:1}}>RECENT SESSIONS</span>
            <button className="btn-ghost" style={{fontSize:11,padding:'3px 10px'}} onClick={() => onShowHistory && onShowHistory(null)}>
              View all →
            </button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {recentSessions.map(s => {
              const score = s.qualityScore || 0
              const color = score >= 80 ? '#30D158' : score >= 60 ? '#FFD60A' : '#FF453A'
              const date = s.completedAt?.toDate?.()
                ? s.completedAt.toDate().toLocaleDateString('en-GB',{day:'2-digit',month:'short'})
                : ''
              return (
                <div key={s.id}
                  onClick={() => onShowHistory && onShowHistory(s)}
                  style={{
                    display:'flex', alignItems:'center', gap:10,
                    padding:'8px 12px', borderRadius:8, cursor:'pointer',
                    border:'1px solid var(--b-1)', background:'var(--bg-2)',
                    transition:'background .1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--bg-3)'}
                  onMouseLeave={e => e.currentTarget.style.background='var(--bg-2)'}
                >
                  <div style={{
                    width:36,height:36,borderRadius:8,flexShrink:0,
                    background:`${color}14`,border:`1.5px solid ${color}44`,
                    display:'flex',alignItems:'center',justifyContent:'center',
                  }}>
                    <span style={{fontFamily:'Inter',fontWeight:900,fontSize:11,color}}>{score}%</span>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--t-1)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {s.matchName}
                    </div>
                    <div style={{fontSize:10,color:'var(--t-3)',marginTop:1}}>
                      {s.half} · {s.totalTaggedErrors || 0} errors · {date}
                    </div>
                  </div>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--t-3)" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
