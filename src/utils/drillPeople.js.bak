/**
 * drillPeople.js — who is who, read from the Supervisors tab
 * ============================================================================
 * DRILL only. Reads the SAME sheet HR-code login uses, so there is one source
 * of truth for people. Tab-name variants are tried in the same order as
 * LoginPage, because the live tab name has varied.
 *
 * Supervisors tab: A=HR code, B=Name, C=Role, D=Email, E=Password
 *
 * Passwords are present in the sheet but deliberately never read here — this
 * module only needs identity and role.
 */
import {
  PEOPLE_SHEET_ID, PEOPLE_TAB_NAMES, PEOPLE_COL,
  DRILL_CREATOR_ROLES, DRILL_TRAINEE_ROLE_SUBSTRING,
} from '../config/drillConfig'

const SHEETS_API_KEY = 'AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI'

let _cache = null          // { at, rows }
const CACHE_MS = 5 * 60 * 1000

/**
 * Every person in the Supervisors tab.
 * → [{ hrCode, name, role, email }]
 */
export async function loadPeople({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cache.at < CACHE_MS) return _cache.rows

  let rows = null
  let lastErr = null
  for (const tab of PEOPLE_TAB_NAMES) {
    try {
      const range = encodeURIComponent(`${tab}!A2:E`)
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${PEOPLE_SHEET_ID}/values/${range}?key=${SHEETS_API_KEY}`
      const res = await fetch(url)
      if (!res.ok) { lastErr = new Error(`${tab}: HTTP ${res.status}`); continue }
      const data = await res.json()
      const vals = data.values || []
      if (!vals.length) { lastErr = new Error(`${tab}: empty`); continue }
      rows = vals
        .map(r => ({
          hrCode: (r[PEOPLE_COL.hrCode] || '').replace(/\s+/g, '').trim().toUpperCase(),
          name:   (r[PEOPLE_COL.name]   || '').trim(),
          role:   (r[PEOPLE_COL.role]   || '').trim(),
          email:  (r[PEOPLE_COL.email]  || '').replace(/\s+/g, '').trim().toLowerCase(),
        }))
        .filter(p => p.hrCode)
      break
    } catch (e) { lastErr = e }
  }

  if (!rows) throw new Error('Could not read the people sheet: ' + (lastErr?.message || 'unknown'))
  _cache = { at: Date.now(), rows }
  return rows
}

/** Role for a signed-in user, matched on email. '' when not found. */
export async function roleForEmail(email) {
  if (!email) return ''
  const target = email.replace(/\s+/g, '').trim().toLowerCase()
  const people = await loadPeople()
  return people.find(p => p.email === target)?.role || ''
}

/** Role for an HR code. '' when not found. */
export async function roleForHrCode(hrCode) {
  if (!hrCode) return ''
  const target = String(hrCode).replace(/\s+/g, '').trim().toUpperCase()
  const people = await loadPeople()
  return people.find(p => p.hrCode === target)?.role || ''
}

/** Full record for a signed-in user — needed for trainee_hr_code on results. */
export async function personForEmail(email) {
  if (!email) return null
  const target = email.replace(/\s+/g, '').trim().toLowerCase()
  const people = await loadPeople()
  return people.find(p => p.email === target) || null
}

/** Trainees — assignable. Role CONTAINS 'Collector', any email domain. */
export async function loadTrainees() {
  const people = await loadPeople()
  const needle = DRILL_TRAINEE_ROLE_SUBSTRING.toLowerCase()
  return people
    .filter(p => p.role.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Creators — can build quizzes and approve retakes. Used for the dropdown. */
export async function loadCreators() {
  const people = await loadPeople()
  return people
    .filter(p => DRILL_CREATOR_ROLES.includes(p.role))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Resolve a pasted blob of HR codes against the trainee list.
 * Accepts commas, spaces, tabs, semicolons or newlines as separators.
 * → { matched: [{hrCode,name}], unknown: [code] }
 */
export async function resolveHrCodes(text) {
  const codes = String(text || '')
    .split(/[\s,;]+/)
    .map(c => c.replace(/\s+/g, '').trim().toUpperCase())
    .filter(Boolean)
  const trainees = await loadTrainees()
  const byCode = new Map(trainees.map(t => [t.hrCode, t]))
  const matched = [], unknown = [], seen = new Set()
  codes.forEach(c => {
    if (seen.has(c)) return
    seen.add(c)
    const hit = byCode.get(c)
    if (hit) matched.push(hit); else unknown.push(c)
  })
  return { matched, unknown }
}

export function clearPeopleCache() { _cache = null }
