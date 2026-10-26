/**
 * insightsData.js — Common Mistakes Analyzer data logic
 * ============================================================================
 * Reads comparison_detail from the FIELD sheet and answers: for one match and
 * half, which mistakes did collectors make most often, and at which moment?
 *
 * Everything except readComparisonDetail is a pure function, so the grouping
 * and metrics can be tested without the sheet or the page.
 *
 * Read-only. Nothing here writes anywhere.
 */
import { FIELD_SHEET_ID } from '../config/fieldConfig'
import { TAB_COMPARISON_DETAIL } from '../config/comparisonConfig'
import { SHEETS_API, getServiceToken, googleFetch } from '../services/google'

const BASE = SHEETS_API
const norm = v => String(v ?? '').trim()

/** "1H", "1", "1h" all mean the first half — rows from different runs may differ. */
export const normHalf = v => norm(v).toUpperCase().replace(/H$/, '')

/** Mistakes only. `correct` and `wrong_side` are excluded entirely. */
export const ERROR_VERDICTS = new Set([
  'missing_event', 'extra_event', 'not_needed_extra', 'wrong_event',
  'wrong_timestamp', 'wrong_extra', 'missing_extra',
])

/** Verdict pill → the verdicts it controls. */
export const PILLS = {
  missing: ['missing_event', 'missing_extra'],
  extra:   ['extra_event', 'not_needed_extra'],
  wrong:   ['wrong_event', 'wrong_timestamp', 'wrong_extra'],
}

/**
 * Extract session start epoch-ms from a collector_session_id.
 * Format: field_{uid}_{enc}_{13-digit-ms} — the last segment is the epoch.
 * Returns a Date, or null when the id is missing or not in the expected format.
 * Exported so InsightsPage can attach it to each run for the date-time filter.
 */
export function sessionDateFromId(id) {
  const m = String(id ?? '').match(/_(\d{13})$/)
  return m ? new Date(Number(m[1])) : null
}

/**
 * The whole comparison_detail tab, one request, rows as objects by header.
 *
 * A thin wrapper rather than a shared reader: fieldSheetSync's readRange is
 * internal to FIELD's save path, and the Comparison reader drops rows without a
 * session_id — every comparison_detail row would be dropped.
 */
export async function readComparisonDetail() {
  const token = await getServiceToken()
  if (!token) throw new Error('Google auth unavailable')
  const range = encodeURIComponent(`${TAB_COMPARISON_DETAIL}!A:ZZ`)
  const res = await googleFetch(`${BASE}/${FIELD_SHEET_ID}/values/${range}`,
    { token: token })
  if (!res.ok) throw new Error(`Could not read ${TAB_COMPARISON_DETAIL} (${res.status})`)
  const values = (await res.json()).values || []
  if (values.length < 2) return []
  const header = values[0].map(norm)
  return values.slice(1).map(r => {
    const obj = Object.fromEntries(header.map((h, i) => [h, norm(r[i])]))
    // attach session start date so InsightsPage can filter by date without re-parsing
    obj._sDate = sessionDateFromId(obj.collector_session_id)
    return obj
  })
}

/** PRESSURE → A → B → C → D → TO → first value found → blank. */
const MODULE_PRIORITY = ['PRESSURE', 'A', 'B', 'C', 'D', 'TO']
export function resolveModule(modules) {
  const vals = [...modules].map(norm).filter(Boolean)
  return MODULE_PRIORITY.find(m => vals.includes(m)) || vals[0] || ''
}

/**
 * A collector's label. HR-code when present; otherwise the uid segment of
 * collector_session_id (field_{uid}_{enc}_{ts}), first 8 chars + "…".
 * Never blank: a run with neither falls back to its run_id.
 */
export function collectorLabel(row) {
  const hr = norm(row.collector_hr_code)
  if (hr) return hr
  const parts = norm(row.collector_session_id).split('_')
  const uid = parts[0] === 'field' ? parts[1] : ''
  if (uid) return uid.slice(0, 8) + '…'
  return 'run ' + norm(row.run_id).slice(0, 8)
}

/**
 * Filter, group and count. Returns null when the match has no rows at all.
 *
 *   totalRuns — distinct run_id across ALL rows for this match+half, correct
 *               rows included, so a perfect run still counts in the denominator
 *   groups    — one per (event_code, verdict, anchor time)
 *   collectors — run_id → label, for the filter dropdown
 */
