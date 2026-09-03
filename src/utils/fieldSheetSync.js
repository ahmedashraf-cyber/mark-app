/**
 * fieldSheetSync.js — FIELD mode Google Sheets sync + CSV export
 * ============================================================================
 * FIELD only. Never imported by Scout or Audit.
 *
 * Two-tab schema (v3):
 *   field_sessions — one row per session
 *   field_events   — one row per event (join on session_id)
 *
 * buildSessionRow() and buildEventRows() are the single serialisation source.
 * Both Sheet write and CSV download call them — outputs are identical.
 *
 * pair_id = ${sessionId.slice(0,8)}_${openEventSeq}
 * duration_ms = closeEvent.video_time_ms - openEvent.video_time_ms (integer arithmetic)
 * time_from_half_start_ms = empty for events before half_start; 0 for half_start itself
 *
 * video identity: video_size_bytes + video_duration_ms (separate columns per schema)
 * Mismatch is a flagged warning, not a hard block.
 */
import { invoke } from '@tauri-apps/api/core'
import {
  FIELD_SHEET_ID, FIELD_TAB_SESSIONS, FIELD_TAB_EVENTS,
  FIELD_SCHEMA_VERSION, SESSION_COLUMNS, EVENT_COLUMNS,
  EVENT_BY_CODE, GROUP_TO_ATTR_COL,
} from '../config/fieldConfig'
import { CURRENT_VERSION } from '../hooks/useUpdateCheck'

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

