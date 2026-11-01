/**
 * myHalvesSheet.js — all Google Sheets reading for the read-only My halves screen.
 *
 * READS ONLY. There is no write, append or update in this file, and a test asserts it. Uses the same service-account
 * token as the rest of the app. This is enforced in the client (see the note in MyHalvesPage): the account can read
 * every tab, and the screen simply asks for, keeps and shows only what the person is allowed to see.
 *
 * Small tabs are read whole, once, when the page opens: field_sessions, scores, session_edits (and the roster for a
 * reviewer, columns A to D only, so the password column is never requested). The two big tabs, field_events and
 * comparison_detail, are read through sheetIndex.js: column A, then only the rows of the half being opened.
 */
import { invoke } from '@tauri-apps/api/core'
import { FIELD_SHEET_ID, FIELD_TAB_SESSIONS, FIELD_TAB_EVENTS } from '../config/fieldConfig'
import { TAB_SCORES, TAB_COMPARISON_DETAIL } from '../config/comparisonConfig'
import { PEOPLE_SHEET_ID, PEOPLE_TAB_NAMES } from '../config/drillConfig'
import { EDIT_LOG_TAB } from './sessionEdit'
import { buildIdIndex, fetchRowsById, rowsToObjects } from './sheetIndex'
import { scopeToCollector } from './myHalves'
import { sameHr } from './hrCode'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const enc = encodeURIComponent
const norm = v => String(v ?? '').trim()

