/**
 * importModelAnswers.js — one-shot Sheet write for model answer sessions
 * ============================================================================
 * Called once from FieldPage when the user clicks "Import Model Answers".
 * Writes to field_sessions and field_events tabs using the same syncSessionToSheet
 * auth and header-validation logic.
 *
 * After a confirmed successful write, sets localStorage['mark_field_model_imported'] = '1'
 * so the button disappears and this never runs twice.
 *
 * FIELD only. Scout and Audit untouched.
 */
import { invoke } from '@tauri-apps/api/core'
import {
  FIELD_SHEET_ID, FIELD_TAB_SESSIONS, FIELD_TAB_EVENTS,
  SESSION_COLUMNS, EVENT_COLUMNS,
} from '../config/fieldConfig'
import { MODEL_SESSION_ROWS, MODEL_EVENT_ROWS } from './modelImportData'

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const IMPORT_DONE_KEY = 'mark_field_model_imported'

async function getToken() {
  const token = await invoke('get_google_access_token_cmd')
  if (!token) throw new Error('Google auth required. Please sign in first.')
  return token
}

async function readHeader(token, tab) {
  const range = encodeURIComponent(`${tab}!1:1`)
  const res = await fetch(`${SHEETS_BASE}/${FIELD_SHEET_ID}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Read header failed (${res.status})`)
  return (await res.json()).values?.[0] || []
}

async function appendRows(token, tab, values) {
  const range = encodeURIComponent(`${tab}!A:A`)
  const url = `${SHEETS_BASE}/${FIELD_SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(()=>'')
    throw new Error(`Append to ${tab} failed (${res.status}): ${txt.slice(0,200)}`)
  }
  const d = await res.json()
  return d.updates?.updatedRows || 0
}

async function validateOrWriteHeader(token, tab, expected) {
  const existing = await readHeader(token, tab)
  if (!existing.length) {
    await appendRows(token, tab, [expected])
    return
  }
  const mismatches = []
  expected.forEach((col, i) => {
    if (existing[i] !== col) mismatches.push(`col ${i+1}: expected "${col}", got "${existing[i]||'(empty)'}"`)
  })
  if (existing.length !== expected.length)
    mismatches.push(`count: expected ${expected.length}, got ${existing.length}`)
  if (mismatches.length)
    throw new Error(`Header mismatch in ${tab}:\n${mismatches.join('\n')}`)
}

async function getExistingSessionIds(token) {
  const range = encodeURIComponent(`${FIELD_TAB_SESSIONS}!B:B`)
  const res = await fetch(`${SHEETS_BASE}/${FIELD_SHEET_ID}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return new Set()
  const vals = (await res.json()).values || []
  return new Set(vals.slice(1).map(r => r[0]).filter(Boolean))
}

export async function importModelAnswers(onProgress) {
  if (localStorage.getItem(IMPORT_DONE_KEY) === '1') {
    return { skipped: true, reason: 'Already imported (mark_field_model_imported=1)' }
  }

  onProgress?.('Authenticating…')
  const token = await getToken()

  onProgress?.('Validating sheet headers…')
  await validateOrWriteHeader(token, FIELD_TAB_SESSIONS, SESSION_COLUMNS)
  await validateOrWriteHeader(token, FIELD_TAB_EVENTS,   EVENT_COLUMNS)

  // Skip sessions already in the sheet (idempotent)
  const existing = await getExistingSessionIds(token)
  const newSessions = MODEL_SESSION_ROWS.filter(r => !existing.has(r[1]))  // col 1 = session_id
  const newSessIds  = new Set(newSessions.map(r => r[1]))
  const newEvents   = MODEL_EVENT_ROWS.filter(r => newSessIds.has(r[0]))   // col 0 = session_id

  if (newSessions.length === 0) {
    localStorage.setItem(IMPORT_DONE_KEY, '1')
    return { skipped: true, reason: 'All sessions already in sheet' }
  }

  onProgress?.(`Writing ${newSessions.length} session rows…`)
  await appendRows(token, FIELD_TAB_SESSIONS, newSessions)

  // Write events in chunks of 500 (API limit per request)
  const CHUNK = 500
  let written = 0
  for (let i = 0; i < newEvents.length; i += CHUNK) {
    const chunk = newEvents.slice(i, i + CHUNK)
    await appendRows(token, FIELD_TAB_EVENTS, chunk)
    written += chunk.length
    onProgress?.(`Writing events… ${written}/${newEvents.length}`)
  }

  localStorage.setItem(IMPORT_DONE_KEY, '1')
  return {
    success: true,
    sessionsWritten: newSessions.length,
    eventsWritten: written,
  }
}

export function isModelImportDone() {
  return localStorage.getItem(IMPORT_DONE_KEY) === '1'
}
