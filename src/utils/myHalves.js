/**
 * myHalves.js — the pure logic behind the read-only "My halves" screen.
 *
 * READ-ONLY, and the whole screen is built on that: nothing here writes, and nothing outside this feature is touched.
 * The list itself reuses the Admin Sessions join (sessionScores.js: newest run per session, the stale rule, "Not
 * compared yet", "-" for a module with no model events). What lives here is what is specific to this screen:
 *   - scoping a collector to their OWN rows before anything is stored or shown
 *   - rebuilding each Event Detail row (comparison_detail stores times, verdict and which attribute groups differed;
 *     the attribute VALUES are in field_events, one column per group, so they are looked up by exact time)
 *   - the filters, the cards, the collection details
 */
import { sameHr } from './hrCode'
import { attrSummary } from './eventAttrs'
import { toSheetHalf, msToReadable } from './fieldSheetSync'
import { COLUMNS, STATE_TEXT } from './halvesScores'
import { MODULES_SPLIT, classifyEventModuleSplit } from './defectTypes'

const norm = v => String(v ?? '').trim()
const num = v => { const t = norm(v); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null }

// ── a collector sees their own rows and no one else's ───────────────────────────────────────────────────────
/**
 * Keep only this collector's sessions (never model answers), and the scores and edits that belong to those sessions.
 * Applied to what was read BEFORE it is stored anywhere, so another collector's rows never reach the screen's state.
 * Matching is by HR-code (hrCode.js), never by anything typed.
 */
export function scopeToCollector(raw, myHr) {
  const header = (raw.sessions?.[0] || []).map(norm)
  const ci = header.indexOf('collector_hr_code'), si = header.indexOf('session_id'), mi = header.indexOf('is_model')
  const sessions = [raw.sessions?.[0] || [], ...(raw.sessions || []).slice(1).filter(r =>
    ci >= 0 && sameHr(r?.[ci], myHr) && norm(r?.[mi]) !== '1')]
  const owned = new Set(sessions.slice(1).map(r => norm(r?.[si])).filter(Boolean))
  const keep = (src, col) => {
    if (!src || src.ok === false) return src
    const values = src.values || []
    const h = (values[0] || []).map(norm), k = h.indexOf(col)
    return { ...src, values: values.length ? [values[0], ...values.slice(1).filter(r => k >= 0 && owned.has(norm(r?.[k])))] : [] }
  }
  return { ...raw, sessions, scores: keep(raw.scores, 'collector_session_id'), edits: keep(raw.edits, 'session_id') }
}

