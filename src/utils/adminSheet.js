/**
 * adminSheet.js — writes for the Batch Manager admin page
 * ============================================================================
 * Two spreadsheets:
 *   · the Supervisor roster — user rows, roles, status, and the role_changes log
 *   · the DRILL sheet       — quiz pass mark / time limit, and quiz_changes
 *
 * All reads and writes go through the service account.
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
import { FIELD_SHEET_ID, FIELD_TAB_SESSIONS, FIELD_TAB_EVENTS } from '../config/fieldConfig'
import { TAB_SCORES } from '../config/comparisonConfig'
import { capabilities } from '../hooks/useAdmin'
import {
  validateSessionEdit, planSessionEdit, matchesQuery, buildEditLogRows, EDIT_LOG_TAB, EDIT_LOG_HEADER,
} from './sessionEdit'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

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

async function readRange(sheetId, range) {
  const url = `${BASE}/${sheetId}/values/${encodeURIComponent(range)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await saToken()}` } })
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
  const first = await readRange(sheetId, `${tab}!A1:Z1`)
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
  const rows = await readRange(sheetId, 'quizzes!A1:Z2000')
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
  const check = await readRange(sheetId, `quizzes!A${quiz.rowNumber}:Z${quiz.rowNumber}`)
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

// ── Role Access Manager ─────────────────────────────────────────────────────

export const ACCESS_TAB = 'role_access'

/**
 * The permission columns, in display order. The key is what capabilities()
 * returns; the label is what the matrix shows.
 *
 * `admin` is included so a Batch Manager can grant it to another role — but
 * capabilities() force-enables it for Batch Manager regardless, so the matrix
 * cannot be used to lock everyone out of the matrix itself.
 */
export const PERMISSIONS = [
  { key:'scout',            label:'Scout' },
  { key:'audit',            label:'Audit' },
  { key:'tag',              label:'Tag' },
  { key:'tagEditor',        label:'Tag Editor' },
  { key:'drillCreate',      label:'Drill — Trainer' },
  { key:'drillTake',        label:'Drill — Trainee' },
  { key:'comparison',       label:'Comparison' },
  { key:'modelAnswer',      label:'Model answer box' },
  { key:'quizManage',       label:'Quiz create/edit' },
  { key:'quizAssign',       label:'Quiz assign' },
  { key:'drillDashboards',  label:'Dashboards' },
  { key:'admin',            label:'Admin page' },
  { key:'hrCodeLogin',      label:'HR-code login' },
  // appended last, so every existing role_access column keeps its position
  { key:'insights',         label:'Insights' },
  { key:'selfReview',       label:'Self-Review' },
]

export const ACCESS_HEADER = ['role', ...PERMISSIONS.map(p => p.key)]

/** The saved matrix, or {} when the tab does not exist yet. */
export async function loadRoleAccess() {
  try {
    const rows = await readRange(PEOPLE_SHEET_ID, `${ACCESS_TAB}!A1:Z40`)
    if (rows.length < 2) return {}
    const header = rows[0].map(norm)
    const out = {}
    rows.slice(1).forEach(r => {
      const role = norm(r[0]); if (!role) return
      const perms = {}
      header.forEach((h, i) => {
        if (i === 0 || !h) return
        const v = norm(r[i])
        if (v !== '') perms[h] = (v === '1' || v.toLowerCase() === 'true')
      })
      out[role] = perms
    })
    return out
  } catch { return {} }
}

/**
 * Replace the whole matrix.
 *
 * Written as one block rather than cell by cell: the matrix is small, and a
 * partial write would leave some roles on the new rules and some on the old,
 * which is worse than failing outright.
 */
