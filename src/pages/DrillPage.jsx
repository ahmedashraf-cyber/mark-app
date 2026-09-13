/**
 * DrillPage.jsx — DRILL entry point
 * ============================================================================
 * DRILL only. Does not touch TAG, Scout, Audit or Comparison.
 *
 * Creators see their quizzes plus a New quiz button.
 * Trainees see only quizzes ASSIGNED to them — an unassigned trainee sees an
 * empty list, which is intentional rather than a bug.
 */
import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { resolveDrillRole } from '../hooks/useAdmin.js'
import { roleForEmail, personForEmail } from '../utils/drillPeople'
import { readTab, flushQueue, pendingWriteCount } from '../utils/drillSheet'
import { TAB_QUIZZES, QUIZ_STATUS } from '../config/drillConfig'
import DrillBuilderPage from './DrillBuilderPage'

export default function DrillPage({ onBack }) {
  const { profile } = useAuth()
  const [role,    setRole]    = useState(null)   // null = resolving
  const [person,  setPerson]  = useState(null)
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [view,    setView]    = useState('list') // 'list' | 'build'

  // Resolve role from the Supervisors tab. Login identifies; role authorises.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await roleForEmail(profile?.email)
        const p = await personForEmail(profile?.email)
        if (!alive) return
        setRole(resolveDrillRole(profile, r))
        setPerson(p)
      } catch (e) {
        if (alive) { setError(e.message); setRole('none') }
      }
    })()
    return () => { alive = false }
  }, [profile?.email])

  // Retry any sheet writes parked while offline.
  useEffect(() => {
    if (pendingWriteCount() > 0) {
      flushQueue().then(r => {
        if (r.flushed) console.log(`[DRILL] flushed ${r.flushed} queued write(s)`)
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!role || role === 'none') { setLoading(false); return }
    let alive = true
    ;(async () => {
      try {
        const rows = await readTab(TAB_QUIZZES)
        if (!alive) return
        const mine = role === 'creator'
          ? rows
          : rows.filter(q =>
              q.status === QUIZ_STATUS.PUBLISHED &&
              String(q.assigned_hr_codes || '')
                .split('|').map(s => s.trim().toUpperCase())
                .includes((person?.hrCode || '').toUpperCase()))
        setQuizzes(mine)
      } catch (e) {
        if (alive) setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [role, person?.hrCode])

  if (view === 'build') {
    return <DrillBuilderPage
      person={person}
      onBack={() => { setView('list'); setLoading(true); setRole(r => r) }}
      onSaved={() => { setView('list') }}
    />
  }

  const Shell = ({ children }) => (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', color:'var(--t-1)', overflow:'hidden' }}>
      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 16px', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none',
          color:'var(--t-3)', cursor:'pointer', fontSize:11, padding:'4px 8px' }}>
          ← Back
        </button>
        <div style={{ width:1, height:20, background:'var(--b-1)' }}/>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800,
          color:'var(--p2)', letterSpacing:1.5, background:'rgba(232,89,12,0.12)',
          padding:'2px 8px', borderRadius:4 }}>DRILL</div>
        {role && role !== 'none' && (
          <span style={{ fontSize:10, color:'var(--t-3)' }}>
            {role === 'creator' ? 'Trainer' : 'Trainee'}
            {person?.hrCode ? ' · ' + person.hrCode : ''}
          </span>
        )}
        <div style={{ flex:1 }}/>
        {role === 'creator' && (
          <button className="btn-orange" style={{ padding:'6px 14px', fontSize:12 }}
            onClick={() => setView('build')}>
            + New quiz
          </button>
        )}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:24,
        maxWidth:860, margin:'0 auto', width:'100%' }}>
        {children}
      </div>
    </div>
  )

  if (role === null || loading) return (
    <Shell><div style={{ color:'var(--t-3)', fontSize:13 }}>Loading…</div></Shell>
  )

  if (role === 'none') return (
    <Shell>
      <div className="card" style={{ padding:24 }}>
        <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>No DRILL access</div>
        <div style={{ fontSize:12, color:'var(--t-3)', lineHeight:1.6 }}>
          DRILL is for trainers (Batch Supervisor or Batch Coordinator) and for
          collectors taking a quiz. Your account is neither, so there is nothing
          here for you.
          {error && <><br/><br/><span style={{ color:'#FF453A' }}>{error}</span></>}
        </div>
      </div>
    </Shell>
  )

  return (
    <Shell>
      {error && (
        <div style={{ background:'rgba(255,69,58,0.08)', border:'1px solid rgba(255,69,58,0.3)',
          borderRadius:8, padding:'10px 12px', fontSize:12, color:'#FF453A', marginBottom:16 }}>
          {error}
        </div>
      )}

      {!quizzes.length ? (
        <div className="card" style={{ padding:28, textAlign:'center' }}>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>
            {role === 'creator' ? 'No quizzes yet' : 'No quizzes assigned to you'}
          </div>
          <div style={{ fontSize:12, color:'var(--t-3)', lineHeight:1.6 }}>
            {role === 'creator'
              ? 'Create one from a Drive folder of clips. You tag the correct answer for each clip, then assign it to collectors.'
              : 'When a trainer assigns you a quiz it will appear here.'}
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {quizzes.map(q => (
            <div key={q.quiz_id} className="card" style={{ padding:16,
              display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>
                  {q.quiz_name || '(unnamed)'}
                </div>
                <div style={{ fontSize:11, color:'var(--t-3)' }}>
                  {q.clip_count || 0} clips · {q.time_limit_min || '—'} min ·
                  pass {q.pass_mark_percent || '—'}% ·
                  <span style={{ fontFamily:'JetBrains Mono,monospace' }}>
                    {' '}{(q.scope_event_ids || '').split('|').filter(Boolean).join(', ') || 'no scope'}
                  </span>
                </div>
              </div>
              <span style={{ fontSize:9, fontWeight:800, letterSpacing:1,
                padding:'3px 8px', borderRadius:4, textTransform:'uppercase',
                background: q.status === QUIZ_STATUS.PUBLISHED
                  ? 'rgba(48,209,88,0.12)' : 'rgba(255,214,10,0.12)',
                color: q.status === QUIZ_STATUS.PUBLISHED ? '#30D158' : '#FFD60A' }}>
                {q.status || 'draft'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}
