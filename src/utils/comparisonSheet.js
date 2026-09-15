/**
 * comparisonSheet.js — write comparison results to Google Sheets
 * ============================================================================
 * FIELD / Comparison only. Scout and Audit never import this file.
 * Uses same auth approach as fieldSheetSync.js.
 */
import { invoke } from '@tauri-apps/api/core'
import {
  FIELD_SHEET_ID,
} from '../config/fieldConfig'
import {
  TAB_COMPARISON_DETAIL, TAB_SCORES,
  DETAIL_COLUMNS, SCORES_COLUMNS,
  TOLERANCE_CONFIG_VERSION, ALGORITHM_VERSION,
} from '../config/comparisonConfig'
import { CURRENT_VERSION } from '../hooks/useUpdateCheck'
import { msToReadable } from './fieldSheetSync'

const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${FIELD_SHEET_ID}`

async function getToken() {
  const token = await invoke('get_google_access_token_cmd')
  if (!token) throw new Error('Google auth required.')
  return token
}

async function readHeader(token, tab) {
  const r = await fetch(`${BASE}/values/${encodeURIComponent(tab+'!1:1')}`,
    { headers: { Authorization: `Bearer ${token}` } })
  return (await r.json()).values?.[0] || []
}

/** Overwrite row 1 only. Data rows are untouched. */
async function writeHeaderRow(token, tab, header) {
  const url = `${BASE}/values/${encodeURIComponent(tab + '!1:1')}?valueInputOption=RAW`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [header] }),
  })
  if (!res.ok) throw new Error(`Could not extend the ${tab} header (${res.status})`)
}

async function appendRows(token, tab, values) {
  const url = `${BASE}/values/${encodeURIComponent(tab+'!A:A')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(()=>'')
    throw new Error(`Append to ${tab} failed (${res.status}): ${txt.slice(0,200)}`)
  }
  return (await res.json()).updates?.updatedRows || 0
}

/**
 * Accept a header that is a PREFIX of the expected one, and extend it in place.
 *
 * This used to demand an exact length match, which made adding any column a
 * breaking change: the moment `expected` grew, existing.length !== expected
 * .length threw and every subsequent run failed — not just missing the new
 * data, but unable to write at all.
 *
 * Columns are only ever APPENDED, so an older header is a strict prefix of the
 * current one and no existing column changes position. A mismatch in the
 * overlapping part is still a genuine error and still throws.
 */
async function validateOrWriteHeader(token, tab, expected) {
  const existing = await readHeader(token, tab)
  if (!existing.length) { await appendRows(token, tab, [expected]); return }

  // the overlap must agree exactly — a rename or reorder is still fatal
  const overlap = Math.min(existing.length, expected.length)
  const bad = []
  for (let i = 0; i < overlap; i++) {
    if (existing[i] !== expected[i]) bad.push(`col ${i + 1}: "${existing[i]}" should be "${expected[i]}"`)
  }
  if (bad.length) throw new Error(`Header mismatch in ${tab} — ${bad.join('; ')}`)

  if (existing.length > expected.length) {
    throw new Error(`${tab} has ${existing.length} columns but the code expects ${expected.length}. `
      + 'A column was removed from the config — that would orphan existing data.')
  }

  // older, shorter header: widen row 1. Existing rows keep their values and
  // simply have no cells under the new columns, which reads as empty.
  if (existing.length < expected.length) {
    console.log(`[MARK Comparison] extending ${tab} header from `
      + `${existing.length} to ${expected.length} columns`)
    await writeHeaderRow(token, tab, expected)
  }
}

