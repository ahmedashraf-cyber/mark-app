/**
 * adminSheet.js — writes for the Batch Manager admin page
 * ============================================================================
 * Two spreadsheets:
 *   · the Supervisor roster — user rows, roles, status, and the role_changes log
 *   · the DRILL sheet       — quiz pass mark / time limit, and quiz_changes
 *
 * Reads go through the API key (read-only). Every WRITE goes through the
 * service account, because an API key cannot write.
 *
 * ── Why every write re-reads first ─────────────────────────────────────────
 * Updating one person's role means writing an exact cell, e.g. Supervisor!C147.
 * The row index comes from an earlier read, so if anyone sorts or edits the
 * sheet in between, that index now points at a DIFFERENT person and the write
 * would silently change the wrong user's access.
 *
 * So each write re-reads the key column immediately beforehand and verifies the
 * identifier in that row still matches. A mismatch aborts rather than guesses.
 * It costs a second per save and removes a whole class of silent corruption.
 */
import { invoke } from '@tauri-apps/api/core'
import { PEOPLE_SHEET_ID, PEOPLE_TAB_NAMES } from '../config/drillConfig'
import { getDrillSheetId } from './drillSheet'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const API_KEY = 'AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI'

export const ROLE_TAB   = 'Supervisor'
export const LOG_TAB    = 'role_changes'
export const QUIZ_LOG   = 'quiz_changes'

/** A=Code B=Name C=Role D=Mail E=Password F=Status — verified against the live sheet. */
export const PCOL = { code:0, name:1, role:2, mail:3, pass:4, status:5 }
const COL_LETTER = ['A','B','C','D','E','F']

const norm     = v => String(v ?? '').trim()
const normCode = v => norm(v).replace(/\s+/g, '').toUpperCase()

async function saToken() {
  const t = await invoke('get_google_access_token_cmd')
  if (!t) throw new Error('Google auth unavailable — cannot write to the sheet')
  return t
}

// ── generic helpers ─────────────────────────────────────────────────────────

async function readRange(sheetId, range, useKey = true) {
  const url = `${BASE}/${sheetId}/values/${encodeURIComponent(range)}`
    + (useKey ? `?key=${API_KEY}` : '')
  const headers = useKey ? {} : { Authorization: `Bearer ${await saToken()}` }
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Read failed (${res.status}) on ${range}`)
  return (await res.json()).values || []
}

async function writeRange(sheetId, range, values) {
  const url = `${BASE}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await saToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  })
  if (!res.ok) throw new Error(`Write failed (${res.status}) on ${range}: ${await res.text()}`)
}

async function appendRows(sheetId, tab, values) {
  const url = `${BASE}/${sheetId}/values/${encodeURIComponent(tab + '!A:A')}`
    + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await saToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  })
  if (!res.ok) throw new Error(`Append failed (${res.status}) on ${tab}: ${await res.text()}`)
}

