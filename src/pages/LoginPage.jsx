import { useState } from 'react'
import { auth, signInWithEmailAndPassword } from '../firebase/config'

const TRAINERS_SHEET_ID  = '1bErhs3yQiJMl6PXRJFgH512wLgfm2dM6Cpj2owimLuw'
const SHEETS_API_KEY     = 'AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI'

// Searches both tabs for an HR code.
// Trainers tab:    A=HR Code, B=Name, C=?, D=?, E=Email, F=Password
// Supervisors tab: A=HR Code, B=Name, C=Role, D=Email,  E=Password
async function lookupHrCode(hrCode) {
  const code = hrCode.trim().replace(/\s+/g, '').toUpperCase()

  const tabs = [
    { name: 'Trainers',    range: 'A2:F', emailCol: 4, passCol: 5 },
    { name: 'Supervisors', range: 'A2:E', emailCol: 3, passCol: 4 },
  ]

  for (const tab of tabs) {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${TRAINERS_SHEET_ID}/values/${encodeURIComponent(tab.name + '!' + tab.range)}?key=${SHEETS_API_KEY}`
      const res  = await fetch(url)
      if (!res.ok) continue
      const data = await res.json()
      const rows = data.values || []
      const row  = rows.find(r => (r[0] || '').replace(/\s+/g,'').trim().toUpperCase() === code)
      if (row) {
        return {
          hrCode:   row[0],
          name:     row[1] || '',
          email:    (row[tab.emailCol] || '').replace(/\s+/g,'').trim().toLowerCase(),
          password: (row[tab.passCol]  || '').trim(),
          tab:      tab.name,
        }
      }
    } catch(e) { /* try next tab */ }
  }
  return null
}

export default function LoginPage() {
  const [mode,     setMode]     = useState('main')    // 'main' | 'hrcode'
  const [hrCode,   setHrCode]   = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
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

  async function handleHrLogin(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const user = await lookupHrCode(hrCode)
      if (!user)         throw new Error('HR Code not found — check the code and try again')
      if (!user.email)   throw new Error('No email set for this HR Code')
      if (!user.password) throw new Error('No password set for this HR Code')
      await signInWithEmailAndPassword(auth, user.email.trim(), user.password.trim())
    } catch (err) {
      setLoading(false)
      setError(EMAIL_ERRORS[err.code] || err.message || 'Sign-in failed')
    }
  }

  const Logo = () => (
    <div className="text-center mb-10">
      <div className="inline-flex items-center gap-3 mb-2">
        <div style={{width:44,height:44,borderRadius:12,background:'var(--p2)',display:'flex',alignItems:'center',justifyContent:'center'}}>
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
  )

  // ── HR Code screen ─────────────────────────────────────────────────────────
  if (mode === 'hrcode') return (
    <div className="min-h-screen flex items-center justify-center" style={{background:'var(--bg)'}}>
      <div className="w-full max-w-sm fade-in">
        <Logo/>
        <form onSubmit={handleHrLogin}>
          <div className="card" style={{padding:24,display:'flex',flexDirection:'column',gap:14}}>
            <div>
              <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>HR CODE</label>
              <input
                className="mark-input"
                type="text"
                value={hrCode}
                onChange={e => { setHrCode(e.target.value); setError('') }}
                placeholder="e.g. A-1234"
                autoComplete="off"
                autoFocus
                style={{fontFamily:'JetBrains Mono,monospace',letterSpacing:1}}
              />
            </div>
            {error && (
              <div style={{background:'rgba(255,69,58,0.1)',border:'1px solid rgba(255,69,58,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#FF453A'}}>
                {error}
              </div>
            )}
            <button type="submit" disabled={loading || !hrCode.trim()}
              className="btn-orange" style={{padding:'12px 0',fontSize:14,marginTop:4}}>
              {loading ? 'Looking up…' : 'Sign In with HR Code'}
            </button>
            <button type="button"
              onClick={() => { setMode('main'); setError(''); setHrCode('') }}
              style={{background:'none',border:'none',color:'var(--t-3)',fontSize:12,cursor:'pointer',textAlign:'center'}}>
              ← Back
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  // ── Main login screen ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center" style={{background:'var(--bg)'}}>
      <div className="w-full max-w-sm fade-in">
        <Logo/>

        {/* HR Code sign-in */}
        <button
          onClick={() => { setMode('hrcode'); setError('') }}
          disabled={loading}
          style={{
            width:'100%', padding:'12px 0', fontSize:14, fontWeight:600,
            background:'var(--bg-2)', color:'var(--t-1)',
            border:'1px solid var(--b-1)', borderRadius:10,
            display:'flex', alignItems:'center', justifyContent:'center', gap:10,
            cursor:'pointer', marginBottom:16,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="8" width="18" height="13" rx="2" stroke="var(--p2)" strokeWidth="1.8"/>
            <path d="M8 8V6a4 4 0 0 1 8 0v2" stroke="var(--p2)" strokeWidth="1.8" strokeLinecap="round"/>
            <circle cx="12" cy="14" r="1.5" fill="var(--p2)"/>
            <line x1="12" y1="15.5" x2="12" y2="18" stroke="var(--p2)" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          Sign in with HR Code
        </button>

        {/* Divider */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
          <div style={{flex:1,height:1,background:'var(--b-1)'}}/>
          <span style={{fontSize:11,color:'var(--t-3)'}}>or use FIELD account</span>
          <div style={{flex:1,height:1,background:'var(--b-1)'}}/>
        </div>

        {/* Email / password form */}
        <form onSubmit={handleLogin}>
          <div className="card" style={{padding:24,display:'flex',flexDirection:'column',gap:14}}>
            <div>
              <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>EMAIL</label>
              <input className="mark-input" type="email" value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="ahmed@hudl.com" autoComplete="email"/>
            </div>
            <div>
              <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>PASSWORD</label>
              <input className="mark-input" type="password" value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="••••••••" autoComplete="current-password"/>
            </div>
            {error && (
              <div style={{background:'rgba(255,69,58,0.1)',border:'1px solid rgba(255,69,58,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#FF453A'}}>
                {error}
              </div>
            )}
            <button type="submit" disabled={loading || !email || !password}
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
