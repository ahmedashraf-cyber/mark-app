/**
 * MyHalvesPage.jsx — "My halves": read-only. A collector rewatches their own halves and sees their errors against the
 * model answer; reviewer roles get the same view for any collector.
 *
 * READS the Google Sheet only and WRITES nothing. Permissions come from caps.viewOwnHalves / caps.viewAnyHalves (the
 * Role Access matrix), never from a role name. The HR-code is the signed-in person's own (roleInfo.code, resolved at
 * sign-in), never a typed field: a collector cannot ask for someone else's.
 *
 * HONEST LIMIT: the app reads the Sheet with its own service account, so "a collector sees only their own halves" is
 * enforced here, in the client. A collector's rows are cut down to their own before they are stored, and a half that is
 * not theirs is refused before anything is read. It is not a server-side wall.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import SessionsTable from '../components/HalvesTable'
import HalfDetail from '../components/HalfDetail'
import { loadHalvesDataset, loadEventCounts } from '../utils/myHalvesSheet'
import { buildSessionRows, averages, MODULES } from '../utils/halvesScores'
import { HALF_COLUMNS, OWN_DEFAULT_COLUMNS, ANY_DEFAULT_COLUMNS, profileOf } from '../utils/myHalves'
import { canonHr } from '../utils/hrCode'
import { identityOf, canIdentify, matchOwner } from '../utils/ownerMatch'
import { canCompareHalves, compareAction, makePreset, isValidPreset, candidateLabel, MSG as COMPARE_MSG } from '../utils/halvesCompare'

const small = { fontSize: 10, color: 'var(--t-3)' }

function Profile({ rows }) {
  const p = profileOf(rows)
  if (!p) return null
  const av = averages(rows)
  return (
    <div data-testid="profile" style={{ border: '1px solid var(--b-1)', borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: 'var(--bg-2)' }}>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{p.name || p.hrCode}</span>
        {p.role && <span style={small}>{p.role}</span>}
        <span style={{ ...small, fontFamily: 'JetBrains Mono,monospace' }}>{p.hrCode}</span>
        {p.email && <span style={small}>{p.email}</span>}
        <span data-testid="profile-halves" style={small}>{p.halves} {p.halves === 1 ? 'half' : 'halves'}{p.modelAnswers ? ` (+ ${p.modelAnswers} model answer${p.modelAnswers === 1 ? '' : 's'})` : ''}</span>
      </div>
      <div data-testid="profile-averages" style={{ fontSize: 11, color: 'var(--t-2)' }}>
        Average Overall <b data-testid="avg-overall">{av.overall.mean === null ? '-' : `${av.overall.mean}%`}</b>
        {MODULES.map(([k, , label]) => <span key={k} style={{ marginLeft: 12 }}>{label} <b>{av[k].mean === null ? '-' : `${av[k].mean}%`}</b></span>)}
        <span style={{ ...small, marginLeft: 10 }}>over {av.sessions} compared {av.sessions === 1 ? 'half' : 'halves'} (stale runs left out)</span>
      </div>
    </div>
  )
}

/**
 * onCompareHalf    (preset) => void. Present only when the app can open Comparison from here; without it there is no Compare button.
 * initialFocus     { matchId, key } coming back from Comparison: the list opens filtered to that match with that half's row in view.
 */
