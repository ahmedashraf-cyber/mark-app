/**
 * SessionsTable.jsx — the Admin Sessions table (Batch Manager only: AdminPage refuses everyone else).
 *
 * READ-ONLY VIEW. It shows rows that sessionScores.js has already joined in memory; it reads no sheet and writes
 * nothing. Filtering, sorting and paging happen on those rows, so no keystroke ever triggers a sheet read.
 * Clicking a row hands it to `onOpen`: the existing Edit panel (owned by AdminPage) does the rest.
 */
import { useEffect, useMemo, useState } from 'react'
import MultiFilter from './MultiFilter'
import {
  COLUMNS, DEFAULT_COLUMNS, EMPTY_FILTERS, applyFilters, activeFilterCount, sortRows, averages, scoreCell, countCell,
  STATE_TEXT, MODULES, toCsv,
} from '../utils/sessionScores'
import { HALF_CHOICES } from '../utils/sessionEdit'
import { showToast } from '../utils/toast'

const COLS_KEY = 'mark_admin_session_cols'
const PAGE_SIZES = [50, 100, 250, 500]

const td = { padding: '6px 8px', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.05)', whiteSpace: 'nowrap' }
const th = { padding: '7px 8px', fontSize: 9, fontWeight: 800, color: 'var(--t-3)', letterSpacing: 0.5, textTransform: 'uppercase',
  textAlign: 'left', borderBottom: '1px solid var(--b-1)', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }
