/**
 * sessionScores.js — the Admin Sessions table, as pure data.
 *
 * READ-ONLY. Joins four things already in the sheets, in memory, by SESSION ID:
 *   field_sessions  one row per saved session
 *   scores          one row per comparison run, written by Comparison (never written here)
 *   session_edits   the Admin "Edit session" log (who changed match_id / half, and when)
 *   roster          collector name and role, by HR code
 * No I/O in this file, so every rule below is unit-tested (sessionScores.test.mjs).
 *
 * Why session id, not match id + HR code: a scores row copies its match_id and half from the MODEL session at run
 * time, and Admin can correct a session's match_id or half afterwards. Joining on those would link the wrong run.
 */
import { toSheetHalf } from './fieldSheetSync'
import { EDIT_LOG_HEADER } from './sessionEdit'

const norm = v => String(v ?? '').trim()
const lower = v => norm(v).toLowerCase()
const normCode = v => norm(v).replace(/\s+/g, '').toUpperCase()
const num = v => { const t = norm(v); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null }

/** [key in the sheet, key in moduleStats, label] */
export const MODULES = [
  ['a', 'A', 'A'], ['b', 'B', 'B'], ['c', 'C', 'C'], ['d', 'D', 'D'], ['to', 'TO', 'TO'], ['pressure', 'PRESSURE', 'Pressure'],
]

const toObjects = values => {
  const header = (values[0] || []).map(norm)
  return values.slice(1).map((r, i) => {
    const o = { _row: i + 2 }
    header.forEach((h, j) => { if (h) o[h] = norm(r?.[j]) })
    return o
  })
}

// ── scores ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * One scores row → one run. A module cell whose `_events` is blank was never written: the run predates the module
 * breakdown (v7.8.85) and has no module numbers at all. That is different from `_events` = 0, a module the model
 * answer does not cover. Both display as "-", but only the second is real "no data".
 */
export function parseRun(o, order) {
  const modules = {}
  for (const [k] of MODULES) {
    const events = num(o[k + '_events'])
    modules[k] = { score: num(o[k + '_score']), correct: num(o[k + '_correct']), events, recorded: events !== null }
  }
  const at = norm(o.run_timestamp_iso)
  return {
    runId: norm(o.run_id), at, atMs: Date.parse(at), order,
    modelSessionId: norm(o.model_session_id), collectorSessionId: norm(o.collector_session_id),
    overall: num(o.score),
    totalModel: num(o.total_model_events),
    correct: num(o.correct), missing: num(o.missing_event), extra: num(o.extra_event), wrongSide: num(o.wrong_side),
    wrongTime: num(o.wrong_timestamp), wrongExtra: num(o.wrong_extra), missExtra: num(o.missing_extra), notNeeded: num(o.not_needed_extra),
    modules,
  }
}

/** collector_session_id → runs, newest first (by run_timestamp_iso; the later sheet row wins a tie or a blank time). */
export function buildRunIndex(scoreValues) {
  const idx = new Map()
  toObjects(scoreValues).forEach((o, i) => {
    const sid = norm(o.collector_session_id); if (!sid) return
    if (!idx.has(sid)) idx.set(sid, [])
    idx.get(sid).push(parseRun(o, i))
  })
  for (const runs of idx.values()) {
    runs.sort((x, y) => ((Number.isNaN(y.atMs) ? -Infinity : y.atMs) - (Number.isNaN(x.atMs) ? -Infinity : x.atMs)) || (y.order - x.order))
  }
  return idx
}

// ── session_edits ────────────────────────────────────────────────────────────────────────────────────────────
/** session_id → applied edits. "NOT APPLIED" rows never changed anything, so they are ignored. */
export function buildEditIndex(editValues) {
  const idx = new Map()
  toObjects(editValues).forEach(o => {
    const sid = norm(o.session_id); if (!sid || lower(o.status) !== 'applied') return
    if (!idx.has(sid)) idx.set(sid, [])
    idx.get(sid).push({ at: norm(o.timestamp_iso), atMs: Date.parse(o.timestamp_iso), field: norm(o.field), by: norm(o.changed_by), from: norm(o.old_value), to: norm(o.new_value) })
  })
  return idx
}

/**
 * THE STALE RULE. A run is stale when the session's match_id or half was edited AFTER the run was written:
 * the run was computed for a session that said something else. A `part` edit alone does not count (it only
 * follows a half edit, which is logged on its own row). A run with no readable time cannot be proved current,
 * so any match/half edit makes it stale. An edit made BEFORE the run does not.
 */
