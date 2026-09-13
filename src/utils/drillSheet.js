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
import { doc, getDoc, setDoc, runTransaction } from 'firebase/firestore'
import {
  DRILL_SPREADSHEET_NAME, DRILL_CONFIG_DOC, DRILL_TABS,
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
  const snap = await getDoc(doc(db, 'mark_config', DRILL_CONFIG_DOC))
  const id = snap.exists() ? (snap.data()?.spreadsheetId || null) : null
  if (id) _sheetId = id
  return id
}

/**
 * Resolve the spreadsheet, creating it once if needed.
 * `shareEmails` are given writer access so trainers can open it.
 *
 * The transaction is what makes this safe: two creators racing both read the
 * doc, but only one commits, and the loser re-reads the winner's ID.
 */
export async function ensureDrillSheet(shareEmails = []) {
  const existing = await getDrillSheetId()
  if (existing) return existing

  const ref = doc(db, 'mark_config', DRILL_CONFIG_DOC)

  // claim the right to create
  const claimed = await runTransaction(db, async tx => {
    const snap = await tx.get(ref)
    const data = snap.exists() ? snap.data() : {}
    if (data.spreadsheetId) return { id: data.spreadsheetId, mine: false }
    // someone else may be mid-creation — respect a fresh lock
    const lockAt = data.creatingAt?.toMillis?.() ?? data.creatingAt ?? 0
    if (lockAt && Date.now() - lockAt < 60_000) return { id: null, mine: false }
    tx.set(ref, { creatingAt: Date.now() }, { merge: true })
    return { id: null, mine: true }
  })

  if (claimed.id) { _sheetId = claimed.id; return claimed.id }

  if (!claimed.mine) {
    // another instance is creating it — wait for them
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const id = await getDrillSheetId()
      if (id) return id
    }
    throw new Error('Another user is still setting up the DRILL sheet. Try again shortly.')
  }

  // we hold the lock — create, seed headers, record the ID
  try {
    const id = await invoke('drill_create_spreadsheet', {
      title: DRILL_SPREADSHEET_NAME,
      tabs: DRILL_TABS.map(t => t.name),
      shareEmails,
    })
    await writeAllHeaders(id)
    await setDoc(ref, {
      spreadsheetId: id,
      createdAt: Date.now(),
      creatingAt: null,
    }, { merge: true })
    _sheetId = id
    return id
  } catch (e) {
    // release the lock so the next attempt is not blocked for a minute
    await setDoc(ref, { creatingAt: null }, { merge: true }).catch(() => {})
    throw e
  }
}

/** Seed row 1 of every tab in one batched request. */
async function writeAllHeaders(sheetId) {
  const t = await token()
  const data = DRILL_TABS.map(tab => ({
    range: `${tab.name}!A1`,
    values: [tab.columns],
  }))
  const res = await fetch(`${SHEETS_BASE}/${sheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  })
  if (!res.ok) throw new Error(`Writing headers failed (${res.status})`)
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
