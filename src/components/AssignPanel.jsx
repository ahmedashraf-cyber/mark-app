/**
 * AssignPanel.jsx — assign a published quiz, and reassign to someone who finished
 * ============================================================================
 * DRILL only. Opened from a published quiz card.
 *
 * Adding is additive: existing assignments and completed results are never
 * touched. A code already on the list is reported, not duplicated — a second
 * row would quietly grant an extra attempt.
 *
 * Reassign keeps the earlier result. It grants one further attempt, scored
 * against the CURRENT answer key, and both attempts stay in history with the
 * quiz_version each actually faced.
 */
import { useState, useEffect } from 'react'
import { assignmentStatus, assignTrainees, reassign } from '../utils/drillAssignments'
import { setAssignmentReview } from '../utils/adminSheet'
import { loadTrainees } from '../utils/drillPeople'

const STATUS = {
  not_started: { label:'not started', c:'var(--t-3)' },
  in_progress: { label:'in progress', c:'#FFD60A' },
  completed:   { label:'completed',   c:'#FF9500' },
  passed:      { label:'passed',      c:'#30D158' },
}

export default function AssignPanel({ quiz, assignedBy, onClose }) {
  const [roster,   setRoster]   = useState(null)
  const [trainees, setTrainees] = useState([])
  const [search,   setSearch]   = useState('')
  const [picked,   setPicked]   = useState(new Set())
  const [paste,    setPaste]    = useState('')
  const [msg,      setMsg]      = useState('')
  const [err,      setErr]      = useState('')
  const [busy,     setBusy]     = useState(false)
  const [confirm,  setConfirm]  = useState(null)   // hrCode awaiting confirmation

  const refresh = async () => {
    try {
      setRoster(await assignmentStatus({
        quizId: quiz.quiz_id, quizRow: quiz, assignedBy,
      }))
    } catch (e) { setErr(e.message) }
  }

  useEffect(() => {
    refresh()
    loadTrainees().then(setTrainees).catch(e => setErr(e.message))
  }, [quiz.quiz_id])

  const assignedCodes = new Set((roster || []).map(r => r.hrCode))
  const available = trainees.filter(t => {
    if (assignedCodes.has(String(t.hrCode).toUpperCase())) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return t.name.toLowerCase().includes(q) || t.hrCode.toLowerCase().includes(q)
  })

  async function doAssign(codes) {
    if (!codes.length) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await assignTrainees({
        quizId: quiz.quiz_id, quizRow: quiz, hrCodes: codes,
        trainees, assignedBy,
      })
      const parts = []
      if (r.added.length)   parts.push(`${r.added.length} assigned`)
      if (r.already.length) parts.push(`already assigned: ${r.already.join(', ')}`)
      if (r.unknown.length) parts.push(`not a collector: ${r.unknown.join(', ')}`)
      setMsg(parts.join(' · '))
      setPicked(new Set()); setPaste('')
      await refresh()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function doReassign(row) {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await reassign({
        quiz,
        trainee: { hrCode: row.hrCode, name: row.name },
        attemptsMade: row.attempts,
        scorePercent: row.lastScore,
        approvedBy: assignedBy,
      })
      setMsg(`${row.hrCode} can retake this quiz. Their previous result is kept.`
        + (r?.reviewCleared ? ' Their review access was switched off, so they cannot see the answers during the new attempt.' : ''))
      // the retake IS granted either way; this only says if the per-trainee flag could not be cleared
      if (r?.reviewError) setErr(`The retake was granted, but ${row.hrCode}'s review access could not be switched off (${r.reviewError}). They still cannot see the answers during the new attempt, but it would return afterwards.`)
      setConfirm(null)
      await refresh()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  // Allow / remove ONE trainee's access to the answers. Allowing it closes their retakes (they can read the key), so say so.
  async function doToggleReview(row) {
    const next = row.reviewAllowed ? '0' : '1'
    const ask = next === '1'
      ? `Let ${row.name || row.hrCode} see the answers of their attempts on "${quiz.quiz_name}"?\n\nOnce they can read the answers they cannot start another attempt. To give them one, use Reassign.`
      : `Stop ${row.name || row.hrCode} seeing the answers on "${quiz.quiz_name}"?\n\nThey can retake again if a retake was approved for them and not used.`
    if (!window.confirm(ask)) return
    setBusy(true); setErr(''); setMsg('')
    try {
      await setAssignmentReview({ quizId: quiz.quiz_id, quizName: quiz.quiz_name, hrCode: row.hrCode, value: next, changedBy: assignedBy })
      setMsg(next === '1' ? `${row.hrCode} can now see the answers. Retakes are closed for them.` : `${row.hrCode} can no longer see the answers.`)
      await refresh()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const input = {
    background:'var(--bg-3)', border:'1px solid var(--b-1)', borderRadius:7,
    padding:'8px 11px', fontSize:12, color:'var(--t-1)', outline:'none',
    boxSizing:'border-box',
  }
  const ghost = {
    padding:'8px 12px', fontSize:11, background:'transparent',
    border:'1px solid var(--b-1)', borderRadius:6, color:'var(--t-3)',
    cursor:'pointer', whiteSpace:'nowrap',
  }

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:60,
      background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center',
      justifyContent:'center', padding:24 }}>
      <div onClick={e => e.stopPropagation()} className="card"
        style={{ width:'100%', maxWidth:640, maxHeight:'86vh', padding:22,
          display:'flex', flexDirection:'column' }}>

        <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:4 }}>
          <div style={{ fontSize:15, fontWeight:700 }}>Assign</div>
          <div style={{ fontSize:12, color:'var(--t-3)', flex:1, overflow:'hidden',
            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{quiz.quiz_name}</div>
          <button onClick={onClose} style={{ background:'none', border:'none',
            color:'var(--t-3)', fontSize:16, cursor:'pointer', lineHeight:1 }}>×</button>
        </div>

        {err && <div style={{ fontSize:11, color:'#FF453A', marginBottom:8 }}>{err}</div>}
        {msg && <div style={{ fontSize:11, color:'var(--t-2)', marginBottom:8 }}>{msg}</div>}

        {/* current roster */}
        <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
          textTransform:'uppercase', margin:'10px 0 6px' }}>
          Currently assigned {roster ? `(${roster.length})` : ''}
        </div>
        <div style={{ overflowY:'auto', maxHeight:230, marginBottom:14 }}>
          {roster === null && <div style={{ fontSize:12, color:'var(--t-3)' }}>Loading…</div>}
          {roster?.length === 0 && (
            <div style={{ fontSize:12, color:'var(--t-3)' }}>Nobody yet.</div>
          )}
          {roster?.map(r => {
            const st = STATUS[r.status] || STATUS.not_started
            return (
              <div key={r.hrCode} style={{ borderBottom:'1px solid rgba(255,255,255,0.05)',
                padding:'8px 0' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11,
                    color:'var(--t-3)', width:72 }}>{r.hrCode}</span>
                  <span style={{ flex:1, fontSize:12, color:'var(--t-2)', overflow:'hidden',
                    textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name || '—'}</span>
                  {r.bestScore != null && (
                    <span style={{ fontSize:11, fontWeight:700,
                      color: r.passed ? '#30D158' : '#FF453A' }}>{r.bestScore}%</span>
                  )}
                  {r.attempts > 1 && (
                    <span style={{ fontSize:10, color:'var(--t-3)' }}>×{r.attempts}</span>
                  )}
                  <span style={{ fontSize:9, fontWeight:700, letterSpacing:0.6,
                    color:st.c, background:st.c + '18', padding:'2px 7px',
                    borderRadius:4, whiteSpace:'nowrap' }}>{st.label}</span>
                  {r.canReassign && confirm !== r.hrCode && (
                    <button onClick={() => setConfirm(r.hrCode)} style={{ ...ghost, padding:'4px 9px' }}>
                      Reassign
                    </button>
                  )}
                  {/* nothing to review until they have finished an attempt, and a pass already sees the answers */}
                  {r.attempts > 0 && !r.passed && (
                    <button data-testid="review-toggle" disabled={busy} onClick={() => doToggleReview(r)} style={{ ...ghost, padding:'4px 9px' }}>
                      {r.reviewAllowed ? 'Remove review' : 'Allow review'}
                    </button>
                  )}
                  {r.reviewAllowed && !r.passed && (
                    <span style={{ fontSize:9, color:'#64D2FF' }}>can see answers</span>
                  )}
                  {r.grantsHeld > r.attempts - 1 && !r.canReassign && r.attempts > 0 && (
                    <span style={{ fontSize:9, color:'#30D158' }}>retake open</span>
                  )}
                </div>

                {confirm === r.hrCode && (
                  <div style={{ background:'rgba(255,214,10,0.07)',
                    border:'1px solid rgba(255,214,10,0.3)', borderRadius:7,
                    padding:'10px 12px', marginTop:8 }}>
                    <div style={{ fontSize:11, color:'var(--t-2)', lineHeight:1.6, marginBottom:10 }}>
                      This will allow <b>{r.name || r.hrCode}</b> to retake this quiz.
                      Their previous result is kept in history. The retake is scored
                      against the current answer key.
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={() => setConfirm(null)} style={{ ...ghost, flex:1 }}>
                        Cancel
                      </button>
                      <button disabled={busy} onClick={() => doReassign(r)}
                        style={{ flex:2, padding:'8px 0', fontSize:11, fontWeight:700,
                          background:'rgba(255,214,10,0.15)',
                          border:'1px solid rgba(255,214,10,0.5)', borderRadius:6,
                          color:'#FFD60A', cursor:'pointer' }}>
                        {busy ? '…' : 'Allow retake'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* add more */}
        <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
          textTransform:'uppercase', marginBottom:6 }}>Add trainees</div>

        <div style={{ display:'flex', gap:8, marginBottom:8 }}>
          <input style={{ ...input, flex:1 }} value={search}
            placeholder="Search name or HR code…"
            onChange={e => setSearch(e.target.value)}/>
          <button style={ghost} disabled={busy || !available.length}
            onClick={() => setPicked(new Set(available.map(t => t.hrCode)))}>
            Select all{search.trim() ? ' shown' : ''} ({available.length})
          </button>
        </div>

        <div style={{ display:'flex', gap:8, marginBottom:10 }}>
          <input style={{ ...input, flex:1, fontFamily:'JetBrains Mono,monospace', fontSize:11 }}
            value={paste} placeholder="Or paste HR codes: A-1234, A-1235 …"
            onChange={e => setPaste(e.target.value)}/>
          <button style={ghost} disabled={busy || !paste.trim()}
            onClick={() => doAssign(paste.split(/[\s,;]+/).filter(Boolean))}>
            Add pasted
          </button>
        </div>

        <div style={{ overflowY:'auto', maxHeight:180, marginBottom:12 }}>
          {!available.length && (
            <div style={{ fontSize:11, color:'var(--t-3)' }}>
              {trainees.length ? 'Everyone matching is already assigned.' : 'Loading collectors…'}
            </div>
          )}
          {available.map(t => {
            const on = picked.has(t.hrCode)
            return (
              <div key={t.hrCode} onClick={() => setPicked(p => {
                  const n = new Set(p); n.has(t.hrCode) ? n.delete(t.hrCode) : n.add(t.hrCode); return n })}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 7px',
                  borderRadius:6, cursor:'pointer',
                  background: on ? 'rgba(232,89,12,0.1)' : 'transparent' }}>
                <div style={{ width:15, height:15, borderRadius:4, flexShrink:0,
                  background: on ? 'var(--p2)' : 'transparent',
                  border:`2px solid ${on ? 'var(--p2)' : 'var(--b-2)'}`,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {on && <span style={{ color:'#000', fontSize:9, fontWeight:900 }}>✓</span>}
                </div>
                <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11,
                  color:'var(--t-3)', width:72 }}>{t.hrCode}</span>
                <span style={{ flex:1, fontSize:12, color:'var(--t-2)' }}>{t.name}</span>
              </div>
            )
          })}
        </div>

        <button className="btn-orange" style={{ width:'100%', padding:'11px 0', fontSize:13 }}
          disabled={busy || !picked.size}
          onClick={() => doAssign([...picked])}>
          {busy ? 'Assigning…'
            : picked.size ? `Assign ${picked.size} trainee${picked.size === 1 ? '' : 's'}`
            : 'Select trainees to assign'}
        </button>
      </div>
    </div>
  )
}
