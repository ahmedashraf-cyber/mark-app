import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AuthProvider, useAuth } from './hooks/useAuth.jsx'
import { checkForUpdate } from './hooks/useUpdateCheck.js'
import LoginPage from './pages/LoginPage'
import SessionSetupPage from './pages/SessionSetupPage'
import ReviewPage from './pages/ReviewPage'
import SessionHistoryPage from './pages/SessionHistoryPage'
import AuditPage from './pages/AuditPage'
import AuditReportPage from './pages/AuditReportPage'
import UpdateBanner from './components/UpdateBanner'

// Cinematic page wrapper — fades + slides in each time content changes
function PageTransition({ id, children }) {
  const [displayId,   setDisplayId]   = useState(id)
  const [displayChild, setDisplayChild] = useState(children)
  const [phase, setPhase] = useState('enter') // 'enter' | 'exit'
  const timerRef = useRef(null)

  useEffect(() => {
    if (id === displayId) return
    // Start exit animation
    setPhase('exit')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDisplayId(id)
      setDisplayChild(children)
      setPhase('enter')
    }, 180) // matches pageExit duration
    return () => clearTimeout(timerRef.current)
  }, [id])

  // Update children without transition when id is same
  useEffect(() => {
    if (id === displayId) setDisplayChild(children)
  }, [children])

  return (
    <div
      key={displayId}
      className={phase === 'enter' ? 'page-enter' : 'page-exit'}
      style={{ height: '100vh', overflow: 'hidden' }}
    >
      {displayChild}
    </div>
  )
}

// ── Background decoration — fixed overlay, always visible above page backgrounds
function BackgroundDecoration() {
  return (
    <div style={{
      position: 'fixed', inset: 0, pointerEvents: 'none',
      zIndex: 9999, overflow: 'hidden',
      transition: 'transform 0.8s ease',
    }}
      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      <svg width="100%" height="100%" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', inset: 0 }}>

        {/* Play button — top left */}
        <g opacity="0.045" transform="translate(60,60)">
          <circle cx="80" cy="80" r="76" fill="none" stroke="#E8590C" strokeWidth="2.5"/>
          <circle cx="80" cy="80" r="58" fill="none" stroke="#E8590C" strokeWidth="1" opacity="0.4"/>
          <polygon points="60,46 120,80 60,114" fill="#E8590C"/>
        </g>

        {/* Film strip — top right */}
        <g opacity="0.038" transform="translate(1180,24)" fill="none" stroke="#E8590C" strokeWidth="1.8">
          <rect x="0" y="0" width="200" height="130" rx="6"/>
          <rect x="8" y="8" width="22" height="22" rx="3" fill="#E8590C" opacity="0.5" stroke="none"/>
          <rect x="8" y="100" width="22" height="22" rx="3" fill="#E8590C" opacity="0.5" stroke="none"/>
          <rect x="170" y="8" width="22" height="22" rx="3" fill="#E8590C" opacity="0.5" stroke="none"/>
          <rect x="170" y="100" width="22" height="22" rx="3" fill="#E8590C" opacity="0.5" stroke="none"/>
          <line x1="0" y1="42" x2="200" y2="42"/>
          <line x1="0" y1="88" x2="200" y2="88"/>
          <line x1="38" y1="0" x2="38" y2="42"/>
          <line x1="100" y1="0" x2="100" y2="42"/>
          <line x1="162" y1="0" x2="162" y2="42"/>
          <line x1="38" y1="88" x2="38" y2="130"/>
          <line x1="100" y1="88" x2="100" y2="130"/>
          <line x1="162" y1="88" x2="162" y2="130"/>
        </g>

        {/* Crosshair — left center */}
        <g opacity="0.042" transform="translate(24,370)" fill="none" stroke="#E8590C" strokeWidth="1.8">
          <circle cx="70" cy="70" r="60"/>
          <circle cx="70" cy="70" r="36"/>
          <circle cx="70" cy="70" r="12"/>
          <circle cx="70" cy="70" r="3" fill="#E8590C" stroke="none"/>
          <line x1="70" y1="0" x2="70" y2="34"/>
          <line x1="70" y1="106" x2="70" y2="140"/>
          <line x1="0" y1="70" x2="34" y2="70"/>
          <line x1="106" y1="70" x2="140" y2="70"/>
        </g>

        {/* Timeline scrubber — bottom center */}
        <g opacity="0.04" transform="translate(320,830)">
          <rect x="0" y="14" width="800" height="4" rx="2" fill="#E8590C" opacity="0.2"/>
          <rect x="0" y="14" width="280" height="4" rx="2" fill="#E8590C" opacity="0.55"/>
          <circle cx="280" cy="16" r="8" fill="#E8590C" opacity="0.7"/>
          <line x1="100" y1="7" x2="100" y2="26" stroke="#E8590C" strokeWidth="1.5" opacity="0.35"/>
          <line x1="280" y1="4" x2="280" y2="30" stroke="#E8590C" strokeWidth="1.5" opacity="0.7"/>
          <line x1="480" y1="7" x2="480" y2="26" stroke="#E8590C" strokeWidth="1.5" opacity="0.25"/>
          <line x1="640" y1="7" x2="640" y2="26" stroke="#E8590C" strokeWidth="1.5" opacity="0.25"/>
          <line x1="760" y1="7" x2="760" y2="26" stroke="#E8590C" strokeWidth="1.5" opacity="0.25"/>
        </g>

        {/* Error tag — top center */}
        <g opacity="0.036" transform="translate(660,18)" fill="none" stroke="#E8590C" strokeWidth="1.8">
          <path d="M0 0 L100 0 L100 70 L50 100 L0 70 Z"/>
          <circle cx="50" cy="38" r="14"/>
          <line x1="50" y1="24" x2="50" y2="52"/>
          <line x1="36" y1="38" x2="64" y2="38"/>
        </g>

        {/* Waveform — right center */}
        <g opacity="0.036" transform="translate(1388,290)" fill="#E8590C">
          <rect x="0"  y="48" width="8" height="38" rx="2"/>
          <rect x="15" y="26" width="8" height="82" rx="2"/>
          <rect x="30" y="36" width="8" height="62" rx="2"/>
          <rect x="45" y="12" width="8" height="110" rx="2"/>
          <rect x="60" y="28" width="8" height="78" rx="2"/>
          <rect x="75" y="44" width="8" height="46" rx="2"/>
        </g>

        {/* Football pitch — bottom right */}
        <g opacity="0.028" transform="translate(820,540)" fill="none" stroke="#ffffff" strokeWidth="1.5">
          <rect x="0" y="0" width="380" height="240" rx="4"/>
          <line x1="190" y1="0" x2="190" y2="240"/>
          <circle cx="190" cy="120" r="50"/>
          <circle cx="190" cy="120" r="3" fill="#ffffff" stroke="none"/>
          <rect x="0" y="72" width="72" height="96" rx="2"/>
          <rect x="308" y="72" width="72" height="96" rx="2"/>
          <rect x="0" y="98" width="24" height="44" rx="2"/>
          <rect x="356" y="98" width="24" height="44" rx="2"/>
        </g>

        {/* Accent dots */}
        <circle cx="580" cy="260" r="2.5" fill="#E8590C" opacity="0.1"/>
        <circle cx="240" cy="660" r="2"   fill="#E8590C" opacity="0.08"/>
        <circle cx="920" cy="160" r="3"   fill="#E8590C" opacity="0.07"/>
        <circle cx="1100" cy="500" r="2"  fill="#E8590C" opacity="0.07"/>
        <circle cx="380" cy="120" r="1.5" fill="#E8590C" opacity="0.09"/>
        <circle cx="760" cy="750" r="2"   fill="#ffffff" opacity="0.04"/>
      </svg>
    </div>
  )
}

