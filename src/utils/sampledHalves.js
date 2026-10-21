/**
 * sampledHalves.js — read and join the Sampled Halves sheet to comparison_detail rows
 * ===================================================================================
 * Read-only. Uses the service-account token (same as selfReviewSheet.js).
 * Shared between InsightsPage and any future consumer.
 *
 * Columns in "Sampled Halves" tab (found by header name, not position):
 *   Batch ID, HR-Code, Collector Name, Half #, Competition, Event, Match ID,
 *   Review Date, Reviewer
 */
import { invoke } from '@tauri-apps/api/core'

export const SAMPLED_SHEET_ID = '1XGVp4o7xu8mwPkhEamz-d1aiWYCkkhR-ffTlVQCcsrM'
export const SAMPLED_TAB      = 'Sampled Halves'
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

const norm     = v => String(v ?? '').trim()
const normUp   = v => norm(v).toUpperCase()
// Half # in Sampled Halves is "1"/"2"/"3"/"4" → "1H"/"2H"/"ET1"/"ET2"
const HALF_MAP = { '1':'1H', '2':'2H', '3':'ET1', '4':'ET2' }
export const normHalfNum = v => HALF_MAP[norm(v)] || normUp(v).replace(/H$/,'').replace(/^(\d+)$/,'$1H')

/**
 * Read the entire Sampled Halves tab. Returns an array of plain objects with
 * these normalised keys: batchId, hrCode, collectorName, halfNum (raw), half
 * (as 1H/2H/ET1/ET2), competition, taskType (the "Event" column), matchId,
 * reviewDate, reviewer.
 *
 * One call per Insights page load, cached for the session in module scope.
 */
let _cache = null
export async function readSampledHalves(force = false) {
  if (_cache && !force) return _cache
  const token = await invoke('get_google_access_token_cmd')
  const range = encodeURIComponent(`${SAMPLED_TAB}!A:Z`)
  const res = await fetch(`${BASE}/${SAMPLED_SHEET_ID}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Could not read Sampled Halves (${res.status})`)
  const values = (await res.json()).values || []
  if (values.length < 2) { _cache = []; return [] }

  // Find columns by header name (case-insensitive, trimmed)
  const header = values[0].map(h => norm(h).toLowerCase())
  const col = name => header.findIndex(h => h === name.toLowerCase())

  const iB  = col('batch id'),      iHR = col('hr-code')
  const iCN = col('collector name'),  iHN = col('half #')
  const iCO = col('competition'),    iEV = col('event')
  const iMI = col('match id'),       iRD = col('review date')
  const iRV = col('reviewer')

  const rows = values.slice(1).map(r => {
    const halfNum = norm(r[iHN] ?? '')
    return {
      batchId:       norm(r[iB]  ?? ''),
      hrCode:        normUp(r[iHR] ?? ''),
      collectorName: norm(r[iCN] ?? ''),
      halfNum,
      half:          normHalfNum(halfNum),
      competition:   norm(r[iCO] ?? ''),
      taskType:      norm(r[iEV] ?? ''),
      matchId:       norm(r[iMI] ?? ''),
      reviewDate:    norm(r[iRD] ?? ''),
      reviewer:      norm(r[iRV] ?? ''),
    }
  }).filter(r => r.matchId && r.half)

  _cache = rows
  return rows
}

/**
 * Build a Map<"matchId_half", SampledRow[]> from sampledRows.
 * A half can appear multiple times (same half, different collectors assigned).
 * Callers use this for O(1) lookup instead of scanning the array.
 */
export function buildSampledIndex(sampledRows) {
  const idx = new Map()
  for (const r of sampledRows) {
    const key = `${r.matchId}_${r.half}`
    if (!idx.has(key)) idx.set(key, [])
    idx.get(key).push(r)
  }
  return idx
}

/**
 * Given a list of comparison_detail rows (each having match_id + half),
 * return stats about the join:
 *   matched, unmatched, multiMatch counts (by distinct matchId+half pair)
 */
