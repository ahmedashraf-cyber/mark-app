/**
 * selfReviewDashData.js: reads Self-Review results for the dashboard. READ-ONLY.
 * ============================================================================
 * Source: the "Collector Self Review" tab of the "Mark Field Collected Data" spreadsheet (see selfReviewDashboardConfig.js).
 * That tab holds ONE ROW PER RESULT EVENT, with the run's summary repeated on every row; a "run" is everything sharing a
 * run_id. The dashboard works in runs.
 *
 * RULES (all enforced here, not in the screen):
 *  1. The header must be the 19-column header exactly, or the 17-column legacy header exactly. Anything else fails loudly.
 *  2. SCOPE: scope 'own' keeps only rows whose HR-code is the caller's own, BEFORE anything is parsed or returned. Other
 *     collectors' rows never reach the screen, and a problem in someone else's row cannot be reported to a collector.
 *  3. Bad data fails loudly with run ids and sheet row numbers: unparseable saved_at_iso, non-numeric counts, a run whose
 *     rows disagree with each other. Nothing is silently dropped or repaired.
 *  4. One review per half (HR-code + match + half): the EARLIEST run, as Self-Review itself shows. Later runs are ignored
 *     and counted.
 *  5. Rule B: a chosen run counts only if its score is not blank AND trainer_rows > 0. A score of 0 is a real score.
 *
 * Uses the mark-reporter service account (invoke get_google_access_token_cmd), never an API key. Does not touch
 * selfReviewSheet.js, which owns the write path.
 */
import { invoke } from '@tauri-apps/api/core'
import {
  SELF_REVIEW_RESULTS_SPREADSHEET_ID, SELF_REVIEW_RESULTS_TAB,
  SELF_REVIEW_HEADER, SELF_REVIEW_HEADER_LEGACY,
} from '../config/selfReviewDashboardConfig.js'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

export class DashDataError extends Error {
  constructor(code, message, problems = []) {
    super(message)
    this.name = 'DashDataError'
    this.code = code
    this.problems = problems          // [{ runId, row, reason }]
  }
}

const str    = v => (v == null ? '' : String(v)).trim()
const canonHr = v => str(v).toUpperCase()
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** null when blank, NaN when present but not a whole non-negative number. Accepts a number or its text. */
function parseCount(v) {
  const s = str(v)
  if (s === '') return null
  return /^\d+(?:\.0+)?$/.test(s) ? Number(s) : NaN
}
/** null when blank, NaN when present but not a number from 0 to 100. A 0 is a score. */
function parseScore(v) {
  const s = str(v)
  if (s === '') return null
  if (!/^\d+(?:\.\d+)?$/.test(s)) return NaN
  const n = Number(s)
  return n <= 100 ? n : NaN
}
/** A real Date, or null. Only ISO text qualifies: a date Sheets converted is not text, and is refused. */
function parseIso(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!ISO.test(s)) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Throws unless the header is one of the two accepted headers, exactly. Returns { legacy }. */
export function checkHeader(headerRow) {
  const cells = (headerRow || []).map(str)
  while (cells.length && cells[cells.length - 1] === '') cells.pop()      // the API drops trailing blanks; a CSV may keep them
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
  if (same(cells, SELF_REVIEW_HEADER)) return { legacy: false }
  if (same(cells, SELF_REVIEW_HEADER_LEGACY)) return { legacy: true }
  const diffs = []
  for (let i = 0; i < Math.max(cells.length, SELF_REVIEW_HEADER.length); i++) {
    if (cells[i] !== SELF_REVIEW_HEADER[i]) diffs.push(`column ${i + 1}: expected "${SELF_REVIEW_HEADER[i] ?? '(none)'}", found "${cells[i] ?? '(none)'}"`)
    if (diffs.length >= 4) break
  }
  throw new DashDataError('HEADER_MISMATCH',
    `The "${SELF_REVIEW_RESULTS_TAB}" tab's header row is not the one Self-Review writes (19 columns, or the older 17). `
    + `Nothing was read, so no column could shift. ${diffs.join('; ')}.`)
}

function emptyResult(scope, reason, legacyHeader = false) {
  return { reviews: [], noComparison: 0, duplicates: 0, incomplete: 0, runsRead: 0, rowsRead: 0,
    legacyHeader, halves: [], matches: [], collectors: [], scope, reason }
}

