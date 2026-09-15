/**
 * DrillPage.jsx — DRILL entry point and journey orchestrator
 * ============================================================================
 * DRILL only. Owns the view switching: list -> build | take -> results.
 *
 * Role decides everything. Creators see their quizzes, the New quiz button and
 * the retake bell. Trainees see only quizzes ASSIGNED to them — an unassigned
 * trainee seeing an empty list is intentional, not a fault.
 */
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { resolveDrillRole } from '../hooks/useAdmin.js'
import { roleForEmail, personForEmail, loadCreators } from '../utils/drillPeople'
import { readTab, readTabs, appendOrQueue, flushQueue, pendingWriteCount, syncHeaders } from '../utils/drillSheet'
import {
  TAB_QUIZZES, TAB_CLIPS, TAB_ANSWERS, TAB_SESSIONS, TAB_ANSWERS_GIVEN, TAB_TRAINEE_LOG,
  SESSIONS_COLUMNS, ANSWERS_GIVEN_COLUMNS, TRAINEE_LOG_COLUMNS,
  QUIZ_STATUS, SESSION_STATUS,
} from '../config/drillConfig'
// FIELD's formatter, not a second one. Produces MM:SS.mmm (6941 -> 00:06.941).
import { msToReadable } from '../utils/fieldSheetSync'
import { createSession, loadSession, clearSession, toScoringInput } from '../utils/drillSession'
import { scoreAttempt, toAnswerGivenRows } from '../utils/drillScoring'
import { canStart, requestRetake, watchMyRequests } from '../utils/drillRetakes'
import DrillBuilderPage from './DrillBuilderPage'
import DrillSessionPage from './DrillSessionPage'
import DrillResultsPage from './DrillResultsPage'
import RetakeRequests from '../components/RetakeRequests'
import AssignPanel from '../components/AssignPanel'
import { quizIdsForTrainee } from '../utils/drillAssignments'

