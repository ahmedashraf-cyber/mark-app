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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import SessionsTable from '../components/SessionsTable'
import HalfDetail from '../components/HalfDetail'
import { loadHalvesDataset } from '../utils/myHalvesSheet'
import { buildSessionRows, averages, MODULES } from '../utils/sessionScores'
import { HALF_COLUMNS, OWN_DEFAULT_COLUMNS, ANY_DEFAULT_COLUMNS, profileOf } from '../utils/myHalves'
import { canonHr, sameHr } from '../utils/hrCode'

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

export default function MyHalvesPage({ onBack }) {
  const { caps, roleInfo } = useAuth()
  const canAny = !!caps?.viewAnyHalves, canOwn = !!caps?.viewOwnHalves
  const me = useMemo(() => ({ hrCode: String(roleInfo?.code || '').trim(), name: roleInfo?.name || '', role: roleInfo?.role || '', email: roleInfo?.email || '' }), [roleInfo])
  const allowed = canAny || canOwn
  const hasCode = !!canonHr(me.hrCode)

  const [load, setLoad] = useState({ status: 'loading', error: '' })
  const [ds, setDs] = useState(null)
  const [open, setOpen] = useState(null)

  const reload = useCallback(async () => {
    setLoad(l => ({ status: l.status === 'ready' ? 'reloading' : 'loading', error: '' }))
    try { setDs(await loadHalvesDataset({ me, canViewAny: canAny })); setLoad({ status: 'ready', error: '' }); setOpen(null) }
    catch (e) { setLoad({ status: 'error', error: e?.message || String(e) }) }
  }, [me, canAny])
  useEffect(() => { if (allowed && (canAny || hasCode)) reload() }, [allowed, canAny, hasCode, reload])

  const built = useMemo(() => {
    if (!ds) return null
    const b = buildSessionRows(ds.raw, ds.eventCounts)
    // a session row does not always carry the collector's email; the roster does, so searching by email finds all their halves
    const email = new Map((ds.raw.roster?.list || []).map(p => [canonHr(p.code), p.email]))
    b.rows = b.rows.map(r => (r.collector_email ? r : { ...r, collector_email: email.get(canonHr(r.collector_hr_code)) || '' }))
    // belt and braces: a collector's list is filtered to their own once more here, so even a bug upstream cannot show another person's half
    return canAny ? b : { ...b, rows: b.rows.filter(r => sameHr(r.collector_hr_code, me.hrCode) && !r.isModel) }
  }, [ds, canAny, me.hrCode])
  const eventsState = !ds ? { status: 'loading' } : ds.eventCounts ? { status: 'ready' } : { status: 'error', error: ds.eventsError }

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
  if (!canAny && !hasCode) return shell(
    <div data-testid="no-hr-code" style={{ fontSize: 13, color: 'var(--t-2)', lineHeight: 1.7, maxWidth: 560 }}>
      Your HR-code could not be found from your sign-in, so there are no halves to show. It is never typed in here. Ask your Batch Manager to check your row in the roster.
    </div>)

  return shell(
    <>
      {load.status === 'loading' && <div data-testid="halves-loading" style={{ fontSize: 12, color: 'var(--t-3)', padding: '18px 0' }}>Reading the sheets…</div>}
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
              above={rows => <Profile rows={rows}/>}/>
          </div>
          {open && <HalfDetail row={open} me={me} canViewAny={canAny} cache={ds.cache} onBack={() => setOpen(null)}/>}
        </>
      )}
    </>
  )
}