const HALF_ORDER = ['1H', '2H', 'ET1', 'ET2']
const byHalf = (a, b) => {
  const ia = HALF_ORDER.indexOf(a), ib = HALF_ORDER.indexOf(b)
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  return a.localeCompare(b)
}

/** One data row -> { rec } or { problem }. */
function parseRow(r) {
  const runId = str(r[0])
  if (!runId) return { problem: 'run_id is blank' }
  const hr = canonHr(r[2]);       if (!hr)    return { runId, problem: 'collector_hr_code is blank' }
  const match = str(r[3]);        if (!match) return { runId, problem: 'match_id is blank' }
  const half = str(r[4]).toUpperCase(); if (!half) return { runId, problem: 'half is blank' }
  const savedAt = parseIso(r[1])
  if (!savedAt) return { runId, problem: `saved_at_iso "${str(r[1]).slice(0, 40)}" is not an ISO date-time` }
  const score = parseScore(r[5]);          if (Number.isNaN(score)) return { runId, problem: `score_percent "${str(r[5])}" is not a number from 0 to 100` }
  const trainerRows = parseCount(r[6]);    if (trainerRows === null || Number.isNaN(trainerRows)) return { runId, problem: `trainer_rows "${str(r[6])}" is not a whole number` }
  const correct = parseCount(r[7]);        if (correct === null || Number.isNaN(correct)) return { runId, problem: `matched "${str(r[7])}" is not a whole number` }
  const missed = parseCount(r[8]);         if (missed === null || Number.isNaN(missed)) return { runId, problem: `missed "${str(r[8])}" is not a whole number` }
  const extra = parseCount(r[9]);          if (extra === null || Number.isNaN(extra)) return { runId, problem: `collector_only "${str(r[9])}" is not a whole number` }
  const wrongRaw = parseCount(r[17]);      if (Number.isNaN(wrongRaw)) return { runId, problem: `wrong_event "${str(r[17])}" is not a whole number` }
  const wrong = wrongRaw === null ? 0 : wrongRaw          // blank on rows saved before v7.12.9: there was no such count then
  return { rec: { runId, hr, match, half, savedAt, savedAtIso: str(r[1]), score, trainerRows, correct, missed, wrong, extra } }
}

const sig = x => [x.hr, x.match, x.half, x.savedAtIso, x.score === null ? '' : x.score, x.trainerRows, x.correct, x.missed, x.wrong, x.extra].join('|')

/**
 * values: the tab as an array of rows (row 0 = header), cells as text or numbers.
 * ctx: { scope: 'own' | 'all', hrCode }.   Throws DashDataError. Never returns another collector's data for scope 'own'.
 */