function AppInner() {
  const { user, loading } = useAuth()
  const [session, setSession]         = useState(null)
  const [historySession, setHistorySession] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [lastResult, setLastResult]   = useState(null)
  const [update, setUpdate]           = useState(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [bridgeSyncStatus, setBridgeSyncStatus] = useState('disconnected')
  const [auditResults,   setAuditResults]   = useState(null)
  const [auditScore,     setAuditScore]     = useState(null)
  const [showAuditReport, setShowAuditReport] = useState(false)

  useEffect(() => {
    if (!user) return
    checkForUpdate().then(u => { if (u) setUpdate(u) })
  }, [user])

  // Patch Tag Once shortcuts and app.asar on every MARK launch (idempotent).
  // asar patch re-enabled in v5.0.0 — embeds correct fiber-based event counting
  // bridge directly into the collection app. Runs silently, skips if already patched.
  useEffect(() => {
    invoke('patch_tag_once_shortcuts')
      .then(r => console.log('[MARK] shortcut patch:', r))
      .catch(e => console.warn('[MARK] shortcut patch failed:', e))
    invoke('patch_tag_once_asar')
      .then(r => console.log('[MARK] asar patch:', r))
      .catch(e => console.warn('[MARK] asar patch failed:', e))
  }, [])

  if (loading) {
    return (
      <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)'}}>
        <div className="fade-in" style={{textAlign:'center'}}>
          <div style={{width:48,height:48,borderRadius:14,background:'var(--p2)',margin:'0 auto 16px',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 8px 24px rgba(232,89,12,0.4)'}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7l9 5 9-5-9-5z" fill="white"/>
              <path d="M3 12l9 5 9-5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'var(--t-1)',letterSpacing:-0.3}}>MARK</div>
          <div style={{fontSize:12,color:'var(--t-3)',marginTop:4}}>Loading…</div>
        </div>
      </div>
    )
  }

  if (!user) return (
    <PageTransition id="login">
      <LoginPage/>
    </PageTransition>
  )

  const pageId = showAuditReport ? 'audit-report' : session?.mode === 'audit' ? `audit-${session.sessionId}` : session ? `review-${session.sessionId}` : showHistory ? 'history' : 'setup'

  return (
    <>
      <BackgroundDecoration />
      <PageTransition id={pageId}>
        {showAuditReport && auditResults ? (
          <AuditReportPage
            results={auditResults}
            score={auditScore}
            session={session}
            onBack={() => setShowAuditReport(false)}
          />
        ) : session?.mode === 'audit' ? (
          <AuditPage
            session={session}
            onBack={() => setSession(null)}
            onFullReport={(results, score, sess) => {
              setAuditResults(results)
              setAuditScore(score)
              setShowAuditReport(true)
            }}
          />
        ) : session ? (
          <ReviewPage
            session={session}
            bridgeSyncStatus={bridgeSyncStatus}
            onBridgeSyncStatus={setBridgeSyncStatus}
            onDone={(result) => { setLastResult(result); setSession(null) }}
            onBack={() => setSession(null)}
          />
        ) : showHistory ? (
          <SessionHistoryPage onBack={() => { setShowHistory(false); setHistorySession(null) }} initialSession={historySession} />
        ) : (
          <SessionSetupPage
            onSessionStart={(s) => setSession(s)}
            lastResult={lastResult}
            onShowHistory={(session) => { setHistorySession(session || null); setShowHistory(true) }}
          />
        )}
      </PageTransition>

      {update && !updateDismissed && (
        <UpdateBanner
          update={update}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner/>
    </AuthProvider>
  )
}
