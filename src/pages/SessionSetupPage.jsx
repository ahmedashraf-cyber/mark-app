import { useState, useEffect } from 'react'
import { db } from '../firebase/config'
import { collection, query, where, getDocs, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { CURRENT_VERSION } from '../hooks/useUpdateCheck'

const SHEETS_API_KEY   = 'AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI'
const MATCHES_SHEET_ID = '1dPwnYhIOiLUy_aBuVijPH3xtU6kxnEu-8FF115kXjSc'

// Column name aliases — handles any capitalisation / spacing in the sheet header
const COL = {
  productionId: ['productionid','production id','production_id','prod id','prodid','id'],
  stagingId:    ['stagingid','staging id','staging_id'],
  matchName:    ['matchname','match name','match_name','name','match'],
  homeTeam:     ['hometeam','home team','home_team','home'],
  awayTeam:     ['awayteam','away team','away_team','away'],
  matchDate:    ['matchdate','match date','match_date','date'],
  competition:  ['competition','league','tournament'],
  country:      ['country'],
  season:       ['season'],
  trainer:      ['trainer','assigned to','assignedto'],
  gameWeek:     ['gameweek','game week','game_week','week','gw','round'],
}

function resolveCol(headers, aliases) {
  for (const alias of aliases) {
    const idx = headers.findIndex(h => h.toLowerCase().trim() === alias)
    if (idx !== -1) return idx
  }
  return -1
}

async function fetchMatchesFromSheet() {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${MATCHES_SHEET_ID}`

  // Step 1: get metadata to find the first sheet's real tab name
  const metaRes = await fetch(`${base}?key=${SHEETS_API_KEY}`)
  if (!metaRes.ok) throw new Error(`Sheets API error ${metaRes.status}`)
  const meta     = await metaRes.json()
  const firstTab = meta?.sheets?.[0]?.properties?.title || 'Sheet1'

  // Step 2: fetch data using real tab name
  const range    = encodeURIComponent(`${firstTab}!A1:Z`)
  const dataRes  = await fetch(`${base}/values/${range}?key=${SHEETS_API_KEY}`)
  if (!dataRes.ok) throw new Error(`Sheets API error ${dataRes.status}`)
  const data = await dataRes.json()
  const rows = data.values || []
  if (rows.length < 2) return []

  // Row 0 = headers
  const headers = rows[0].map(h => String(h).toLowerCase().trim())
  const idx = {}
  for (const [field, aliases] of Object.entries(COL)) {
    idx[field] = resolveCol(headers, aliases)
  }

  const get = (row, field) => idx[field] !== -1 ? String(row[idx[field]] || '').trim() : ''

  return rows.slice(1)
    .filter(r => r.length > 0 && get(r, 'productionId'))
    .map(r => ({
      productionId: get(r, 'productionId'),
      stagingId:    get(r, 'stagingId'),
      matchName:    get(r, 'matchName'),
      homeTeam:     get(r, 'homeTeam'),
      awayTeam:     get(r, 'awayTeam'),
      matchDate:    get(r, 'matchDate'),
      competition:  get(r, 'competition'),
      country:      get(r, 'country'),
      season:       get(r, 'season'),
      trainer:      get(r, 'trainer'),
      gameWeek:     get(r, 'gameWeek') ? Number(get(r, 'gameWeek')) : null,
    }))
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
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')
  const [matches, setMatches]             = useState([])
  const [matchesLoading, setMatchesLoading] = useState(true)
  const [matchesError, setMatchesError]   = useState('')

  useEffect(() => {
    setMatchesLoading(true)
    fetchMatchesFromSheet()
      .then(rows => { setMatches(rows); setMatchesLoading(false) })
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
      const lockDoc = await getDoc(doc(db, 'mark_locks', lockId))
      if (lockDoc.exists()) {
        const data = lockDoc.data()
        if (data.reviewerId === profile?.uid) {
          setLockStatus('free')
        } else {
          setLockStatus('locked')
          setLockedBy(data.reviewerName || data.reviewerEmail || 'Another reviewer')
        }
      } else {
        setLockStatus('free')
      }
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
      })
    } catch (e) {
      setError('Failed to start session: ' + e.message)
      setLoading(false)
    }
  }

  const canStart = selectedMatch && selectedHalf && lockStatus === 'free' && !loading

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
            ) : filteredMatches.length === 0 ? (
              <div style={{padding:24,textAlign:'center',color:'var(--t-3)',fontSize:13}}>No matches match your search</div>
            ) : filteredMatches.map((m, i) => {
              const isSelected = selectedMatch?.productionId === m.productionId
              return (
                <div key={i} onClick={() => { setSelectedMatch(m); setLockStatus(null); setSelectedHalf(null) }}
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
                  <button key={h.id} onClick={() => { setSelectedHalf(h); setLockStatus(null) }} disabled={!selectedMatch}
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
            </div>
          )}

          {error && <div style={{fontSize:12,color:'#FF453A',background:'rgba(255,69,58,0.1)',borderRadius:8,padding:'8px 12px'}}>{error}</div>}

          <button className="btn-orange" style={{padding:'14px 0',fontSize:15,marginTop:'auto'}} disabled={!canStart} onClick={handleStartSession}>
            {loading ? 'Starting…' : 'Start Review Session →'}
          </button>
        </div>
      </div>
    </div>
  )
}