export function processValues(values, ctx) {
  const scope = ctx && ctx.scope
  if (scope !== 'own' && scope !== 'all') throw new DashDataError('BAD_SCOPE', 'Internal error: the dashboard was asked for neither "own" nor "all" results.')
  const own = canonHr(ctx.hrCode)
  if (scope === 'own' && !own) return emptyResult(scope, 'NO_HR_CODE')
  if (!Array.isArray(values) || values.length === 0) {
    throw new DashDataError('TAB_EMPTY', `The "${SELF_REVIEW_RESULTS_TAB}" tab is empty: it has no header row.`)
  }
  const { legacy } = checkHeader(values[0])

  const problems = []
  const runs = new Map()                                    // runId -> [{ row, rec }]
  let rowsRead = 0
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || []
    if (r.every(c => str(c) === '')) continue
    if (scope === 'own' && canonHr(r[2]) !== own) continue    // SCOPE: other collectors' rows are never even parsed
    rowsRead++
    const row = i + 1                                       // the row number a person sees in the sheet
    const p = parseRow(r)
    if (p.problem) { problems.push({ runId: p.runId || '(blank)', row, reason: p.problem }); continue }
    if (!runs.has(p.rec.runId)) runs.set(p.rec.runId, [])
    runs.get(p.rec.runId).push({ row, rec: p.rec })
  }

  const parsed = []
  for (const [runId, list] of runs) {
    const first = list[0]
    const odd = list.find(x => sig(x.rec) !== sig(first.rec))
    if (odd) { problems.push({ runId, row: odd.row, reason: `rows of this run disagree (row ${first.row} vs row ${odd.row})` }); continue }
    parsed.push({ ...first.rec, rowCount: list.length, firstRow: first.row })
  }
  if (problems.length) {
    // One problem per run and reason, however many of its rows share it: a 14-row run with one bad date is ONE thing to fix.
    const uniq = new Map()
    for (const p of problems) {
      const k = `${p.runId}|${p.reason}`
      if (uniq.has(k)) uniq.get(k).moreRows++
      else uniq.set(k, { ...p, moreRows: 0 })
    }
    const list = [...uniq.values()]
    const more = p => (p.moreRows ? ` and ${p.moreRows} more row(s)` : '')
    const shown = list.slice(0, 3).map(p => `${p.runId} (row ${p.row}${more(p)}): ${p.reason}`).join('; ')
    throw new DashDataError('BAD_DATA',
      `${list.length} problem(s) in the "${SELF_REVIEW_RESULTS_TAB}" tab, so no scores are shown. ${shown}${list.length > 3 ? '; and more' : ''}.`, list)
  }

  // One review per half: the earliest run (ties by run_id), the same run Self-Review shows. The rest are ignored and counted.
  const groups = new Map()
  for (const run of parsed) {
    const k = `${run.hr}|${run.match}|${run.half}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(run)
  }
  let duplicates = 0, noComparison = 0, incomplete = 0
  const reviews = []
  for (const list of groups.values()) {
    list.sort((a, b) => a.savedAt - b.savedAt || a.runId.localeCompare(b.runId))
    duplicates += list.length - 1
    const run = list[0]
    if (run.score === null || run.trainerRows <= 0) { noComparison++; continue }       // rule B; note 0 !== null
    if (run.rowCount !== run.trainerRows + run.extra) incomplete++
    reviews.push(run)
  }
  reviews.sort((a, b) => a.savedAt - b.savedAt || a.runId.localeCompare(b.runId))

  return {
    reviews, noComparison, duplicates, incomplete, runsRead: parsed.length, rowsRead, legacyHeader: legacy,
    halves: [...new Set(reviews.map(x => x.half))].sort(byHalf),
    matches: [...new Set(reviews.map(x => x.match))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    collectors: [...new Set(reviews.map(x => x.hr))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    scope, reason: null,
  }
}

/**
 * Reads the whole tab (no row cap) and processes it. deps.getToken / deps.fetch are for tests.
 * A missing tab, a missing spreadsheet and a refused read each get their own plain message.
 */
export async function loadDashboardData(ctx, deps = {}) {
  const scope = ctx && ctx.scope
  if (scope === 'own' && !canonHr(ctx.hrCode)) return emptyResult(scope, 'NO_HR_CODE')   // nothing to look up: do not even read
  const getToken = deps.getToken || (() => invoke('get_google_access_token_cmd'))
  const doFetch = deps.fetch || ((...a) => fetch(...a))
  const token = await getToken()
  if (!token) throw new DashDataError('NO_TOKEN', 'Google access is not available right now, so the scores could not be read.')
  const url = `${BASE}/${SELF_REVIEW_RESULTS_SPREADSHEET_ID}/values/${encodeURIComponent(`'${SELF_REVIEW_RESULTS_TAB}'!A:S`)}`
    + '?valueRenderOption=UNFORMATTED_VALUE'
  let res
  try { res = await doFetch(url, { headers: { Authorization: `Bearer ${token}` } }) }
  catch (e) { throw new DashDataError('NETWORK', `Could not reach Google Sheets: ${e?.message || e}`) }
  let body = null
  try { body = await res.json() } catch { body = null }
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`
    if (res.status === 400 && /unable to parse range/i.test(msg)) {
      throw new DashDataError('TAB_MISSING', `The "${SELF_REVIEW_RESULTS_TAB}" tab was not found in the Mark Field Collected Data spreadsheet.`)
    }
    if (res.status === 404) throw new DashDataError('SHEET_MISSING', 'The Mark Field Collected Data spreadsheet was not found.')
    if (res.status === 403 || res.status === 401) {
      throw new DashDataError('NO_ACCESS', 'The MARK service account is not allowed to read the Mark Field Collected Data spreadsheet. Ask a Batch Manager to share it with the service account.')
    }
    throw new DashDataError('READ_FAILED', `Reading the scores failed: ${msg}`)
  }
  return processValues(body?.values, ctx)
}