export function isRunStale(run, edits) {
  if (!edits || !edits.length) return false
  return edits.some(e => (e.field === 'match_id' || e.field === 'half') && (Number.isNaN(run.atMs) || Number.isNaN(e.atMs) || e.atMs > run.atMs))
}

// ── the joined rows ────────────────────────────────────────────────────────────────────────────────────────
/**
 * @param raw  { sessions: field_sessions values, scores: {ok,values,error}, edits: {ok,values,error}, roster: {ok,list,error} }
 * @param eventCounts  Map(session_id → events) or null while it is still loading
 * Returns { rows, notes } — notes lists every source that could not be read, so the screen can say why.
 */
export function buildSessionRows(raw, eventCounts = null) {
  const notes = []
  const scoresOk = raw.scores?.ok !== false, editsOk = raw.edits?.ok !== false, rosterOk = raw.roster?.ok !== false
  if (!scoresOk) notes.push({ source: 'scores', message: raw.scores.error })
  if (!editsOk) notes.push({ source: 'session_edits', message: raw.edits.error })
  if (!rosterOk) notes.push({ source: 'roster', message: raw.roster.error })
  const runs = scoresOk ? buildRunIndex(raw.scores.values || []) : new Map()
  const edits = editsOk ? buildEditIndex(raw.edits.values || []) : new Map()
  const byCode = new Map(), byMail = new Map()
  ;(rosterOk ? raw.roster.list || [] : []).forEach(p => { if (p.code) byCode.set(normCode(p.code), p); if (p.email) byMail.set(lower(p.email), p) })

  const sess = toObjects(raw.sessions || []).filter(o => o.session_id)
  // a model answer exists for a match+half when a model session is approved (blank counts), the same rule Tag uses
  const models = new Set(sess.filter(o => o.is_model === '1' && ['', 'approved'].includes(lower(o.model_status))).map(o => `${o.match_id}|${toSheetHalf(o.half)}`))

  const rows = sess.map(o => {
    const person = byCode.get(normCode(o.collector_hr_code)) || byMail.get(lower(o.collector_email)) || null
    const list = (runs.get(o.session_id) || []).map(r => ({ ...r, stale: isRunStale(r, edits.get(o.session_id)) }))
    const isModel = o.is_model === '1'
    const state = isModel ? 'model' : !scoresOk ? 'unknown' : !list.length ? 'not_compared' : list[0].stale ? 'stale' : 'compared'
    const half = toSheetHalf(o.half) || o.half
    const savedAt = o.export_date || (o.collection_end_wall_iso || '').slice(0, 10)
    return {
      ...o, rowNumber: o._row, key: o.session_id, isModel, half, halfRaw: o.half,
      savedAt, savedSort: o.collection_end_wall_iso || o.export_date || '',
      collectorName: person?.name || '', collectorRole: person?.role || '',
      hasModel: models.has(`${o.match_id}|${half}`),
      incomplete: o.collection_incomplete === '1',
      edited: (edits.get(o.session_id) || []).length > 0,
      events: eventCounts ? (eventCounts.get(o.session_id) ?? 0) : null,
      runs: list, run: list[0] || null, runCount: list.length, state,
    }
  })
  return { rows, notes, editsOk, scoresOk }
}

// ── what a score cell says ───────────────────────────────────────────────────────────────────────────────────
const pct = n => `${Number.isInteger(n) ? n : n.toFixed(1)}%`
export const STATE_TEXT = { model: 'Model answer', not_compared: 'Not compared', stale: 'Stale, match changed', compared: 'Compared', unknown: 'Scores unavailable' }

/**
 * One score cell. kind tells the screen how to dress it; text is also what the CSV carries.
 * `which` is 'overall' or a module key (a b c d to pressure).
 */
export function scoreCell(row, which) {
  if (row.state === 'model') return which === 'overall' ? { kind: 'model', text: 'Model answer' } : { kind: 'blank', text: '' }
  if (row.state === 'not_compared') return which === 'overall' ? { kind: 'notcompared', text: 'Not compared' } : { kind: 'blank', text: '' }
  if (row.state === 'unknown') return which === 'overall' ? { kind: 'unknown', text: 'Scores unavailable' } : { kind: 'blank', text: '' }
  const r = row.run
  const m = which === 'overall' ? null : r.modules[which]
  const score = which === 'overall' ? r.overall : m.score
  let cell
  if (score === null) cell = { kind: which !== 'overall' && !m.recorded ? 'norecord' : 'nodata', text: '-' }
  else cell = { kind: 'value', text: pct(score), value: score, detail: m ? `${m.correct ?? '?'} of ${m.events ?? '?'} correct` : null }
  return row.state === 'stale' ? { ...cell, stale: true } : cell
}