export function analyze(rows, matchId, half) {
  // match_id is stored as a STRING; compare as strings, never as numbers
  const mid = norm(matchId), h = normHalf(half)
  const mine = rows.filter(r => norm(r.match_id) === mid && normHalf(r.half) === h)
  if (!mine.length) return null

  // Build full run registry BEFORE any filtering so totalRuns is the true denominator
  // and collectors includes sDate for the date-time filter in InsightsPage.
  const allRuns = new Map()   // run_id → { label, sDate }
  mine.forEach(r => {
    if (!allRuns.has(r.run_id))
      allRuns.set(r.run_id, { label: collectorLabel(r), sDate: r._sDate || null })
  })
  const totalRuns = allRuns.size
  // collectors Map kept for backward compat: run_id → label string
  const collectors = new Map([...allRuns.entries()].map(([id, v]) => [id, v.label]))

  const groups = new Map()
  mine.forEach(r => {
    if (!ERROR_VERDICTS.has(r.verdict)) return
    // An extra event has no model time — the model never tagged it — so it is
    // anchored on the collector's time. Every other mistake anchors on the
    // model's time, the canonical moment in the match.
    const isExtra = r.verdict === 'extra_event' || r.verdict === 'not_needed_extra'
    const anchorMs = isExtra ? r.collector_video_time_ms : r.model_video_time_ms
    const key = `${r.event_code}|${r.verdict}|${anchorMs}`
    if (!groups.has(key)) {
      groups.set(key, {
        key, event_code: r.event_code, verdict: r.verdict,
        anchor_ms: Number(anchorMs) || 0,
        anchor_readable: (isExtra ? r.collector_time_readable : r.model_time_readable) || '',
        runs: new Set(), modules: new Set(), rows: [],
      })
    }
    const g = groups.get(key)
    g.runs.add(r.run_id)
    // event_module is written inconsistently across runs, so it is collected,
    // never part of the key, and resolved after grouping
    if (norm(r.event_module)) g.modules.add(norm(r.event_module))
    g.rows.push(r)
  })

  return {
    totalRuns,
    collectors,
    allRuns,   // Map<run_id, {label, sDate}> — used by InsightsPage for date-time filter
    groups: [...groups.values()].map(g => ({ ...g, module: resolveModule(g.modules) })),
  }
}

/**
 * The rows to show, after both filters. Collector filter recalculates count
 * and pct from only the selected runs; groups left with zero are hidden.
 *
 * selectedRuns: Set of run_id, or null for "all collectors"
 * pills:        { missing, extra, wrong } booleans
 */
export function viewRows(result, { selectedRuns = null, pills = { missing:true, extra:true, wrong:true } } = {}) {
  if (!result) return []
  const allowed = new Set(Object.entries(pills).filter(([, on]) => on).flatMap(([p]) => PILLS[p]))
  return result.groups
    .filter(g => allowed.has(g.verdict))
    .map(g => {
      const runs = selectedRuns ? [...g.runs].filter(r => selectedRuns.has(r)) : [...g.runs]
      const count = runs.length
      return { ...g, count, contributingRuns: runs,
        pct: result.totalRuns ? Math.round(count / result.totalRuns * 100) : 0 }
    })
    .filter(g => g.count > 0)
}

/** The five summary chips. Runs is the match total, unaffected by the collector filter. */
export function summary(result, rows) {
  const sum = vs => rows.filter(g => vs.includes(g.verdict)).reduce((n, g) => n + g.count, 0)
  return {
    runs: result?.totalRuns || 0,
    patterns: rows.length,
    missing: sum(PILLS.missing),
    extra: sum(PILLS.extra),
    wrong: sum(PILLS.wrong),
  }
}

/** CSV of the visible rows, count descending. */
export function toCsv(rows, { matchId, half, totalRuns }) {
  const cell = v => {
    let s = String(v ?? '')
    if (/^[=+\-@]/.test(s)) s = "'" + s          // formula-injection guard
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const sorted = [...rows].sort((a, b) => b.count - a.count)
  return [
    '# MARK Common Mistakes Export',
    `# match_id: ${matchId}  half: ${half}  total_runs: ${totalRuns}`,
    `# exported: ${new Date().toISOString()}`,
    '',
    'rank,event_code,verdict,timestamp,module,count,total_runs,pct',
    ...sorted.map((g, i) => [i + 1, g.event_code, g.verdict, g.anchor_readable, g.module,
      g.count, totalRuns, g.pct + '%'].map(cell).join(',')),
  ].join('\n')
}