const input = { background: 'var(--bg-3)', border: '1px solid var(--b-1)', borderRadius: 6, padding: '6px 9px', fontSize: 11, color: 'var(--t-1)', outline: 'none' }
const btn = { padding: '5px 11px', fontSize: 11, background: 'transparent', border: '1px solid var(--b-1)', borderRadius: 6, color: 'var(--t-2)', cursor: 'pointer' }
const label = { fontSize: 9, fontWeight: 800, color: 'var(--t-3)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 }
const mono = { fontFamily: 'JetBrains Mono,monospace' }
const muted = { color: 'var(--t-3)' }

const STATE_COLOR = { compared: '#30D158', stale: '#FF9F0A', not_compared: 'var(--t-3)', model: '#64D2FF', unknown: '#FF9F0A' }

/** Remembered for the session (cleared when the app closes), not across restarts. */
function loadCols() {
  try {
    const v = JSON.parse(sessionStorage.getItem(COLS_KEY))
    if (Array.isArray(v) && v.length && v.every(k => COLUMNS.some(c => c.key === k))) return v
  } catch { /* fall through */ }
  return DEFAULT_COLUMNS
}

/** One score cell, dressed by what it says. The same cell function feeds the CSV. */
function Score({ row, which }) {
  const c = scoreCell(row, which)
  if (c.kind === 'blank') return null
  const style = c.kind === 'value' ? { color: c.stale ? 'var(--t-3)' : 'var(--t-1)', textDecoration: c.stale ? 'line-through' : 'none', ...mono }
    : c.kind === 'notcompared' ? { ...muted, fontStyle: 'italic' }
    : c.kind === 'model' ? { color: '#64D2FF' }
    : c.kind === 'unknown' ? { color: '#FF9F0A' }
    : muted          // '-' : no data
  const tip = c.kind === 'norecord' ? 'This run was written before module scores existed, so it has none.'
    : c.kind === 'nodata' ? 'The model answer has no events for this.'
    : c.detail || undefined
  return <span style={style} title={tip}>{c.text}</span>
}

function Cell({ col, row, badgeIn, onBadge, expanded }) {
  const badge = row.runCount > 1 && badgeIn === col.key
    ? <button data-testid="runs-badge" title="Show the earlier runs" onClick={e => { e.stopPropagation(); onBadge(row.key) }}
        style={{ marginLeft: 6, padding: '0 6px', fontSize: 9, borderRadius: 8, cursor: 'pointer', color: 'var(--t-2)',
          border: '1px solid var(--b-1)', background: expanded ? 'rgba(232,89,12,0.14)' : 'transparent' }}>{row.runCount} runs</button> : null
  switch (col.key) {
    case 'overall': return <><Score row={row} which="overall"/>{badge}</>
    case 'a': case 'b': case 'c': case 'd': case 'to': case 'pressure': return <Score row={row} which={col.key}/>
    case 'status': return <><span data-testid="status" style={{ color: STATE_COLOR[row.state] }}>{STATE_TEXT[row.state]}</span>{badge}</>
    case 'events': return row.events === null ? <span style={muted} title="Counting events…">…</span> : String(row.events)
    case 'match': return <span style={mono}>{row.match_id}</span>
    case 'session': return <span style={{ ...mono, fontSize: 9, ...muted }}>{row.session_id}</span>
    case 'video': return <span title={row.video_filename} style={{ display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }}>{row.video_filename}</span>
    case 'method': return row.collection_method === 'all' ? 'All events' : row.collection_method === 'partial' ? 'Not all events' : <span style={muted}>-</span>
    case 'collector': return <span title={row.collectorName}>{row.collector_hr_code}</span>
    case 'type': return row.isModel ? <span style={{ color: '#64D2FF' }}>Model answer</span> : 'Collector'
    case 'hasModel': return row.hasModel ? 'yes' : 'no'
    case 'flags': return <>{row.incomplete && <span title="collection_incomplete = 1: saved without a Half end" style={{ color: '#FF9F0A', marginRight: 6 }}>no Half end</span>}{row.edited && <span title="Edited by Admin" style={{ color: '#64D2FF' }}>edited</span>}</>
    case 'runAt': return row.run && row.state !== 'model' ? <span style={mono}>{row.run.at.replace('T', ' ').slice(0, 16)}</span> : null
    case 'modelSession': return row.run && row.state !== 'model' ? <span style={{ ...mono, fontSize: 9 }} title={row.run.modelSessionId}>{row.run.modelSessionId}</span> : null
    case 'runs': return row.runCount ? String(row.runCount) : null
    case 'teams': return [row.home_team_name, row.away_team_name].filter(Boolean).join(' v ')
    case 'totalModel': case 'correct': case 'missing': case 'extra': case 'wrongSide': case 'wrongTime': case 'wrongExtra': case 'missExtra': case 'notNeeded':
      return countCell(row, col.key)
    default: return col.csv(row)
  }
}

const Field = ({ name, children, w }) => <div style={{ width: w }}><div style={label}>{name}</div>{children}</div>
const Range = ({ name, min, max, onMin, onMax, ...p }) => (
  <Field name={name}><div style={{ display: 'flex', gap: 4 }}>
    <input type="number" placeholder="min" value={min} onChange={e => onMin(e.target.value)} style={{ ...input, width: 62 }} {...p}/>
    <input type="number" placeholder="max" value={max} onChange={e => onMax(e.target.value)} style={{ ...input, width: 62 }} {...p}/>
  </div></Field>
)

export default function SessionsTable({ rows, notes, eventsState, loadedAt, reloading, onReload, onOpen, editingKey }) {
  const [f, setF] = useState(EMPTY_FILTERS)
  const set = patch => setF(x => ({ ...x, ...patch }))
  const [sortKey, setSortKey] = useState('saved')
  const [sortDir, setSortDir] = useState('desc')            // newest first by default
  const [visible, setVisible] = useState(loadCols)
  const [colsOpen, setColsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [pageSize, setPageSize] = useState(100)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(() => new Set())         // sessions whose earlier runs are listed

  useEffect(() => { try { sessionStorage.setItem(COLS_KEY, JSON.stringify(visible)) } catch { /* not remembered */ } }, [visible])
  useEffect(() => { setPage(1) }, [f, sortKey, sortDir, pageSize])

  const filtered = useMemo(() => applyFilters(rows, f), [rows, f])
  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir])
  const avg = useMemo(() => averages(filtered), [filtered])
  const roles = useMemo(() => [...new Set(rows.map(r => r.collectorRole).filter(Boolean))].sort(), [rows])
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const cur = Math.min(page, pages)
  const pageRows = sorted.slice((cur - 1) * pageSize, cur * pageSize)
  const cols = COLUMNS.filter(c => visible.includes(c.key))
  const badgeIn = visible.includes('overall') ? 'overall' : 'status'
  const nActive = activeFilterCount(f)
  const toggleRuns = key => setOpen(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const sortBy = key => { if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(key); setSortDir(key === 'saved' || key === 'events' || COLUMNS.find(c => c.key === key)?.label.match(/Overall|^[A-D]$|TO|Pressure/) ? 'desc' : 'asc') } }

  const exportCsv = async () => {
    const name = `sessions_${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.csv`
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const path = await invoke('save_text_file_dialog', { name, content: toCsv(sorted, COLUMNS) })
      if (path) showToast(`Saved ${sorted.length} session${sorted.length === 1 ? '' : 's'} to ${path}`)
    } catch (e) { showToast(`Could not save ${name}: ${e?.message || e}`, 'error') }
  }

  const note = n => ({
    scores: "Couldn't read the scores tab. Compared status and scores are unavailable; these sessions are NOT 'not compared'.",
    session_edits: "Couldn't read session_edits. Stale scores can't be detected, so scores may be out of date, and 'edited by Admin' is unavailable.",
    roster: "Couldn't read the roster. Collector names and roles are unavailable.",
  })[n.source]
  const warn = { fontSize: 11, lineHeight: 1.6, padding: '8px 12px', borderRadius: 8, color: '#FF9F0A', border: '1px solid rgba(255,159,10,0.4)', background: 'rgba(255,159,10,0.08)', marginBottom: 8 }

  return (
    <div data-testid="sessions-table">
      {notes.map(n => <div key={n.source} data-testid="load-note" style={warn}>⚠ {note(n)} <span style={{ ...muted }}>({n.message})</span></div>)}
      {eventsState.status === 'loading' && <div data-testid="events-loading" style={{ fontSize: 10, ...muted, marginBottom: 8 }}>Counting events… (the Events column and filter fill in when it finishes)</div>}
      {eventsState.status === 'error' && <div data-testid="events-error" style={warn}>⚠ Couldn&rsquo;t count events, so the Events column and filter are unavailable. <span style={muted}>({eventsState.error})</span></div>}

      {/* toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input data-testid="f-search" style={{ ...input, flex: 1, minWidth: 220 }} value={f.q} placeholder="Search match ID, session ID, HR-code, collector name or email"
          onChange={e => set({ q: e.target.value })}/>
        <button style={btn} onClick={() => setMoreOpen(o => !o)}>{moreOpen ? 'Hide filters' : 'More filters'}{nActive ? ` · ${nActive} on` : ''}</button>
        <button data-testid="clear-filters" style={{ ...btn, opacity: nActive ? 1 : 0.45 }} disabled={!nActive} onClick={() => setF(EMPTY_FILTERS)}>Clear all filters</button>
        <div style={{ position: 'relative' }}>
          <button data-testid="cols-btn" style={btn} onClick={() => setColsOpen(o => !o)}>Columns ({visible.length})</button>
          {colsOpen && (
            <div data-testid="cols-menu" style={{ position: 'absolute', right: 0, top: 30, zIndex: 20, width: 250, maxHeight: 360, overflowY: 'auto', padding: 10,
              background: 'var(--bg-2)', border: '1px solid var(--b-1)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
              {COLUMNS.map(c => (
                <label key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, padding: '3px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={visible.includes(c.key)} data-testid={`col-${c.key}`}
                    onChange={() => setVisible(v => (v.includes(c.key) ? (v.length > 1 ? v.filter(k => k !== c.key) : v) : COLUMNS.map(x => x.key).filter(k => k === c.key || v.includes(k))))}/>
                  {c.label}
                </label>))}
              <button style={{ ...btn, marginTop: 8, width: '100%' }} onClick={() => setVisible(DEFAULT_COLUMNS)}>Reset to default</button>
            </div>)}
        </div>
        <button data-testid="export-csv" style={btn} disabled={!sorted.length} onClick={exportCsv}>Export CSV ({sorted.length})</button>
        <button data-testid="reload" style={btn} disabled={reloading} onClick={onReload}>{reloading ? 'Reloading…' : 'Reload'}</button>
      </div>

      {moreOpen && (
        <div data-testid="filters-panel" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 12, marginBottom: 10, border: '1px solid var(--b-1)', borderRadius: 10, background: 'var(--bg-3)' }}>
          <Field name="Match ID(s)"><input data-testid="f-match" style={{ ...input, width: 150 }} value={f.matchIds} placeholder="1366067, 1454815" onChange={e => set({ matchIds: e.target.value })}/></Field>
          <Field name="Half"><MultiFilter label="All halves" width={120} options={HALF_CHOICES.map(([v, l]) => ({ value: v, label: `${v} · ${l}` }))} selected={f.halves} onChange={halves => set({ halves })}/></Field>
          <Field name="Part"><MultiFilter label="All parts" width={110} options={['1', '2', '3', '4', '5']} selected={f.parts} onChange={parts => set({ parts })}/></Field>
          <Field name="Collector HR-code(s)"><input data-testid="f-hr" style={{ ...input, width: 140 }} value={f.hrCodes} placeholder="C-77, C-12" onChange={e => set({ hrCodes: e.target.value })}/></Field>
          <Field name="Collector role"><MultiFilter label="Any role" width={170} options={roles} selected={f.roles} onChange={r => set({ roles: r })}/></Field>
          <Field name="Type"><MultiFilter label="Any type" width={130} options={[{ value: 'collector', label: 'Collector session' }, { value: 'model', label: 'Model answer' }]} selected={f.types} onChange={types => set({ types })}/></Field>
          <Field name="Compared"><MultiFilter label="Any status" width={140} options={[{ value: 'compared', label: 'Compared' }, { value: 'not_compared', label: 'Not compared' }, { value: 'stale', label: 'Stale, match changed' }]} selected={f.status} onChange={status => set({ status })}/></Field>
          <Field name="Collection method"><MultiFilter label="Any method" width={150} options={[{ value: 'partial', label: 'Not all events' }, { value: 'all', label: 'All events' }, { value: 'none', label: '(not recorded)' }]} selected={f.methods} onChange={methods => set({ methods })}/></Field>
          <Range name="Overall %" min={f.overallMin} max={f.overallMax} onMin={v => set({ overallMin: v })} onMax={v => set({ overallMax: v })}/>
          <Range name="TO %" min={f.toMin} max={f.toMax} onMin={v => set({ toMin: v })} onMax={v => set({ toMax: v })}/>
          <Range name="Pressure %" min={f.pressureMin} max={f.pressureMax} onMin={v => set({ pressureMin: v })} onMax={v => set({ pressureMax: v })}/>
          <Field name="Module has data">
            <div style={{ display: 'flex', gap: 10, fontSize: 11, paddingTop: 5 }}>
              <label style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="f-hasto" checked={f.hasTO} onChange={e => set({ hasTO: e.target.checked })}/> TO</label>
              <label style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="f-haspressure" checked={f.hasPressure} onChange={e => set({ hasPressure: e.target.checked })}/> Pressure</label>
            </div></Field>
          <Field name="Saved from"><input type="date" style={input} value={f.from} onChange={e => set({ from: e.target.value })}/></Field>
          <Field name="Saved to"><input type="date" style={input} value={f.to} onChange={e => set({ to: e.target.value })}/></Field>
          <Field name="Model answer exists"><MultiFilter label="Either" width={110} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} selected={f.hasModel} onChange={hasModel => set({ hasModel })}/></Field>
          <Field name="Flags"><MultiFilter label="No flag filter" width={190} options={[{ value: 'incomplete', label: 'Incomplete (no Half end)' }, { value: 'edited', label: 'Edited by Admin' }]} selected={f.flags} onChange={flags => set({ flags })}/></Field>
          <Field name="Video file"><input data-testid="f-video" style={{ ...input, width: 160 }} value={f.video} placeholder="part of the file name" onChange={e => set({ video: e.target.value })}/></Field>
          <Range name="Events" min={f.eventsMin} max={f.eventsMax} onMin={v => set({ eventsMin: v })} onMax={v => set({ eventsMax: v })} disabled={eventsState.status !== 'ready'}/>
        </div>
      )}

      {/* counts + averages */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div data-testid="row-count" style={{ fontSize: 12, fontWeight: 700 }}>Showing {sorted.length} of {rows.length} sessions</div>
        <div style={{ fontSize: 10, ...muted }}>{loadedAt ? `Read from the sheets ${new Date(loadedAt).toLocaleTimeString()}. Filters work on this copy; press Reload to read again.` : ''}</div>
      </div>
      <div data-testid="averages" style={{ fontSize: 10, ...muted, marginBottom: 8, lineHeight: 1.7 }}>
        Average of the latest score over <b style={{ color: 'var(--t-2)' }}>{avg.sessions}</b> compared session{avg.sessions === 1 ? '' : 's'} (stale runs, not-compared and model answers left out):{' '}
        {['overall', ...MODULES.map(m => m[0])].map((k, i) => (
          <span key={k} style={{ marginRight: 10 }}>{k === 'overall' ? 'Overall' : MODULES.find(m => m[0] === k)[2]}{' '}
            <b style={{ color: 'var(--t-2)', ...mono }}>{avg[k].mean === null ? '-' : `${avg[k].mean}%`}</b>{avg[k].n && avg[k].n !== avg.sessions ? ` (${avg[k].n})` : ''}</span>))}
        {notes.some(n => n.source === 'session_edits') && <span style={{ color: '#FF9F0A' }}> · stale runs could not be detected, so these averages may include some</span>}
      </div>

      {/* the table, never empty without saying why */}
      {rows.length === 0 ? (
        <div data-testid="empty-reason" style={{ ...warn, color: 'var(--t-2)', borderColor: 'var(--b-1)', background: 'transparent' }}>The field_sessions tab has no sessions in it.</div>
      ) : sorted.length === 0 ? (
        <div data-testid="empty-reason" style={{ ...warn, color: 'var(--t-2)', borderColor: 'var(--b-1)', background: 'transparent' }}>
          None of the {rows.length} sessions match these filters. <button style={btn} onClick={() => setF(EMPTY_FILTERS)}>Clear all filters</button></div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {cols.map(c => <th key={c.key} data-testid={`th-${c.key}`} style={th} onClick={() => sortBy(c.key)}>{c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}
              <th style={{ ...th, cursor: 'default' }}/>
            </tr></thead>
            <tbody>
              {pageRows.map(r => (
                <FragmentRow key={r.key} r={r} cols={cols} badgeIn={badgeIn} expanded={open.has(r.key)} onBadge={toggleRuns} onOpen={onOpen} editing={editingKey === r.key}/>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* paging */}
      {sorted.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 11 }}>
          <button style={btn} disabled={cur <= 1} data-testid="prev" onClick={() => setPage(cur - 1)}>‹ Prev</button>
          <span data-testid="page-info">Page {cur} of {pages}</span>
          <button style={btn} disabled={cur >= pages} data-testid="next" onClick={() => setPage(cur + 1)}>Next ›</button>
          <span style={{ flex: 1 }}/>
          <span style={muted}>Rows per page</span>
          <select style={{ ...input, cursor: 'pointer' }} value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}</select>
        </div>
      )}
    </div>
  )
}

function FragmentRow({ r, cols, badgeIn, expanded, onBadge, onOpen, editing }) {
  return (
    <>
      <tr data-testid="session-row" data-key={r.key} onClick={() => onOpen(r)}
        style={{ cursor: 'pointer', background: editing ? 'rgba(232,89,12,0.10)' : 'transparent' }}>
        {cols.map(c => <td key={c.key} style={td}><Cell col={c} row={r} badgeIn={badgeIn} onBadge={onBadge} expanded={expanded}/></td>)}
        <td style={td}><button style={btn} onClick={e => { e.stopPropagation(); onOpen(r) }}>Edit</button></td>
      </tr>
      {expanded && (
        <tr data-testid="runs-list"><td colSpan={cols.length + 1} style={{ ...td, background: 'var(--bg-3)', whiteSpace: 'normal' }}>
          <div style={{ fontSize: 9, fontWeight: 800, ...muted, letterSpacing: 0.5, marginBottom: 4 }}>EARLIER RUNS OF THIS SESSION (the newest is the row above)</div>
          {r.runs.slice(1).map(x => {
            const c = scoreCell({ ...r, run: x, state: x.stale ? 'stale' : 'compared' }, 'overall')
            return (
              <div key={x.runId + x.at} data-testid="earlier-run" style={{ display: 'flex', gap: 14, fontSize: 11, padding: '2px 0' }}>
                <span style={mono}>{x.at ? x.at.replace('T', ' ').slice(0, 16) : '(no time)'}</span>
                <span style={{ ...mono, width: 56, textDecoration: x.stale ? 'line-through' : 'none', color: x.stale ? 'var(--t-3)' : 'var(--t-1)' }}>{c.text}</span>
                <span style={{ ...mono, fontSize: 9, ...muted }}>vs {x.modelSessionId || '?'}</span>
                <span style={{ ...mono, fontSize: 9, ...muted }}>run {x.runId}</span>
                {x.stale && <span style={{ color: '#FF9F0A' }}>Stale, match changed</span>}
              </div>)
          })}
        </td></tr>
      )}
    </>
  )
}