/** A count cell: a number, or '' when the run did not record it. */
export const countCell = (row, key) => (row.run && row.state !== 'unknown' && row.state !== 'model' && row.run[key] !== null && row.run[key] !== undefined) ? String(row.run[key]) : ''

// ── columns ────────────────────────────────────────────────────────────────────────────────────────────────
const sv = k => r => r[k] ?? ''
const scoreSort = which => r => { const c = scoreCell(r, which); return c.kind === 'value' && !c.stale ? c.value : null }
const scoreCsv = which => r => { const c = scoreCell(r, which); return c.stale ? '' : c.kind === 'value' ? String(c.value) : c.kind === 'nodata' || c.kind === 'norecord' ? '' : '' }
const countSort = key => r => (r.state === 'compared' && r.run && r.run[key] !== null ? r.run[key] : null)
const countCsv = key => r => (r.state === 'compared' ? countCell(r, key) : '')

/**
 * Every column the table can show, in display order. `def` = on by default. `sort(row)` gives the value to sort by
 * (null sorts last); `csv(row)` gives the CSV text. For CSV, a STALE run's numbers are left blank and the status says why.
 */
export const COLUMNS = [
  { key: 'match', label: 'Match ID', def: true, sort: sv('match_id'), csv: sv('match_id') },
  { key: 'half', label: 'Half', def: true, sort: sv('half'), csv: sv('half') },
  { key: 'part', label: 'Part', def: false, sort: r => num(r.part), csv: sv('part') },
  { key: 'collector', label: 'Collector', def: true, sort: r => lower(r.collector_hr_code), csv: sv('collector_hr_code') },
  { key: 'name', label: 'Name', def: false, sort: r => lower(r.collectorName), csv: sv('collectorName') },
  { key: 'role', label: 'Role', def: false, sort: r => lower(r.collectorRole), csv: sv('collectorRole') },
  { key: 'email', label: 'Email', def: false, sort: r => lower(r.collector_email), csv: sv('collector_email') },
  { key: 'method', label: 'Method', def: true, sort: sv('collection_method'), csv: sv('collection_method') },
  { key: 'events', label: 'Events', def: true, sort: r => r.events, csv: r => (r.events === null ? '' : String(r.events)) },
  { key: 'overall', label: 'Overall', def: true, sort: scoreSort('overall'), csv: scoreCsv('overall') },
  ...MODULES.map(([k, , label]) => ({ key: k, label: label, def: k === 'to' || k === 'pressure', sort: scoreSort(k), csv: scoreCsv(k) })),
  { key: 'status', label: 'Compared', def: true, sort: r => STATE_TEXT[r.state], csv: r => STATE_TEXT[r.state] },
  { key: 'runs', label: 'Runs', def: false, sort: r => r.runCount, csv: r => String(r.runCount) },
  { key: 'runAt', label: 'Run time', def: false, sort: r => (r.run && r.state !== 'model' ? r.run.at : null), csv: r => (r.state === 'compared' && r.run ? r.run.at : '') },
  { key: 'modelSession', label: 'Compared against', def: false, sort: r => (r.run ? r.run.modelSessionId : null), csv: r => (r.state === 'compared' && r.run ? r.run.modelSessionId : '') },
  { key: 'totalModel', label: 'Model events', def: false, sort: countSort('totalModel'), csv: countCsv('totalModel') },
  { key: 'correct', label: 'Correct', def: false, sort: countSort('correct'), csv: countCsv('correct') },
  { key: 'missing', label: 'Missing', def: false, sort: countSort('missing'), csv: countCsv('missing') },
  { key: 'extra', label: 'Extra', def: false, sort: countSort('extra'), csv: countCsv('extra') },
  { key: 'wrongSide', label: 'Wrong side', def: false, sort: countSort('wrongSide'), csv: countCsv('wrongSide') },
  { key: 'wrongTime', label: 'Wrong time', def: false, sort: countSort('wrongTime'), csv: countCsv('wrongTime') },
  { key: 'wrongExtra', label: 'Wrong extra', def: false, sort: countSort('wrongExtra'), csv: countCsv('wrongExtra') },
  { key: 'missExtra', label: 'Miss extra', def: false, sort: countSort('missExtra'), csv: countCsv('missExtra') },
  { key: 'notNeeded', label: 'Not needed extra', def: false, sort: countSort('notNeeded'), csv: countCsv('notNeeded') },
  { key: 'saved', label: 'Saved', def: false, sort: r => r.savedSort, csv: sv('savedAt') },
  { key: 'type', label: 'Type', def: false, sort: r => (r.isModel ? 'Model answer' : 'Collector'), csv: r => (r.isModel ? 'Model answer' : 'Collector') },
  { key: 'video', label: 'Video file', def: false, sort: r => lower(r.video_filename), csv: sv('video_filename') },
  { key: 'teams', label: 'Teams', def: false, sort: r => lower(r.home_team_name), csv: r => [r.home_team_name, r.away_team_name].filter(Boolean).join(' v ') },
  { key: 'hasModel', label: 'Model exists', def: false, sort: r => (r.hasModel ? 1 : 0), csv: r => (r.hasModel ? 'yes' : 'no') },
  { key: 'flags', label: 'Flags', def: false, sort: r => (r.incomplete ? 1 : 0) + (r.edited ? 1 : 0), csv: r => [r.incomplete && 'incomplete (no Half end)', r.edited && 'edited by Admin'].filter(Boolean).join('; ') },
  { key: 'session', label: 'Session ID', def: false, sort: sv('session_id'), csv: sv('session_id') },
]
export const DEFAULT_COLUMNS = COLUMNS.filter(c => c.def).map(c => c.key)

