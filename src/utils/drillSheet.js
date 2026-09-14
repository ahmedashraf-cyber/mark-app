/**
 * drillSheet.js — the DRILL spreadsheet: resolve, create, read, write
 * ============================================================================
 * DRILL only. Does not touch the TAG spreadsheet.
 *
 * WHY A SEPARATE SPREADSHEET
 * A Google Sheet caps at 10 million cells. quiz_answers_given at 500 trainees
 * would consume roughly a million cells per quiz, so about eight quizzes would
 * fill the TAG spreadsheet — and when a spreadsheet fills, EVERY write to it
 * fails, taking TAG, Comparison and Audit down with it. Isolating DRILL
 * contains that.
 *
 * HOW EVERY INSTALL FINDS THE SAME ONE
 * The ID lives in Firestore at mark_config/drill. First creator writes it under
 * a lock; everyone else reads it. Without the lock two trainers creating a quiz
 * at the same moment would produce two spreadsheets and split the data.
 *
 * OFFLINE
 * A failed write is queued in localStorage and retried, so a trainee always
 * sees their score even when the sheet write fails. Firestore is written first
 * and is the recovery source.
 */
import { invoke } from '@tauri-apps/api/core'
import { db } from '../firebase/config'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import {
  DRILL_CONFIG_DOC, DRILL_TABS, DRILL_SHEET_ID_DEFAULT,
} from '../config/drillConfig'

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const QUEUE_KEY   = 'mark_drill_write_queue'

let _sheetId = null   // in-memory cache for the session

async function token() {
  const t = await invoke('get_google_access_token_cmd')
  if (!t) throw new Error('Google auth unavailable')
  return t
}

// ── Spreadsheet resolution ───────────────────────────────────────────────────

/** Read the stored ID, or null. */
export async function getDrillSheetId() {
  if (_sheetId) return _sheetId
  // Firestore first, so the ID can be changed centrally without a new build.
  try {
    const snap = await getDoc(doc(db, 'mark_config', DRILL_CONFIG_DOC))
    const id = snap.exists() ? (snap.data()?.spreadsheetId || null) : null
    if (id) { _sheetId = id; return id }
  } catch (e) {
    console.warn('[DRILL] could not read mark_config/drill:', e.message)
  }
  // Fall back to the spreadsheet that was set up and verified by hand. Without
  // this, a fresh install fails with "spreadsheet does not exist yet" even
  // though the sheet is sitting there shared and working.
  if (DRILL_SHEET_ID_DEFAULT) {
    _sheetId = DRILL_SHEET_ID_DEFAULT
    return _sheetId
  }
  return null
}

/**
 * ONE-TIME SETUP — point MARK at a spreadsheet a human already created.
 *
 * MARK cannot create the spreadsheet itself: a service account has zero Drive
 * storage quota, so it can never OWN a file. (Folders work, which is why the
 * Scout export can make them — a folder holds no content.) Writing to a file
 * owned by a real person is fine and consumes their quota, which is how the TAG
 * spreadsheet already works.
 *
 * So a creator makes an empty spreadsheet, shares it with the service account
 * as Editor, and pastes the link here once. MARK then adds the six tabs and
 * their headers itself and records the ID in Firestore, so every other install
 * finds the same spreadsheet without repeating the step.
 */
export function parseSpreadsheetId(input) {
  const s = String(input || '').trim()
  if (!s) return null
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{30,}$/.test(s)) return s
  return null
}

/** Can the service account actually reach it? Returns the title on success. */
export async function verifySheetAccess(spreadsheetId) {
  const t = await token()
  const res = await fetch(
    `${SHEETS_BASE}/${spreadsheetId}?fields=properties.title,sheets.properties`,
    { headers: { Authorization: `Bearer ${t}` } })
  if (res.status === 404) {
    throw new Error('Not found. Check the link, and that it is shared with ' +
      'mark-reporter@mark-app-498618.iam.gserviceaccount.com')
  }
  if (res.status === 403) {
    throw new Error('No permission. Share it with ' +
      'mark-reporter@mark-app-498618.iam.gserviceaccount.com as Editor.')
  }
  if (!res.ok) throw new Error(`Could not open the spreadsheet (${res.status})`)
  const meta = await res.json()
  return {
    title: meta.properties?.title || '(untitled)',
    existingTabs: (meta.sheets || []).map(s => s.properties.title),
  }
}

