// Roster — resolves a numeric collector/reviewer id (Event.author / legacyId)
// to a real person: { legacyId, hrcode, name, email, role }.
//
// Three sources, by priority (highest first):
//   1. Live identities harvested this session from the collection app's own
//      GraphQL "EventHistory" op (passive link tap + active sweep in the bridge).
//   2. The persistent Firestore `roster` collection — the self-updating backbone.
//      Every audit writes its freshly-resolved people back here, and the admin
//      `users_finalized.csv` is imported here as the initial seed.
//   3. Raw `#<id>` fallback when nobody knows who it is.
//
// Firestore `roster` doc shape (keyed by String(legacyId)):
//   { legacyId, hrcode, fullName, email, role, source, updatedAt }

import { db } from '../firebase/config'
import { collection, getDocs, doc, writeBatch, serverTimestamp } from 'firebase/firestore'

// "Alaa Wagih (A-088)" — falls back gracefully to name, code, or #id.
export function formatPerson(entry, fallbackId) {
  if (!entry) return fallbackId != null && fallbackId !== '' ? `#${fallbackId}` : '—'
  const name = entry.name || entry.fullName || ''
  const code = entry.hrcode || entry.hrCode || ''
  if (name && code) return `${name} (${code})`
  if (name) return name
  if (code) return code
  return fallbackId != null && fallbackId !== '' ? `#${fallbackId}` : '—'
}

// Keep only the fields we actually have a value for, so a partial source never
// clobbers a richer one when merged.
function pick(r) {
  const o = {}
  if (r.legacyId != null) o.legacyId = Number(r.legacyId)
  if (r.hrcode || r.hrCode) o.hrcode = r.hrcode || r.hrCode
  if (r.name || r.fullName) o.name = r.name || r.fullName
  if (r.email) o.email = r.email
  if (r.role) o.role = r.role
  return o
}

// Build a { legacyId(string) -> entry } lookup, roster first, live on top.
export function buildIdentityMap(liveIdentities = [], roster = {}) {
  const map = {}
  Object.values(roster).forEach(r => {
    if (r && r.legacyId != null) map[String(r.legacyId)] = pick(r)
  })
  ;(liveIdentities || []).forEach(r => {
    if (r && r.legacyId != null) {
      const k = String(r.legacyId)
      map[k] = { ...(map[k] || {}), ...pick(r) }
    }
  })
  return map
}

// One read of the whole roster collection. Returns { legacyId(string): entry }.
export async function loadRoster() {
  try {
    const snap = await getDocs(collection(db, 'roster'))
    const out = {}
    snap.forEach(d => {
      const data = d.data()
      if (data && data.legacyId != null) out[String(data.legacyId)] = data
    })
    return out
  } catch (e) {
    console.warn('[MARK] loadRoster failed:', e)
    return {}
  }
}

// Persist freshly-resolved identities to the roster (merge, batched, source tagged).
export async function saveIdentities(identities = []) {
  const valid = (identities || []).filter(r => r && r.legacyId != null && (r.hrcode || r.name || r.email))
  if (!valid.length) return 0
  try {
    for (let i = 0; i < valid.length; i += 450) {
      const batch = writeBatch(db)
      valid.slice(i, i + 450).forEach(r => {
        const ref = doc(db, 'roster', String(r.legacyId))
        const payload = { legacyId: Number(r.legacyId), source: 'eventHistory', updatedAt: serverTimestamp() }
        if (r.hrcode) payload.hrcode = r.hrcode
        if (r.name) payload.fullName = r.name
        if (r.email) payload.email = r.email
        batch.set(ref, payload, { merge: true })
      })
      await batch.commit()
    }
    return valid.length
  } catch (e) {
    console.warn('[MARK] saveIdentities failed:', e)
    return 0
  }
}

// Admin: import users_finalized.csv (legacy_id,hr_code,full_name,email,job) into
// the roster as the seed backbone. Merge-only — never nulls out richer data that
// a live sweep already wrote.
export async function importRosterCsv(csvText) {
  const rows = parseCsv(csvText)
  if (!rows.length) return 0
  const header = rows[0].map(h => String(h).trim().toLowerCase())
  const col = (names) => { for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i } return -1 }
  const ci = {
    legacyId: col(['legacy_id', 'legacyid', 'legacy id', 'id']),
    hrcode:   col(['hr_code', 'hrcode', 'hr code', 'code']),
    name:     col(['full_name', 'fullname', 'full name', 'name']),
    email:    col(['email', 'e-mail']),
    job:      col(['job', 'role', 'title']),
  }
  if (ci.legacyId === -1) throw new Error('CSV missing a legacy_id column')

  const entries = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const legacyId = parseInt(String(r[ci.legacyId] || '').trim(), 10)
    if (!Number.isFinite(legacyId)) continue
    const cell = (idx) => (idx !== -1 ? String(r[idx] || '').trim() : '')
    entries.push({ legacyId, hrcode: cell(ci.hrcode), fullName: cell(ci.name), email: cell(ci.email), role: cell(ci.job) })
  }

  let written = 0
  for (let i = 0; i < entries.length; i += 450) {
    const batch = writeBatch(db)
    entries.slice(i, i + 450).forEach(e => {
      const ref = doc(db, 'roster', String(e.legacyId))
      const payload = { legacyId: e.legacyId, source: 'csv', updatedAt: serverTimestamp() }
      if (e.hrcode) payload.hrcode = e.hrcode
      if (e.fullName) payload.fullName = e.fullName
      if (e.email) payload.email = e.email
      if (e.role) payload.role = e.role
      batch.set(ref, payload, { merge: true })
    })
    await batch.commit()
    written += Math.min(450, entries.length - i)
  }
  return written
}

// Minimal RFC-4180-ish CSV parser (quoted fields, escaped quotes, CRLF).
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* ignore */ }
      else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.length && r.some(c => c !== ''))
}
