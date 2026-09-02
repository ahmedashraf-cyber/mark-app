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

async function validateOrWriteHeader(token, tab, expected) {
  const existing = await readHeader(token, tab)
  if (!existing.length) { await appendRows(token, tab, [expected]); return }
  const bad = expected.filter((c,i) => existing[i] !== c)
  if (bad.length || existing.length !== expected.length)
    throw new Error(`Header mismatch in ${tab}: ${bad.join(', ')}`)
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
  return SCORES_COLUMNS.map(c => String(row[c] ?? ''))
}

function buildDetailRows(detailRows) {
  return detailRows.map(d => DETAIL_COLUMNS.map(c => String(d[c] ?? '')))
}

// ── Main write function ────────────────────────────────────────────────────
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