/**
 * Add any missing tabs, then seed headers on the tabs we just created.
 * Existing tabs are left alone so re-running is harmless.
 */
export async function setupDrillSheet(input) {
  const id = parseSpreadsheetId(input)
  if (!id) throw new Error('That does not look like a Google Sheets link.')

  const { title, existingTabs } = await verifySheetAccess(id)
  const t = await token()

  const missing = DRILL_TABS.filter(tab => !existingTabs.includes(tab.name))
  if (missing.length) {
    const res = await fetch(`${SHEETS_BASE}/${id}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: missing.map(tab => ({ addSheet: { properties: { title: tab.name } } })),
      }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Could not add tabs (${res.status}): ${txt.slice(0, 160)}`)
    }
  }

  // headers only on tabs that were missing — never overwrite a populated tab
  if (missing.length) {
    const hdrRes = await fetch(`${SHEETS_BASE}/${id}/values:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: missing.map(tab => ({ range: `${tab.name}!A1`, values: [tab.columns] })),
      }),
    })
    if (!hdrRes.ok) throw new Error(`Could not write headers (${hdrRes.status})`)
  }

  await setDoc(doc(db, 'mark_config', DRILL_CONFIG_DOC), {
    spreadsheetId: id,
    title,
    configuredAt: Date.now(),
  }, { merge: true })
  _sheetId = id

  return { spreadsheetId: id, title, tabsAdded: missing.map(m => m.name) }
}

/**
 * Rewrite row 1 of every tab to match the current column lists.
 *
 * Needed whenever columns are added: the tabs already exist so setupDrillSheet
 * leaves their headers alone, but appendRows writes by POSITION from the column
 * array. A stale header row would mean data landing under the wrong names.
 * Only row 1 is touched, so existing data is untouched.
 */
export async function syncHeaders() {
  const id = await getDrillSheetId()
  if (!id) throw new Error('No DRILL spreadsheet configured')
  const t = await token()
  const res = await fetch(`${SHEETS_BASE}/${id}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: DRILL_TABS.map(tab => ({ range: `${tab.name}!A1`, values: [tab.columns] })),
    }),
  })
  if (!res.ok) throw new Error(`Header sync failed (${res.status})`)
  return DRILL_TABS.map(t2 => ({ tab: t2.name, columns: t2.columns.length }))
}

/** True once setup has been done, so the UI knows whether to prompt. */
export async function isDrillConfigured() {
  return !!(await getDrillSheetId())
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Whole tab as objects keyed by its header row.
 * Returns [] for an empty tab rather than throwing, so a fresh install with no
 * quizzes yet is not an error state.
 */
export async function readTab(tabName, { sheetId } = {}) {
  const id = sheetId || await getDrillSheetId()
  if (!id) return []
  const t = await token()
  const res = await fetch(
    `${SHEETS_BASE}/${id}/values/${encodeURIComponent(tabName + '!A:ZZ')}`,
    { headers: { Authorization: `Bearer ${t}` } })
  if (!res.ok) throw new Error(`Reading ${tabName} failed (${res.status})`)
  const rows = (await res.json()).values || []
  if (rows.length < 2) return []
  const headers = rows[0]
  return rows.slice(1).map(r =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])))
}

