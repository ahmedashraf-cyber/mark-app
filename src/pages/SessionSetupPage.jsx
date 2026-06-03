import { useState, useEffect } from 'react'
import { db } from '../firebase/config'
import { collection, query, where, getDocs, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'

// Google Sheets API — reads match data
const SHEETS_API_KEY = 'AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI'
const MATCHES_SHEET_ID = '1dPwnYhIOiLUy_aBuVijPH3xtU6kxnEu-8FF115kXjSc'

const HALVES = [
  { id: '1H', label: '1st Half' },
  { id: '2H', label: '2nd Half' },
  { id: 'ET1', label: 'Extra Time 1' },
  { id: 'ET2', label: 'Extra Time 2' },
]

export default function SessionSetupPage({ onSessionStart }) {
  const { profile, logout } = useAuth()
  const [matches, setMatches]     = useState([])
  const [matchSearch, setMatchSearch] = useState('')
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [selectedHalf, setSelectedHalf]   = useState(null)
  const [collector, setCollector] = useState(null)
  const [lockStatus, setLockStatus] = useState(null) // null | 'checking' | 'locked' | 'free'
  const [lockedBy, setLockedBy]   = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [fetchingMatches, setFetchingMatches] = useState(true)

  // Load matches from Google Sheet on mount
  useEffect(() => {
    fetchMatches()
  }, [])

  // Check half lock when match + half selected
  useEffect(() => {
    if (selectedMatch && selectedHalf) {
      checkHalfLock()
      findCollector()
    }
  }, [selectedMatch, selectedHalf])

  async function fetchMatches() {
    setFetchingMatches(true)
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${MATCHES_SHEET_ID}/values/Sheet1?key=${SHEETS_API_KEY}`
      const res = await fetch(url)
      const data = await res.json()
      const rows = data.values || []
      const headers = rows[0] || []
      const parsed = rows.slice(1).map(row => {
        const obj = {}
        headers.forEach((h, i) => { obj[h.toLowerCase().replace(/\s/g,'_')] = row[i] || '' })
        return obj
      }).filter(r => r.match_id || r.id)
      setMatches(parsed)
    } catch (e) {
      // Fallback: show empty with message
      setMatches([])
    }
    setFetchingMatches(false)
  }

  async function findCollector() {
    if (!selectedMatch || !selectedHalf) return
    setCollector(null)
    try {
      // Look in FIELD's group_assignments or batch_trainer_assignments
      // for the trainee assigned to this match
      const matchId = selectedMatch.match_id || selectedMatch.id
      const snap = await getDocs(
        query(collection(db, 'mark_match_assignments'),
          where('matchId', '==', matchId),
          where('half', '==', selectedHalf.id)
        )
      )
      if (!snap.empty) {
        setCollector(snap.docs[0].data())
      }
    } catch (e) {}
  }

  async function checkHalfLock() {
    if (!selectedMatch || !selectedHalf) return
    setLockStatus('checking')
    const matchId = selectedMatch.match_id || selectedMatch.id
    const lockId = `${matchId}_${selectedHalf.id}`
    try {
      const lockDoc = await getDoc(doc(db, 'mark_locks', lockId))
      if (lockDoc.exists()) {
        const data = lockDoc.data()
        // Check if it's the current user's own lock
        if (data.reviewerId === profile?.uid) {
          setLockStatus('free') // own session — can resume
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
    if (!selectedMatch || !selectedHalf) return
    if (lockStatus === 'locked') return
    setLoading(true); setError('')

    const matchId = selectedMatch.match_id || selectedMatch.id
    const lockId  = `${matchId}_${selectedHalf.id}`
    const sessionId = `${profile.uid}_${matchId}_${selectedHalf.id}_${Date.now()}`

    try {
      // Claim the half lock
      await setDoc(doc(db, 'mark_locks', lockId), {
        reviewerId:    profile.uid,
        reviewerEmail: profile.email,
        reviewerName:  profile.displayName || profile.email.split('@')[0],
        matchId, half: selectedHalf.id,
        claimedAt: serverTimestamp(),
      })

      // Create session doc
      await setDoc(doc(db, 'mark_sessions', sessionId), {
        sessionId,
        matchId, half: selectedHalf.id,
        matchName:   selectedMatch.match_name || selectedMatch.name || matchId,
        homeTeam:    selectedMatch.home_team  || '',
        awayTeam:    selectedMatch.away_team  || '',
        matchDate:   selectedMatch.match_date || selectedMatch.date || '',
        reviewerId:  profile.uid,
        reviewerEmail: profile.email,
        reviewerName:  profile.displayName || profile.email.split('@')[0],
        collectorId:   collector?.collectorId || '',
        collectorCode: collector?.collectorCode || '',
        status: 'in_progress',
        isFirstReview: true,
        totalTaggedErrors: 0,
        totalReviewedEvents: 0,
        qualityScore: null,
        startedAt: serverTimestamp(),
        completedAt: null,
      })

      onSessionStart({
        sessionId, matchId, half: selectedHalf.id,
        matchName: selectedMatch.match_name || selectedMatch.name || matchId,
        homeTeam:  selectedMatch.home_team || '',
        awayTeam:  selectedMatch.away_team || '',
        collector,
      })
    } catch (e) {
      setError('Failed to start session: ' + e.message)
      setLoading(false)
    }
  }

  const filteredMatches = matches.filter(m => {
    const q = matchSearch.toLowerCase()
    return !q ||
      (m.match_name || m.name || '').toLowerCase().includes(q) ||
      (m.match_id   || m.id   || '').toString().includes(q) ||
      (m.home_team  || '').toLowerCase().includes(q) ||
      (m.away_team  || '').toLowerCase().includes(q)
  })

  const canStart = selectedMatch && selectedHalf && lockStatus === 'free' && !loading

  return (
    <div className="min-h-screen flex flex-col" style={{background:'var(--bg)'}}>

      {/* Topbar */}
      <header style={{
        height:52, display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0 20px', borderBottom:'1px solid var(--b-1)',
        background:'var(--bg-2)',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:28,height:28,borderRadius:8,background:'var(--p2)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7l9 5 9-5-9-5z" fill="white"/>
              <path d="M3 12l9 5 9-5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:'var(--t-1)'}}>MARK</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:12,color:'var(--t-3)'}}>{profile?.email}</span>
          <button className="btn-ghost" style={{padding:'5px 12px',fontSize:12}} onClick={logout}>Sign out</button>
        </div>
      </header>

      {/* Content */}
      <div style={{flex:1,overflow:'auto',padding:32,display:'flex',gap:24,maxWidth:1000,margin:'0 auto',width:'100%'}}>

        {/* Left — Match Selection */}
        <div style={{flex:1,display:'flex',flexDirection:'column',gap:16}}>
          <div>
            <h2 style={{fontFamily:'Inter',fontWeight:800,fontSize:20,color:'var(--t-1)',marginBottom:4}}>New Review Session</h2>
            <p style={{fontSize:13,color:'var(--t-3)'}}>Select the match and half you want to review</p>
          </div>

          {/* Match search */}
          <div>
            <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>MATCH</label>
            <input
              className="mark-input"
              placeholder="Search by match name, ID, or team…"
              value={matchSearch}
              onChange={e => { setMatchSearch(e.target.value); setSelectedMatch(null); setLockStatus(null) }}
              autoFocus
            />
          </div>

          {/* Match list */}
          <div className="card" style={{flex:1,overflow:'auto',maxHeight:380}}>
            {fetchingMatches ? (
              <div style={{padding:24,textAlign:'center',color:'var(--t-3)',fontSize:13}}>Loading matches…</div>
            ) : filteredMatches.length === 0 ? (
              <div style={{padding:24,textAlign:'center',color:'var(--t-3)',fontSize:13}}>
                {matches.length === 0 ? 'No matches found in sheet' : 'No matches match your search'}
              </div>
            ) : filteredMatches.map((m, i) => {
              const mid = m.match_id || m.id
              const name = m.match_name || m.name || mid
              const date = m.match_date || m.date || ''
              const isSelected = selectedMatch && (selectedMatch.match_id || selectedMatch.id) === mid
              return (
                <div
                  key={i}
                  onClick={() => { setSelectedMatch(m); setLockStatus(null); setSelectedHalf(null) }}
                  style={{
                    padding:'12px 16px',
                    borderBottom:'1px solid var(--b-1)',
                    cursor:'pointer',
                    background: isSelected ? 'rgba(232,89,12,0.12)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--p2)' : '3px solid transparent',
                    transition:'background .1s',
                  }}
                >
                  <div style={{fontSize:13,fontWeight:600,color:'var(--t-1)'}}>{name}</div>
                  <div style={{fontSize:11,color:'var(--t-3)',marginTop:2}}>
                    ID: <span className="mono">{mid}</span>
                    {date && ` · ${date}`}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right — Half + Status */}
        <div style={{width:280,display:'flex',flexDirection:'column',gap:16}}>

          {/* Half selection */}
          <div>
            <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:8,letterSpacing:.5}}>HALF</label>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {HALVES.map(h => {
                const isSelected = selectedHalf?.id === h.id
                return (
                  <button
                    key={h.id}
                    onClick={() => { setSelectedHalf(h); setLockStatus(null) }}
                    disabled={!selectedMatch}
                    style={{
                      padding:'10px 8px',
                      borderRadius:10,
                      border: isSelected ? '2px solid var(--p2)' : '2px solid var(--b-1)',
                      background: isSelected ? 'rgba(232,89,12,0.12)' : 'var(--bg-2)',
                      color: isSelected ? 'var(--p2)' : 'var(--t-2)',
                      fontSize:13, fontWeight: isSelected ? 700 : 400,
                      cursor: selectedMatch ? 'pointer' : 'not-allowed',
                      opacity: selectedMatch ? 1 : .4,
                      transition:'all .15s',
                    }}
                  >
                    {h.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Lock status */}
          {selectedMatch && selectedHalf && (
            <div className="card" style={{padding:14}}>
              {lockStatus === 'checking' && (
                <div style={{fontSize:12,color:'var(--t-3)'}}>Checking availability…</div>
              )}
              {lockStatus === 'free' && (
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span className="status-dot green"/>
                  <span style={{fontSize:12,color:'var(--t-2)'}}>Available — no one is reviewing this half</span>
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

          {/* Collector info */}
          {collector && (
            <div className="card" style={{padding:14}}>
              <div style={{fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>COLLECTOR</div>
              <div style={{fontSize:13,color:'var(--t-1)',fontWeight:600}}>{collector.collectorName || collector.collectorCode}</div>
              <div className="mono" style={{fontSize:11,color:'var(--t-3)',marginTop:2}}>{collector.collectorCode}</div>
            </div>
          )}

          {/* Start button */}
          {error && (
            <div style={{fontSize:12,color:'#FF453A',background:'rgba(255,69,58,0.1)',borderRadius:8,padding:'8px 12px'}}>
              {error}
            </div>
          )}

          <button
            className="btn-orange"
            style={{padding:'14px 0',fontSize:15,marginTop:'auto'}}
            disabled={!canStart}
            onClick={handleStartSession}
          >
            {loading ? 'Starting…' : 'Start Review Session →'}
          </button>
        </div>
      </div>
    </div>
  )
}