export function joinStats(compRows, sampledIdx) {
  const pairs = new Map()
  for (const r of compRows) {
    const key = `${norm(r.match_id)}_${normUp(r.half).replace(/H$/,'').replace(/^(\d+)$/,'$1H')}`
    pairs.set(key, true)
  }
  let matched = 0, unmatched = 0, multi = 0
  for (const key of pairs.keys()) {
    const rows = sampledIdx.get(key) || []
    if (!rows.length) unmatched++
    else if (rows.length > 1) { matched++; multi++ }
    else matched++
  }
  return { matched, unmatched, multi, total: pairs.size }
}

/**
 * For a given HR-code (supervisor), return all distinct Batch IDs where they
 * appear as Reviewer in the Sampled Halves tab.
 * Option A: derive from the Reviewer column — no schema change needed.
 */
export function supervisorBatches(sampledRows, hrCode) {
  if (!hrCode) return []
  const code = normUp(hrCode)
  const batches = new Set()
  for (const r of sampledRows) {
    if (normUp(r.reviewer) === code && r.batchId) batches.add(r.batchId)
  }
  return [...batches].sort()
}

/**
 * Extract all distinct filter option values from sampledRows:
 *   batches, hrCodes (with collectorName), competitions, taskTypes, reviewers
 */
export function filterOptions(sampledRows) {
  const batches = new Set(), collectors = new Map()
  const competitions = new Set(), taskTypes = new Set(), reviewers = new Set()
  for (const r of sampledRows) {
    if (r.batchId) batches.add(r.batchId)
    if (r.hrCode)  collectors.set(r.hrCode, r.collectorName)
    if (r.competition) competitions.add(r.competition)
    if (r.taskType)    taskTypes.add(r.taskType)
    if (r.reviewer)    reviewers.add(r.reviewer)
  }
  return {
    batches:      [...batches].sort(),
    collectors:   [...collectors.entries()].sort((a,b) => a[0].localeCompare(b[0])),
    competitions: [...competitions].sort(),
    taskTypes:    [...taskTypes].sort(),
    reviewers:    [...reviewers].sort(),
  }
}

/**
 * Given filters, return the set of "matchId_half" keys that pass ALL active
 * filters. Each key maps to one Sampled Halves entry (or several — we take the
 * union of batches etc. across all rows for that half and log duplicates).
 *
 * filters: { batches, hrCodes, competitions, taskTypes, reviewers, dateFrom, dateTo }
 * Each is an array; empty array means "all" (no filter).
 * dateFrom/dateTo are ISO date strings "YYYY-MM-DD" or ''.
 */
export function filteredHalfKeys(sampledRows, sampledIdx, filters) {
  const { batches=[], hrCodes=[], competitions=[], taskTypes=[], reviewers=[], dateFrom='', dateTo='' } = filters
  const allFiltersEmpty = !batches.length && !hrCodes.length && !competitions.length
    && !taskTypes.length && !reviewers.length && !dateFrom && !dateTo

  const result = new Set()
  for (const [key, rows] of sampledIdx) {
    if (rows.length > 1) {
      console.warn(`[Insights] Half ${key} has ${rows.length} Sampled Halves rows — counting once`)
    }
    // A half passes if ANY of its sampled rows passes all active filters
    const passes = rows.some(r => {
      if (batches.length      && !batches.includes(r.batchId))         return false
      if (hrCodes.length      && !hrCodes.includes(r.hrCode))          return false
      if (competitions.length && !competitions.includes(r.competition)) return false
      if (taskTypes.length    && !taskTypes.includes(r.taskType))       return false
      if (reviewers.length    && !reviewers.includes(r.reviewer))       return false
      if (dateFrom && r.reviewDate && r.reviewDate < dateFrom)           return false
      if (dateTo   && r.reviewDate && r.reviewDate > dateTo)             return false
      return true
    })
    if (passes) result.add(key)
  }
  return { halfKeys: result, allFiltersEmpty }
}