export async function saveRoleAccess(matrix, changedBy) {
  await ensureTab(PEOPLE_SHEET_ID, ACCESS_TAB, ACCESS_HEADER)
  const roles = Object.keys(matrix)
  const rows = roles.map(r =>
    [r, ...PERMISSIONS.map(p => matrix[r]?.[p.key] ? '1' : '0')])
  // header plus every role, in one PUT
  await writeRange(PEOPLE_SHEET_ID, `${ACCESS_TAB}!A1`, [ACCESS_HEADER, ...rows])
  try {
    await ensureTab(PEOPLE_SHEET_ID, LOG_TAB, LOG_HEADER)
    await appendRows(PEOPLE_SHEET_ID, LOG_TAB, [[
      new Date().toISOString(), norm(changedBy), '', '',
      'role_access', '', `${roles.length} roles updated`,
    ]])
  } catch (e) { console.error('[MARK admin] access saved but not logged:', e) }
}

// ── config: minimum version ─────────────────────────────────────────────────

export const CONFIG_TAB = 'config'
const CONFIG_HEADER = ['key', 'value']

export async function loadConfig() {
  try {
    const rows = await readRange(PEOPLE_SHEET_ID, `${CONFIG_TAB}!A1:B100`)
    const out = {}
    rows.slice(1).forEach(r => { const k = norm(r[0]); if (k) out[k] = norm(r[1]) })
    return out
  } catch { return {} }
}

/**
 * Set one config key.
 *
 * The minimum version locks people OUT, so a typo here is costly: the app's
 * gate fails open on an unparseable value, but a valid-looking version far in
 * the future would block everyone. The UI validates the shape before calling
 * this; this function records the old value so the log shows what it was.
 */
export async function setConfigValue(key, value, changedBy) {
  await ensureTab(PEOPLE_SHEET_ID, CONFIG_TAB, CONFIG_HEADER)
  const rows = await readRange(PEOPLE_SHEET_ID, `${CONFIG_TAB}!A1:B100`)
  let rowNum = null, oldValue = ''
  rows.forEach((r, i) => {
    if (i > 0 && norm(r[0]) === key) { rowNum = i + 1; oldValue = norm(r[1]) }
  })
  if (rowNum) await writeRange(PEOPLE_SHEET_ID, `${CONFIG_TAB}!B${rowNum}`, [[String(value)]])
  else await appendRows(PEOPLE_SHEET_ID, CONFIG_TAB, [[key, String(value)]])

  try {
    await ensureTab(PEOPLE_SHEET_ID, LOG_TAB, LOG_HEADER)
    await appendRows(PEOPLE_SHEET_ID, LOG_TAB, [[
      new Date().toISOString(), norm(changedBy), '', '', key, oldValue, String(value),
    ]])
  } catch (e) { console.error('[MARK admin] config saved but not logged:', e) }
  return oldValue
}

// ── Edit a Tag session (match id / half) ────────────────────────────────────
// Batch Manager only. Changes match_id and half (and the part that goes with the half) on ONE row of field_sessions.
//
// The order is deliberate:
//   1. re-read the row and check it is still the session, with the values the manager was shown
//   2. WRITE THE LOG FIRST, one row per changed field (who, when, old, new). If the log cannot be written the edit
//      does not happen: a change with no record of who made it is worse than no change.
//   3. apply all the cell changes in ONE request
//   4. if that fails, add a "NOT APPLIED" row to the log, so the log never claims a change that did not happen
//   5. best effort: mirror the change to the Firestore copy of the session
// It never touches the scores or comparison_detail tabs; it reports what is there instead.