// ── filters ────────────────────────────────────────────────────────────────────────────────────────────────
export const EMPTY_FILTERS = {
  q: '', matchIds: '', hrCodes: '', video: '',
  halves: [], parts: [], roles: [], types: [], status: [], methods: [], hasModel: [], flags: [],
  overallMin: '', overallMax: '', toMin: '', toMax: '', pressureMin: '', pressureMax: '',
  hasTO: false, hasPressure: false, from: '', to: '', eventsMin: '', eventsMax: '',
}
const words = s => norm(s).split(/[\s,;]+/).filter(Boolean)
const inRange = (v, min, max) => {
  const lo = num(min), hi = num(max)
  if (lo === null && hi === null) return true
  if (v === null || v === undefined) return false
  return (lo === null || v >= lo) && (hi === null || v <= hi)
}
const scoreOf = (row, which) => { const c = scoreCell(row, which); return c.kind === 'value' && !c.stale ? c.value : null }

/** How many filters are doing something (for the "Clear all filters" button). */
export const activeFilterCount = f => Object.entries(EMPTY_FILTERS).filter(([k, d]) => Array.isArray(d) ? f[k].length : d === false ? f[k] : norm(f[k]) !== '').length

/** All filters together (AND). A filter left empty does nothing. */
export function applyFilters(rows, f) {
  const q = lower(f.q), ids = words(f.matchIds), hrs = words(f.hrCodes).map(normCode), vid = lower(f.video)
  const scoreFiltersOn = [f.overallMin, f.overallMax, f.toMin, f.toMax, f.pressureMin, f.pressureMax].some(v => norm(v) !== '')
  return rows.filter(r => {
    if (q && ![r.match_id, r.session_id, r.collector_hr_code, r.collectorName, r.collector_email].some(v => lower(v).includes(q))) return false
    if (ids.length && !ids.includes(r.match_id)) return false
    if (hrs.length && !hrs.includes(normCode(r.collector_hr_code))) return false
    if (f.halves.length && !f.halves.includes(r.half)) return false
    if (f.parts.length && !f.parts.includes(r.part)) return false
    if (f.roles.length && !f.roles.includes(r.collectorRole)) return false
    if (f.types.length && !f.types.includes(r.isModel ? 'model' : 'collector')) return false
    if (f.status.length && !f.status.includes(r.state)) return false
    if (f.methods.length && !f.methods.includes(r.collection_method || 'none')) return false
    if (f.hasModel.length && !f.hasModel.includes(r.hasModel ? 'yes' : 'no')) return false
    if (f.flags.includes('incomplete') && !r.incomplete) return false
    if (f.flags.includes('edited') && !r.edited) return false
    if (vid && !lower(r.video_filename).includes(vid)) return false
    if (f.from && !(r.savedAt && r.savedAt >= f.from)) return false
    if (f.to && !(r.savedAt && r.savedAt <= f.to)) return false
    if (norm(f.eventsMin) !== '' || norm(f.eventsMax) !== '') { if (!inRange(r.events, f.eventsMin, f.eventsMax)) return false }
    if (scoreFiltersOn) {
      if (!inRange(scoreOf(r, 'overall'), f.overallMin, f.overallMax)) return false
      if (!inRange(scoreOf(r, 'to'), f.toMin, f.toMax)) return false
      if (!inRange(scoreOf(r, 'pressure'), f.pressureMin, f.pressureMax)) return false
    }
    // "Module has data": the module had model events in the run shown. A stale run cannot say.
    if (f.hasTO || f.hasPressure) {
      if (r.state !== 'compared') return false
      if (f.hasTO && !(r.run.modules.to.events > 0)) return false
      if (f.hasPressure && !(r.run.modules.pressure.events > 0)) return false
    }
    return true
  })
}