// ── the list's columns ───────────────────────────────────────────────────────────────────────────────────────
const byKey = Object.fromEntries(COLUMNS.map(c => [c.key, c]))
export function fmtDuration(ms) {
  const n = num(ms); if (n === null || n < 0) return ''
  const s = Math.round(n / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
// 'Events/min' and 'Active time' are NOT shown (list, details, CSV): the writer stores collection_elapsed_raw_ms at twice the real active
// time and collection_events_per_min at half the real rate (a known defect, not fixed here). Showing them would show wrong numbers.
// To bring them back once the defect is fixed, restore the two column definitions and the two detail rows below.
const extra = [
  { key: 'start', label: 'Collection start', sort: r => r.collection_start_wall_iso || null, csv: r => r.collection_start_wall_iso || '' },
  { key: 'end', label: 'Collection end', sort: r => r.collection_end_wall_iso || null, csv: r => r.collection_end_wall_iso || '' },
  { key: 'incomplete', label: 'No Half end', sort: r => (r.incomplete ? 1 : 0), csv: r => (r.incomplete ? 'yes' : 'no') },
].map(c => ({ ...c, def: false }))
/** Every column this screen can show, in order. Teams and Saved come right after Match ID and Half for readability. */
export const HALF_COLUMNS = [byKey.match, byKey.teams, byKey.half, byKey.part, byKey.collector, byKey.name, byKey.role, byKey.email,
  byKey.saved, byKey.method, byKey.events, byKey.overall, byKey.a, byKey.b, byKey.c, byKey.d, byKey.to, byKey.pressure,
  byKey.status, byKey.runs, byKey.runAt, byKey.modelSession, byKey.totalModel, byKey.correct, byKey.missing, byKey.extra, byKey.wrongSide,
  byKey.wrongTime, byKey.wrongExtra, byKey.missExtra, byKey.notNeeded, ...extra, byKey.video, byKey.type, byKey.flags, byKey.session]
export const OWN_DEFAULT_COLUMNS = ['match', 'teams', 'half', 'part', 'saved', 'method', 'events', 'overall', 'a', 'b', 'c', 'd', 'to', 'pressure', 'status']
export const ANY_DEFAULT_COLUMNS = ['match', 'teams', 'half', 'part', 'collector', 'name', 'saved', 'method', 'events', 'overall', 'a', 'b', 'c', 'd', 'to', 'pressure', 'status']

// ── one half's detail ────────────────────────────────────────────────────────────────────────────────────────
/**
 * The Event Detail rows for one run, as the Comparison screen shows them.
 *   detailRows   comparison_detail rows of the run (objects)
 *   ownEvents    field_events of the collector's session
 *   modelEvents  field_events of the model session the run used
 * Each side is found by the EXACT video_time_ms the stored row carries (the engine copied it from the event), and
 * an event is handed to one row only, so two events at the same millisecond are not both given to the same row.
 * If an event can no longer be found (the session was saved again after the run) the row keeps its stored values and
 * says so, rather than guessing.
 */
export function buildDetailView(detailRows, ownEvents, modelEvents) {
  const index = evs => { const m = new Map(); (evs || []).forEach(e => { const k = norm(e.video_time_ms); if (!m.has(k)) m.set(k, []); m.get(k).push(e) }); return m }
  const M = index(modelEvents), C = index(ownEvents)
  const take = (map, ms, preferCode) => {
    const list = map.get(norm(ms)); if (!list || !list.length) return null
    let i = preferCode ? list.findIndex(e => e.event_code === preferCode) : -1
    if (i < 0) i = 0
    return list.splice(i, 1)[0]
  }
  return (detailRows || []).map((r, i) => {
    const mMs = norm(r.model_video_time_ms), cMs = norm(r.collector_video_time_ms)
    const mEv = mMs ? take(M, mMs, r.event_code) : null
    const cEv = cMs ? take(C, cMs, r.event_code) : null
    const mCode = mEv?.event_code || (r.verdict !== 'extra_event' ? norm(r.event_code) : '')
    const cCode = cEv?.event_code || (r.verdict === 'extra_event' ? norm(r.event_code) : '')
    const mA = attrSummary(mEv), cA = attrSummary(cEv)
    return {
      i, verdict: norm(r.verdict),
      model_event_code: mCode, collector_event_code: cCode,
      model_attrs: mA.short, model_attrs_full: mA.full, collector_attrs: cA.short, collector_attrs_full: cA.full,
      model_video_time_ms: mMs, collector_video_time_ms: cMs,
      delta_ms: norm(r.delta_ms), model_team: norm(r.model_team), collector_team: norm(r.collector_team),
      model_shape: norm(r.model_shape), attrs_differed: norm(r.attrs_differed), error_weight: norm(r.error_weight),
      event_module: norm(r.event_module) || classifyEventModuleSplit(mCode || cCode),
      // a time was stored but the event is not in the sheet (re-saved since): the row is shown from what was stored
      modelMissing: !!mMs && !mEv, collectorMissing: !!cMs && !cEv,
      gkNote: [mEv, cEv].some(isGkSaveGap),
    }
  })
}

/**
 * Goal-keeper SAVE events: Tag asks for a body state AND a stance, but both are written to the one column
 * attr_gk_body_state, so only the stance reaches the sheet. Known limitation; surfaced rather than hidden.
 */
export function isGkSaveGap(ev) {
  return !!ev && norm(ev.event_code) === 'goal_keeper' && /GK_TYPE_SAVE_(WON|SUCCESS)/.test(norm(ev.attr_type))
}

export const filterOptions = rows => {
  const events = new Set(), verdicts = new Set(), modules = new Set()
  rows.forEach(r => { if (r.model_event_code) events.add(r.model_event_code); if (r.collector_event_code) events.add(r.collector_event_code); if (r.verdict) verdicts.add(r.verdict); if (r.event_module) modules.add(r.event_module) })
  return { events: [...events].sort(), verdicts: [...verdicts].sort(), modules: MODULES_SPLIT.filter(m => modules.has(m)) }
}
/** ANY within one filter, AND across filters (the same rule the Comparison screen uses). */
export const filterDetail = (rows, { events = [], verdicts = [], modules = [] } = {}) => rows.filter(r => {
  if (events.length && !events.includes(r.model_event_code) && !events.includes(r.collector_event_code)) return false
  if (verdicts.length && !verdicts.includes(r.verdict)) return false
  if (modules.length && !modules.includes(r.event_module)) return false
  return true
})

/** The collector's own events as a plain list, always available whether or not the half was compared. */
export function ownEventRows(ownEvents) {
  return (ownEvents || []).map((e, i) => {
    const a = attrSummary(e)
    return { i, seq: norm(e.event_seq), code: norm(e.event_code), label: norm(e.event_label), team: norm(e.team), ms: norm(e.video_time_ms),
      attrs: a.short, attrs_full: a.full, module: classifyEventModuleSplit(norm(e.event_code)), gkNote: isGkSaveGap(e) }
  }).sort((x, y) => (num(x.ms) ?? 0) - (num(y.ms) ?? 0) || (num(x.seq) ?? 0) - (num(y.seq) ?? 0))
}

/** The numbers on the score cards, from the stored run (never re-scored). */
export function runCards(run) {
  if (!run) return null
  return {
    overall: run.overall,
    counts: [['Correct', run.correct, '#30D158'], ['Missing', run.missing, '#FF453A'], ['Extra', run.extra, '#FF9500'],
      ['Wrong side', run.wrongSide, '#BF5AF2', true], ['Wrong time', run.wrongTime, '#64D2FF'], ['Wrong extra', run.wrongExtra, '#FF9F0A'],
      ['Miss extra', run.missExtra, '#FF6B6B'], ['Not needed extra', run.notNeeded, '#8E8E93']].map(([label, value, color, unscored]) => ({ label, value: value ?? 0, color, unscored: !!unscored })),
    totalModel: run.totalModel, totalCollector: run.totalCollector,
    modules: MODULES_SPLIT.map(m => { const k = m === 'PRESSURE' ? 'pressure' : m.toLowerCase(); const st = run.modules[k]; return { module: m, score: st.score, correct: st.correct, events: st.events, recorded: st.recorded } }),
  }
}

/** "Collection details" for one half. */
export function collectionDetails(row) {
  return [
    ['Method', row.collection_method === 'all' ? 'All events' : row.collection_method === 'partial' ? 'Not all events' : '—'],
    ['Part', ({ 1: '1st half', 2: '2nd half', 3: 'Extra time 1', 4: 'Extra time 2', 5: 'Penalties' })[Number(row.part)] || row.part || '—'],
    ['Collection started', row.collection_start_wall_iso ? row.collection_start_wall_iso.replace('T', ' ').slice(0, 19) : '—'],
    ['Collection ended', row.collection_end_wall_iso ? row.collection_end_wall_iso.replace('T', ' ').slice(0, 19) : '—'],
    ['Saved without a Half end', row.incomplete ? 'Yes (collection_incomplete = 1)' : 'No'],
    ['Video file', row.video_filename || '—'],
  ]
}

/** Profile header: only when the rows shown belong to ONE collector. */
export function profileOf(rows) {
  if (!rows.length) return null
  const first = rows[0]
  if (!rows.every(r => sameHr(r.collector_hr_code, first.collector_hr_code))) return null
  // a model answer this person recorded is shown in the list, but it is not one of their collected halves
  const halves = rows.filter(r => !r.isModel).length
  return { name: first.collectorName, role: first.collectorRole, hrCode: first.collector_hr_code, email: first.collector_email || rows.find(r => r.collector_email)?.collector_email || '', halves, modelAnswers: rows.length - halves }
}

export { msToReadable, STATE_TEXT }
