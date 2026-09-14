/**
 * RetakeRequests.jsx — the trainer's bell and approval panel
 * ============================================================================
 * DRILL only. Bell with a count in the top bar rather than a banner or a
 * buried screen: a banner blocks the work, a screen gets missed, and several
 * requests can arrive at once.
 *
 * The trainer sees who asked and their score — nothing more, by design.
 * Rejecting requires a reason, which the trainee then reads.
 */
import { useState, useEffect } from 'react'
import { watchRequestsFor, decideRequest } from '../utils/drillRetakes'

export default function RetakeRequests({ trainerEmail }) {
  const [requests, setRequests] = useState([])
  const [open,     setOpen]     = useState(false)
  const [busy,     setBusy]     = useState(null)
  const [reasons,  setReasons]  = useState({})
  const [err,      setErr]      = useState('')

  useEffect(() => watchRequestsFor(trainerEmail, setRequests), [trainerEmail])

  if (!trainerEmail) return null

  async function decide(r, approve) {
    setErr(''); setBusy(r.id)
    try {
      await decideRequest(r.id, approve, reasons[r.id])
      setReasons(x => { const n = { ...x }; delete n[r.id]; return n })
    } catch (e) { setErr(e.message) }
    finally { setBusy(null) }
  }

  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        title="Retake requests"
        style={{ background:'none', border:'none', cursor:'pointer', padding:'4px 6px',
          position:'relative', display:'flex', alignItems:'center' }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
            stroke={requests.length ? 'var(--p2)' : 'var(--t-3)'} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M13.7 21a2 2 0 0 1-3.4 0"
            stroke={requests.length ? 'var(--p2)' : 'var(--t-3)'} strokeWidth="1.8"
            strokeLinecap="round"/>
        </svg>
        {requests.length > 0 && (
          <span style={{ position:'absolute', top:0, right:0, minWidth:15, height:15,
            borderRadius:8, background:'var(--p2)', color:'#fff', fontSize:9,
            fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center',
            padding:'0 3px' }}>
            {requests.length}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position:'absolute', top:32, right:0, width:330, zIndex:50,
          background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:10,
          boxShadow:'0 10px 32px rgba(0,0,0,0.5)', padding:14 }}>
          <div style={{ fontSize:12, fontWeight:700, marginBottom:10 }}>
            Retake requests {requests.length ? `(${requests.length})` : ''}
          </div>

          {!requests.length && (
            <div style={{ fontSize:11, color:'var(--t-3)', lineHeight:1.5 }}>
              Nothing waiting. When a trainee fails and asks you for a retake it
              appears here.
            </div>
          )}

          {err && (
            <div style={{ fontSize:11, color:'#FF453A', marginBottom:8 }}>{err}</div>
          )}

          {requests.map(r => (
            <div key={r.id} style={{ borderTop:'1px solid var(--b-1)', paddingTop:10,
              marginTop:10 }}>
              <div style={{ fontSize:12, fontWeight:600 }}>
                {r.trainee_name || r.trainee_hr_code}
              </div>
              <div style={{ fontSize:10, color:'var(--t-3)', marginTop:2 }}>
                <span style={{ fontFamily:'JetBrains Mono,monospace' }}>{r.trainee_hr_code}</span>
                {' · '}{r.quiz_name}
              </div>
              <div style={{ fontSize:11, marginTop:6 }}>
                scored <span style={{ color:'#FF453A', fontWeight:700 }}>{r.score_percent}%</span>
                {' '}on attempt {r.attempt_number}
              </div>

              <input value={reasons[r.id] || ''}
                onChange={e => setReasons(x => ({ ...x, [r.id]: e.target.value }))}
                placeholder="Reason (required to reject)"
                style={{ width:'100%', marginTop:8, background:'var(--bg-3)',
                  border:'1px solid var(--b-1)', borderRadius:6, padding:'6px 9px',
                  fontSize:11, color:'var(--t-1)', outline:'none', boxSizing:'border-box' }}/>

              <div style={{ display:'flex', gap:6, marginTop:8 }}>
                <button disabled={busy === r.id} onClick={() => decide(r, false)}
                  style={{ flex:1, padding:'7px 0', fontSize:11, background:'transparent',
                    border:'1px solid rgba(255,69,58,0.4)', borderRadius:6,
                    color:'#FF453A', cursor:'pointer' }}>
                  Reject
                </button>
                <button disabled={busy === r.id} onClick={() => decide(r, true)}
                  style={{ flex:2, padding:'7px 0', fontSize:11, fontWeight:700,
                    background:'rgba(48,209,88,0.15)', border:'1px solid rgba(48,209,88,0.4)',
                    borderRadius:6, color:'#30D158', cursor:'pointer' }}>
                  {busy === r.id ? '…' : 'Approve retake'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