// ── Serialise a single run result to Sheet rows ────────────────────────────
function buildScoreRow(runId, modelSess, collectorSess, result, scopeEventIds) {
  const row = {
    run_id:                     runId,
    run_timestamp_iso:          new Date().toISOString(),
    match_id:                   modelSess.match_id      || '',
    half:                       modelSess.half          || '',
    collector_hr_code:          collectorSess.collector_hr_code || '',
    model_session_id:           modelSess.session_id,
    model_version:              modelSess.model_version || '',
    model_source:               modelSess.model_source  || '',
    collector_session_id:       collectorSess.session_id,
    tolerance_config_version:   TOLERANCE_CONFIG_VERSION,
    algorithm_version:          ALGORITHM_VERSION,
    scope_event_ids:            scopeEventIds.join('|'),
    total_model_events:         String(result.modelEventCount),
    total_collector_events:     String(result.collectorEventCount + result.excludedCollectorCount),
    total_scoped_collector_events: String(result.collectorEventCount),
    correct:                    String(result.verdictCounts.correct           || 0),
    missing_event:              String(result.verdictCounts.missing_event     || 0),
    extra_event:                String(result.verdictCounts.extra_event       || 0),
    wrong_side:                 String(result.verdictCounts.wrong_side        || 0),
    wrong_timestamp:            String(result.verdictCounts.wrong_timestamp   || 0),
    wrong_extra:                String(result.verdictCounts.wrong_extra       || 0),
    missing_extra:              String(result.verdictCounts.missing_extra     || 0),
    not_needed_extra:           String(result.verdictCounts.not_needed_extra  || 0),
    score:                      result.score !== null ? String(result.score) : '',
    video_match_status:         result.videoMatchStatus,
  }

  // Module breakdown. A module the model answer does not cover has a null
  // score, which must reach the sheet as '' — writing 0 would be
  // indistinguishable from a collector who genuinely got everything wrong.
  const ms = result.moduleStats || {}
  const put = (prefix, mod) => {
    const st = ms[mod]
    row[prefix + '_score']   = st && st.score !== null ? String(st.score) : ''
    row[prefix + '_correct'] = st ? String(st.correct) : ''
    row[prefix + '_events']  = st ? String(st.events)  : ''
  }
  put('a','A'); put('b','B'); put('c','C')
  put('d','D'); put('to','TO'); put('pressure','PRESSURE')

  // String(row[c] ?? '') below would turn a null into "null", so nulls are
  // normalised above rather than relying on the map.
  return SCORES_COLUMNS.map(c => String(row[c] ?? ''))
}

function buildDetailRows(detailRows) {
  return detailRows.map(d => DETAIL_COLUMNS.map(c => {
    if (c === 'model_time_readable')     return msToReadable(d.model_video_time_ms     || '')
    if (c === 'collector_time_readable') return msToReadable(d.collector_video_time_ms || '')
    return String(d[c] ?? '')
  }))
}

// ── Main write function ────────────────────────────────────────────────────
/**
 * Has this exact run already been written?
 *
 * Identity is model session + collector session + tolerance config + algorithm
 * version. Those four fully determine the output: same inputs and same rules
 * give byte-identical rows, so a second write is pure noise in the sheet and
 * makes the cross-collector report double-count.
 *
 * The two versions are in the key deliberately — after a tolerance or
 * algorithm change the same pair SHOULD be re-run, and this must not block it.
 *
 * → the existing row as an object, or null
 */
export async function findExistingRun(modelSessionId, collectorSessionId) {
  const token = await getToken()
  const res = await fetch(`${BASE}/values/${encodeURIComponent(TAB_SCORES + '!A:ZZ')}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null            // never block a write on a failed read
  const rows = (await res.json()).values || []
  if (rows.length < 2) return null

  const hdr = rows[0]
  const idx = Object.fromEntries(hdr.map((h, i) => [h, i]))
  const want = {
    model_session_id:         String(modelSessionId || ''),
    collector_session_id:     String(collectorSessionId || ''),
    tolerance_config_version: String(TOLERANCE_CONFIG_VERSION),
    algorithm_version:        String(ALGORITHM_VERSION),
  }

  // newest first, so an identical re-run shows the most recent one
  for (let i = rows.length - 1; i >= 1; i--) {
    const r = rows[i]
    const same = Object.entries(want).every(([k, v]) =>
      idx[k] !== undefined && String(r[idx[k]] ?? '') === v)
    if (!same) continue
    return Object.fromEntries(hdr.map((h, j) => [h, r[j] ?? '']))
  }
  return null
}

export async function writeComparisonResults(modelSess, collectorSess, result, scopeEventIds, runId) {
  const token = await getToken()

  await validateOrWriteHeader(token, TAB_COMPARISON_DETAIL, DETAIL_COLUMNS)
  await validateOrWriteHeader(token, TAB_SCORES, SCORES_COLUMNS)

  const scoreRow   = buildScoreRow(runId, modelSess, collectorSess, result, scopeEventIds)
  const detailRows = buildDetailRows(result.detailRows)

  await appendRows(token, TAB_SCORES, [scoreRow])

  // Write detail rows in chunks of 500
  let written = 0
  for (let i = 0; i < detailRows.length; i += 500) {
    written += await appendRows(token, TAB_COMPARISON_DETAIL, detailRows.slice(i, i + 500))
  }

  return { scoreWritten: 1, detailWritten: written }
}
