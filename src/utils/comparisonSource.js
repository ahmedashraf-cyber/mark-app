/**
 * comparisonSource.js — the ONLY data source for comparisons
 * ============================================================================
 * Both the model answer and the collector session are read from the Google
 * Sheet: field_sessions for the session, field_events for its events. Same tab,
 * same column names, same format on both sides.
 *
 * This replaced a hybrid that read Firestore first and fell back to the Sheet,
 * for the model AND the collector. The two stores disagree on format —
 * Firestore is camelCase with half "1", the Sheet snake_case with half "1H" —
 * which forced a double half query and a groups→attr_* flattener between them,
 * and caused the recurring "No collector session found". With one source there
 * is nothing to translate.
 *
 * Firestore is not consulted here at all, by design. Stale Sheet data is the
 * accepted trade: if FIELD has saved to Firestore but not yet synced, wait for
 * the sync before comparing.
 *
 * Each tab is read ONCE per comparison and cached for that run, so a lookup and
 * its events never come from two different snapshots of the sheet.
 */
import { invoke } from '@tauri-apps/api/core'
import { FIELD_SHEET_ID, FIELD_TAB_SESSIONS, FIELD_TAB_EVENTS } from '../config/fieldConfig'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const norm = v => String(v ?? '').trim()

/**
 * "1H", "1", "1h", " 1 " → "1". Older rows may hold either form, and an exact
 * string match would trade the old cross-source bug for a new within-source one.
 */
export const normHalf = v => norm(v).toUpperCase().replace(/H$/, '').replace(/\s+/g, '')
const normCode = v => norm(v).replace(/\s+/g, '').toUpperCase()

/** Only '1' is a model answer. Blank, '0' or anything malformed is a collector. */
const isModelRow = r => norm(r.is_model) === '1'

async function token() {
  const t = await invoke('get_google_access_token_cmd')
  if (!t) throw new Error('Google auth unavailable')
  return t
}

async function readTab(tab) {
  const res = await fetch(
    `${BASE}/${FIELD_SHEET_ID}/values/${encodeURIComponent(tab + '!A:ZZ')}`,
    { headers: { Authorization: `Bearer ${await token()}` } })
  if (!res.ok) throw new Error(`Could not read ${tab} (${res.status})`)
  const rows = (await res.json()).values || []
  if (rows.length < 2) return []
  const header = rows[0].map(norm)
  return rows.slice(1)
    .map(r => Object.fromEntries(header.map((h, i) => [h, norm(r[i])])))
    .filter(o => o.session_id)
}

/** A per-run cache, so every lookup in one comparison sees one snapshot. */
export function createSource() {
  let sessions = null, events = null
  const getSessions = async () => (sessions ||= await readTab(FIELD_TAB_SESSIONS))
  const getEvents   = async () => (events   ||= await readTab(FIELD_TAB_EVENTS))

  return {
    /**
     * Find a session by match, half and — for a collector — HR-code.
     * Returns the newest match, or null.
     */
    async findSession({ matchId, half, hrCode, isModel }) {
      const all = await getSessions()
      const mid = norm(matchId), h = normHalf(half)
      const hits = all.filter(s =>
        norm(s.match_id) === mid &&
        normHalf(s.half) === h &&
        isModelRow(s) === !!isModel &&
        (isModel || normCode(s.collector_hr_code) === normCode(hrCode)))
      // newest first, so a re-collected half uses the latest attempt
      hits.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      return hits[0] || null
    },

    /**
     * Direct lookup by session_id — the escape hatch.
     *
     * Deliberately ignores is_model, match_id and half, so a mislabelled row is
     * still reachable. Whatever went wrong in the field-based lookup, a pasted
     * session_id works.
     */
    async findById(sessionId) {
      const all = await getSessions()
      return all.find(s => norm(s.session_id) === norm(sessionId)) || null
    },

    /** Events for one session, in time order. Already flat attr_* columns. */
    async loadEvents(sessionId) {
      const all = await getEvents()
      return all
        .filter(e => norm(e.session_id) === norm(sessionId))
        .sort((a, b) => (Number(a.video_time_ms) || 0) - (Number(b.video_time_ms) || 0))
    },

    /** For diagnostics when a lookup finds nothing. */
    async candidatesFor({ matchId, half }) {
      const all = await getSessions()
      return all
        .filter(s => norm(s.match_id) === norm(matchId))
        .map(s => ({ session_id: s.session_id, half: s.half,
          is_model: s.is_model || '(blank)', collector_hr_code: s.collector_hr_code,
          halfMatches: normHalf(s.half) === normHalf(half) }))
    },
  }
}