async function getJson(url) {
  const token = await invoke('get_google_access_token_cmd')
  if (!token) throw new Error('Google auth required.')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Read failed (${res.status}): ${(await res.text()).slice(0, 160)}`)
  return res.json()
}
const readRange = async (sheetId, a1) => (await getJson(`${BASE}/${sheetId}/values/${enc(a1)}`)).values || []

/** The two calls sheetIndex.js needs, against the FIELD spreadsheet. There is no "read the whole tab" for the big ones. */
export const fieldIo = {
  readColumnA: tab => readRange(FIELD_SHEET_ID, `${tab}!A:A`),
  async batchGetRows(tab, segs) {
    const out = []
    for (let i = 0; i < segs.length; i += 40) {          // keep the URL short
      const part = segs.slice(i, i + 40)
      const url = `${BASE}/${FIELD_SHEET_ID}/values:batchGet?majorDimension=ROWS&` + part.map(([s, e]) => `ranges=${enc(`${tab}!A${s}:ZZ${e}`)}`).join('&')
      out.push(...((await getJson(url)).valueRanges || []).map(v => v.values || []))
    }
    return out
  },
}

const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, error: e?.message || String(e) }))
const tabMissing = r => !r.ok && /\(400\)/.test(r.error)     // a tab that does not exist yet is a real "nothing"
const optional = r => (r.ok ? { ok: true, values: r.v } : tabMissing(r) ? { ok: true, values: [] } : { ok: false, error: r.error })

/** Name, role and email by HR-code. Columns A to D only: the password column is never requested. */
async function loadRoster() {
  let last
  for (const tab of PEOPLE_TAB_NAMES) {
    try {
      const rows = await readRange(PEOPLE_SHEET_ID, `${tab}!A1:D2000`)
      if (rows.length < 2) { last = new Error('tab empty'); continue }
      return rows.slice(1).filter(r => (r || []).some(c => norm(c))).map(r => ({ code: norm(r[0]), name: norm(r[1]), role: norm(r[2]), email: norm(r[3]) }))
    } catch (e) { last = e }
  }
  throw last || new Error('Supervisor tab not found')
}

/**
 * PHASE 1: what the list needs, read once and in parallel: field_sessions, scores, session_edits (the edit log is what
 * tells a stale score from a current one, so the list is not shown without it) and, for a reviewer, the roster. These
 * are small tabs. `onProgress({ id, state: 'done' | 'error', error? })` is called as each one finishes.
 * It does NOT read field_events: the list appears first and the event counts follow (loadEventCounts).
 *
 * For a collector the result has ALREADY been cut down to their own halves, so no other collector's row is ever kept in
 * the screen's state.
 *   me: { hrCode, name, role, email }   canViewAny: may see any collector's halves
 */
export async function loadHalvesDataset({ me, canViewAny, onProgress = () => {} }) {
  const track = (id, p) => settle(p).then(r => { onProgress(r.ok ? { id, state: 'done' } : { id, state: 'error', error: r.error }); return r })
  const [fs, sc, ed, ro] = await Promise.all([
    track('sessions', readRange(FIELD_SHEET_ID, `${FIELD_TAB_SESSIONS}!A:ZZ`)),
    track('scores', readRange(FIELD_SHEET_ID, `${TAB_SCORES}!A:ZZ`)),
    track('edits', readRange(FIELD_SHEET_ID, `${EDIT_LOG_TAB}!A:ZZ`)),
    canViewAny ? track('roster', loadRoster()) : Promise.resolve({ ok: true, v: null }),
  ])
  if (!fs.ok) throw new Error(`Could not read ${FIELD_TAB_SESSIONS}: ${fs.error}`)
  const header = (fs.v[0] || []).map(norm)
  for (const n of ['session_id', 'match_id', 'half', 'collector_hr_code']) {
    if (!header.includes(n)) throw new Error(`Column ${n} not found in ${FIELD_TAB_SESSIONS}`)
  }
  let raw = {
    sessions: fs.v, scores: optional(sc), edits: optional(ed),
    roster: ro.v === null
      ? { ok: true, list: [{ code: me.hrCode, name: me.name, role: me.role, email: me.email }] }   // a collector never reads the roster
      : ro.ok ? { ok: true, list: ro.v } : { ok: false, error: ro.error },
  }
  if (!canViewAny) raw = scopeToCollector(raw, me.hrCode)     // before anything is stored
  return {
    raw, loadedAt: new Date().toISOString(),
    // kept for the whole session of the screen; a Reload makes a new dataset and so a new, empty cache. `events.index` is
    // filled by loadEventCounts, `detail.index` the first time a half with a run is opened, so each big tab's column A is
    // read once.
    cache: { events: { index: null }, detail: { index: null }, headers: {} },
  }
}

/**
 * PHASE 2: the number of events of each listed session, from column A of field_events (one read, and the index it builds
 * is kept in the cache for opening halves). Returns a Map(session_id → count). Throws if the tab cannot be read; the list
 * stays usable and says the counts failed.
 */
export async function loadEventCounts(ds) {
  const index = buildIdIndex(await fieldIo.readColumnA(FIELD_TAB_EVENTS))
  ds.cache.events.index = index
  const header = (ds.raw.sessions[0] || []).map(norm), si = header.indexOf('session_id')
  const counts = new Map()
  ds.raw.sessions.slice(1).forEach(r => { const id = norm(r?.[si]); if (id && !counts.has(id)) counts.set(id, (index.get(id) || []).reduce((n, [a, b]) => n + (b - a + 1), 0)) })
  return counts
}

// header only: a one-row read, not the whole tab
const readHeader = async (cache, tab) => (cache.headers[tab] ||= ((await readRange(FIELD_SHEET_ID, `${tab}!A1:ZZ1`))[0] || []).map(norm))

/**
 * One half's detail: its own events (always), and, if the newest run is current, that run's detail rows and the model
 * session's events. Refuses a half that is not the viewer's own unless they may see any collector's.
 */
export async function loadHalfDetail(row, { cache, me, canViewAny }) {
  if (!canViewAny && !sameHr(row.collector_hr_code, me.hrCode)) throw new Error('You can only open your own halves.')
  const evHeader = await readHeader(cache, FIELD_TAB_EVENTS)
  const own = await fetchRowsById(fieldIo, FIELD_TAB_EVENTS, row.session_id, cache.events)
  const out = { ownEvents: rowsToObjects(evHeader, own), detail: null, modelEvents: null, run: null, warning: '' }
  const run = row.state === 'compared' ? row.run : null
  if (!run) return out
  const dHeader = await readHeader(cache, TAB_COMPARISON_DETAIL)
  const det = rowsToObjects(dHeader, await fetchRowsById(fieldIo, TAB_COMPARISON_DETAIL, run.runId, cache.detail))
  const mine = det.filter(d => norm(d.collector_session_id) === norm(row.session_id))
  if (mine.length !== det.length) out.warning = 'Some stored rows for this run belong to another session and were ignored.'
  const model = await fetchRowsById(fieldIo, FIELD_TAB_EVENTS, run.modelSessionId, cache.events)
  return { ...out, run, detail: mine, modelEvents: rowsToObjects(evHeader, model) }
}
