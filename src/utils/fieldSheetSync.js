/**
 * fieldSheetSync.js — Google Sheets write for FIELD mode
 * =========================================================
 * FIELD mode only. Scout and Audit never import this file.
 *
 * Uses the existing Google OAuth commands already in main.rs:
 *   get_google_access_token_cmd  → returns a valid access token
 *
 * All rows for a session are written in ONE batch append request.
 * On duplicate session_id: existing rows are deleted first, then re-appended.
 * Header is written on first save; on subsequent saves it is validated —
 * any mismatch causes a hard failure before writing any data.
 *
 * The same serialisation function (buildRows) is used for both the Sheet
 * and the CSV download — they are guaranteed identical.
 */
import { invoke } from '@tauri-apps/api/core'
import {
  FIELD_SHEET_ID, FIELD_SHEET_TAB, FIELD_SCHEMA_VERSION,
  FIELD_COLUMNS, validateMatchId,
} from '../config/fieldConfig'
import { CURRENT_VERSION } from '../hooks/useUpdateCheck'

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

// ─── Auth helper ──────────────────────────────────────────────────────────────
async function getToken() {
  try {
    const token = await invoke('get_google_access_token_cmd')
    if (!token) throw new Error('No token returned')
    return token
  } catch (e) {
    throw new Error(`Google auth failed: ${e.message || e}. Please sign in via Settings.`)
  }
}

// ─── Row serialisation ────────────────────────────────────────────────────────
// Single source of truth — used for BOTH Sheet and CSV.
// Returns: { headers: string[], rows: string[][] }
export function buildRows(session, events, flags = '') {
  const exportTs = new Date().toISOString()
  const videoFilename = session.videoName || (session.videoPath || '').split(/[\\/]/).pop() || ''
  const videoDurSec   = session.videoDurationSec || ''
  const collEmail     = session.collectorEmail   || ''

  // Collection timing
  const accMs     = session.accumulatedMs || 0
  const startMs   = session.collectionStartWallMs || null
  const endMs     = session.collectionEndWallMs   || null
  const sessionMs = (startMs && endMs && endMs > startMs) ? (endMs - startMs) : 0
  const totalMs   = accMs + sessionMs
  const elapsedMins = totalMs > 0 ? totalMs / 60000 : 0
  const evPerMin  = elapsedMins > 0 ? (events.length / elapsedMins).toFixed(2) : ''
  const hasHalfEnd = events.some(e => e.eventId === 'half_end')

  function isoOrEmpty(ms) {
    if (!ms) return ''
    try { return new Date(ms).toISOString() } catch { return '' }
  }
  function msToReadable(ms) {
    if (!ms && ms !== 0) return ''
    const total = Math.floor(ms / 1000)
    const m = Math.floor(total / 60), s = total % 60, mil = Math.floor(ms % 1000)
    return `${m}:${String(s).padStart(2,'0')}.${String(mil).padStart(3,'0')}`
  }

  // Sort by video_time_ms ascending — deterministic
  const sorted = [...events].sort((a,b) => (a.videoTimeSec||0)*1000 - (b.videoTimeSec||0)*1000)

  const rows = sorted.map(ev => {
    const videoMs = Math.round((ev.videoTimeSec || 0) * 1000)

    // Attribute groups: up to 6 slots (groupId + comma-separated optionCodes)
    // v3 events have ev.groups[]; v1/v2 events have ev.extras[] (flat labels)
    const groupSlots = []
    if (ev.groups && ev.groups.length > 0) {
      ev.groups.forEach(g => {
        const codes = (g.selections || []).map(s => s.code || s.label || '').filter(Boolean).join(',')
        groupSlots.push(g.groupId || '', codes)
      })
    }
    // Pad to 6 slots (12 columns)
    while (groupSlots.length < 12) groupSlots.push('')

    // Legacy flat extras — pass "Lunch" through verbatim (per earlier decision)
    const extrasFlat = ev.groups?.length > 0
      ? ''
      : (ev.extras || []).map(x => String(x)).join(',')

    const row = {
      schema_version:              FIELD_SCHEMA_VERSION,
      session_id:                  session.sessionId || '',
      match_id:                    session.matchId   || '',
      half:                        session.half      || '',
      collector_hr_code:           session.collectorHrCode || '',
      event_id:                    ev.eventId    || '',
      event_label:                 ev.eventLabel || '',
      video_time_ms:               videoMs,
      video_time_readable:         msToReadable(videoMs),
      team:                        ev.team       || '',
      team_source:                 ev.teamSource || '',
      inferred_type:               ev.type?.label || ev.type?.code || ev.type || '',
      type_source:                 ev.typeSource || '',
      group_1_id:    groupSlots[0]  || '',
      group_1_codes: groupSlots[1]  || '',
      group_2_id:    groupSlots[2]  || '',
      group_2_codes: groupSlots[3]  || '',
      group_3_id:    groupSlots[4]  || '',
      group_3_codes: groupSlots[5]  || '',
      group_4_id:    groupSlots[6]  || '',
      group_4_codes: groupSlots[7]  || '',
      group_5_id:    groupSlots[8]  || '',
      group_5_codes: groupSlots[9]  || '',
      group_6_id:    groupSlots[10] || '',
      group_6_codes: groupSlots[11] || '',
      extras_flat:                 extrasFlat,
      possession_certain:          ev.possessionCertain === false ? '0' : ev.possessionCertain === true ? '1' : '',
      miscommunication_team:       ev.miscommunicationTeam || '',
      video_filename:              videoFilename,
      video_duration_sec:          videoDurSec,
      collector_email:             collEmail,
      export_timestamp_iso:        exportTs,
      mark_version:                CURRENT_VERSION,
      collection_start_wall_iso:   isoOrEmpty(startMs),
      collection_end_wall_iso:     isoOrEmpty(endMs),
      collection_elapsed_raw_ms:   totalMs || '',
      collection_events_per_min:   evPerMin,
      collection_incomplete:       hasHalfEnd ? '0' : '1',
      flags,
    }

    return FIELD_COLUMNS.map(col => String(row[col] ?? ''))
  })

  return { headers: FIELD_COLUMNS, rows }
}