/** Create a tab if it is missing, then make sure row 1 is the header. */
async function ensureTab(sheetId, tab, header) {
  const meta = await fetch(`${BASE}/${sheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${await saToken()}` } })
  if (!meta.ok) throw new Error(`Could not list tabs (${meta.status})`)
  const titles = ((await meta.json()).sheets || []).map(s => s.properties.title)

  if (!titles.includes(tab)) {
    const res = await fetch(`${BASE}/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await saToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    })
    if (!res.ok) throw new Error(`Could not create ${tab} (${res.status})`)
    await writeRange(sheetId, `${tab}!A1`, [header])
    return
  }
  const first = await readRange(sheetId, `${tab}!A1:Z1`, false)
  if (!first.length || !first[0].length) await writeRange(sheetId, `${tab}!A1`, [header])
}

// ── users ───────────────────────────────────────────────────────────────────

/**
 * Every roster row, each carrying its 1-based SHEET ROW NUMBER so a later write
 * can address the right cell. rowNumber is data row + 2 (row 1 is the header).
 */
export async function loadUsers() {
  let lastErr = null
  for (const tab of PEOPLE_TAB_NAMES) {
    try {
      const rows = await readRange(PEOPLE_SHEET_ID, `${tab}!A1:F2000`)
      if (rows.length < 2) { lastErr = new Error('tab empty'); continue }
      const out = []
      rows.slice(1).forEach((r, i) => {
        if (!(r || []).some(c => norm(c))) return
        out.push({
          rowNumber: i + 2,
          tab,
          code:   norm(r[PCOL.code]),
          name:   norm(r[PCOL.name]),
          role:   norm(r[PCOL.role]),
          email:  norm(r[PCOL.mail]),
          status: norm(r[PCOL.status]),
        })
      })
      return out
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('Supervisor tab not found')
}

/**
 * Write one cell for one user, after confirming the row still holds them.
 * Returns the old value so the caller can log it.
 */
async function updateUserCell(user, colIndex, value) {
  const tab = user.tab || ROLE_TAB
  // Re-read THIS row and check the HR-code before touching anything.
  const check = await readRange(PEOPLE_SHEET_ID, `${tab}!A${user.rowNumber}:F${user.rowNumber}`)
  const row = check[0] || []
  if (normCode(row[PCOL.code]) !== normCode(user.code)) {
    throw new Error(
      `Row ${user.rowNumber} now holds "${norm(row[PCOL.code]) || '(empty)'}" `
      + `but ${user.code} was expected. The sheet changed since it was loaded — `
      + `nothing was written. Reload the user list and try again.`)
  }
  const oldValue = norm(row[colIndex])
  const cell = `${tab}!${COL_LETTER[colIndex]}${user.rowNumber}`
  await writeRange(PEOPLE_SHEET_ID, cell, [[value]])
  return oldValue
}

export async function setUserRole(user, newRole, changedBy) {
  const oldRole = await updateUserCell(user, PCOL.role, newRole)
  await logRoleChange({ changedBy, code: user.code, name: user.name,
    field: 'role', oldValue: oldRole, newValue: newRole })
  return oldRole
}

export async function setUserStatus(user, newStatus, changedBy) {
  const oldStatus = await updateUserCell(user, PCOL.status, newStatus)
  await logRoleChange({ changedBy, code: user.code, name: user.name,
    field: 'status', oldValue: oldStatus || '(blank)', newValue: newStatus })
  return oldStatus
}

/**
 * Append a user. Column E (password) is deliberately left EMPTY: this page does
 * not set passwords, and writing a placeholder would create a working
 * credential. The person signs in only once a password is set deliberately.
 */
export async function addUser({ name, email, code, role }, changedBy) {
  const existing = await loadUsers()
  if (existing.some(u => normCode(u.code) === normCode(code))) {
    throw new Error(`HR-code ${code} already exists in the roster.`)
  }
  if (email && existing.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error(`${email} already exists in the roster.`)
  }
  await appendRows(PEOPLE_SHEET_ID, ROLE_TAB,
    [[norm(code), norm(name), norm(role), norm(email), '', 'active']])
  await logRoleChange({ changedBy, code, name, field: 'added',
    oldValue: '', newValue: role })
}

export const LOG_HEADER = [
  'timestamp_iso', 'changed_by', 'user_hr_code', 'user_name',
  'field', 'old_value', 'new_value',
]

async function logRoleChange({ changedBy, code, name, field, oldValue, newValue }) {
  try {
    await ensureTab(PEOPLE_SHEET_ID, LOG_TAB, LOG_HEADER)
    await appendRows(PEOPLE_SHEET_ID, LOG_TAB, [[
      new Date().toISOString(), norm(changedBy), norm(code), norm(name),
      field, norm(oldValue), norm(newValue),
    ]])
  } catch (e) {
    // The change itself already succeeded. Losing the audit line is bad, but
    // throwing here would tell the manager the change failed when it did not.
    console.error('[MARK admin] role change applied but NOT logged:', e)
  }
}

// ── quizzes ─────────────────────────────────────────────────────────────────

export const QUIZ_LOG_HEADER = [
  'timestamp_iso', 'changed_by', 'quiz_id', 'quiz_name',
  'field', 'old_value', 'new_value',
]

/** Quiz rows with their sheet row numbers, for the same addressing reason. */
export async function loadQuizzes() {
  const sheetId = await getDrillSheetId()
  if (!sheetId) throw new Error('DRILL sheet is not configured')
  const rows = await readRange(sheetId, 'quizzes!A1:Z2000', false)
  if (rows.length < 2) return { sheetId, header: rows[0] || [], quizzes: [] }
  const header = rows[0]
  const idx = Object.fromEntries(header.map((h, i) => [norm(h), i]))
  const quizzes = rows.slice(1)
    .map((r, i) => ({ rowNumber: i + 2, raw: r,
      quiz_id: norm(r[idx.quiz_id]), quiz_name: norm(r[idx.quiz_name]),
      status: norm(r[idx.status]),
      scope_event_ids: norm(r[idx.scope_event_ids]),
      clip_count: norm(r[idx.clip_count]),
      pass_mark_percent: norm(r[idx.pass_mark_percent]),
      time_limit_min: norm(r[idx.time_limit_min]) }))
    .filter(q => q.quiz_id)
  return { sheetId, header, idx, quizzes }
}

function colLetter(i) {
  // quizzes has more than 26 columns in principle; handle AA..AZ
  return i < 26 ? String.fromCharCode(65 + i)
    : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26))
}

/**
 * Change one setting on one quiz.
 *
 * Only pass_mark_percent and time_limit_min are writable here, by name — so a
 * bug in column indexing cannot reach the answer key, the clip list or the
 * quiz's status.
 */
export async function setQuizSetting({ quiz, field, value, changedBy }) {
  if (!['pass_mark_percent', 'time_limit_min'].includes(field)) {
    throw new Error(`${field} is not editable from the admin page`)
  }
  const { sheetId, idx } = await loadQuizzes()
  const colIdx = idx[field]
  if (colIdx == null) throw new Error(`Column ${field} not found on the quizzes tab`)

  // verify the row still holds this quiz before writing
  const check = await readRange(sheetId, `quizzes!A${quiz.rowNumber}:Z${quiz.rowNumber}`, false)
  const row = check[0] || []
  if (norm(row[idx.quiz_id]) !== norm(quiz.quiz_id)) {
    throw new Error(`Row ${quiz.rowNumber} no longer holds ${quiz.quiz_id}. `
      + 'The sheet changed since it was loaded — nothing was written.')
  }
  const oldValue = norm(row[colIdx])
  await writeRange(sheetId, `quizzes!${colLetter(colIdx)}${quiz.rowNumber}`, [[String(value)]])

  try {
    await ensureTab(sheetId, QUIZ_LOG, QUIZ_LOG_HEADER)
    await appendRows(sheetId, QUIZ_LOG, [[
      new Date().toISOString(), norm(changedBy), quiz.quiz_id, quiz.quiz_name,
      field, oldValue, String(value),
    ]])
  } catch (e) {
    console.error('[MARK admin] quiz change applied but NOT logged:', e)
  }
  return oldValue
}
