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
import { useState, useEffect, useMemo } from 'react'
import { ALL_ROLES, capabilities } from '../hooks/useAdmin'
import {
  loadUsers, setUserRole, setUserStatus, addUser,
  loadQuizzes, setQuizSetting,
} from '../utils/adminSheet'
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
      {tab === 'users'
        ? <UsersSection changedBy={changedBy}/>
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
        {setTab && ['users','quizzes'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn, background: tab === t ? 'rgba(232,89,12,0.14)' : 'transparent',
              borderColor: tab === t ? 'var(--p2)' : 'var(--b-1)',
              color: tab === t ? 'var(--p2)' : 'var(--t-3)' }}>
            {t === 'users' ? 'Users' : 'Quiz settings'}
          </button>
        ))}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:18, maxWidth:1300,
        margin:'0 auto', width:'100%' }}>{children}</div>
    </div>
  )
}
