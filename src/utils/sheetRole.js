/**
 * sheetRole.js — resolve a person's role from the Supervisor tab
 * ============================================================================
 * One read per login, cached for the session and persisted so the app still
 * works offline. Nothing re-reads the sheet on a screen transition.
 *
 * Sheet layout, verified live: A=Code B=Name C=Role D=Mail E=Password F=Status
 * 541 users at the time of writing.
 *
 * A role change by a Batch Manager takes effect on the user's NEXT login, not
 * immediately. That is intentional — the alternative is polling the sheet
 * constantly for a change that happens a few times a month.
 */
import { PEOPLE_SHEET_ID, PEOPLE_TAB_NAMES } from '../config/drillConfig'
import { COLLECTOR_ROLES, isCollector } from '../hooks/useAdmin'

const SHEETS_API_KEY = 'AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI'
const CACHE_KEY = 'mark_role_cache_v1'
const COL = { code: 0, name: 1, role: 2, mail: 3, pass: 4, status: 5 }

const norm  = v => String(v || '').trim()
const lower = v => norm(v).toLowerCase()
/** HR-codes are hand-typed in two places; compare them forgivingly. */
const normCode = v => norm(v).replace(/\s+/g, '').toUpperCase()

/** Column F. Anything that is not an explicit "inactive" counts as active. */
function isActive(statusCell) {
  const s = lower(statusCell)
  if (!s) return true     // blank = active, so 541 existing rows keep working
  return !['inactive', 'removed', 'disabled', 'no', 'false', '0'].includes(s)
}

// ── cache ───────────────────────────────────────────────────────────────────
function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') }
  catch { return {} }
}
function writeCache(key, entry) {
  try {
    const all = readCache()
    all[key] = { ...entry, cachedAt: Date.now() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(all))
  } catch { /* storage full or unavailable — not worth failing a login over */ }
}
export function cachedRole(key) {
  const hit = readCache()[String(key || '').toLowerCase()]
  return hit || null
}

/** Every row of the Supervisor tab. Throws if the sheet cannot be read. */
export async function fetchPeople() {
  let lastErr = null
  for (const tab of PEOPLE_TAB_NAMES) {
    const range = encodeURIComponent(`${tab}!A1:F2000`)
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${PEOPLE_SHEET_ID}`
      + `/values/${range}?key=${SHEETS_API_KEY}`
    try {
      const res = await fetch(url)
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue }
      const rows = (await res.json()).values || []
      if (rows.length < 2) { lastErr = new Error('tab empty'); continue }
      return rows.slice(1)
        .filter(r => (r || []).some(c => norm(c)))
        .map(r => ({
          code:   norm(r[COL.code]),
          name:   norm(r[COL.name]),
          role:   norm(r[COL.role]),
          email:  norm(r[COL.mail]),
          status: norm(r[COL.status]),
          active: isActive(r[COL.status]),
        }))
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('Supervisor tab not found')
}

/**
 * Resolve by email or HR-code.
 *
 * Returns { role, name, code, email, active, source, offline, reason }.
 * `source` is 'sheet' or 'cache'; `role` is null when access is denied.
 */
export async function resolveRole({ email, hrCode }) {
  const key = lower(email || hrCode)
  if (!key) return { role: null, reason: 'no identifier supplied' }

  let people = null
  try {
    people = await fetchPeople()
  } catch (e) {
    // ── OFFLINE FALLBACK ──────────────────────────────────────────────────
    // A collector must be able to work with no connection; that is the whole
    // point of the offline write queue. So:
    //   · a cached role is honoured, flagged offline
    //   · with no cache, an HR-code gets COLLECTOR access only — the least
    //     privilege that still allows the job
    //   · with no cache, an EMAIL is denied, because elevated access must
    //     never rest on an unverified identity
    // The asymmetry is deliberate: an unverified collector can only add data,
    // whereas an unverified manager could rewrite everyone's roles.
    const hit = cachedRole(key)
    if (hit) {
      return { ...hit, source: 'cache', offline: true,
        reason: 'Sheet unreachable — using your last known role' }
    }
    if (hrCode) {
      return {
        role: COLLECTOR_ROLES[0], name: '', code: normCode(hrCode), email: '',
        active: true, source: 'fallback', offline: true,
        reason: 'Sheet unreachable and no cached role — collector access only',
      }
    }
    return { role: null, source: 'fallback', offline: true,
      reason: 'Sheet unreachable and no cached role. Connect to the internet '
        + 'and sign in again.' }
  }

  const found = email
    ? people.find(p => lower(p.email) === lower(email))
    : people.find(p => normCode(p.code) === normCode(hrCode))

  if (!found) {
    return { role: null, source: 'sheet',
      reason: 'Your account is not registered. Contact your Batch Manager.' }
  }
  if (!found.active) {
    return { role: null, source: 'sheet', code: found.code, name: found.name,
      reason: 'Your access has been removed. Contact your Batch Manager.' }
  }
  // HR-code login is for collectors only; everyone else must use email
  if (hrCode && !isCollector(found.role)) {
    return { role: null, source: 'sheet', code: found.code, name: found.name,
      reason: 'Please sign in with your email and password.' }
  }

  const entry = {
    role: found.role, name: found.name, code: found.code,
    email: found.email, active: true,
  }
  writeCache(key, entry)
  // cache under both identifiers, so an email login still warms the HR-code
  // lookup and vice versa
  if (found.email) writeCache(lower(found.email), entry)
  if (found.code)  writeCache(lower(found.code), entry)
  return { ...entry, source: 'sheet', offline: false }
}