export default function DrillPage({ onBack }) {
  const { profile } = useAuth()
  const [role,    setRole]    = useState(null)
  const [person,  setPerson]  = useState(null)
  const [quizzes, setQuizzes] = useState([])
  const [sessions,setSessions]= useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [view,    setView]    = useState('list')
  const [active,  setActive]  = useState(null)   // { session, quiz, clipRows, keyRows }
  const [result,  setResult]  = useState(null)
  const [myReqs,  setMyReqs]  = useState([])
  const [creators,setCreators]= useState([])
  const [busy,    setBusy]    = useState('')
  const [assignFor, setAssignFor] = useState(null)   // quiz row being assigned

  // role: login identifies, the Supervisors tab authorises
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [r, p] = await Promise.all([
          roleForEmail(profile?.email), personForEmail(profile?.email),
        ])
        if (!alive) return
        setRole(resolveDrillRole(profile, r)); setPerson(p)
      } catch (e) { if (alive) { setError(e.message); setRole('none') } }
    })()
    return () => { alive = false }
  }, [profile?.email])

  useEffect(() => {
    if (pendingWriteCount() > 0) flushQueue().catch(() => {})
    // Keep row 1 of every tab in step with the column lists. Columns get added
    // as DRILL grows, and appendRows writes by position, so a stale header row
    // would put data under the wrong names. Cheap, idempotent, row 1 only.
    syncHeaders().catch(e => console.warn('[DRILL] header sync:', e.message))
  }, [])

  useEffect(() => {
    if (!person?.hrCode) return
    return watchMyRequests(person.hrCode, setMyReqs)
  }, [person?.hrCode])

  const refresh = useCallback(async () => {
    if (!role || role === 'none') { setLoading(false); return }
    try {
      const { [TAB_QUIZZES]: qs, [TAB_SESSIONS]: ss } =
        await readTabs([TAB_QUIZZES, TAB_SESSIONS])
      if (role === 'creator') {
        setQuizzes(qs)
      } else {
        // assignments live in their own tab now; quizIdsForTrainee still reads
        // the legacy assigned_hr_codes cell for quizzes not yet migrated
        const mineIds = await quizIdsForTrainee(person?.hrCode)
        setQuizzes(qs.filter(q =>
          q.status === QUIZ_STATUS.PUBLISHED && mineIds.has(q.quiz_id)))
      }
      setSessions(ss)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [role, person?.hrCode])

  useEffect(() => { refresh() }, [refresh])

  // an attempt left in progress — resume it, or record it void if the 24h
  // window has passed, because it counts as a failed attempt either way
  useEffect(() => {
    if (!person?.hrCode || !quizzes.length) return
    const found = loadSession()
    if (!found) return
    if (found.expired) {
      clearSession()
      setError('Your last attempt expired — you had 24 hours to finish it. It counts as a failed attempt.')
      return
    }
    const s = found.session
    if (String(s.trainee_hr_code).toUpperCase() !== String(person.hrCode).toUpperCase()) {
      clearSession(); return
    }
    const quiz = quizzes.find(q => q.quiz_id === s.quiz_id)
    if (!quiz) { clearSession(); return }
    ;(async () => {
      const { [TAB_CLIPS]: clipRows, [TAB_ANSWERS]: keyRows } =
        await readTabs([TAB_CLIPS, TAB_ANSWERS])
      setActive({
        session: s, quiz,
        clipRows: clipRows.filter(c => c.quiz_id === quiz.quiz_id),
        keyRows:  keyRows.filter(a => a.quiz_id === quiz.quiz_id),
      })
      setView('take')
    })()
  }, [person?.hrCode, quizzes.length])

  async function startQuiz(quiz, asTestRun) {
    setBusy(quiz.quiz_id); setError('')
    try {
      if (!asTestRun) {
        const gate = await canStart({ quiz, trainee: person, sessions })
        if (!gate.allowed) {
          setError(
            gate.reason === 'passed'   ? 'You have already passed this quiz.' :
            gate.reason === 'pending'  ? 'Your retake request is waiting for a trainer.' :
            gate.reason === 'rejected' ? `Retake refused: ${gate.rejectionReason}` :
            'You need a trainer to approve a retake before trying again.')
          return
        }
      }
      const { [TAB_CLIPS]: allClips, [TAB_ANSWERS]: allKeys } =
        await readTabs([TAB_CLIPS, TAB_ANSWERS])
      const clipRows = allClips.filter(c =>
        c.quiz_id === quiz.quiz_id && String(c.is_excluded) !== '1' && String(c.is_missing) !== '1')
      if (!clipRows.length) { setError('This quiz has no usable clips.'); return }

      const mine = sessions.filter(s => s.quiz_id === quiz.quiz_id &&
        String(s.trainee_hr_code || '').toUpperCase() === String(person?.hrCode || '').toUpperCase() &&
        String(s.is_test_run) !== '1')
      const session = createSession({
        quiz, clips: clipRows, trainee: person, attemptNumber: mine.length + 1,
      })
      session.is_test_run = asTestRun ? 1 : 0
      setActive({ session, quiz, clipRows, keyRows: allKeys.filter(a => a.quiz_id === quiz.quiz_id) })
      setView('take')
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }

  /** Score, persist, show. Firestore-less: the sheet is the store, queued on failure. */
  async function handleFinish(finished) {
    const { quiz, clipRows, keyRows } = active
    const input = toScoringInput(finished, clipRows, keyRows)
    const scored = scoreAttempt({ ...input, passMarkPercent: quiz.pass_mark_percent })
    const timeTakenMs = Number(finished.elapsed_ms || 0)

    setResult({ ...scored, attemptNumber: finished.attempt_number,
                status: finished.status, timeTakenMs })
    setView('results')
    clearSession()

    // writes never block the score being shown — appendOrQueue retries later
    const isTest = String(finished.is_test_run) === '1'
    await appendOrQueue(TAB_SESSIONS, [{
      result_id: finished.result_id, quiz_id: quiz.quiz_id,
      quiz_version: finished.quiz_version,
      trainee_hr_code: finished.trainee_hr_code, trainee_email: finished.trainee_email,
      attempt_number: finished.attempt_number,
      started_at: new Date(finished.started_at).toISOString(),
      finished_at: new Date(finished.finished_at || Date.now()).toISOString(),
      score_percent: scored.scorePercent, passed: scored.passed ? 1 : 0,
      total_events: scored.totalEvents,
      correct_count: scored.counts.correct || 0,
      missed_count: scored.counts.missed || 0,
      not_needed_count: scored.counts.not_needed_event || 0,
      wrong_event_count: scored.counts.wrong_event || 0,
      wrong_team_count: scored.counts.wrong_team || 0,
      wrong_timestamp_count: scored.counts.wrong_timestamp || 0,
      wrong_extra_count: scored.counts.wrong_extra || 0,
      total_time_taken_ms: timeTakenMs,
      total_time_taken_readable: msToReadable(timeTakenMs),
      is_test_run: isTest ? 1 : 0, status: finished.status,
    }], SESSIONS_COLUMNS)

    // toAnswerGivenRows lives in drillScoring beside the code that built these
    // rows, because it has to know that scoreClip stores each side as
    // { code, team, at, attrs } on `key` and `tag`. Spreading the rows straight
    // in here is what left every trainee_* and correct_* column blank.
    await appendOrQueue(
      TAB_ANSWERS_GIVEN,
      toAnswerGivenRows(finished.result_id, scored.rows, finished.clip_times || {}),
      ANSWERS_GIVEN_COLUMNS)

    // creators testing their own quiz are excluded from the profile log
    if (!isTest) {
      await appendOrQueue(TAB_TRAINEE_LOG, [{
        trainee_hr_code: finished.trainee_hr_code,
        trainee_email: finished.trainee_email,
        session_type: 'quiz',
        session_id_or_quiz_id: quiz.quiz_id,
        session_date: new Date().toISOString(),
        match_id_or_quiz_name: quiz.quiz_name,
        scope: quiz.scope_event_ids,
        score_percent: scored.scorePercent,
        total_events_or_clips: scored.totalEvents,
        correct_count: scored.counts.correct || 0,
        missed_count: scored.counts.missed || 0,
        wrong_event_count: scored.counts.wrong_event || 0,
        wrong_extra_count: scored.counts.wrong_extra || 0,
        time_taken_ms: timeTakenMs,
        time_taken_readable: msToReadable(timeTakenMs),
        version: finished.quiz_version,
      }], TRAINEE_LOG_COLUMNS)
    }
    refresh()
  }

  async function handleRequestRetake() {
    if (!creators.length) {
      try { setCreators(await loadCreators()) } catch (e) { setError(e.message); return }
    }
    setView('request')
  }

  // ── sub-views ──
  if (view === 'build') return (
    <DrillBuilderPage person={person}
      onBack={() => setView('list')}
      onSaved={() => { setView('list'); refresh() }}/>
  )

  if (view === 'take' && active) return (
    <DrillSessionPage session={active.session} clipRows={active.clipRows}
      onFinish={handleFinish}
      onAbandon={() => { clearSession(); setActive(null); setView('list') }}/>
  )

  if (view === 'results' && result) return (
    <DrillResultsPage result={result} quiz={active?.quiz} clipRows={active?.clipRows || []}
      onDone={() => { setResult(null); setActive(null); setView('list') }}
      onRequestRetake={handleRequestRetake}/>
  )

  if (view === 'request') return (
    <RequestView creators={creators} quiz={active?.quiz} person={person}
      result={result}
      onCancel={() => setView('results')}
      onSent={() => { setView('list'); setResult(null); setActive(null) }}/>
  )

  // ── list ──
  const Shell = ({ children }) => (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', color:'var(--t-1)', overflow:'hidden' }}>
      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 16px', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none',
          color:'var(--t-3)', cursor:'pointer', fontSize:11, padding:'4px 8px' }}>← Back</button>
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
        {role === 'creator' && <RetakeRequests trainerEmail={person?.email}/>}
        {role === 'creator' && (
          <button className="btn-orange" style={{ padding:'6px 14px', fontSize:12 }}
            onClick={() => setView('build')}>+ New quiz</button>
        )}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:24, maxWidth:880, margin:'0 auto', width:'100%' }}>
        {children}
      </div>
    </div>
  )

  if (role === null || loading) return (
    <Shell><div style={{ color:'var(--t-3)', fontSize:13 }}>Loading…</div></Shell>)

  if (role === 'none') return (
    <Shell>
      <div className="card" style={{ padding:24 }}>
        <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>No DRILL access</div>
        <div style={{ fontSize:12, color:'var(--t-3)', lineHeight:1.6 }}>
          DRILL is for trainers (Batch Supervisor or Batch Coordinator) and for
          collectors taking a quiz. Your account is neither.
          {error && <><br/><br/><span style={{ color:'#FF453A' }}>{error}</span></>}
        </div>
      </div>
    </Shell>
  )

  const pendingReq = myReqs.find(r => r.status === 'pending')
  const rejected   = myReqs.find(r => r.status === 'rejected')
  const approved   = myReqs.find(r => r.status === 'approved')

  return (
    <Shell>
      {error && (
        <div style={{ background:'rgba(255,69,58,0.08)', border:'1px solid rgba(255,69,58,0.3)',
          borderRadius:8, padding:'10px 12px', fontSize:12, color:'#FF453A', marginBottom:14 }}>
          {error}
        </div>
      )}

      {role === 'trainee' && pendingReq && (
        <Banner color="#FFD60A">
          Your retake request for <b>{pendingReq.quiz_name}</b> is waiting for a trainer.
        </Banner>
      )}
      {role === 'trainee' && approved && (
        <Banner color="#30D158">
          Retake approved for <b>{approved.quiz_name}</b> — you can take it again now.
        </Banner>
      )}
      {role === 'trainee' && rejected && !pendingReq && !approved && (
        <Banner color="#FF453A">
          Retake refused for <b>{rejected.quiz_name}</b>: {rejected.reason}
        </Banner>
      )}

      {!quizzes.length ? (
        <div className="card" style={{ padding:28, textAlign:'center' }}>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>
            {role === 'creator' ? 'No quizzes yet' : 'No quizzes assigned to you'}
          </div>
          <div style={{ fontSize:12, color:'var(--t-3)', lineHeight:1.6 }}>
            {role === 'creator'
              ? 'Create one from a Drive folder of clips. Tag the correct answer for each clip, then assign it to collectors.'
              : 'When a trainer assigns you a quiz it will appear here.'}
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {quizzes.map(q => {
            const mine = sessions.filter(s => s.quiz_id === q.quiz_id &&
              String(s.trainee_hr_code || '').toUpperCase() === String(person?.hrCode || '').toUpperCase() &&
              String(s.is_test_run) !== '1')
            const best = mine.reduce((b, s) =>
              Math.max(b, Number(s.score_percent || 0)), 0)
            const hasPassed = mine.some(s => String(s.passed) === '1')
            return (
              <div key={q.quiz_id} className="card" style={{ padding:16,
                display:'flex', alignItems:'center', gap:14 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>
                    {q.quiz_name || '(unnamed)'}
                  </div>
                  <div style={{ fontSize:11, color:'var(--t-3)' }}>
                    {q.clip_count || 0} clips · {q.time_limit_min || '—'} min ·
                    pass {q.pass_mark_percent || '—'}%
                    {mine.length > 0 && ` · ${mine.length} attempt${mine.length === 1 ? '' : 's'}, best ${best}%`}
                  </div>
                </div>
                {hasPassed && (
                  <span style={{ fontSize:9, fontWeight:800, letterSpacing:1, padding:'3px 8px',
                    borderRadius:4, background:'rgba(48,209,88,0.12)', color:'#30D158' }}>PASSED</span>
                )}
                {role === 'creator' && (
                  <span style={{ fontSize:9, fontWeight:800, letterSpacing:1, padding:'3px 8px',
                    borderRadius:4, textTransform:'uppercase',
                    background: q.status === QUIZ_STATUS.PUBLISHED ? 'rgba(48,209,88,0.12)' : 'rgba(255,214,10,0.12)',
                    color: q.status === QUIZ_STATUS.PUBLISHED ? '#30D158' : '#FFD60A' }}>
                    {q.status || 'draft'}
                  </span>
                )}
                {role === 'creator' && q.status === QUIZ_STATUS.PUBLISHED && (
                  <button style={{ padding:'7px 13px', fontSize:12, background:'transparent',
                    border:'1px solid var(--b-1)', borderRadius:7, color:'var(--t-2)',
                    cursor:'pointer' }}
                    onClick={() => setAssignFor(q)}>
                    Assign
                  </button>
                )}
                {q.status === QUIZ_STATUS.PUBLISHED && !hasPassed && (
                  <button className="btn-orange" style={{ padding:'7px 14px', fontSize:12 }}
                    disabled={busy === q.quiz_id}
                    onClick={() => startQuiz(q, role === 'creator')}>
                    {busy === q.quiz_id ? '…'
                      : role === 'creator' ? 'Test it'
                      : mine.length ? 'Retake' : 'Start'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {assignFor && (
        <AssignPanel quiz={assignFor} assignedBy={person?.email}
          onClose={() => { setAssignFor(null); refresh() }}/>
      )}
    </Shell>
  )
}

function Banner({ color, children }) {
  return (
    <div style={{ background:color + '14', border:`1px solid ${color}55`, borderRadius:8,
      padding:'10px 14px', fontSize:12, color:'var(--t-1)', marginBottom:12, lineHeight:1.5 }}>
      {children}
    </div>
  )
}

/** Pick a trainer and send the request. */
function RequestView({ creators, quiz, person, result, onCancel, onSent }) {
  const [trainer, setTrainer] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function send() {
    setBusy(true); setErr('')
    try {
      await requestRetake({
        quiz, trainee: person, trainerEmail: trainer,
        attemptNumber: result?.attemptNumber || 1,
        scorePercent: result?.scorePercent ?? 0,
      })
      onSent()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'var(--bg)', color:'var(--t-1)' }}>
      <div className="card" style={{ padding:28, maxWidth:430, width:'100%' }}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:8 }}>Request a retake</div>
        <div style={{ fontSize:12, color:'var(--t-3)', lineHeight:1.6, marginBottom:18 }}>
          Choose the trainer who should decide. They will see who asked and your
          score, and can approve or refuse with a reason.
        </div>

        <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
          marginBottom:6, textTransform:'uppercase' }}>Trainer</div>
        <select value={trainer} onChange={e => setTrainer(e.target.value)}
          style={{ width:'100%', background:'var(--bg-3)', border:'1px solid var(--b-1)',
            borderRadius:7, padding:'9px 12px', fontSize:13, color:'var(--t-1)',
            outline:'none', boxSizing:'border-box', marginBottom:14 }}>
          <option value="">Choose…</option>
          {creators.map(c => (
            <option key={c.email} value={c.email}>{c.name} — {c.role}</option>
          ))}
        </select>

        {err && <div style={{ fontSize:11, color:'#FF453A', marginBottom:12 }}>{err}</div>}

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onCancel} style={{ flex:1, padding:'11px 0', fontSize:13,
            background:'transparent', border:'1px solid var(--b-1)', borderRadius:8,
            color:'var(--t-3)', cursor:'pointer' }}>Back</button>
          <button className="btn-orange" style={{ flex:2, padding:'11px 0', fontSize:13 }}
            disabled={!trainer || busy} onClick={send}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  )
}
