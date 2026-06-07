import { useState, useEffect, useRef } from 'react'
import { AuthProvider, useAuth } from './hooks/useAuth.jsx'
import { checkForUpdate } from './hooks/useUpdateCheck.js'
import LoginPage from './pages/LoginPage'
import SessionSetupPage from './pages/SessionSetupPage'
import ReviewPage from './pages/ReviewPage'
import SessionHistoryPage from './pages/SessionHistoryPage'
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

function AppInner() {
  const { user, loading } = useAuth()
  const [session, setSession]         = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [lastResult, setLastResult]   = useState(null)
  const [update, setUpdate]           = useState(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [bridgeSyncStatus, setBridgeSyncStatus] = useState('disconnected')

  useEffect(() => {
    if (!user) return
    checkForUpdate().then(u => { if (u) setUpdate(u) })
  }, [user])

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

  const pageId = session ? `review-${session.sessionId}` : showHistory ? 'history' : 'setup'

  return (
    <>
      <PageTransition id={pageId}>
        {session ? (
          <ReviewPage
            session={session}
            bridgeSyncStatus={bridgeSyncStatus}
            onBridgeSyncStatus={setBridgeSyncStatus}
            onDone={(result) => { setLastResult(result); setSession(null) }}
            onBack={() => setSession(null)}
          />
        ) : showHistory ? (
          <SessionHistoryPage onBack={() => setShowHistory(false)} />
        ) : (
          <SessionSetupPage
            onSessionStart={(s) => setSession(s)}
            lastResult={lastResult}
            onShowHistory={() => setShowHistory(true)}
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