async function batchWrite(sheetId, data) {
  const res = await fetch(`${BASE}/${sheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await saToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  })
  if (!res.ok) throw new Error(`Write failed (${res.status}): ${await res.text()}`)
}

async function readFieldSessions() {
  const values = await readRange(FIELD_SHEET_ID, `${FIELD_TAB_SESSIONS}!A:ZZ`)
  const header = (values[0] || []).map(norm)
  const idx = n => header.indexOf(n)
  for (const n of ['session_id', 'match_id', 'half']) {
    if (idx(n) < 0) throw new Error(`Column ${n} not found in ${FIELD_TAB_SESSIONS}`)
  }
  return { values, header, idx }
}

/** Sessions matching a search (match id, session id, HR code, email, video name). Newest first. */
export async function findFieldSessions(query, limit = 40) {
  const { values, header } = await readFieldSessions()
  const rows = values.slice(1).map((r, i) => {
    const o = { rowNumber: i + 2 }
    header.forEach((h, j) => { o[h] = norm(r[j]) })
    return o
  })
  return rows.filter(r => r.session_id && matchesQuery(r, query)).reverse().slice(0, limit)
}

/**
 * The rows in `scores` that mention this session, as the model or the collector session.
 * → { rows, checked }  checked=false means the tab could NOT be read, so "no rows" must not be claimed.
 * A tab that does not exist yet is a real "no rows".
 */
export async function findScoresRows(sessionId) {
  let values
  try { values = await readRange(FIELD_SHEET_ID, `${TAB_SCORES}!A:ZZ`) }
  catch (e) {
    if (/\(400\)/.test(e.message)) return { rows: [], checked: true }
    return { rows: [], checked: false, error: e.message }
  }
  const header = (values[0] || []).map(norm)
  const m = header.indexOf('model_session_id'), c = header.indexOf('collector_session_id')
  if (m < 0 && c < 0) return { rows: [], checked: false, error: 'scores has no session id columns' }
  const id = norm(sessionId)
  const rows = values.slice(1).filter(r => (m >= 0 && norm(r[m]) === id) || (c >= 0 && norm(r[c]) === id))
    .map(r => Object.fromEntries(header.map((h, j) => [h, norm(r[j])])))
  return { rows, checked: true }
}

/**
 * @param role       the signed-in user's role (re-checked here, not only by the page)
 * @param changedBy  their email, for the log
 * @param session    the row as shown: { rowNumber, session_id, match_id, half, collector_hr_code }
 * @returns { changes, scoresRows, scoresChecked, firestore }
 */
export async function editFieldSession({ role, changedBy, session, matchId, half }) {
  if (!capabilities(role).admin) throw new Error('Only a Batch Manager can edit a session.')
  const who = norm(changedBy)
  if (!who || who === 'unknown') throw new Error("Couldn't tell who you are signed in as, so nothing was changed.")
  const v = validateSessionEdit({ matchId, half })
  if (!v.ok) throw new Error(Object.values(v.errors).join('. '))

  // 1. the row, right now
  const { values, idx } = await readFieldSessions()
  const row = values[session.rowNumber - 1] || []
  if (norm(row[idx('session_id')]) !== norm(session.session_id)) {
    throw new Error(`The sheet changed since it was loaded: row ${session.rowNumber} is no longer this session. Nothing was changed. Search again.`)
  }
  const current = { match_id: norm(row[idx('match_id')]), half: norm(row[idx('half')]), part: idx('part') >= 0 ? norm(row[idx('part')]) : '' }
  if (current.match_id !== norm(session.match_id) || current.half !== norm(session.half)) {
    throw new Error('This session was changed by someone else since you opened it. Nothing was changed. Search again.')
  }
  let changes = planSessionEdit(current, { matchId, half })
  if (idx('part') < 0) changes = changes.filter(c => c.field !== 'part')   // an older sheet without the column
  if (!changes.length) throw new Error('Nothing to change: the session already has those values.')

  const scores = await findScoresRows(session.session_id)
  const at = new Date().toISOString()
  const scoresCount = scores.rows.length
  const note = scores.checked ? '' : `scores tab could not be checked: ${scores.error}`

  // 2. the log first
  await ensureTab(FIELD_SHEET_ID, EDIT_LOG_TAB, EDIT_LOG_HEADER)
  await appendRows(FIELD_SHEET_ID, EDIT_LOG_TAB,
    buildEditLogRows({ at, changedBy: who, session, changes, scoresCount, status: 'applied', note }))

  // 3. then the change, in one request
  try {
    await batchWrite(FIELD_SHEET_ID, changes.map(c => ({
      range: `${FIELD_TAB_SESSIONS}!${colLetter(idx(c.field))}${session.rowNumber}`, values: [[c.to]] })))
  } catch (e) {
    // 4. the log must not claim a change that did not happen
    try {
      await appendRows(FIELD_SHEET_ID, EDIT_LOG_TAB,
        buildEditLogRows({ at: new Date().toISOString(), changedBy: who, session, changes, scoresCount,
          status: 'NOT APPLIED', note: e.message }))
    } catch (e2) { console.error('[MARK admin] session edit failed AND the failure was not logged:', e2) }
    throw new Error(`The sheet could not be updated, so nothing was changed (${e.message}).`)
  }

  // 5. best effort: the Firestore copy of the session, so the two stores agree
  let firestore = 'updated'
  try {
    const { doc, updateDoc } = await import('firebase/firestore')
    const { db } = await import('../firebase/config')
    const patch = {}
    changes.forEach(c => { patch[c.field === 'match_id' ? 'matchId' : c.field] = c.field === 'part' ? Number(c.to) : c.to })
    await updateDoc(doc(db, 'mark_field_sessions', norm(session.session_id)), patch)
  } catch (e) {
    firestore = /not-found|No document/i.test(String(e?.code || e?.message)) ? 'no Firestore copy of this session' : `not updated (${e?.code || e?.message || e})`
  }
  return { changes, scoresRows: scores.rows, scoresChecked: scores.checked, firestore }
}

// ── The Sessions table's data (READ-ONLY) ───────────────────────────────────
// Read once when the tab opens (and again only on Reload); everything after that is in memory.
// Each source reports its own outcome, so one failed read never makes another look empty: a table
// that said "Not compared" for every session because the scores tab could not be read would be a lie.
//   field_sessions   required: if it cannot be read there is nothing to show, and the error is thrown
//   scores           optional: a missing tab is a real "nothing compared yet"; any other failure is reported
//   session_edits    optional: a missing tab is a real "never edited"; any other failure is reported
//   roster           optional: names and roles; if unreadable the table still works without them
const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, error: e?.message || String(e) }))
const tabMissing = r => !r.ok && /\(400\)/.test(r.error)

export async function loadSessionsDataset() {
  const [fs, sc, ed, ro] = await Promise.all([
    settle(readRange(FIELD_SHEET_ID, `${FIELD_TAB_SESSIONS}!A:ZZ`)),
    settle(readRange(FIELD_SHEET_ID, `${TAB_SCORES}!A:ZZ`)),
    settle(readRange(FIELD_SHEET_ID, `${EDIT_LOG_TAB}!A:ZZ`)),
    settle(loadUsers()),
  ])
  if (!fs.ok) throw new Error(`Could not read ${FIELD_TAB_SESSIONS}: ${fs.error}`)
  const header = (fs.v[0] || []).map(norm)
  for (const n of ['session_id', 'match_id', 'half']) {
    if (!header.includes(n)) throw new Error(`Column ${n} not found in ${FIELD_TAB_SESSIONS}`)
  }
  const optional = r => (r.ok ? { ok: true, values: r.v } : tabMissing(r) ? { ok: true, values: [] } : { ok: false, error: r.error })
  return {
    sessions: fs.v,
    scores: optional(sc),
    edits: optional(ed),
    roster: ro.ok ? { ok: true, list: ro.v } : { ok: false, error: ro.error },
    loadedAt: new Date().toISOString(),
  }
}

/**
 * How many events each session has: rows per session_id in field_events, reading column A only.
 * field_sessions has no event-count column, and this tab can be large, so it is loaded after the table
 * is already on screen. → Map(session_id → count)
 */
export async function loadEventCounts() {
  const values = await readRange(FIELD_SHEET_ID, `${FIELD_TAB_EVENTS}!A:A`)
  const counts = new Map()
  for (let i = 1; i < values.length; i++) {
    const id = norm(values[i]?.[0])
    if (id) counts.set(id, (counts.get(id) || 0) + 1)
  }
  return counts
}
