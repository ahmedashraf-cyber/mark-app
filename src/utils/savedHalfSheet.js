/**
 * savedHalfSheet.js: the Google Sheet side of reopening a saved half in Tag.
 * ============================================================================
 *   isHalfCompared(sessionId)   THE LOCK. One named rule: a half is compared when the scores tab has at least one row whose
 *                               collector_session_id equals this session_id. ANY run counts, a stale one too, so editing
 *                               the match id afterwards cannot unlock a half. Matched by session_id, never by match + HR.
 *   findSavedHalves(...)        this collector's saved sessions of one half (match_id + half + HR-code)
 *   saveEditedHalf(...)         replaces a saved half in ONE atomic spreadsheets.batchUpdate
 *
 * Why one batch: Sheets applies every request in a batchUpdate or none of them. The old event rows are deleted, the new
 * ones appended, the session row updated in place and the session_edits log row appended, all together. If anything fails
 * the sheet is exactly as it was. (The older syncSessionToSheet deletes first and appends after, in separate requests.)
 *
 * Tab ids always come from the spreadsheet BY NAME (tabIdsByName), never from a number in the code.
 *
 * CLIENT-SIDE ONLY. The lock and the fingerprint stop the honest mistake and the race with a reviewer. A modified copy of
 * the app could skip them.
 */
import { getToken, tabIdsByName, buildEventRows, toSheetHalf } from './fieldSheetSync'
import { FIELD_SHEET_ID, FIELD_TAB_SESSIONS, FIELD_TAB_EVENTS, SESSION_COLUMNS } from '../config/fieldConfig'
import { TAB_SCORES, SCORES_COLUMNS } from '../config/comparisonConfig'
import { EDIT_LOG_TAB, EDIT_LOG_HEADER } from './sessionEdit'
import { sameHr } from './drillAccess'     // the HR-code rule: trim, no inner spaces, dash variants to '-', upper-case
import { assertWritable } from './writeGuard'
import { MSG } from '../config/savedHalfConfig'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const norm = v => String(v ?? '').trim()
const letter = i => { let s = '', n = i + 1; while (n) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) } return s }

/** An expected, explainable failure. `kind` lets the screen say the right thing and decide whether Retry makes sense. */
export class SavedHalfError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.name = 'SavedHalfError'; this.kind = kind; Object.assign(this, extra) }
}
// kinds: 'compared' | 'unreadable' | 'changed' | 'missing' | 'duplicate_rows' | 'empty' | 'tabs' | 'write' | 'unsure'

