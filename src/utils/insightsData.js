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
import { invoke } from '@tauri-apps/api/core'
import { FIELD_SHEET_ID } from '../config/fieldConfig'
import { TAB_COMPARISON_DETAIL } from '../config/comparisonConfig'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const norm = v => String(v ?? '').trim()

/** "1H", "1", "1h" all mean the first half — rows from different runs may differ. */
export const normHalf = v => norm(v).toUpperCase().replace(/H$/, '')

/** Mistakes only. `correct` and `wrong_side` are excluded entirely. */
export const ERROR_VERDICTS = new Set([
  'missing_event', 'extra_event', 'wrong_event',
  'wrong_timestamp', 'wrong_extra', 'missing_extra',
])

/** Verdict pill → the verdicts it controls. */
export const PILLS = {
  missing: ['missing_event', 'missing_extra'],
  extra:   ['extra_event'],
  wrong:   ['wrong_event', 'wrong_timestamp', 'wrong_extra'],
}

/**
 * The whole comparison_detail tab, one request, rows as objects by header.
 *
 * A thin wrapper rather than a shared reader: fieldSheetSync's readRange is
 * internal to FIELD's save path, and the Comparison reader drops rows without a
 * session_id — every comparison_detail row would be dropped.
 */
export async function readComparisonDetail() {
  const token = await invoke('get_google_access_token_cmd')
  if (!token) throw new Error('Google auth unavailable')
  const range = encodeURIComponent(`${TAB_COMPARISON_DETAIL}!A:ZZ`)
  const res = await fetch(`${BASE}/${FIELD_SHEET_ID}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Could not read ${TAB_COMPARISON_DETAIL} (${res.status})`)
  const values = (await res.json()).values || []
  if (values.length < 2) return []
  const header = values[0].map(norm)
  return values.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, norm(r[i])])))
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

  const totalRuns = new Set(mine.map(r => r.run_id)).size
  const collectors = new Map()
  mine.forEach(r => { if (!collectors.has(r.run_id)) collectors.set(r.run_id, collectorLabel(r)) })

  const groups = new Map()
  mine.forEach(r => {
    if (!ERROR_VERDICTS.has(r.verdict)) return
    // An extra event has no model time — the model never tagged it — so it is
    // anchored on the collector's time. Every other mistake anchors on the
    // model's time, the canonical moment in the match.
    const isExtra = r.verdict === 'extra_event'
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

// ── Cross-match analysis (used by the new Insights filter feature) ────────────
// The original analyze() function is unchanged — it still powers the single-match view.
// These new functions work across ALL matches + halves.

import { normHalfNum } from './sampledHalves'

/** Normalise a half string from comparison_detail to the 1H/2H/ET1/ET2 form. */
function normHalfKey(v) {
  const u = String(v ?? '').trim().toUpperCase()
  // e.g. "1H", "1", "2H", "ET1" — normHalfNum handles all of them
  return normHalfNum(u)
}

/**
 * Analyse comparison_detail rows across all match+half pairs that appear in
 * the given halfKeys set (from sampledHalves.filteredHalfKeys).
 *
 * When includeUnsampled is true, rows whose half is NOT in sampledIdx are also
 * included (halfKeys is then treated as "all known keys" plus unsampled ones).
 *
 * Returns:
 *   totalHalves — distinct (matchId, half) pairs with at least one run
 *   unsampledHalves — pairs not in Sampled Halves (0 when includeUnsampled=false)
 *   groupMap    — Map<event_code, { event_code, halves:Set, errorCount, verdict_counts }>
 *   collectors  — Map<hrCode, collectorName>  (for display only)
 */
export function analyzeFiltered(compRows, sampledIdx, halfKeys, includeUnsampled) {
  // Build a set of all comparison half-keys
  const allCompKeys = new Set()
  for (const r of compRows) {
    const key = `${norm(r.match_id)}_${normHalfKey(r.half)}`
    allCompKeys.add(key)
  }

  // Decide which half-keys to include
  let include
  if (includeUnsampled) {
    // All keys: sampled+filtered UNION unsampled comparison keys
    include = new Set([...halfKeys, ...[...allCompKeys].filter(k => !sampledIdx.has(k))])
  } else {
    include = halfKeys
  }

  const halfSet     = new Set()   // distinct halves contributing to the analysis
  const unsampledSet = new Set()  // distinct halves not in Sampled Halves
  const groupMap    = new Map()   // event_code → { halves:Set, errorCount, rows }
  const collectors  = new Map()

  for (const r of compRows) {
    const key = `${norm(r.match_id)}_${normHalfKey(r.half)}`
    if (!include.has(key)) continue
    halfSet.add(key)
    if (!sampledIdx.has(key)) unsampledSet.add(key)
    if (r.collector_hr_code) collectors.set(norm(r.collector_hr_code), norm(r.collector_hr_code))
    if (!ERROR_VERDICTS.has(r.verdict)) continue

    const ec = norm(r.event_code)
    if (!groupMap.has(ec)) {
      groupMap.set(ec, {
        event_code: ec, halves: new Set(), errorCount: 0, rows: [],
        verdict_counts: {},
      })
    }
    const g = groupMap.get(ec)
    g.halves.add(key)
    g.errorCount++
    g.verdict_counts[r.verdict] = (g.verdict_counts[r.verdict] || 0) + 1
    g.rows.push(r)
  }

  return {
    totalHalves:     halfSet.size,
    unsampledHalves: unsampledSet.size,
    groupMap,
    collectors,
  }
}

/**
 * Convert analyzeFiltered's groupMap into a sorted array of event rows,
 * each with rate = errorCount / totalHalves.
 */
export function rankEvents(groupMap, totalHalves) {
  if (!totalHalves) return []
  return [...groupMap.values()].map(g => ({
    event_code:     g.event_code,
    halveCount:     g.halves.size,
    errorCount:     g.errorCount,
    rate:           g.errorCount / totalHalves,
    verdict_counts: g.verdict_counts,
    rows:           g.rows,
  })).sort((a, b) => b.rate - a.rate || b.errorCount - a.errorCount)
}

/**
 * Batch comparison: for each event in the ranked list, compute error rates
 * for the selected batch vs everyone else (same non-batch filters applied).
 *
 * compRows       — all comparison_detail rows
 * sampledIdx     — full sampled index (unfiltered for batch dimension)
 * batchHalfKeys  — halfKeys for the selected batch (with non-batch filters)
 * othersHalfKeys — halfKeys for all other batches (same non-batch filters)
 * MIN_HALVES = 5  — minimum on each side to show a ratio
 *
 * Returns Map<event_code, { batchRate, othersRate, ratio, batchHalves, othersHalves }>
 */
const MIN_HALVES_FOR_RATIO = 5
export function batchComparison(compRows, batchHalfKeys, othersHalfKeys) {
  const batchData  = analyzeFiltered(compRows, new Map(), batchHalfKeys, false)
  const othersData = analyzeFiltered(compRows, new Map(), othersHalfKeys, false)
  const allCodes   = new Set([...batchData.groupMap.keys(), ...othersData.groupMap.keys()])
  const result = new Map()
  for (const ec of allCodes) {
    const batchG  = batchData.groupMap.get(ec)
    const othersG = othersData.groupMap.get(ec)
    const batchHalves  = batchData.totalHalves
    const othersHalves = othersData.totalHalves
    const batchRate  = batchHalves  ? (batchG?.errorCount  || 0) / batchHalves  : 0
    const othersRate = othersHalves ? (othersG?.errorCount || 0) / othersHalves : 0
    const canCompare = batchHalves >= MIN_HALVES_FOR_RATIO && othersHalves >= MIN_HALVES_FOR_RATIO
    result.set(ec, {
      batchRate, othersRate,
      ratio:        canCompare && othersRate > 0 ? batchRate / othersRate : null,
      canCompare,
      batchHalves, othersHalves,
    })
  }
  return result
}
