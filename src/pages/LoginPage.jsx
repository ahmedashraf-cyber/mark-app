import { useState } from 'react'
import { auth, signInWithEmailAndPassword } from '../firebase/config'

export default function LoginPage() {
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (err) {
      setLoading(false)
      const msgs = {
        'auth/invalid-credential':       'Incorrect email or password',
        'auth/user-not-found':           'No account found with this email',
        'auth/wrong-password':           'Incorrect password',
        'auth/too-many-requests':        'Too many attempts — try later',
        'auth/network-request-failed':   'No internet connection',
      }
      setError(msgs[err.code] || 'Login failed')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{background:'var(--bg)'}}>
      <div className="w-full max-w-sm fade-in">

        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-2">
            <div style={{
              width:44, height:44, borderRadius:12,
              background:'var(--p2)',
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L3 7l9 5 9-5-9-5z" fill="white"/>
                <path d="M3 12l9 5 9-5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                <path d="M3 17l9 5 9-5" stroke="white" strokeWidth="2" strokeLinecap="round" opacity=".6"/>
              </svg>
            </div>
            <div>
              <div style={{fontFamily:'Inter',fontWeight:900,fontSize:28,color:'var(--t-1)',letterSpacing:-1}}>MARK</div>
              <div style={{fontSize:11,color:'var(--t-3)',marginTop:-4,letterSpacing:2}}>REVIEW APP</div>
            </div>
          </div>
          <p style={{color:'var(--t-3)',fontSize:13,marginTop:8}}>Sign in with your FIELD account</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin}>
          <div className="card" style={{padding:24, display:'flex', flexDirection:'column', gap:14}}>

            <div>
              <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>EMAIL</label>
              <input
                className="mark-input"
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="ahmed@hudl.com"
                autoComplete="email"
                autoFocus
              />
            </div>

            <div>
              <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>PASSWORD</label>
              <input
                className="mark-input"
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div style={{
                background:'rgba(255,69,58,0.1)', border:'1px solid rgba(255,69,58,0.3)',
                borderRadius:8, padding:'8px 12px', fontSize:12, color:'#FF453A'
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="btn-orange"
              style={{padding:'12px 0',fontSize:14,marginTop:4}}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </div>
        </form>

        <p style={{textAlign:'center',color:'var(--t-3)',fontSize:11,marginTop:16}}>
          Use the same email and password as FIELD
        </p>
      </div>
    </div>
  )
}
