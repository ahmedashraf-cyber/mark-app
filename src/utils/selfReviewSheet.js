/**
 * selfReviewSheet.js — all Google Sheets I/O for Collector Self-Review mode.
 * ============================================================================
 * Uses the mark-reporter service account (invoke get_google_access_token_cmd)
 * for every call. Sampled Halves must be shared with mark-reporter as Editor.
 * Trainer review sheets must be shared with mark-reporter as Viewer (Option Z
 * ensures this for new sheets; existing sheets are shared manually).
 *
 * Read by: CollectorSelfReviewPage.jsx only. (The dashboard reads the same tab through selfReviewDashData.js and never writes.)
 * Does not touch Scout, Audit, FIELD, Drill, Comparison, or Insights.
 */

import { invoke } from '@tauri-apps/api/core'
import {
  SELF_REVIEW_RESULTS_SPREADSHEET_ID, SELF_REVIEW_RESULTS_TAB, SELF_REVIEW_HEADER, SELF_REVIEW_HEADER_LEGACY,
} from '../config/selfReviewDashboardConfig.js'
import { describeTarget, verbFor, readReply, failureMessage, assertSheetsContract } from './sheetsFetch.js'

const SAMPLED_SHEET_ID = '1XGVp4o7xu8mwPkhEamz-d1aiWYCkkhR-ffTlVQCcsrM'
const SAMPLED_TAB      = 'Sampled Halves'
// Where results are SAVED and read back: the "Collector Self Review" tab of the Mark Field Collected Data spreadsheet
// (moved from the Sampled Halves spreadsheet in v7.12.33). One definition, in selfReviewDashboardConfig.js.
const RESULTS_SHEET_ID   = SELF_REVIEW_RESULTS_SPREADSHEET_ID
const SAVE_TAB          = SELF_REVIEW_RESULTS_TAB
const BASE             = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_BASE       = 'https://www.googleapis.com/drive/v3/files'

// The authoritative 19-column header (v7.12.9+).
// Columns 18-19 (wrong_event, collector_event) were appended in v7.12.9.
// The 17-column v7.12.8 header is migrated on first write after the upgrade.
const SAVE_HEADER      = SELF_REVIEW_HEADER
const SAVE_HEADER_V788 = SELF_REVIEW_HEADER_LEGACY

// Map half number (column D) to the internal code used everywhere in MARK.
const HALF_FROM_NUM = { '1':'1H', '2':'2H', '3':'ET1', '4':'ET2' }

// ── SA token ─────────────────────────────────────────────────────────────────
async function saToken() {
  return invoke('get_google_access_token_cmd')
}
function authHdr(tok) {
  return { Authorization: `Bearer ${tok}` }
}