async function call(token, path, init = {}, what = 'Request') {
  let res
  try { res = await fetch(`${BASE}/${FIELD_SHEET_ID}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } }) }
  catch (e) { throw Object.assign(new Error(`${what}: no answer from Google (${e?.message || e})`), { network: true }) }
  if (!res.ok) { const t = await res.text().catch(() => ''); throw Object.assign(new Error(`${what} failed (${res.status}): ${t.slice(0, 200)}`), { status: res.status }) }
  return res.json()
}
const values = async (token, range, what) => (await call(token, `/values/${encodeURIComponent(range)}`, {}, what)).values || []

// ── THE LOCK ────────────────────────────────────────────────────────────────────────────────────────────────────
const SCORE_ID_COL  = letter(SCORES_COLUMNS.indexOf('collector_session_id'))   // 'I'
const SCORE_RUN_COL = letter(SCORES_COLUMNS.indexOf('run_timestamp_iso'))      // 'B'

/** Pure: is this session in the set of sessions that have a score run? (the rule itself, with no reading) */
export const isComparedIn = (runs, sessionId) => !!norm(sessionId) && runs.has(norm(sessionId))

/**
 * Reads the scores tab FRESH: only the collector_session_id column (and, when the caller wants the date, the run time).
 * Never cached. Throws a SavedHalfError('unreadable') with the real reason when it cannot be read or is not laid out as
 * expected: the lock fails CLOSED.
 * → Map(session_id → time of its newest run, '' if unknown)
 */
export async function readScoreRuns({ withDates = false, token } = {}) {
  const tok = token || await getToken()
  const ranges = [`${TAB_SCORES}!${SCORE_ID_COL}:${SCORE_ID_COL}`, ...(withDates ? [`${TAB_SCORES}!${SCORE_RUN_COL}:${SCORE_RUN_COL}`] : [])]
  let out
  try { out = await call(tok, `/values:batchGet?${ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&')}`, {}, 'Reading the scores tab') }
  catch (e) { throw new SavedHalfError('unreadable', `Could not check whether this half has been compared: ${e.message}`, { cause: e }) }
  const ids = out.valueRanges?.[0]?.values || [], dates = withDates ? (out.valueRanges?.[1]?.values || []) : []
  if (norm(ids[0]?.[0]) !== 'collector_session_id')
    throw new SavedHalfError('unreadable', `Could not check whether this half has been compared: column ${SCORE_ID_COL} of the scores tab is "${norm(ids[0]?.[0]) || '(empty)'}", not collector_session_id.`)
  const runs = new Map()
  ids.forEach((r, i) => {
    if (i === 0) return
    const id = norm(r?.[0]); if (!id) return
    const at = norm(dates[i]?.[0])
    if (!runs.has(id) || (at && at > runs.get(id))) runs.set(id, at)
  })
  return runs
}

/** → { compared, comparedAtIso }. Fresh read. Throws SavedHalfError('unreadable') if the answer cannot be known. */
export async function readComparedInfo(sessionId, opts = {}) {
  const runs = await readScoreRuns({ withDates: true, ...opts })
  return { compared: isComparedIn(runs, sessionId), comparedAtIso: runs.get(norm(sessionId)) || '' }
}
/** THE RULE. true when at least one score run exists for this session (any run, stale or not). Fresh read, fails closed. */
export const isHalfCompared = async sessionId => (await readComparedInfo(sessionId)).compared

// ── Finding the half ────────────────────────────────────────────────────────────────────────────────────────────
async function readSessionsTab(token) {
  const rows = await values(token, `${FIELD_TAB_SESSIONS}!A:ZZ`, `Reading ${FIELD_TAB_SESSIONS}`)
  const header = (rows[0] || []).map(norm)
  const o = rows.slice(1).map((r, i) => ({ ...Object.fromEntries(header.map((h, k) => [h, norm(r?.[k])])), _row: i + 2 }))
  return { header, objs: o.filter(x => x.session_id) }
}

/**
 * This collector's saved sessions of one half. Match: match_id + half (1H 2H ET1 ET2 PEN, not Part: older rows have no part
 * column) + the HR-code, compared with the shared normaliser. Never a typed code. Model answers are not offered. A session
 * stored twice (the old Retry defect) is listed once, with duplicateRows > 1 so the screen can say so.
 * → [{ sessionId, rowNumbers, duplicateRows, exportDate, method, part, videoName, ... }] newest first
 */
export async function findSavedHalves({ matchId, half, hrCode, token }) {
  const tok = token || await getToken()
  const id = norm(matchId), h = toSheetHalf(half)
  if (!id || !h || !norm(hrCode)) return []
  const { objs } = await readSessionsTab(tok)
  const by = new Map()
  objs.filter(o => norm(o.match_id) === id && toSheetHalf(o.half) === h && sameHr(o.collector_hr_code, hrCode) && o.is_model !== '1')
    .forEach(o => { const k = o.session_id; if (!by.has(k)) by.set(k, []); by.get(k).push(o) })
  return [...by.values()].map(list => {
    const o = list[0]
    return {
      sessionId: o.session_id, rowNumbers: list.map(x => x._row), duplicateRows: list.length,
      exportDate: o.export_date, method: o.collection_method, part: o.part, videoName: o.video_filename,
      videoDurationMs: Number(o.video_duration_ms) || null, videoSizeBytes: Number(o.video_size_bytes) || null,
      matchId: o.match_id, half: toSheetHalf(o.half), hrCode: o.collector_hr_code, email: o.collector_email,
      homeTeam: o.home_team_name, awayTeam: o.away_team_name,
      startIso: o.collection_start_wall_iso, endIso: o.collection_end_wall_iso,
      elapsedMs: Number(o.collection_elapsed_raw_ms) || 0, eventsPerMin: o.collection_events_per_min,
      incomplete: o.collection_incomplete === 'TRUE' || o.collection_incomplete === 'true' || o.collection_incomplete === '1',
    }
  }).sort((a, b) => String(b.endIso || b.exportDate).localeCompare(String(a.endIso || a.exportDate)))
}

/** Column A of field_events, once: → Map(session_id → number of event rows), plus each id's row numbers. */
export async function readEventRows(token) {
  const col = await values(token, `${FIELD_TAB_EVENTS}!A:A`, `Reading ${FIELD_TAB_EVENTS}`)
  const counts = new Map(), rowsOf = new Map()
  col.forEach((r, i) => { if (i === 0) return; const id = norm(r?.[0]); if (!id) return; counts.set(id, (counts.get(id) || 0) + 1); if (!rowsOf.has(id)) rowsOf.set(id, []); rowsOf.get(id).push(i + 1) })
  return { counts, rowsOf }
}

/** What the start screen shows beside each saved session, best effort: a failed read just leaves that value out. */
export async function describeSavedHalves(halves, { token } = {}) {
  const tok = token || await getToken()
  const out = { counts: null, runs: null, countsError: '', runsError: '' }
  try { out.counts = (await readEventRows(tok)).counts } catch (e) { out.countsError = e.message }
  try { out.runs = await readScoreRuns({ withDates: true, token: tok }) } catch (e) { out.runsError = e.message }
  return out
}

/**
 * The fingerprint of a saved half: what a second window or another person changes when they save. Taken when the half is
 * opened and compared again right before saving (the two-windows rule).
 */
export async function readFingerprint(sessionId, token) {
  const tok = token || await getToken()
  const { objs } = await readSessionsTab(tok)
  const mine = objs.filter(o => o.session_id === norm(sessionId))
  const { counts, rowsOf } = await readEventRows(tok)
  return {
    sessionRows: mine.map(o => o._row),
    endIso: mine[0]?.collection_end_wall_iso ?? '', elapsedMs: mine[0]?.collection_elapsed_raw_ms ?? '',
    eventRows: counts.get(norm(sessionId)) || 0, eventRowNumbers: rowsOf.get(norm(sessionId)) || [],
  }
}
export const fingerprintKey = f => `${f.endIso}|${f.elapsedMs}|${f.eventRows}`

// ── Saving ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Session-row cells an edit may change. Everything else on the row (start time, video, match, half, HR-code, ...) stays. */
export const EDIT_UPDATES_COLUMNS = ['collection_end_wall_iso', 'collection_elapsed_raw_ms', 'collection_events_per_min', 'collection_incomplete', 'home_team_name', 'away_team_name']

const toCell = v => v === '' || v == null ? {} : typeof v === 'number' ? { userEnteredValue: { numberValue: v } }
  : typeof v === 'boolean' ? { userEnteredValue: { boolValue: v } } : { userEnteredValue: { stringValue: String(v) } }

/** Consecutive 1-based row numbers merged into [first, last] ranges, LAST range first (deleting bottom-up keeps indexes valid). */
export function rangesBottomUp(rowNumbers) {
  const rows = [...new Set(rowNumbers)].sort((a, b) => a - b), out = []
  rows.forEach(n => { const last = out[out.length - 1]; if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]) })
  return out.reverse()
}

async function logHasToken(token, saveToken) {
  if (!saveToken) return false
  const col = letter(EDIT_LOG_HEADER.indexOf('note'))
  let rows = []
  try { rows = await values(token, `${EDIT_LOG_TAB}!${col}:${col}`, `Reading ${EDIT_LOG_TAB}`) } catch { return false }   // no tab yet = no earlier save
  return rows.some(r => norm(r?.[0]).includes(`save=${saveToken}`))
}

async function ensureEditLogTab(token) {
  const meta = await call(token, '?fields=sheets.properties(sheetId,title)', {}, 'Reading the tab list')
  if ((meta.sheets || []).some(s => s.properties?.title === EDIT_LOG_TAB)) return
  await call(token, ':batchUpdate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: EDIT_LOG_TAB } } }] }) }, `Creating the ${EDIT_LOG_TAB} tab`)
  await call(token, `/values/${encodeURIComponent(EDIT_LOG_TAB + '!A1')}?valueInputOption=RAW`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [EDIT_LOG_HEADER] }) }, `Writing the ${EDIT_LOG_TAB} header`)
}