/** Several tabs in one request — used by the quiz list and the profile. */
export async function readTabs(tabNames) {
  const id = await getDrillSheetId()
  if (!id) return Object.fromEntries(tabNames.map(n => [n, []]))
  const t = await token()
  const qs = tabNames.map(n => `ranges=${encodeURIComponent(n + '!A:ZZ')}`).join('&')
  const res = await fetch(`${SHEETS_BASE}/${id}/values:batchGet?${qs}`,
    { headers: { Authorization: `Bearer ${t}` } })
  if (!res.ok) throw new Error(`Batch read failed (${res.status})`)
  const ranges = (await res.json()).valueRanges || []
  const out = {}
  tabNames.forEach((name, i) => {
    const rows = ranges[i]?.values || []
    if (rows.length < 2) { out[name] = []; return }
    const headers = rows[0]
    out[name] = rows.slice(1).map(r =>
      Object.fromEntries(headers.map((h, j) => [h, r[j] ?? ''])))
  })
  return out
}

// ── Writes ───────────────────────────────────────────────────────────────────

function toRow(obj, columns) {
  return columns.map(c => {
    const v = obj[c]
    if (v === null || v === undefined) return ''
    if (typeof v === 'boolean') return v ? '1' : '0'
    return String(v)
  })
}

/**
 * Append objects to a tab. Chunked at 500 rows because that is where the
 * Sheets API starts refusing, and a 50-clip quiz can exceed it.
 */
export async function appendRows(tabName, objects, columns, { sheetId } = {}) {
  if (!objects?.length) return 0
  const id = sheetId || await getDrillSheetId()
  if (!id) throw new Error('DRILL spreadsheet does not exist yet')
  const t = await token()
  const rows = objects.map(o => toRow(o, columns))

  let written = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const url = `${SHEETS_BASE}/${id}/values/${encodeURIComponent(tabName + '!A:A')}`
      + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: chunk }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Append to ${tabName} failed (${res.status}): ${txt.slice(0, 160)}`)
    }
    written += (await res.json()).updates?.updatedRows || 0
  }
  return written
}

/**
 * Overwrite the rows of a tab matching a predicate by rewriting the whole tab.
 * Used when a quiz is edited. Read-modify-write rather than surgical updates,
 * because Sheets has no row-level update by value and the tabs are small.
 */
export async function replaceTabRows(tabName, columns, allObjects, { sheetId } = {}) {
  const id = sheetId || await getDrillSheetId()
  if (!id) throw new Error('DRILL spreadsheet does not exist yet')
  const t = await token()

  // clear everything below the header
  const clearRes = await fetch(
    `${SHEETS_BASE}/${id}/values/${encodeURIComponent(tabName + '!A2:ZZ')}:clear`,
    { method: 'POST', headers: { Authorization: `Bearer ${t}` } })
  if (!clearRes.ok) throw new Error(`Clearing ${tabName} failed (${clearRes.status})`)

  if (!allObjects.length) return 0
  return appendRows(tabName, allObjects, columns, { sheetId: id })
}

// ── Offline queue ────────────────────────────────────────────────────────────
// A trainee must always see their score. Firestore is written first and is the
// recovery source; a failed sheet write is parked here and retried on next
// launch, so nothing is lost and nobody is blocked by a dropped connection.

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}
function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch {}
}

export function queueWrite(tabName, objects, columns) {
  const q = loadQueue()
  q.push({ tabName, objects, columns, at: Date.now() })
  saveQueue(q)
}

/** Append, and on failure queue instead of throwing. */
export async function appendOrQueue(tabName, objects, columns) {
  try {
    const n = await appendRows(tabName, objects, columns)
    return { ok: true, written: n, queued: false }
  } catch (e) {
    queueWrite(tabName, objects, columns)
    console.warn('[DRILL] sheet write queued for retry:', e.message)
    return { ok: false, written: 0, queued: true, error: e.message }
  }
}

/** Retry everything parked. Call on launch. Survives partial success. */
export async function flushQueue() {
  const q = loadQueue()
  if (!q.length) return { attempted: 0, flushed: 0 }
  const remaining = []
  let flushed = 0
  for (const item of q) {
    try {
      await appendRows(item.tabName, item.objects, item.columns)
      flushed++
    } catch {
      remaining.push(item)
    }
  }
  saveQueue(remaining)
  return { attempted: q.length, flushed, remaining: remaining.length }
}

export function pendingWriteCount() { return loadQueue().length }

export function clearSheetIdCache() { _sheetId = null }