// ── Auth ────────────────────────────────────────────────────────────────────
async function getToken() {
  try {
    const token = await invoke('get_google_access_token_cmd')
    if (!token) throw new Error('No token returned')
    return token
  } catch (e) {
    throw new Error(`Google auth failed: ${e.message || e}. Please sign in.`)
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function msToReadable(ms) {
  if (ms === null || ms === undefined || ms === '') return ''
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60), s = total % 60, mil = Math.floor(ms % 1000)
  return `${m}:${String(s).padStart(2,'0')}.${String(mil).padStart(3,'0')}`
}
function isoOrEmpty(ms) {
  if (!ms) return ''
  try { return new Date(ms).toISOString() } catch { return '' }
}

// ── Pair index: build open-event seq map from events ──────────────────────
// Returns Map<pair_id, { openVideoTimeMs, status }>
function buildPairIndex(events) {
  const pairs = new Map()
  events.forEach(ev => {
    if (ev.pair_id && ev.pair_status) {
      if (!ev.closesEventId && !pairs.has(ev.pair_id)) {
        // open event
        pairs.set(ev.pair_id, { openVideoTimeMs: ev.video_time_ms ?? Math.round((ev.videoTimeSec||0)*1000) })
      }
    }
  })
  return pairs
}

// ── Half-start anchor for time_from_half_start_ms ─────────────────────────
function buildHalfStartMs(events) {
  const hs = events.find(e => e.eventId === 'half_start')
  if (!hs) return null
  return hs.video_time_ms ?? Math.round((hs.videoTimeSec||0)*1000)
}

// ── Session row serialiser ─────────────────────────────────────────────────
export function buildSessionRow(session) {
  const exportDate = new Date().toISOString().slice(0,10)
  const accMs     = session.accumulatedMs || 0
  const startMs   = session.collectionStartWallMs || null
  const endMs     = session.collectionEndWallMs   || null
  const sessionMs = (startMs && endMs && endMs > startMs) ? (endMs - startMs) : 0
  const totalMs   = accMs + sessionMs
  const elapsedMins = totalMs > 0 ? totalMs / 60000 : 0
  const evPerMin  = elapsedMins > 0 ? (session.totalEvents / elapsedMins).toFixed(2) : ''

  const half = session.half ? `${session.half}H` : ''  // "1H" / "2H"

  const row = {
    schema_version:            FIELD_SCHEMA_VERSION,
    session_id:                session.sessionId        || '',
    match_id:                  String(session.matchId || ''),
    half,
    collector_hr_code:         session.collectorHrCode  || '',
    collector_email:           session.collectorEmail   || '',
    video_filename:            session.videoName        || '',
    video_size_bytes:          String(session.videoSizeBytes || ''),
    video_duration_ms:         String(session.videoDurationMs || ''),
    home_team_name:            session.homeTeamName     || '',
    away_team_name:            session.awayTeamName     || '',
    is_model:                  '0',
    model_version:             '',
    model_status:              '',
    scope_event_ids:           session.scopeEventIds    || '',
    mark_version:              CURRENT_VERSION,
    export_date:               exportDate,
    collection_start_wall_iso: isoOrEmpty(startMs),
    collection_end_wall_iso:   isoOrEmpty(endMs),
    collection_elapsed_raw_ms: String(totalMs || ''),
    collection_events_per_min: evPerMin,
    collection_incomplete:     session.collectionIncomplete ? '1' : '0',
  }
  return SESSION_COLUMNS.map(col => String(row[col] ?? ''))
}

// ── Event rows serialiser ──────────────────────────────────────────────────
export function buildEventRows(events) {
  // Sort by video_time_ms ascending — deterministic
  const sorted = [...events].sort((a,b) => {
    const aMs = a.video_time_ms ?? Math.round((a.videoTimeSec||0)*1000)
    const bMs = b.video_time_ms ?? Math.round((b.videoTimeSec||0)*1000)
    return aMs - bMs
  })

  const halfStartMs = buildHalfStartMs(sorted)
  const pairIndex   = buildPairIndex(sorted)

  return sorted.map((ev, idx) => {
    const videoMs  = ev.video_time_ms ?? Math.round((ev.videoTimeSec||0)*1000)
    const registry = EVENT_BY_CODE[ev.eventId] || {}
    const seq      = ev.event_seq ?? (idx + 1)

    // time_from_half_start_ms
    let timeFromHalf = ''
    if (ev.eventId === 'half_start') {
      timeFromHalf = '0'
    } else if (halfStartMs !== null) {
      timeFromHalf = String(videoMs - halfStartMs)
      // negative = event before half_start → empty
      if (Number(timeFromHalf) < 0) timeFromHalf = ''
    }

    // duration_ms for close events
    let durationMs = ''
    if (ev.pair_id && ev.pair_status === 'complete') {
      const open = pairIndex.get(ev.pair_id)
      if (open && ev.closesEventId) {
        durationMs = String(videoMs - open.openVideoTimeMs)
      }
    }

    // Named attr columns — map each collected group to its column
    const attrCols = Object.fromEntries(EVENT_COLUMNS
      .filter(c => c.startsWith('attr_'))
      .map(c => [c, '']))

    if (ev.groups && ev.groups.length > 0) {
      ev.groups.forEach(g => {
        const colName = GROUP_TO_ATTR_COL[g.groupId]
        if (!colName) return
        const codes = (g.selections || []).map(s => s.code || s.label || '').filter(Boolean)
        if (codes.length > 0) attrCols[colName] = codes.join('|')
      })
    } else if (ev.extras && ev.extras.length > 0) {
      // legacy v1/v2 events with flat extras array — put in attr_extras
      // pass "Lunch" through as-is (legacy value, no exception)
      attrCols['attr_extras'] = ev.extras.map(x => String(x)).join('|')
    }

    // inferred_type as optionCode
    const inferredType = ev.type?.code || ev.type || ''

    const row = {
      session_id:              ev.sessionId     || '',
      event_seq:               String(seq),
      event_id:                String(registry.numericId || ''),
      event_code:              ev.eventId       || '',
      event_label:             ev.eventLabel    || '',
      video_time_ms:           String(videoMs),
      video_time_readable:     msToReadable(videoMs),
      time_from_half_start_ms: timeFromHalf,
      team:                    ev.team          || '',
      team_source:             ev.teamSource    || '',
      inferred_type:           inferredType,
      type_source:             ev.typeSource    || '',
      pair_id:                 ev.pair_id       || '',
      pair_status:             ev.pair_status   || '',
      duration_ms:             durationMs,
      possession_certain:      ev.possessionCertain === false ? '0' : ev.possessionCertain === true ? '1' : '',
      miscommunication_team:   ev.miscommunicationTeam || '',
      ...attrCols,
      model_shape:             ev.model_shape || '',  // Pressure Code on model rows; empty on live FIELD rows
    }
    return EVENT_COLUMNS.map(col => String(row[col] ?? ''))
  })
}

// ── CSV download (Sheet and CSV from same serialiser) ─────────────────────
function toCsv(headers, rows) {
  function cell(v) {
    const s = String(v ?? '')
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function downloadFieldCsv(session, events) {
  const sessionCsv = toCsv(SESSION_COLUMNS, [buildSessionRow(session)])
  const eventsCsv  = toCsv(EVENT_COLUMNS, buildEventRows(events))

  const base     = (session.videoName || 'field').replace(/\.[^.]+$/, '').replace(/[/\\?%*:|"<>]/g,'-')
  const matchPart= session.matchId ? `_${session.matchId}` : ''
  const halfPart = session.half    ? `_H${session.half}`   : ''
  const ts       = new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')

  // Two files: sessions CSV and events CSV
  for (const [suffix, csv] of [['_sessions',sessionCsv],['_events',eventsCsv]]) {
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `${base}${matchPart}${halfPart}${suffix}_${ts}.csv`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }
}

// ── Sheet helpers ─────────────────────────────────────────────────────────
async function readRange(token, tab, range) {
  const r = encodeURIComponent(`${tab}!${range}`)
  const res = await fetch(`${SHEETS_BASE}/${FIELD_SHEET_ID}/values/${r}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const txt = await res.text().catch(()=>'')
    throw new Error(`Read ${tab}!${range} failed (${res.status}): ${txt.slice(0,200)}`)
  }
  return (await res.json()).values || []
}

async function appendRows(token, tab, values) {
  const range = encodeURIComponent(`${tab}!A:A`)
  const url   = `${SHEETS_BASE}/${FIELD_SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
  const res   = await fetch(url, {
    method:'POST',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ values }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(()=>'')
    throw new Error(`Append to ${tab} failed (${res.status}): ${txt.slice(0,200)}`)
  }
  const data = await res.json()
  const written = data.updates?.updatedRows || 0
  if (written === 0) throw new Error(`Append to ${tab} returned 0 rows written`)
  return written
}

async function deleteRowsBySessionId(token, tab, sessionId, colIndex = 0) {
  const colA = await readRange(token, tab, 'A:A')
  const toDelete = []
  colA.forEach((row, idx) => {
    if (idx > 0 && row[colIndex] === sessionId) toDelete.push(idx + 1)
  })
  if (toDelete.length === 0) return 0

  const requests = [...toDelete].reverse().map(rowNum => ({
    deleteDimension: {
      range: { sheetId: tab === FIELD_TAB_SESSIONS ? 0 : 1,
               dimension: 'ROWS', startIndex: rowNum-1, endIndex: rowNum }
    }
  }))
  const res = await fetch(`${SHEETS_BASE}/${FIELD_SHEET_ID}:batchUpdate`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(()=>'')
    throw new Error(`Delete rows in ${tab} failed (${res.status}): ${txt.slice(0,200)}`)
  }
  return toDelete.length
}

async function validateOrWriteHeader(token, tab, expectedHeaders) {
  const rows = await readRange(token, tab, '1:1')
  if (!rows.length || rows[0].length === 0) {
    await appendRows(token, tab, [expectedHeaders])
    return
  }
  const existing = rows[0]
  const mismatches = []
  expectedHeaders.forEach((col, i) => {
    if (existing[i] !== col)
      mismatches.push(`col ${i+1}: expected "${col}", found "${existing[i] || '(empty)'}"`)
  })
  if (existing.length !== expectedHeaders.length)
    mismatches.push(`count: expected ${expectedHeaders.length}, found ${existing.length}`)
  if (mismatches.length > 0)
    throw new Error(
      `Header mismatch in ${tab} — NOT writing to prevent misaligned data.\n` +
      `Fix the sheet or bump schema version.\n\n` + mismatches.join('\n')
    )
}

// ── Main sync ─────────────────────────────────────────────────────────────
export async function syncSessionToSheet(session, events) {
  const token = await getToken()

  // 1. Validate/write headers on both tabs
  await validateOrWriteHeader(token, FIELD_TAB_SESSIONS, SESSION_COLUMNS)
  await validateOrWriteHeader(token, FIELD_TAB_EVENTS,   EVENT_COLUMNS)

  // 2. Duplicate session check (same Match+Half+Collector, different session_id)
  let duplicateHalfWarning = null
  try {
    const sessRows = await readRange(token, FIELD_TAB_SESSIONS, 'A:E')
    const conflict = sessRows.slice(1).find(r =>
      r[0] && r[0] !== session.sessionId &&
      r[2] === String(session.matchId) &&
      r[3] === `${session.half}H` &&
      r[4] === session.collectorHrCode
    )
    if (conflict) {
      duplicateHalfWarning = `DUPLICATE_HALF:${conflict[0]}`
      console.warn(`[MARK Field] Same match+half+collector under session ${conflict[0]}`)
    }
  } catch(e) { console.warn('[MARK Field] duplicate check (non-fatal):', e.message) }

  // 3. Delete existing rows for this session (idempotent retry safety)
  const [delSess, delEvs] = await Promise.all([
    deleteRowsBySessionId(token, FIELD_TAB_SESSIONS, session.sessionId, 1),
    deleteRowsBySessionId(token, FIELD_TAB_EVENTS,   session.sessionId, 0),
  ])
  if (delSess + delEvs > 0)
    console.log(`[MARK Field] Deleted ${delSess} session rows, ${delEvs} event rows for retry`)

  // 4. Build and append
  const sessionRow = buildSessionRow(session)
  const eventRows  = buildEventRows(events)

  await appendRows(token, FIELD_TAB_SESSIONS, [sessionRow])
  if (eventRows.length > 0)
    await appendRows(token, FIELD_TAB_EVENTS, eventRows)

  return {
    success: true,
    rowsWritten: 1 + eventRows.length,
    duplicateHalfWarning,
  }
}