export default function MyHalvesPage({ onBack, onCompareHalf, initialFocus }) {
  const { caps, roleInfo, profile } = useAuth()
  const canAny = !!caps?.viewAnyHalves, canOwn = !!caps?.viewOwnHalves
  // The Compare / Recompare button: halvesCompare AND comparison (it opens Comparison), for the halves of ANY collector only.
  const canCompare = canAny && canCompareHalves(caps) && typeof onCompareHalf === 'function'
  const [pick, setPick] = useState(null)               // { row, candidates }: more than one model answer, the user chooses; nothing is guessed
  const [compareNote, setCompareNote] = useState('')
  const startFilters = useMemo(() => (initialFocus?.matchId ? { matchIds: String(initialFocus.matchId) } : null), [])   // first mount only
  // A role that may open Comparison but has no halvesCompare value in role_access (the column does not exist yet, or its cell is blank)
  // simply has no button. Say so once in the log, so "why is there no button" has an answer.
  useEffect(() => {
    if (!canAny || !caps?.comparison || caps?.halvesCompare) return
    const o = roleInfo?.accessOverrides
    if (!o || !('halvesCompare' in o)) console.warn(`[MARK halves] Compare buttons are OFF: role_access has no halvesCompare value for "${roleInfo?.role || '?'}" (the column is missing, or its cell is blank${o ? '' : ', or there is no row for this role'}). A Batch Manager can switch it on under Admin, Role Access.`)
  }, [canAny, caps?.comparison, caps?.halvesCompare, roleInfo])
  // email is the SIGNED-IN account's (profile.email), never roleInfo.email: that is blank for the full-access account and offline
  const me = useMemo(() => ({ hrCode: String(roleInfo?.code || '').trim(), name: roleInfo?.name || '', role: roleInfo?.role || '', email: profile?.email || '' }), [profile?.email, roleInfo])
  const allowed = canAny || canOwn
  const identified = canIdentify(identityOf(me))      // the signed-in account's email OR an HR-code is enough to find own halves

  const [load, setLoad] = useState({ status: 'loading', error: '' })
  const [ds, setDs] = useState(null)
  const [open, setOpen] = useState(null)
  const [prog, setProg] = useState({})                                       // which small tab has been read: id -> { state, error }
  const [counts, setCounts] = useState({ status: 'loading', map: null, error: '' })   // event counts arrive AFTER the list
  const run = useRef(0)                                                      // a Reload makes any answer still on its way stale

  const reload = useCallback(async () => {
    const mine = ++run.current
    const current = () => run.current === mine
    setLoad(l => ({ status: l.status === 'ready' ? 'reloading' : 'loading', error: '' })); setProg({})
    try {
      // phase 1: the list. As soon as sessions, scores and the edit log (and the roster, for a reviewer) are read it is shown
      const next = await loadHalvesDataset({ me, canViewAny: canAny, onProgress: p => { if (current()) setProg(x => ({ ...x, [p.id]: p })) } })
      if (!current()) return
      setDs(next); setLoad({ status: 'ready', error: '' }); setOpen(null); setCounts({ status: 'loading', map: null, error: '' })
      // phase 2: the event counts (column A of field_events, once; the index is kept for opening halves)
      loadEventCounts(next).then(
        map => { if (current()) setCounts({ status: 'ready', map, error: '' }) },
        e => { if (current()) setCounts({ status: 'error', map: null, error: e?.message || String(e) }) })
    } catch (e) { if (current()) setLoad({ status: 'error', error: e?.message || String(e) }) }
  }, [me, canAny])
  useEffect(() => { if (allowed && (canAny || identified)) reload() }, [allowed, canAny, identified, reload])

  const built = useMemo(() => {
    if (!ds) return null
    const b = buildSessionRows(ds.raw, counts.map)
    // a session row does not always carry the collector's email; the roster does, so searching by email finds all their halves
    const email = new Map((ds.raw.roster?.list || []).map(p => [canonHr(p.code), p.email]))
    b.rows = b.rows.map(r => (r.collector_email ? r : { ...r, collector_email: email.get(canonHr(r.collector_hr_code)) || '' }))
    // belt and braces: a collector's list is filtered to their own once more here, so even a bug upstream cannot show another person's half
    return canAny ? b : { ...b, rows: b.rows.filter(r => matchOwner(identityOf(me), { email: r.collector_email, hrCode: r.collector_hr_code }).match && !r.isModel) }
  }, [ds, counts.map, canAny, me])
  const eventsState = !ds || counts.status === 'loading' ? { status: 'loading' } : counts.status === 'ready' ? { status: 'ready' } : { status: 'error', error: counts.error }

  // ── Compare / Recompare ──────────────────────────────────────────────────────────────────────────────────
  const goCompare = (row, model) => {
    const preset = makePreset(row, model)
    if (!isValidPreset(preset)) { setCompareNote(COMPARE_MSG.badPreset); return }
    setCompareNote(''); setPick(null); onCompareHalf(preset)
  }
  const startCompare = row => {
    const a = compareAction(row, caps)
    if (!a.show || a.disabled) { if (a.reason) setCompareNote(a.reason); return }
    if (a.candidates.length === 1) goCompare(row, a.candidates[0])
    else setPick({ row, candidates: a.candidates })            // several approved models: the user picks
  }
  const renderCompare = row => {
    const a = compareAction(row, caps)
    if (!a.show) return null
    return (
      <button data-testid="compare-btn" data-label={a.label} disabled={a.disabled} aria-disabled={a.disabled} title={a.disabled ? a.reason : a.hint}
        onClick={e => { e.stopPropagation(); startCompare(row) }}
        style={{ padding: '5px 11px', fontSize: 11, background: a.disabled ? 'transparent' : 'rgba(232,89,12,0.12)', border: `1px solid ${a.disabled ? 'var(--b-1)' : 'rgba(232,89,12,0.5)'}`,
          borderRadius: 6, color: a.disabled ? 'var(--t-3)' : '#E8590C', cursor: a.disabled ? 'not-allowed' : 'pointer', opacity: a.disabled ? 0.6 : 1 }}>{a.label}</button>)
  }

  const shell = children => (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      <div style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--b-1)', padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--t-3)', fontSize: 18, cursor: 'pointer', padding: '0 6px 0 0' }}>←</button>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{canAny ? 'Halves' : 'My halves'}</span>
        <span style={small}>{canAny ? "Any collector's halves, read-only" : 'Your own halves against the model answer, read-only'}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 60px' }}>{children}</div>
    </div>
  )

  if (!allowed) return shell(<div data-testid="no-access" style={{ fontSize: 13, color: 'var(--t-3)' }}>Your role does not have access to this screen.</div>)
  if (!canAny && !identified) return shell(
    <div data-testid="no-hr-code" style={{ fontSize: 13, color: 'var(--t-2)', lineHeight: 1.7, maxWidth: 560 }}>
      Your account has no email or HR-code, so there are no halves to show. Neither is ever typed in here. Ask your Batch Manager to check your row in the roster.
    </div>)

  return shell(
    <>
      {compareNote && (
        <div data-testid="compare-note" style={{ fontSize: 12, padding: '8px 12px', marginBottom: 10, borderRadius: 8, color: '#FF9F0A', border: '1px solid rgba(255,159,10,0.3)', background: 'rgba(255,159,10,0.08)' }}>
          {compareNote} <button onClick={() => setCompareNote('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--t-3)', cursor: 'pointer', fontSize: 11 }}>Dismiss</button>
        </div>)}
      {pick && (
        <div data-testid="model-picker" role="dialog" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--b-1)', borderRadius: 12, padding: 18, width: 520, maxWidth: '92vw' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Which model answer?</div>
            <div style={{ fontSize: 11, color: 'var(--t-3)', marginBottom: 12, lineHeight: 1.6 }}>
              Match {pick.row.match_id} · {pick.row.half} has {pick.candidates.length} approved model answers. Choose the one to compare this half with. Nothing is written.</div>
            {pick.candidates.map(c => (
              <button key={c.sessionId} data-testid="pick-model" data-session={c.sessionId} onClick={() => goCompare(pick.row, c)}
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6, padding: '8px 10px', fontSize: 11, background: 'var(--bg-3)', border: '1px solid var(--b-1)', borderRadius: 8, color: 'var(--t-1)', cursor: 'pointer', fontFamily: 'JetBrains Mono,monospace' }}>
                {candidateLabel(c)}</button>))}
            <div style={{ textAlign: 'right', marginTop: 8 }}><button data-testid="pick-cancel" onClick={() => setPick(null)} style={{ padding: '5px 12px', fontSize: 11, background: 'transparent', border: '1px solid var(--b-1)', borderRadius: 6, color: 'var(--t-2)', cursor: 'pointer' }}>Cancel</button></div>
          </div>
        </div>)}
      {load.status === 'loading' && (
        <div data-testid="halves-loading" style={{ fontSize: 12, color: 'var(--t-3)', padding: '18px 0', lineHeight: 1.9 }}>
          Reading the sheets…
          {[['sessions', 'Sessions'], ['scores', 'Scores'], ['edits', 'Edit log (to tell a current score from a stale one)'], ...(canAny ? [['roster', 'Names and roles']] : [])].map(([id, label]) => {
            const st = prog[id]
            return (
              <div key={id} data-testid={`progress-${id}`} style={{ color: st?.state === 'error' ? '#FF453A' : st?.state === 'done' ? 'var(--t-2)' : 'var(--t-3)' }}>
                {st?.state === 'done' ? '✓' : st?.state === 'error' ? '✗' : '…'} {label}{st?.state === 'error' ? `: ${st.error}` : ''}
              </div>)
          })}
        </div>)}
      {load.status === 'error' && (
        <div data-testid="halves-load-error" style={{ fontSize: 12, padding: '10px 12px', borderRadius: 8, color: '#FF453A', border: '1px solid rgba(255,69,58,0.3)', background: 'rgba(255,69,58,0.08)' }}>
          Couldn&rsquo;t load the halves: {load.error}
          <div style={{ marginTop: 8 }}><button onClick={reload} style={{ background: 'transparent', border: '1px solid var(--b-1)', borderRadius: 6, color: 'var(--t-2)', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>Try again</button></div>
        </div>)}
      {built && load.status !== 'error' && (
        <>
          {/* the list stays mounted while a half is open, so its filters are still there when you come back */}
          <div style={{ display: open ? 'none' : 'block' }}>
            <SessionsTable rows={built.rows} notes={built.notes} eventsState={eventsState} loadedAt={ds.loadedAt}
              reloading={load.status === 'reloading'} onReload={reload} onOpen={setOpen}
              columns={HALF_COLUMNS} defaultColumns={canAny ? ANY_DEFAULT_COLUMNS : OWN_DEFAULT_COLUMNS} colsKey={canAny ? 'mark_halves_cols_any' : 'mark_halves_cols_own'}
              actionLabel="Open" canExport={canAny} hide={canAny ? [] : ['hr', 'roles', 'types']} noun="halves"
              renderAction={canCompare ? renderCompare : null} initialFilters={startFilters} focusKey={initialFocus?.key || null}
              above={rows => <Profile rows={rows}/>}/>
          </div>
          {open && <HalfDetail row={open} me={me} canViewAny={canAny} cache={ds.cache} onBack={() => setOpen(null)} onReload={reload}/>}
        </>
      )}
    </>
  )
}
