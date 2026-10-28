/**
 * AdminPage.jsx — Batch Manager only
 * ============================================================================
 * Two sections: the user roster and quiz settings.
 *
 * Reached from a button on SessionSetupPage that renders only when
 * capabilities(role).admin is true, so no other role sees the entry point. The
 * page itself ALSO checks, because hiding a button is not access control — a
 * stale prop or a future refactor must not open it.
 *
 * Writes go through adminSheet.js, which re-reads and verifies each row before
 * touching it. Saves therefore take a second or two; that is the price of not
 * overwriting the wrong person when the sheet has been sorted underneath us.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ALL_ROLES, capabilities } from '../hooks/useAdmin'
import {
  loadUsers, setUserRole, setUserStatus, addUser,
  loadQuizzes, setQuizSetting,
  loadRoleAccess, saveRoleAccess, PERMISSIONS,
  loadConfig, setConfigValue,
} from '../utils/adminSheet'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../firebase/config'
import { CURRENT_VERSION } from '../hooks/useUpdateCheck'
import { planRepair, applyRepair } from '../utils/modelRepair'
import { findScoresRows, editFieldSession, loadSessionsDataset, loadEventCounts } from '../utils/adminSheet'
import { buildSessionRows, patchAfterEdit } from '../utils/sessionScores'
import SessionsTable from '../components/SessionsTable'
import { HALF_CHOICES, EDIT_LOG_TAB, validateSessionEdit, planSessionEdit, scoresWarning } from '../utils/sessionEdit'
import { toSheetHalf } from '../utils/fieldSheetSync'
import { showToast } from '../utils/toast'

const INACTIVE = ['inactive', 'removed', 'disabled', 'no', 'false', '0']
const isActive = s => !INACTIVE.includes(String(s || '').trim().toLowerCase())

const td = { padding:'6px 8px', fontSize:11, borderBottom:'1px solid rgba(255,255,255,0.05)' }
const th = { padding:'7px 8px', fontSize:9, fontWeight:800, color:'var(--t-3)',
  letterSpacing:0.5, textTransform:'uppercase', textAlign:'left',
  borderBottom:'1px solid var(--b-1)', whiteSpace:'nowrap' }
const inputStyle = { background:'var(--bg-3)', border:'1px solid var(--b-1)',
  borderRadius:6, padding:'6px 9px', fontSize:11, color:'var(--t-1)', outline:'none' }
const btn = { padding:'5px 11px', fontSize:11, background:'transparent',
  border:'1px solid var(--b-1)', borderRadius:6, color:'var(--t-2)', cursor:'pointer' }

export default function AdminPage({ role, changedBy, onBack }) {
  const caps = capabilities(role)
  const [tab, setTab] = useState('users')

  // Hiding the button is not access control. If this page is ever reached by
  // any other route, it must refuse on its own.
  if (!caps.admin) {
    return (
      <Shell onBack={onBack}>
        <div className="card" style={{ padding:24, fontSize:13, color:'#FF453A' }}>
          This page is for Batch Managers only.
          <div style={{ fontSize:11, color:'var(--t-3)', marginTop:6 }}>
            Your role: {caps.role || 'unrecognised'}
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell onBack={onBack} tab={tab} setTab={setTab}>
      {tab === 'users'   ? <UsersSection changedBy={changedBy}/>
       : tab === 'access' ? <AccessSection changedBy={changedBy}/>
       : tab === 'app'    ? <><AppSection changedBy={changedBy}/><RepairSection/></>
       : tab === 'sessions' ? <SessionsSection role={role} changedBy={changedBy}/>
       : <QuizzesSection changedBy={changedBy} canEdit={caps.editQuizSettings}/>}
    </Shell>
  )
}

// ── Users ───────────────────────────────────────────────────────────────────

function UsersSection({ changedBy }) {
  const [users, setUsers]   = useState([])
  const [loading, setLoad]  = useState(true)
  const [err, setErr]       = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [busy, setBusy]     = useState('')
  const [draft, setDraft]   = useState({})      // code -> pending role
  const [showAdd, setShowAdd] = useState(false)

  const refresh = async () => {
    setLoad(true); setErr('')
    try { setUsers(await loadUsers()); setDraft({}) }
    catch (e) { setErr(e?.message || String(e)) }
    finally { setLoad(false) }
  }
  useEffect(() => { refresh() }, [])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter(u => {
      if (roleFilter && u.role !== roleFilter) return false
      if (!q) return true
      return u.name.toLowerCase().includes(q)
          || u.email.toLowerCase().includes(q)
          || u.code.toLowerCase().includes(q)
    })
  }, [users, search, roleFilter])

  async function saveRole(u) {
    const next = draft[u.code]
    if (!next || next === u.role) return
    setBusy(u.code)
    try {
      await setUserRole(u, next, changedBy)
      showToast(`${u.name || u.code}: ${u.role} → ${next}`)
      await refresh()
    } catch (e) {
      showToast(e?.message || String(e), 'error')
    } finally { setBusy('') }
  }

  /**
   * Send a reset email. A client CANNOT set another user's password: Firebase's
   * updatePassword only works on the signed-in user, and changing someone
   * else's needs the Admin SDK, which must run server-side — shipping that
   * credential in the app would let anyone take over any account.
   *
   * So the user sets their own password from the emailed link. Note this does
   * NOT update column E of the roster, so HR-code login for that person would
   * still use the old stored password — which is why only email-login roles
   * should be reset this way.
   */
  async function resetPassword(u) {
    if (!u.email) return
    if (!window.confirm(`Send a password reset email to ${u.email}?`)) return
    setBusy(u.code)
    try {
      await sendPasswordResetEmail(auth, u.email)
      showToast(`Reset email sent to ${u.email}`)
    } catch (e) {
      showToast(`Could not send the reset: ${e?.message || e}`, 'error')
    } finally { setBusy('') }
  }

  async function toggleStatus(u) {
    const next = isActive(u.status) ? 'inactive' : 'active'
    setBusy(u.code)
    try {
      await setUserStatus(u, next, changedBy)
      showToast(`${u.name || u.code} is now ${next}`)
      await refresh()
    } catch (e) {
      showToast(e?.message || String(e), 'error')
    } finally { setBusy('') }
  }

  const roleCounts = useMemo(() => {
    const c = {}
    users.forEach(u => { c[u.role] = (c[u.role] || 0) + 1 })
    return c
  }, [users])

  return (
    <>
      <div className="card" style={{ padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email or HR-code"
            style={{ ...inputStyle, flex:1, minWidth:200 }}/>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            style={{ ...inputStyle, cursor:'pointer' }}>
            <option value="">All roles ({users.length})</option>
            {ALL_ROLES.map(r => (
              <option key={r} value={r}>{r} ({roleCounts[r] || 0})</option>
            ))}
          </select>
          <button style={btn} onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
          <button className="btn-orange" style={{ padding:'5px 12px', fontSize:11 }}
            onClick={() => setShowAdd(s => !s)}>
            {showAdd ? 'Cancel' : '+ Add user'}
          </button>
        </div>
        <div style={{ fontSize:10, color:'var(--t-3)', marginTop:8 }}>
          {shown.length} of {users.length} users
          {' · a role change takes effect on that person\u2019s next sign-in'}
        </div>
      </div>

      {showAdd && <AddUserForm changedBy={changedBy}
        onDone={() => { setShowAdd(false); refresh() }}/>}

      {err && (
        <div className="card" style={{ padding:14, marginBottom:12, fontSize:11,
          color:'#FF453A', border:'1px solid rgba(255,69,58,0.3)' }}>
          {err}
        </div>
      )}

      <div className="card" style={{ padding:14 }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>HR-code</th><th style={th}>Name</th>
              <th style={th}>Email</th><th style={{ ...th, width:230 }}>Role</th>
              <th style={th}>Status</th><th style={th}/>
            </tr></thead>
            <tbody>
              {shown.map(u => {
                const pending = draft[u.code] && draft[u.code] !== u.role
                const active = isActive(u.status)
                return (
                  <tr key={u.code + ':' + u.rowNumber}
                    style={{ opacity: active ? 1 : 0.45 }}>
                    <td style={{ ...td, fontFamily:'JetBrains Mono,monospace',
                      color:'var(--t-3)' }}>{u.code}</td>
                    <td style={td}>{u.name || '—'}</td>
                    <td style={{ ...td, color:'var(--t-3)' }}>{u.email || '—'}</td>
                    <td style={td}>
                      <select value={draft[u.code] ?? u.role}
                        onChange={e => setDraft(d => ({ ...d, [u.code]: e.target.value }))}
                        style={{ ...inputStyle, width:'100%', cursor:'pointer',
                          borderColor: pending ? 'var(--p2)' : 'var(--b-1)' }}>
                        {/* the stored value may not be one of the seven — keep it
                            visible rather than silently switching their role */}
                        {!ALL_ROLES.includes(u.role) && u.role && (
                          <option value={u.role}>{u.role} (unrecognised)</option>
                        )}
                        {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={{ ...td, fontSize:10, fontWeight:700,
                      color: active ? '#30D158' : '#FF9500' }}>
                      {active ? 'active' : (u.status || 'inactive')}
                    </td>
                    <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                      {pending && (
                        <button className="btn-orange"
                          style={{ padding:'3px 9px', fontSize:10, marginRight:6 }}
                          disabled={busy === u.code}
                          onClick={() => saveRole(u)}>
                          {busy === u.code ? 'Saving…' : 'Save role'}
                        </button>
                      )}
                      <button style={{ ...btn, padding:'3px 9px', fontSize:10, marginRight:6 }}
                        disabled={busy === u.code || !u.email}
                        title={u.email
                          ? `Send a reset link to ${u.email}. MARK cannot set another `
                            + `user's password directly — that needs Firebase Admin SDK, `
                            + `which must run server-side.`
                          : 'No email on record — cannot send a reset'}
                        onClick={() => resetPassword(u)}>
                        Reset password
                      </button>
                      <button style={{ ...btn, padding:'3px 9px', fontSize:10 }}
                        disabled={busy === u.code}
                        onClick={() => toggleStatus(u)}>
                        {active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!shown.length && !loading && (
                <tr><td colSpan={6} style={{ ...td, textAlign:'center', padding:20,
                  color:'var(--t-3)' }}>No users match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function AddUserForm({ changedBy, onDone }) {
  const [f, setF] = useState({ name:'', email:'', code:'', role:ALL_ROLES[0] })
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!f.code.trim()) { showToast('An HR-code is required', 'error'); return }
    setBusy(true)
    try {
      await addUser(f, changedBy)
      showToast(`${f.name || f.code} added as ${f.role}`)
      onDone()
    } catch (e) {
      showToast(e?.message || String(e), 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ padding:14, marginBottom:12 }}>
      <div style={{ fontSize:12, fontWeight:700, marginBottom:10 }}>Add user</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1.4fr auto', gap:8 }}>
        <input placeholder="HR-code" value={f.code} style={inputStyle}
          onChange={e => setF({ ...f, code:e.target.value })}/>
        <input placeholder="Name" value={f.name} style={inputStyle}
          onChange={e => setF({ ...f, name:e.target.value })}/>
        <input placeholder="Email" value={f.email} style={inputStyle}
          onChange={e => setF({ ...f, email:e.target.value })}/>
        <select value={f.role} style={{ ...inputStyle, cursor:'pointer' }}
          onChange={e => setF({ ...f, role:e.target.value })}>
          {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="btn-orange" style={{ padding:'6px 14px', fontSize:11 }}
          disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add'}</button>
      </div>
      <div style={{ fontSize:10, color:'var(--t-3)', marginTop:8, lineHeight:1.5 }}>
        No password is set here. The row is created with an empty password
        column, so this person cannot sign in until one is set deliberately —
        writing a placeholder would create a working credential.
      </div>
    </div>
  )
}

// ── Quizzes ─────────────────────────────────────────────────────────────────

function QuizzesSection({ changedBy, canEdit }) {
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoad]    = useState(true)
  const [err, setErr]         = useState('')
  const [draft, setDraft]     = useState({})   // quiz_id -> { pass, time }
  const [busy, setBusy]       = useState('')

  const refresh = async () => {
    setLoad(true); setErr('')
    try { const { quizzes } = await loadQuizzes(); setQuizzes(quizzes); setDraft({}) }
    catch (e) { setErr(e?.message || String(e)) }
    finally { setLoad(false) }
  }
  useEffect(() => { refresh() }, [])

  async function save(q) {
    const d = draft[q.quiz_id] || {}
    const jobs = []
    if (d.pass != null && String(d.pass) !== q.pass_mark_percent)
      jobs.push(['pass_mark_percent', d.pass])
    if (d.time != null && String(d.time) !== q.time_limit_min)
      jobs.push(['time_limit_min', d.time])
    if (!jobs.length) return

    setBusy(q.quiz_id)
    try {
      for (const [field, value] of jobs) {
        await setQuizSetting({ quiz:q, field, value, changedBy })
      }
      showToast(`${q.quiz_name}: ${jobs.map(j => j[0]).join(' and ')} updated`)
      await refresh()
    } catch (e) {
      showToast(e?.message || String(e), 'error')
    } finally { setBusy('') }
  }

  return (
    <>
      <div className="card" style={{ padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ fontSize:12, fontWeight:700, flex:1 }}>
            Quiz settings ({quizzes.length})
          </div>
          <button style={btn} onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
        </div>
        <div style={{ fontSize:10, color:'var(--t-3)', marginTop:8, lineHeight:1.6 }}>
          Changes apply to NEW attempts only. Each completed attempt stores the
          pass mark that was in force when it was taken, so raising the mark
          cannot retroactively fail anyone — an earlier pass stays a pass.
          {!canEdit && <><br/><b style={{ color:'#FF9500' }}>
            Read-only: only a Batch Manager can change these.</b></>}
        </div>
      </div>

      {err && (
        <div className="card" style={{ padding:14, marginBottom:12, fontSize:11,
          color:'#FF453A' }}>{err}</div>
      )}

      <div className="card" style={{ padding:14 }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>Quiz</th><th style={th}>Scope</th>
              <th style={{ ...th, textAlign:'right' }}>Clips</th>
              <th style={{ ...th, width:110 }}>Pass mark %</th>
              <th style={{ ...th, width:110 }}>Time limit (min)</th>
              <th style={th}>Status</th><th style={th}/>
            </tr></thead>
            <tbody>
              {quizzes.map(q => {
                const d = draft[q.quiz_id] || {}
                const dirty = (d.pass != null && String(d.pass) !== q.pass_mark_percent)
                           || (d.time != null && String(d.time) !== q.time_limit_min)
                return (
                  <tr key={q.quiz_id}>
                    <td style={td}>{q.quiz_name || q.quiz_id}</td>
                    <td style={{ ...td, fontSize:10, color:'var(--t-3)',
                      fontFamily:'JetBrains Mono,monospace' }}>
                      {q.scope_event_ids || '—'}</td>
                    <td style={{ ...td, textAlign:'right', color:'var(--t-3)' }}>
                      {q.clip_count || '—'}</td>
                    <td style={td}>
                      {canEdit ? (
                        <input type="number" min="0" max="100"
                          value={d.pass ?? q.pass_mark_percent}
                          onChange={e => setDraft(x => ({ ...x,
                            [q.quiz_id]: { ...(x[q.quiz_id]||{}), pass:e.target.value } }))}
                          style={{ ...inputStyle, width:'100%' }}/>
                      ) : <span>{q.pass_mark_percent}%</span>}
                    </td>
                    <td style={td}>
                      {canEdit ? (
                        <input type="number" min="1"
                          value={d.time ?? q.time_limit_min}
                          onChange={e => setDraft(x => ({ ...x,
                            [q.quiz_id]: { ...(x[q.quiz_id]||{}), time:e.target.value } }))}
                          style={{ ...inputStyle, width:'100%' }}/>
                      ) : <span>{q.time_limit_min}</span>}
                    </td>
                    <td style={{ ...td, fontSize:10, fontWeight:700,
                      color: q.status === 'published' ? '#30D158' : '#FFD60A' }}>
                      {q.status}</td>
                    <td style={{ ...td, textAlign:'right' }}>
                      {canEdit && dirty && (
                        <button className="btn-orange"
                          style={{ padding:'3px 10px', fontSize:10 }}
                          disabled={busy === q.quiz_id}
                          onClick={() => save(q)}>
                          {busy === q.quiz_id ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!quizzes.length && !loading && (
                <tr><td colSpan={7} style={{ ...td, textAlign:'center', padding:20,
                  color:'var(--t-3)' }}>No quizzes found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Role Access Manager ─────────────────────────────────────────────────────

function AccessSection({ changedBy }) {
  const [matrix, setMatrix] = useState(null)
  const [saved,  setSaved]  = useState(null)   // what is on the sheet
  const [busy,   setBusy]   = useState(false)
  const [err,    setErr]    = useState('')

  useEffect(() => {
    (async () => {
      setErr('')
      try {
        const stored = await loadRoleAccess()
        // Pre-fill from the DEFAULTS, then layer anything already saved. So a
        // sheet with no role_access tab shows exactly today's behaviour rather
        // than an empty grid, and the manager edits from a correct baseline.
        const seed = {}
        ALL_ROLES.forEach(r => {
          const base = capabilities(r)
          seed[r] = {}
          PERMISSIONS.forEach(p => {
            seed[r][p.key] = stored[r] && p.key in stored[r]
              ? stored[r][p.key] : !!base[p.key]
          })
        })
        setMatrix(seed)
        setSaved(JSON.stringify(seed))
      } catch (e) { setErr(e?.message || String(e)) }
    })()
  }, [])

  const dirty = matrix && JSON.stringify(matrix) !== saved

  async function save() {
    setBusy(true)
    try {
      await saveRoleAccess(matrix, changedBy)
      setSaved(JSON.stringify(matrix))
      showToast('Role access saved — applies at each user\u2019s next sign-in')
    } catch (e) { showToast(e?.message || String(e), 'error') }
    finally { setBusy(false) }
  }

  if (err) return <div className="card" style={{ padding:14, fontSize:11, color:'#FF453A' }}>{err}</div>
  if (!matrix) return <div className="card" style={{ padding:14, fontSize:12, color:'var(--t-3)' }}>Loading…</div>

  return (
    <>
      <div className="card" style={{ padding:14, marginBottom:12, display:'flex',
        alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:700, flex:1 }}>Role Access Manager</div>
        <button className="btn-orange" style={{ padding:'6px 14px', fontSize:11,
          opacity: dirty && !busy ? 1 : 0.45 }}
          disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save access'}
        </button>
      </div>
      <div className="card" style={{ padding:'9px 14px', marginBottom:12, fontSize:10,
        color:'var(--t-3)', lineHeight:1.6 }}>
        Changes apply at each user&rsquo;s next sign-in — the role is read once at
        login, not on every screen. A blank cell on the sheet keeps that
        permission&rsquo;s default rather than denying it.
        <br/>
        <b style={{ color:'#FF9500' }}>Admin page access for Batch Manager is always on
        and cannot be removed</b> — unchecking it would remove the only route back
        into this screen.
      </div>

      <div className="card" style={{ padding:14, overflowX:'auto' }}>
        <table style={{ borderCollapse:'collapse', fontSize:10 }}>
          <thead><tr>
            <th style={{ ...th, position:'sticky', left:0, background:'var(--bg-2)' }}>Role</th>
            {PERMISSIONS.map(p => (
              <th key={p.key} style={{ ...th, textAlign:'center', padding:'7px 6px',
                writingMode:'vertical-rl', transform:'rotate(180deg)', height:104 }}>
                {p.label}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {ALL_ROLES.map(r => (
              <tr key={r}>
                <td style={{ ...td, whiteSpace:'nowrap', position:'sticky', left:0,
                  background:'var(--bg-2)', fontWeight:600 }}>{r}</td>
                {PERMISSIONS.map(p => {
                  const locked = p.key === 'admin' && r === 'Batch Manager'
                  return (
                    <td key={p.key} style={{ ...td, textAlign:'center' }}>
                      <input type="checkbox" checked={!!matrix[r][p.key]}
                        disabled={locked}
                        title={locked ? 'Locked on to prevent a lockout' : ''}
                        onChange={e => setMatrix(m => ({ ...m,
                          [r]: { ...m[r], [p.key]: e.target.checked } }))}
                        style={{ accentColor:'var(--p2)', cursor: locked ? 'default' : 'pointer',
                          opacity: locked ? 0.5 : 1 }}/>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── App settings: minimum version ───────────────────────────────────────────

function AppSection({ changedBy }) {
  const [min, setMin]   = useState('')
  const [orig, setOrig] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig()
      setMin(cfg.minimum_version || '')
      setOrig(cfg.minimum_version || '')
    })()
  }, [])

  const shaped = /^\d+\.\d+(\.\d+)?$/.test(min.trim())
  // Blocking people out is the one setting with no way back from inside the
  // app, so refuse a minimum ABOVE this build rather than let a typo lock
  // everyone, including the manager typing it, out at once.
  const tooHigh = shaped && cmp(min.trim(), CURRENT_VERSION) > 0
  const dirty = min.trim() !== orig

  async function save() {
    setBusy(true)
    try {
      await setConfigValue('minimum_version', min.trim(), changedBy)
      setOrig(min.trim())
      showToast(`Minimum version set to ${min.trim()}`)
    } catch (e) { showToast(e?.message || String(e), 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ padding:16, maxWidth:560 }}>
      <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>Minimum app version</div>
      <div style={{ fontSize:10, color:'var(--t-3)', marginBottom:14, lineHeight:1.6 }}>
        Anyone on a version below this is blocked at sign-in and told to update.
        It takes effect the next time they open MARK. Leave it empty to block
        nobody.
      </div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <input value={min} onChange={e => setMin(e.target.value)}
          placeholder="e.g. 7.9.20" style={{ ...inputStyle, width:140 }}/>
        <button className="btn-orange" style={{ padding:'6px 14px', fontSize:11,
          opacity: dirty && (shaped || !min.trim()) && !tooHigh && !busy ? 1 : 0.45 }}
          disabled={!dirty || busy || (!!min.trim() && !shaped) || tooHigh}
          onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <span style={{ fontSize:10, color:'var(--t-3)',
          fontFamily:'JetBrains Mono,monospace' }}>
          this build: v{CURRENT_VERSION}
        </span>
      </div>
      {!!min.trim() && !shaped && (
        <div style={{ fontSize:10, color:'#FF453A', marginTop:8 }}>
          Use the form 7.9.20 — digits and dots only.
        </div>
      )}
      {tooHigh && (
        <div style={{ fontSize:10, color:'#FF453A', marginTop:8, lineHeight:1.5 }}>
          {min.trim()} is newer than this build (v{CURRENT_VERSION}). Saving it would
          block everyone, including you, with no way back in from the app. Set a
          version that has actually been released.
        </div>
      )}
    </div>
  )
}

/**
 * One-off repair: model answers saved from Tag before v7.12.2 reached the sheet
 * as collector sessions. Check first — it lists what it would change and writes
 * nothing — then apply.
 */
function RepairSection() {
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg]   = useState('')
  const check = async () => {
    setBusy('check'); setMsg('')
    try { setPlan(await planRepair()) } catch (e) { setMsg(e?.message || String(e)) }
    finally { setBusy('') }
  }
  const apply = async () => {
    if (!window.confirm(`Correct ${plan.fixes.length} model answer row(s) and ${(plan.halfFixes||[]).length} half value(s) in field_sessions?`)) return
    setBusy('apply'); setMsg('')
    try {
      const r = await applyRepair(plan)
      setMsg(`Fixed ${r.fixed} model answer row(s) and ${r.halvesFixed} half value(s).` + (r.skipped.length
        ? ` Skipped ${r.skipped.length} — the sheet changed since the check; run Check again.` : ''))
      setPlan(null)
    } catch (e) { setMsg(e?.message || String(e)) }
    finally { setBusy('') }
  }
  return (
    <div className="card" style={{ padding:16, maxWidth:560, marginTop:12 }}>
      <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>Repair model answers</div>
      <div style={{ fontSize:10, color:'var(--t-3)', marginBottom:12, lineHeight:1.6 }}>
        Before v7.12.2, model answers saved from Tag reached the sheet marked as collector
        sessions, so Comparison and the start-screen check couldn&rsquo;t find them. This
        corrects them from Firestore. <b>Check</b> only reads; nothing is written until you
        press <b>Apply</b>.
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <button style={btn} disabled={!!busy} onClick={check}>{busy === 'check' ? 'Checking…' : 'Check'}</button>
        {plan && (plan.fixes.length + (plan.halfFixes||[]).length) > 0 && (
          <button className="btn-orange" style={{ padding:'6px 14px', fontSize:11 }}
            disabled={!!busy} onClick={apply}>
            {busy === 'apply' ? 'Applying…' : `Apply — fix ${plan.fixes.length + (plan.halfFixes||[]).length}`}</button>
        )}
      </div>
      {plan && (
        <div style={{ fontSize:11, marginTop:12, color:'var(--t-2)', lineHeight:1.7 }}>
          {plan.modelsInFirestore} model answer(s) in Firestore ·{' '}
          <b>{plan.fixes.length}</b> mislabelled in the sheet
          {' · '}<b>{(plan.halfFixes||[]).length}</b> half value(s) doubled (e.g. 1HH)
          {plan.fixes.length + (plan.halfFixes||[]).length === 0 && ' — nothing to fix.'}
          {(plan.halfFixes||[]).slice(0, 6).map(f => (
            <div key={'h'+f.rowNumber} style={{ fontFamily:'JetBrains Mono,monospace', fontSize:10,
              color:'var(--t-3)' }}>row {f.rowNumber} · half {f.from} → {f.to}</div>
          ))}
          {plan.fixes.slice(0, 12).map(f => (
            <div key={f.sessionId} style={{ fontFamily:'JetBrains Mono,monospace', fontSize:10,
              color:'var(--t-3)' }}>row {f.rowNumber} · {f.matchId} {f.half} · is_model {f.from} → 1</div>
          ))}
          {plan.fixes.length > 12 && <div style={{ color:'var(--t-3)' }}>…and {plan.fixes.length - 12} more</div>}
        </div>
      )}
      {msg && <div style={{ fontSize:11, marginTop:10, color:'var(--p2)' }}>{msg}</div>}
    </div>
  )
}

// ── Sessions: a read-only table of every saved session with its latest score, plus the Edit panel ──────────────
/**
 * Batch Manager only (the page refuses everyone else, and editFieldSession checks the role again).
 *
 * field_sessions, scores, session_edits and the roster are read ONCE when this tab opens (and again on Reload) and
 * joined in memory by session id (utils/sessionScores.js). Filters, sorting and paging never read a sheet. The
 * table is a view: nothing here writes to scores, and the Edit panel below is the same one as before. Clicking
 * a row opens it. If a read fails the real error is shown, and a source that could not be read is never shown as
 * "nothing there".
 */
function SessionsSection({ role, changedBy }) {
  const [ds, setDs]         = useState(null)                       // the raw sheets, as read
  const [load, setLoad]     = useState({ status: 'loading', error: '' })   // loading | reloading | ready | error
  const [events, setEvents] = useState({ status: 'idle', map: null, error: '' })
  const [busy, setBusy]     = useState('')
  const [msg, setMsg]       = useState('')
  const [edit, setEdit]     = useState(null)                       // { row, matchId, half, scores }
  const [done, setDone]     = useState(null)                       // result of the last saved edit
  const gen = useRef(0)                                            // a slow read must not overwrite a newer one

  const reload = useCallback(async () => {
    const my = ++gen.current
    setLoad(l => ({ status: l.status === 'ready' ? 'reloading' : 'loading', error: '' }))
    try {
      const raw = await loadSessionsDataset()
      if (my !== gen.current) return
      setDs(raw); setLoad({ status: 'ready', error: '' }); setEdit(null)
      // the event counts are a separate, larger read: the table is already usable while they arrive
      setEvents({ status: 'loading', map: null, error: '' })
      loadEventCounts().then(
        map => { if (my === gen.current) setEvents({ status: 'ready', map, error: '' }) },
        e => { if (my === gen.current) setEvents({ status: 'error', map: null, error: e?.message || String(e) }) })
    } catch (e) { if (my === gen.current) setLoad({ status: 'error', error: e?.message || String(e) }) }
  }, [])
  useEffect(() => { reload(); return () => { gen.current++ } }, [reload])

  const built = useMemo(() => (ds ? buildSessionRows(ds, events.map) : null), [ds, events.map])

  const open = async row0 => {
    // the Edit panel compares against the cell as it is in the sheet, so it gets the raw half, not the tidied one
    const row = { ...row0, half: row0.halfRaw }
    setDone(null); setMsg('')
    setEdit({ row, matchId: row.match_id, half: toSheetHalf(row.half) || row.half, scores: null })
    try {
      const sc = await findScoresRows(row.session_id)
      setEdit(e => (e && e.row.session_id === row.session_id ? { ...e, scores: sc } : e))
    } catch (e) { setEdit(x => (x && x.row.session_id === row.session_id ? { ...x, scores: { rows: [], checked: false, error: e?.message || String(e) } } : x)) }
  }

  const current = edit && { match_id: edit.row.match_id, half: edit.row.half, part: edit.row.part }
  const valid   = edit ? validateSessionEdit({ matchId: edit.matchId, half: edit.half }) : null
  const changes = edit && valid.ok ? planSessionEdit(current, { matchId: edit.matchId, half: edit.half }) : []
  const warn    = edit?.scores?.checked ? scoresWarning(edit.scores.rows) : ''

  const save = async () => {
    const lines = changes.map(c => `  ${c.field}: ${c.from || '(blank)'}  →  ${c.to}`).join('\n')
    const ask = `Change this session?\n\n${edit.row.session_id}\n${lines}\n\n` + (warn ? `${warn}\n\n` : '')
      + `This is logged in ${EDIT_LOG_TAB} as ${changedBy}.`
    if (!window.confirm(ask)) return
    setBusy('save'); setMsg('')
    try {
      const r = await editFieldSession({ role, changedBy, session: edit.row, matchId: edit.matchId, half: edit.half })
      // update the in-memory copy, so the row shows its new values and its Stale flag at once
      setDs(d => patchAfterEdit(d, edit.row, r.changes, changedBy))
      setDone({ session: edit.row.session_id, ...r }); setEdit(null)
    } catch (e) { setMsg(e?.message || String(e)) }
    finally { setBusy('') }
  }

  const box = (color, border, bg) => ({ fontSize:11, lineHeight:1.6, padding:'10px 12px', borderRadius:8, color, border:`1px solid ${border}`, background:bg })
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Sessions</div>
      <div style={{ fontSize: 10, color: 'var(--t-3)', marginBottom: 12, lineHeight: 1.6 }}>
        Every session saved to <code>field_sessions</code> with its latest score from <code>scores</code>. This is a view:
        nothing here changes a score. Click a row to correct its <b>Match ID</b> or <b>half</b>; every change is logged in <code>{EDIT_LOG_TAB}</code>.
      </div>

      {load.status === 'loading' && <div data-testid="sessions-loading" style={{ fontSize: 12, color: 'var(--t-3)', padding: '18px 0' }}>Reading field_sessions, scores and session_edits…</div>}
      {load.status === 'error' && (
        <div data-testid="sessions-load-error" style={{ ...box('#FF453A', 'rgba(255,69,58,0.3)', 'rgba(255,69,58,0.08)') }}>
          Couldn&rsquo;t load the sessions: {load.error}
          <div style={{ marginTop: 8 }}><button style={btn} onClick={reload}>Try again</button></div>
        </div>)}

      {built && load.status !== 'error' && (
        <>
      {edit && (
        <div data-testid="edit-panel" style={{ border:'1px solid var(--b-1)', borderRadius:10, padding:14, background:'var(--bg-3)' }}>
          <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:10, fontFamily:'JetBrains Mono,monospace' }}>{edit.row.session_id}</div>
          <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap', marginBottom:12 }}>
            <label style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:0.5 }}>MATCH ID
              <input data-testid="edit-match" style={{ ...inputStyle, display:'block', marginTop:4, width:150, fontFamily:'JetBrains Mono,monospace' }}
                inputMode="numeric" value={edit.matchId}
                onChange={e => setEdit({ ...edit, matchId: e.target.value.replace(/\D/g, '') })}/>
            </label>
            <label style={{ fontSize:9, fontWeight:800, color:'var(--t-3)', letterSpacing:0.5 }}>HALF
              <select data-testid="edit-half" style={{ ...inputStyle, display:'block', marginTop:4, cursor:'pointer' }}
                value={edit.half} onChange={e => setEdit({ ...edit, half: e.target.value })}>
                {!HALF_CHOICES.some(([c]) => c === edit.half) && <option value={edit.half}>{edit.half || '(blank)'}</option>}
                {HALF_CHOICES.map(([c, l]) => <option key={c} value={c}>{c} · {l}</option>)}
              </select>
            </label>
          </div>
          {!valid.ok && <div style={{ ...box('#FF453A', 'rgba(255,69,58,0.3)', 'rgba(255,69,58,0.08)'), marginBottom:10 }}>{Object.values(valid.errors).join('. ')}</div>}
          {changes.length > 0 && (
            <div style={{ fontSize:11, color:'var(--t-2)', marginBottom:10, lineHeight:1.7 }}>
              {changes.map(c => <div key={c.field} style={{ fontFamily:'JetBrains Mono,monospace' }}>{c.field}: {c.from || '(blank)'} → <b>{c.to}</b>{c.field === 'part' ? '  (follows the half)' : ''}</div>)}
            </div>
          )}
          {edit.scores === null && <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:10 }}>Checking the scores tab…</div>}
          {edit.scores && !edit.scores.checked && (
            <div data-testid="scores-unchecked" style={{ ...box('#FF9F0A', 'rgba(255,159,10,0.4)', 'rgba(255,159,10,0.1)'), marginBottom:10 }}>
              Couldn&rsquo;t check the scores tab ({edit.scores.error}). If this session has been compared, the comparison must be run again after this edit.
            </div>
          )}
          {warn && <div data-testid="scores-warning" style={{ ...box('#FF9F0A', 'rgba(255,159,10,0.4)', 'rgba(255,159,10,0.1)'), marginBottom:10 }}>⚠ {warn}</div>}
          <div style={{ display:'flex', gap:8 }}>
            <button style={btn} disabled={!!busy} onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn-orange" style={{ padding:'6px 14px', fontSize:11, opacity: (!valid.ok || !changes.length) ? 0.45 : 1 }}
              data-testid="edit-save" disabled={!!busy || !valid.ok || !changes.length || edit.scores === null} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save change'}</button>
          </div>
        </div>
      )}

      {done && (
        <div data-testid="edit-done" style={{ ...box('var(--t-2)', 'rgba(48,209,88,0.3)', 'rgba(48,209,88,0.07)'), marginTop:12 }}>
          <b style={{ color:'#30D158' }}>Saved.</b>{' '}
          {done.changes.map(c => `${c.field}: ${c.from || '(blank)'} → ${c.to}`).join(' · ')}
          <div style={{ color:'var(--t-3)' }}>Logged in {EDIT_LOG_TAB}. Firestore copy: {done.firestore}.</div>
          {done.scoresChecked && done.scoresRows.length > 0 && (
            <div data-testid="done-scores-warning" style={{ marginTop:8, color:'#FF9F0A' }}>⚠ {scoresWarning(done.scoresRows)}</div>)}
          {!done.scoresChecked && (
            <div style={{ marginTop:8, color:'#FF9F0A' }}>⚠ The scores tab could not be checked. If this session has been compared, the comparison must be run again.</div>)}
        </div>
      )}
      {msg && <div data-testid="edit-error" style={{ ...box('#FF453A', 'rgba(255,69,58,0.3)', 'rgba(255,69,58,0.08)'), marginTop:12 }}>{msg}</div>}
          <SessionsTable rows={built.rows} notes={built.notes} eventsState={events} loadedAt={ds.loadedAt}
            reloading={load.status === 'reloading'} onReload={reload} onOpen={open} editingKey={edit?.row.session_id}/>
        </>
      )}
    </div>
  )
}

/** numeric version compare: -1, 0, 1 */
function cmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

// ── shell ───────────────────────────────────────────────────────────────────

function Shell({ onBack, tab, setTab, children }) {
  return (
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
          padding:'2px 8px', borderRadius:4 }}>ADMIN</div>
        <div style={{ flex:1 }}/>
        {setTab && ['users','access','quizzes','sessions','app'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn, background: tab === t ? 'rgba(232,89,12,0.14)' : 'transparent',
              borderColor: tab === t ? 'var(--p2)' : 'var(--b-1)',
              color: tab === t ? 'var(--p2)' : 'var(--t-3)' }}>
            {t === 'users' ? 'Users' : t === 'access' ? 'Role access'
              : t === 'quizzes' ? 'Quiz settings' : t === 'sessions' ? 'Sessions' : 'App'}
          </button>
        ))}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:18, maxWidth:1300,
        margin:'0 auto', width:'100%' }}>{children}</div>
    </div>
  )
}
