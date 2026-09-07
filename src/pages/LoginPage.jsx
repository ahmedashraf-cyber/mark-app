import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  auth,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
} from '../firebase/config'
import { signInWithCredential } from 'firebase/auth'

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [gLoading, setGLoading] = useState(false)
  const [error,    setError]    = useState('')

  const EMAIL_ERRORS = {
    'auth/invalid-credential':     'Incorrect email or password',
    'auth/user-not-found':         'No account found with this email',
    'auth/wrong-password':         'Incorrect password',
    'auth/too-many-requests':      'Too many attempts — try later',
    'auth/network-request-failed': 'No internet connection',
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (err) {
      setLoading(false)
      setError(EMAIL_ERRORS[err.code] || 'Login failed')
    }
  }

  async function handleGoogle() {
    setError(''); setGLoading(true)
    try {
      // Use the existing Rust OAuth flow (opens browser, handles redirect)
      // Returns { id_token, access_token, ... }
      const tokenJson = await invoke('google_oauth_sign_in')
      const idToken = tokenJson.id_token
      if (!idToken) throw new Error('No id_token returned from Google sign-in')

      // Sign into Firebase with the Google id_token
      const credential = GoogleAuthProvider.credential(idToken)
      await signInWithCredential(auth, credential)
      // onAuthStateChanged in useAuth handles the rest
    } catch (err) {
      setGLoading(false)
      if (typeof err === 'string' && err.includes('cancelled')) return
      setError(typeof err === 'string' ? err : (err.message || 'Google sign-in failed'))
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{background:'var(--bg)'}}>
      <div className="w-full max-w-sm fade-in">

        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-2">
            <div style={{
              width:44, height:44, borderRadius:12, background:'var(--p2)',
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

        {/* Google sign-in */}
        <button
          onClick={handleGoogle}
          disabled={gLoading || loading}
          style={{
            width:'100%', padding:'12px 0', fontSize:14, fontWeight:600,
            background:'#fff', color:'#1f1f1f', border:'none', borderRadius:10,
            display:'flex', alignItems:'center', justifyContent:'center', gap:10,
            cursor: gLoading ? 'wait' : 'pointer', marginBottom:16,
            boxShadow:'0 1px 4px rgba(0,0,0,0.3)',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {!gLoading ? (
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-8 20-20 0-1.3-.1-2.7-.4-4z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4c-7.7 0-14.4 4.2-17.7 10.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.5 26.8 36 24 36c-5.2 0-9.7-2.9-11.3-7H6.2C9.5 39.7 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.8l6.2 5.2C41 35.5 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/>
            </svg>
          ) : (
            <div style={{width:18,height:18,border:'2px solid #1f1f1f',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
          )}
          {gLoading ? 'Opening browser…' : 'Continue with Google'}
        </button>

        {/* Divider */}
        <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:16}}>
          <div style={{flex:1, height:1, background:'var(--b-1)'}}/>
          <span style={{fontSize:11, color:'var(--t-3)'}}>or use FIELD account</span>
          <div style={{flex:1, height:1, background:'var(--b-1)'}}/>
        </div>

        {/* Email / password form */}
        <form onSubmit={handleLogin}>
          <div className="card" style={{padding:24, display:'flex', flexDirection:'column', gap:14}}>
            <div>
              <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>EMAIL</label>
              <input
                className="mark-input" type="email" value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="ahmed@hudl.com" autoComplete="email"
              />
            </div>
            <div>
              <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>PASSWORD</label>
              <input
                className="mark-input" type="password" value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••" autoComplete="current-password"
              />
            </div>
            {error && (
              <div style={{background:'rgba(255,69,58,0.1)',border:'1px solid rgba(255,69,58,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#FF453A'}}>
                {error}
              </div>
            )}
            <button type="submit" disabled={loading || gLoading || !email || !password}
              className="btn-orange" style={{padding:'12px 0',fontSize:14,marginTop:4}}>
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
