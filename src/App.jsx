import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './hooks/useAuth.jsx'
import { checkForUpdate } from './hooks/useUpdateCheck.js'
import LoginPage from './pages/LoginPage'
import SessionSetupPage from './pages/SessionSetupPage'
import ReviewPage from './pages/ReviewPage'
import UpdateBanner from './components/UpdateBanner'

function AppInner() {
  const { user, loading } = useAuth()
  const [session, setSession]         = useState(null)
  const [lastResult, setLastResult]   = useState(null)
  const [update, setUpdate]           = useState(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  // Persist bridge sync status across sessions — bridge in collection app
  // stays alive after Done, so the next session should inherit the connection.
  const [bridgeSyncStatus, setBridgeSyncStatus] = useState('disconnected')

  // Check for update on startup (only once, after login)
  useEffect(() => {
    if (!user) return
    checkForUpdate().then(u => { if (u) setUpdate(u) })
  }, [user])

  if (loading) {
    return (
      <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)'}}>
        <div style={{textAlign:'center'}}>
          <div style={{width:40,height:40,borderRadius:10,background:'var(--p2)',margin:'0 auto 16px',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7l9 5 9-5-9-5z" fill="white"/>
              <path d="M3 12l9 5 9-5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'var(--t-1)'}}>MARK</div>
          <div style={{fontSize:12,color:'var(--t-3)',marginTop:4}}>Loading…</div>
        </div>
      </div>
    )
  }

  if (!user) return <LoginPage/>

  return (
    <>
      {session ? (
        <ReviewPage
          session={session}
          bridgeSyncStatus={bridgeSyncStatus}
          onBridgeSyncStatus={setBridgeSyncStatus}
          onDone={(result) => { setLastResult(result); setSession(null) }}
          onBack={() => setSession(null)}
        />
      ) : (
        <SessionSetupPage
          onSessionStart={(s) => setSession(s)}
          lastResult={lastResult}
        />
      )}

      {/* Update notification banner */}
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