// ── sort ─────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE collator, made once: calling String.localeCompare(a, b, options) builds a collator on every comparison, which
// made sorting 20,000 rows take about a second. numeric:true so "1H, 2H, ET1" and match ids sort sensibly.
const collator = new Intl.Collator(undefined, { numeric: true })

/** Empty values always go last, whichever way the column is sorted; ties keep sheet order, newest first. */
export function sortRows(rows, key, dir = 'desc') {
  const col = COLUMNS.find(c => c.key === key) || COLUMNS.find(c => c.key === 'saved')
  const sign = dir === 'asc' ? 1 : -1
  const empty = v => v === null || v === undefined || v === ''
  return rows.map(r => [r, col.sort(r)]).sort((a, b) => {
    const x = a[1], y = b[1], ex = empty(x), ey = empty(y)
    if (ex !== ey) return ex ? 1 : -1
    if (!ex) { const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y)); if (c) return c * sign }
    return b[0].rowNumber - a[0].rowNumber
  }).map(t => t[0])
}

// ── averages ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Mean of each session's latest score over the rows given. Stale, not-compared and model sessions are left out, and a
 *  "-" (no data) is not a zero: it is skipped, so each metric has its own n. */
export function averages(rows) {
  const out = {}
  for (const w of ['overall', ...MODULES.map(m => m[0])]) {
    const vals = rows.map(r => (r.state === 'compared' ? scoreOf(r, w) : null)).filter(v => v !== null)
    out[w] = { n: vals.length, mean: vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10 : null }
  }
  out.sessions = rows.filter(r => r.state === 'compared').length
  return out
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────────────────
const cq = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
/** Every column, hidden ones included. Rows are the filtered, sorted rows. A stale run's numbers are blank. */
export function toCsv(rows, columns = COLUMNS) {
  const lines = [columns.map(c => cq(c.label)).join(',')]
  rows.forEach(r => lines.push(columns.map(c => cq(c.csv(r))).join(',')))
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

// ── after an Admin edit ────────────────────────────────────────────────────────────────────────────────────
/**
 * The in-memory copy after editFieldSession succeeded: the changed cells are updated and the log rows are added, so the
 * row shows its new values and the Stale flag at once, without reading the sheets again. Pure: returns a new dataset.
 */
export function patchAfterEdit(raw, row, changes, who, at = new Date().toISOString()) {
  const header = (raw.sessions[0] || []).map(norm)
  const sessions = raw.sessions.slice()
  const cells = (sessions[row.rowNumber - 1] || []).slice()
  changes.forEach(c => { const i = header.indexOf(c.field); if (i >= 0) cells[i] = c.to })
  sessions[row.rowNumber - 1] = cells
  if (raw.edits.ok === false) return { ...raw, sessions }
  const base = raw.edits.values?.length ? raw.edits.values : [EDIT_LOG_HEADER]
  const added = changes.map(c => {
    const o = { timestamp_iso: at, changed_by: who, session_id: row.session_id, collector_hr_code: row.collector_hr_code, field: c.field, old_value: c.from, new_value: c.to, status: 'applied' }
    return (base[0] || EDIT_LOG_HEADER).map(h => o[norm(h)] ?? '')
  })
  return { ...raw, sessions, edits: { ...raw.edits, values: [...base, ...added] } }
}