/**
 * Replace a saved half. `session` is the finished session object (as FieldPage builds it at Done), `events` the edited list,
 * `opened` = { fingerprint } taken when the half was opened, `saveToken` stays the same across Retry of one edit.
 *
 * Order of checks (each refuses with a SavedHalfError and writes nothing):
 *   0 an earlier attempt of this same save already applied (the token is in the log)  -> returns { alreadySaved: true }
 *   1 the scores tab, read fresh: compared -> 'compared'; unreadable -> 'unreadable' (fail closed)
 *   2 the tab ids by NAME ('tabs' if one is missing)
 *   3 the session row and its fingerprint: not exactly one row -> 'missing' / 'duplicate_rows'; changed -> 'changed'
 *   4 one atomic batchUpdate
 */
export async function saveEditedHalf({ session, events, opened, editorEmail, saveToken }) {
  assertWritable('saving the half')
  const sessionId = norm(session?.sessionId)
  if (!sessionId) throw new SavedHalfError('missing', 'This session has no id, so it cannot be saved over a saved half.')
  const tok = await getToken()

  if (await logHasToken(tok, saveToken)) return { alreadySaved: true, rowsWritten: 0 }

  let info
  try { info = await readComparedInfo(sessionId, { token: tok }) } catch (e) { throw e instanceof SavedHalfError ? e : new SavedHalfError('unreadable', `Could not check whether this half has been compared: ${e.message}`) }
  if (info.compared) throw new SavedHalfError('compared', MSG.COMPARED_WHILE_EDITING, { comparedAtIso: info.comparedAtIso })

  const eventRows = buildEventRows(events)
  if (!eventRows.length) throw new SavedHalfError('empty', 'A saved half cannot be saved with no events. Go back to leave it as it is.')

  await ensureEditLogTab(tok).catch(e => { throw new SavedHalfError('tabs', `Could not prepare the ${EDIT_LOG_TAB} tab: ${e.message}. Nothing was changed.`) })
  let ids
  try { ids = await tabIdsByName(tok, [FIELD_TAB_SESSIONS, FIELD_TAB_EVENTS, EDIT_LOG_TAB]) } catch (e) { throw new SavedHalfError('tabs', e.message) }

  const cur = await readFingerprint(sessionId, tok)
  if (cur.sessionRows.length === 0) throw new SavedHalfError('missing', 'This half is no longer in the sheet, so nothing was saved.')
  if (cur.sessionRows.length > 1) throw new SavedHalfError('duplicate_rows', `This half is stored ${cur.sessionRows.length} times in the sheet (rows ${cur.sessionRows.join(', ')}), so it cannot be saved safely. Ask a Batch Manager. Nothing was changed.`)
  if (fingerprintKey(cur) !== fingerprintKey(opened?.fingerprint || {}))
    throw new SavedHalfError('changed', 'This half was saved by someone else, or from another window, since you opened it. Your changes were not saved. Close it and open the saved half again.')

  // The cells an edit changes, worked out HERE and not by buildSessionRow. buildSessionRow computes the elapsed time as
  // accumulatedMs + (last event wall time - first event wall time); for a half reopened days after it was collected that
  // wall-clock gap would be added in. The rule for an edit is the one specified: the NEW active time is ADDED to the OLD one.
  // FieldPage passes accumulatedMs = (the old stored value) + (this sitting's active time), so it is used as it is.
  const elapsed = Math.max(0, Number(session.accumulatedMs) || 0)
  const built = {
    collection_end_wall_iso:   session.collectionEndWallMs ? new Date(session.collectionEndWallMs).toISOString() : '',
    collection_elapsed_raw_ms: elapsed ? String(elapsed) : '',
    collection_events_per_min: elapsed > 0 ? (eventRows.length / (elapsed / 60000)).toFixed(2) : '',
    collection_incomplete:     session.collectionIncomplete ? '1' : '0',
    home_team_name:            norm(session.homeTeamName),
    away_team_name:            norm(session.awayTeamName),
  }
  const logRow = [new Date().toISOString(), norm(editorEmail), sessionId, norm(session.collectorHrCode), 'events',
    cur.eventRows, eventRows.length, 0, 'APPLIED', `edited by collector; save=${saveToken || ''}`]
  const requests = [
    ...rangesBottomUp(cur.eventRowNumbers).map(([a, b]) => ({ deleteDimension: { range: { sheetId: ids[FIELD_TAB_EVENTS], dimension: 'ROWS', startIndex: a - 1, endIndex: b } } })),
    { appendCells: { sheetId: ids[FIELD_TAB_EVENTS], rows: eventRows.map(r => ({ values: r.map(toCell) })), fields: 'userEnteredValue' } },
    ...EDIT_UPDATES_COLUMNS.map(c => ({ updateCells: { start: { sheetId: ids[FIELD_TAB_SESSIONS], rowIndex: cur.sessionRows[0] - 1, columnIndex: SESSION_COLUMNS.indexOf(c) },
      rows: [{ values: [toCell(built[c])] }], fields: 'userEnteredValue' } })),
    { appendCells: { sheetId: ids[EDIT_LOG_TAB], rows: [{ values: logRow.map(toCell) }], fields: 'userEnteredValue' } },
  ]
  try { await call(tok, ':batchUpdate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) }, 'Saving the half') }
  catch (e) {
    if (e.network) throw new SavedHalfError('unsure', 'MARK could not confirm whether the save reached the sheet (the connection dropped). Press Retry: if it was saved, MARK will recognise that and will not save it twice.')
    throw new SavedHalfError('write', `${e.message}. Nothing was changed in the sheet; your edited version is kept. You can retry.`)
  }
  // What the screen remembers as "the version I opened" must be what the sheet really holds now, so read it back (best
  // effort: if that read fails the computed values are used and the result says it was not verified).
  let fingerprint = { endIso: norm(built.collection_end_wall_iso), elapsedMs: norm(built.collection_elapsed_raw_ms), eventRows: eventRows.length }
  let verified = false
  try {
    const after = await readFingerprint(sessionId, tok)
    fingerprint = { endIso: after.endIso, elapsedMs: after.elapsedMs, eventRows: after.eventRows }
    verified = after.eventRows === eventRows.length && after.sessionRows.length === 1
  } catch { /* the save itself succeeded; only the read-back failed */ }
  return { alreadySaved: false, rowsWritten: eventRows.length, oldCount: cur.eventRows, newCount: eventRows.length, fingerprint, verified }
}