// ── Generic fetch helpers ─────────────────────────────────────────────────────
// Failures are described by utils/sheetsFetch.js: the status, the action, the tab, the spreadsheet and what Google answered.
function explainFailure(res, method, url, data, raw) { throw new Error(failureMessage(res, method, url, data, raw)) }
export async function sheetCall(url, tok, method, body) {      // exported so the guard's wiring can be tested
  assertSheetsContract(method, url)        // a wrong method is refused here, before anything is sent
  let res
  try {
    res = await fetch(url, {
      method, headers: body === undefined ? authHdr(tok) : { ...authHdr(tok), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (e) { throw new Error(`Could not reach Google Sheets while ${verbFor(method, url)} ${describeTarget(url)}: ${e?.message || e}`) }
  const { data, raw } = await readReply(res)
  if (!res.ok || data === undefined) explainFailure(res, method, url, data, raw)
  return data
}
async function sheetGet(url, tok) { return sheetCall(url, tok, 'GET') }
async function sheetPost(url, tok, body) { return sheetCall(url, tok, 'POST', body) }
async function sheetPut(url, tok, body) { return sheetCall(url, tok, 'PUT', body) }          // values.update

// ── Extract sheet ID or folder ID from a Drive URL ────────────────────────────
function sheetIdFromUri(uri) {
  if (!uri) return { sheetId: null, folderId: null }
  const sm = uri.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (sm) return { sheetId: sm[1], folderId: null }
  const fm = uri.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (fm) return { sheetId: null, folderId: fm[1] }
  return { sheetId: null, folderId: null }
}

// ── Extract URI from a grid cell (chip → hyperlink → text) ───────────────────
function cellUri(cell) {
  if (!cell) return ''
  // Smart chip (rich link)
  for (const run of cell.chipRuns || []) {
    const u = run?.chip?.richLinkProperties?.uri
    if (u) return u
  }
  if (cell.hyperlink) return cell.hyperlink
  const t = (cell.formattedValue || '').trim()
  return t.startsWith('http') ? t : ''
}

// ── Resolve a Drive folder → the most recently modified Sheet inside it ───────
async function sheetIdFromFolder(folderId, tok) {
  const q   = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.spreadsheet'`)
  const url = `${DRIVE_BASE}?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime+desc&supportsAllDrives=true&includeItemsFromAllDrives=true`
  const res = await fetch(url, { headers: authHdr(tok) })
  const data = await res.json()
  if (!res.ok) throw new Error(`Drive folder listing failed: ${data?.error?.message || `HTTP ${res.status}`}`)
  const files = data.files || []
  if (!files.length) throw new Error(`No Google Sheets found inside folder ${folderId}`)
  if (files.length > 1) {
    console.warn(`[MARK SelfReview] Folder ${folderId} has ${files.length} sheets (re-collect?). Using most recent: "${files[0].name}" (${files[0].id})`)
  }
  return files[0].id
}

// ── 1. Load the collector's assigned halves ───────────────────────────────────
// Returns [{key, matchId, half, sheetId}], deduplicated by matchId+half.
// Uses spreadsheets.get with includeGridData to read smart-chip URIs in col P.
export async function loadCollectorHalves(hrCode) {
  const norm = s => String(s || '').trim().toUpperCase()
  const tok  = await saToken()

  const ranges = [
    `${SAMPLED_TAB}!B2:B3000`,  // 0: HR-code
    `${SAMPLED_TAB}!D2:D3000`,  // 1: Half number (1/2/3/4)
    `${SAMPLED_TAB}!G2:G3000`,  // 2: Match ID
    `${SAMPLED_TAB}!P2:P3000`,  // 3: Link (chip/hyperlink/text)
  ]
  const params = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&')
    + `&includeGridData=true`
    + `&fields=sheets.data.startRow,sheets.data.rowData.values.formattedValue,sheets.data.rowData.values.hyperlink,sheets.data.rowData.values.chipRuns.chip.richLinkProperties.uri`

  const data = await sheetGet(`${BASE}/${SAMPLED_SHEET_ID}?${params}`, tok)
  const grids = data?.sheets?.[0]?.data
  if (!grids || grids.length < 4) throw new Error('Sampled Halves sheet returned unexpected data.')

  const cellAt = (gridIdx, rowIdx) => {
    const r = (grids[gridIdx].rowData || [])[rowIdx]
    return r?.values?.[0] || null
  }
  const n = Math.max(...grids.map(g => (g.rowData || []).length))

  const seen = new Map()
  for (let i = 0; i < n; i++) {
    const rowHr   = norm((cellAt(0, i) || {}).formattedValue)
    if (rowHr !== norm(hrCode)) continue
    const halfNum = norm((cellAt(1, i) || {}).formattedValue)
    const half    = HALF_FROM_NUM[halfNum]
    const matchId = norm((cellAt(2, i) || {}).formattedValue)
    if (!half || !matchId) continue

    const uri      = cellUri(cellAt(3, i))
    const { sheetId, folderId } = sheetIdFromUri(uri)

    let resolvedSheetId = sheetId
    if (!resolvedSheetId && folderId) {
      try {
        resolvedSheetId = await sheetIdFromFolder(folderId, tok)
      } catch (e) {
        console.warn(`[MARK SelfReview] Skipping row ${i + 2}: folder ${folderId} — ${e.message}`)
        continue
      }
    }
    if (!resolvedSheetId) continue

    const key = `${matchId}_${half}`
    seen.set(key, { key, matchId, half, sheetId: resolvedSheetId })
  }

  return [...seen.values()]
}

// ── 2. Load saved self-review runs for this HR-code ───────────────────────────
// Returns Map<"matchId_half", rows[]> where rows are the raw sheet rows for the
// FIRST (earliest saved_at_iso) run only.
export async function loadSavedReviews(hrCode) {
  const tok  = await saToken()
  const norm = s => String(s || '').trim().toUpperCase()
  const data = await sheetGet(
    // Read through col S (19 cols) so new wrong_event/collector_event columns are included.
    // Rows written by v7.12.8 only have 17 columns; cols R/S will simply be undefined → ''.
    `${BASE}/${RESULTS_SHEET_ID}/values/${encodeURIComponent(`'${SAVE_TAB}'!A1:S50000`)}`,
    tok
  )
  const rows = (data.values || []).slice(1) // skip header row

  // Group by {hr}_{matchId}_{half}, then by run_id; keep earliest run per half.
  const byKey = new Map()
  for (const r of rows) {
    if (norm(r[2]) !== norm(hrCode)) continue
    const key = `${norm(r[3])}_${norm(r[4])}`
    if (!byKey.has(key)) byKey.set(key, new Map())
    const runId = String(r[0] || '')
    if (!byKey.get(key).has(runId)) byKey.get(key).set(runId, [])
    byKey.get(key).get(runId).push(r)
  }

  const out = new Map()
  for (const [key, runs] of byKey) {
    // Earliest run = smallest saved_at_iso (ISO string sorts lexicographically)
    const sorted = [...runs.values()].sort((a, b) =>
      String(a[0]?.[1] || '').localeCompare(String(b[0]?.[1] || ''))
    )
    out.set(key, sorted[0])
  }
  return out
}

// ── 3. Load trainer review sheet ─────────────────────────────────────────────
// Two layouts exist:
//   - Scout export (exportScoutSession.js): headers at row ~8, Event Type / Video Time / Error Type / Extra 1..5 / Team
//   - MARK Review (exportSessionToUserDrive): headers near row 1, Event / Timestamp / Extra 1 / Team
// Header detection: first row with (Event OR Event Type) AND (Timestamp OR Video Time).
// Returns [{eventLabel, timestamp, errorType, team}]
export async function loadTrainerSheet(sheetId, matchId) {
  const tok  = await saToken()
  const data = await sheetGet(
    `${BASE}/${sheetId}/values/${encodeURIComponent('A1:Z5000')}`,
    tok
  ).catch(e => {
    throw new Error(`Trainer sheet for match ${matchId} could not be loaded: ${e.message}`)
  })

  const values = data.values
  if (!values?.length) throw new Error(`Trainer sheet for match ${matchId} is empty or unreadable.`)

  // Find header row: first row containing (Event OR Event Type) AND (Timestamp OR Video Time)
  const norm  = s => String(s || '').trim().toLowerCase()
  const hasEvent = row => row.some(c => norm(c) === 'event' || norm(c) === 'event type')
  const hasTime  = row => row.some(c => norm(c) === 'timestamp' || norm(c) === 'video time')

  const hi = values.findIndex(row => hasEvent(row) && hasTime(row))
  if (hi === -1) {
    throw new Error(`Trainer sheet for match ${matchId} has no recognisable header row (looked for Event/Event Type + Timestamp/Video Time).`)
  }

  const H     = values[hi].map(norm)
  // Column resolution by header name (position-independent)
  const iEvent  = H.findIndex(h => h === 'event' || h === 'event type')
  const iTs     = H.findIndex(h => h === 'timestamp' || h === 'video time')
  // "Error Type" column (Scout layout, stores display labels or codes)
  // Fallback to "Extra 1" (MARK Review layout)
  const iErr    = (() => {
    const ei = H.findIndex(h => h === 'error type')
    if (ei !== -1) return ei
    return H.findIndex(h => h === 'extra 1')
  })()
  const iTeam   = H.findIndex(h => h === 'team')

  const g = (row, idx) => (idx >= 0 && row[idx] != null ? String(row[idx]).trim() : '')

  const out = []
  for (let i = hi + 1; i < values.length; i++) {
    const row = values[i] || []
    const eventLabel = g(row, iEvent)
    if (!eventLabel) continue
    out.push({
      eventLabel,
      timestamp: g(row, iTs),
      errorType: iErr >= 0 ? g(row, iErr) : '',
      team:      iTeam >= 0 ? g(row, iTeam) : '',
    })
  }
  return out
}

// ── 4. Verify save-tab header before every write (with v7.12.8 migration) ─────
// If the header is exactly the old 17-column v7.12.8 header, appends the two new
// column names (wrong_event, collector_event) into R1:S1 and continues.
// If the header is the current 19-column header, passes immediately.
// Any other header → fails loudly.
export async function verifySaveHeader() {
  const tok  = await saToken()
  const data = await sheetGet(
    `${BASE}/${RESULTS_SHEET_ID}/values/${encodeURIComponent(`'${SAVE_TAB}'!A1:S1`)}`,
    tok
  )
  const hdr = (data.values?.[0] || []).map(s => String(s || '').trim())

  if (JSON.stringify(hdr) === JSON.stringify(SAVE_HEADER)) {
    // Already up to date.
    return
  }

  if (JSON.stringify(hdr) === JSON.stringify(SAVE_HEADER_V788)) {
    // Migrate: write the two new column names into R1:S1. That is values.update, which Google defines as PUT (a POST here is
    // answered with an HTML "Page not found"). Then READ THE HEADER BACK: nothing is appended unless it is now the 19 columns.
    try {
      await sheetPut(
        `${BASE}/${RESULTS_SHEET_ID}/values/${encodeURIComponent(`'${SAVE_TAB}'!R1:S1`)}?valueInputOption=RAW`,
        tok,
        { values: [['wrong_event', 'collector_event']] }
      )
      const back = await sheetGet(`${BASE}/${RESULTS_SHEET_ID}/values/${encodeURIComponent(`'${SAVE_TAB}'!A1:S1`)}`, tok)
      const now = (back.values?.[0] || []).map(s => String(s || '').trim())
      if (JSON.stringify(now) !== JSON.stringify(SAVE_HEADER)) throw new Error(`the header still reads [${now.join(', ')}] after the update`)
    } catch (e) {
      throw new Error(`Could not add the two new header columns (wrong_event, collector_event) to the "${SAVE_TAB}" tab: ${e.message}`)
    }
    console.log('[MARK SelfReview] Migrated save-tab header from 17 → 19 columns.')
    return
  }

  throw new Error(
    `Save tab header mismatch. Expected 19-column or migratable 17-column header. Found: [${hdr.join(', ')}]`
  )
}

// ── 5. Append result rows to the save tab ────────────────────────────────────
export async function appendSaveRows(rows) {
  const tok = await saToken()
  return sheetPost(
    `${BASE}/${RESULTS_SHEET_ID}/values/${encodeURIComponent(`'${SAVE_TAB}'!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    tok,
    { values: rows }
  )
}

// ── 6. Read save tab — check for existing run_id (retry dedup) ────────────────
export async function savedRowsForRunId(runId) {
  const tok  = await saToken()
  const data = await sheetGet(
    `${BASE}/${RESULTS_SHEET_ID}/values/${encodeURIComponent(`'${SAVE_TAB}'!A:A`)}`,
    tok
  )
  const col = (data.values || []).flat().map(s => String(s || '').trim())
  return col.includes(runId)
}

// ── 7. STRICT full read of the results tab for ONE half ───────────────────────
// A lock may only be taken over, and rows may only be appended, on the strength of this read, and only if ALL of it succeeded:
//   - the request completed within the timeout (no answer = no decision),
//   - the HTTP status is exactly 200,
//   - the reply is JSON with values,
//   - the header row is exactly the 19-column header or the 17-column legacy header (read-only: nothing is migrated here),
//   - and it is a FULL read: whole columns A:S, no row limit.
// Anything else throws, and the caller must block the save and show the error. Returns the distinct runs saved for this half.
export const STRICT_READ_TIMEOUT_MS = 30000
export async function readHalfState(hrCode, matchId, half, { timeoutMs = STRICT_READ_TIMEOUT_MS } = {}) {
  const tok = await saToken()
  const url = `${BASE}/${RESULTS_SHEET_ID}/values/${encodeURIComponent(`'${SAVE_TAB}'!A:S`)}?valueRenderOption=UNFORMATTED_VALUE`
  const where = `${verbFor('GET', url)} ${describeTarget(url)}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let res, data, raw
  try {
    try { res = await fetch(url, { headers: authHdr(tok), signal: ctl.signal }) }
    catch (e) {
      throw new Error(ctl.signal.aborted
        ? `Google Sheets did not answer within ${timeoutMs / 1000} s while ${where}`
        : `Could not reach Google Sheets while ${where}: ${e?.message || e}`)
    }
    try { ({ data, raw } = await readReply(res)) }
    catch (e) { throw new Error(`Google Sheets reply was cut off while ${where}: ${e?.message || e}`) }
    if (ctl.signal.aborted) throw new Error(`Google Sheets did not answer within ${timeoutMs / 1000} s while ${where}`)
  } finally { clearTimeout(timer) }
  if (res.status !== 200 || data === undefined) explainFailure(res, 'GET', url, data, raw)
  const values = data && data.values
  if (!Array.isArray(values) || values.length === 0) throw new Error(`The "${SAVE_TAB}" tab is empty (it has no header row), so it cannot be checked.`)
  const hdr = values[0].map(c => String(c ?? '').trim())
  while (hdr.length && hdr[hdr.length - 1] === '') hdr.pop()
  const same = want => hdr.length === want.length && hdr.every((c, i) => c === want[i])
  if (!same(SAVE_HEADER) && !same(SAVE_HEADER_V788)) {
    throw new Error(`The "${SAVE_TAB}" tab's header row is not the one Self-Review writes (19 columns, or the older 17), so it cannot be checked safely.`)
  }
  const up = v => String(v ?? '').trim().toUpperCase()
  const want = { hr: up(hrCode), match: String(matchId ?? '').trim(), half: up(half) }
  const runs = new Map()
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || []
    if (up(r[2]) !== want.hr || String(r[3] ?? '').trim() !== want.match || up(r[4]) !== want.half) continue
    const id = String(r[0] ?? '').trim()
    if (id && !runs.has(id)) runs.set(id, String(r[1] ?? ''))
  }
  return { rowsRead: values.length - 1, runs: [...runs].map(([runId, savedAt]) => ({ runId, savedAt })).sort((a, b) => a.savedAt.localeCompare(b.savedAt)) }
}

export { SAVE_HEADER }