// ─── CSV download ─────────────────────────────────────────────────────────────
export function downloadFieldCsv(session, events, flags = '') {
  const { headers, rows } = buildRows(session, events, flags)

  function cell(v) {
    const s = String(v ?? '')
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'

  const base = (session.videoName || 'field').replace(/\.[^.]+$/, '').replace(/[/\\?%*:|"<>]/g, '-')
  const ts   = new Date().toISOString().slice(0,16).replace(/[T:]/g, '-')
  const filename = `${base}_${session.matchId || 'MATCH'}_H${session.half || '?'}_${ts}.csv`

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
  return filename
}

// ─── Read all values from the sheet ──────────────────────────────────────────
async function readSheet(token) {
  const range = encodeURIComponent(`${FIELD_SHEET_TAB}!A:A`)
  const url   = `${SHEETS_BASE}/${FIELD_SHEET_ID}/values/${range}`
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const txt = await res.text().catch(()=>'')
    throw new Error(`Sheet read failed (${res.status}): ${txt.slice(0,200)}`)
  }
  const data = await res.json()
  return data.values || []  // [[cell], [cell], ...]
}

async function readSheetRow1(token) {
  const range = encodeURIComponent(`${FIELD_SHEET_TAB}!1:1`)
  const url   = `${SHEETS_BASE}/${FIELD_SHEET_ID}/values/${range}`
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Header read failed (${res.status})`)
  const data  = await res.json()
  return (data.values?.[0] || [])
}

// ─── Delete rows by session_id ─────────────────────────────────────────────────
// Returns { deletedCount }
async function deleteSessionRows(token, sessionId) {
  // Read full col A to find matching row indices
  const colA = await readSheet(token)
  // Find row indices (1-based) where col A = sessionId (skip header row 1)
  const toDelete = []
  colA.forEach((row, idx) => {
    if (idx > 0 && row[0] === sessionId) toDelete.push(idx + 1)  // 1-based row number
  })

  if (toDelete.length === 0) return { deletedCount: 0 }

  // Delete in reverse order (so indices don't shift)
  // Sheets API batchUpdate with DeleteDimensionRequest
  const requests = [...toDelete].reverse().map(rowNum => ({
    deleteDimension: {
      range: {
        sheetId: 0,  // gid=0 from URL
        dimension: 'ROWS',
        startIndex: rowNum - 1,  // 0-based
        endIndex:   rowNum,
      }
    }
  }))

  const url = `${SHEETS_BASE}/${FIELD_SHEET_ID}:batchUpdate`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(()=>'')
    throw new Error(`Delete rows failed (${res.status}): ${txt.slice(0,200)}`)
  }
  return { deletedCount: toDelete.length }
}

// ─── Append rows ──────────────────────────────────────────────────────────────
async function appendRows(token, values) {
  const range = encodeURIComponent(`${FIELD_SHEET_TAB}!A:A`)
  const url   = `${SHEETS_BASE}/${FIELD_SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
  const res   = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(()=>'')
    throw new Error(`Sheet append failed (${res.status}): ${txt.slice(0,200)}`)
  }
  const data = await res.json()
  // Confirm actual rows written
  const updated = data.updates?.updatedRows || 0
  if (updated === 0) throw new Error('Sheet append returned 0 rows written — treating as failure')
  return { rowsWritten: updated }
}

// ─── Main sync function ────────────────────────────────────────────────────────
// Returns { success: true, rowsWritten } or throws with a human-readable message.
export async function syncSessionToSheet(session, events) {
  const token = await getToken()

  // ── 1. Check for same Match+Half+Collector under different session ID ────────
  // (warning only — does not block write)
  let duplicateHalfFlag = ''
  try {
    // Read session_id (col A), match_id (col C), half (col D), hr_code (col E)
    const rangeCheck = encodeURIComponent(`${FIELD_SHEET_TAB}!A:E`)
    const checkRes = await fetch(
      `${SHEETS_BASE}/${FIELD_SHEET_ID}/values/${rangeCheck}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (checkRes.ok) {
      const checkData = await checkRes.json()
      const allRows   = checkData.values || []
      const conflict  = allRows.slice(1).find(r =>
        r[0] && r[0] !== session.sessionId &&
        r[2] === session.matchId &&
        r[3] === String(session.half) &&
        r[4] === session.collectorHrCode
      )
      if (conflict) {
        duplicateHalfFlag = `DUPLICATE_HALF:${conflict[0]}`
        console.warn(`[MARK Field] Same match+half+collector found under session ${conflict[0]}`)
      }
    }
  } catch(e) { console.warn('[MARK Field] duplicate check failed (non-fatal):', e.message) }

  const { headers, rows } = buildRows(session, events, duplicateHalfFlag)

  // ── 2. Header check ───────────────────────────────────────────────────────────
  const existingHeader = await readSheetRow1(token)

  if (existingHeader.length === 0) {
    // Sheet is empty — write header first
    await appendRows(token, [headers])
  } else {
    // Validate existing header matches expected exactly
    const mismatches = []
    headers.forEach((col, i) => {
      if (existingHeader[i] !== col) {
        mismatches.push(`col ${i+1}: expected "${col}", found "${existingHeader[i] || '(empty)'}"`)
      }
    })
    if (existingHeader.length !== headers.length) {
      mismatches.push(`column count: expected ${headers.length}, found ${existingHeader.length}`)
    }
    if (mismatches.length > 0) {
      throw new Error(
        `Sheet header mismatch — NOT writing to prevent misaligned data.\n` +
        `Fix the sheet header or bump schema version.\n\n` +
        mismatches.join('\n')
      )
    }
  }

  // ── 3. Delete existing rows for this session (idempotent retry safety) ────────
  const { deletedCount } = await deleteSessionRows(token, session.sessionId)
  if (deletedCount > 0) {
    console.log(`[MARK Field] Deleted ${deletedCount} existing rows for session ${session.sessionId}`)
  }

  // ── 4. Append all rows in one batch ──────────────────────────────────────────
  const { rowsWritten } = await appendRows(token, rows)

  return {
    success: true,
    rowsWritten,
    duplicateHalfWarning: duplicateHalfFlag || null,
  }
}
