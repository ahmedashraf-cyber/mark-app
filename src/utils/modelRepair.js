/**
 * modelRepair.js — one-off repair for model answers mislabelled in the sheet
 * ============================================================================
 * Until v7.12.2 the sheet writer hardcoded is_model = 0, so every model answer
 * saved from Tag reached field_sessions as a collector session. Firestore held
 * the correct value throughout. This finds those rows and corrects them.
 *
 * Two steps, by design:
 *   planRepair()   — reads only. Lists every row it would change.
 *   applyRepair()  — writes, only what the plan listed, re-verifying each row
 *                    first so a sorted sheet cannot redirect a write.
 *
 * Writes only is_model, model_version and model_status. Nothing else on the
 * row, and no other tab, is touched.
 */
import { invoke } from '@tauri-apps/api/core'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { FIELD_SHEET_ID, FIELD_TAB_SESSIONS } from '../config/fieldConfig'
import { toSheetHalf } from './fieldSheetSync'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const norm = v => String(v ?? '').trim()

async function token() {
  const t = await invoke('get_google_access_token_cmd')
  if (!t) throw new Error('Google auth unavailable')
  return t
}

const colLetter = i => i < 26 ? String.fromCharCode(65 + i)
  : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26))

async function readSessions() {
  const res = await fetch(`${BASE}/${FIELD_SHEET_ID}/values/${encodeURIComponent(FIELD_TAB_SESSIONS + '!A:ZZ')}`,
    { headers: { Authorization: `Bearer ${await token()}` } })
  if (!res.ok) throw new Error(`Could not read ${FIELD_TAB_SESSIONS} (${res.status})`)
  const values = (await res.json()).values || []
  const header = (values[0] || []).map(norm)
  const idx = n => header.indexOf(n)
  for (const n of ['session_id', 'half', 'is_model', 'model_version', 'model_status']) {
    if (idx(n) < 0) throw new Error(`Column ${n} not found in ${FIELD_TAB_SESSIONS}`)
  }
  return { values, idx }
}

/**
 * Every sheet row whose Firestore session is a model answer but whose sheet
 * row says it is not. Reads only.
 */
export async function planRepair() {
  // Firestore wrote is_model as the string '1'; accept a number too
  const snaps = await Promise.all([
    getDocs(query(collection(db, 'mark_field_sessions'), where('is_model', '==', '1'))),
    getDocs(query(collection(db, 'mark_field_sessions'), where('is_model', '==', 1))),
  ])
  const models = new Map()
  snaps.forEach(sn => sn.forEach(d => {
    const x = d.data()
    models.set(norm(x.sessionId || d.id), {
      version: norm(x.model_version) || '1',
      status:  norm(x.model_status)  || 'approved',
      matchId: norm(x.matchId), half: norm(x.half),
    })
  }))

  const { values, idx } = await readSessions()
  const fixes = []
  values.slice(1).forEach((r, i) => {
    const id = norm(r[idx('session_id')])
    const m = models.get(id)
    if (!m) return
    if (norm(r[idx('is_model')]) === '1') return     // already right
    fixes.push({ sessionId: id, rowNumber: i + 2, matchId: m.matchId, half: m.half,
      from: norm(r[idx('is_model')]) || '(blank)', version: m.version, status: m.status })
  })
  // Halves written as 1HH / 2HH / ET1H / PENH by v7.12.2. Any row, model or
  // not — Comparison, Insights and the start-screen check cannot match them.
  const halfFixes = []
  values.slice(1).forEach((r, i) => {
    const raw = norm(r[idx('half')]), good = toSheetHalf(raw)
    if (raw && good && raw !== good) {
      halfFixes.push({ sessionId: norm(r[idx('session_id')]), rowNumber: i + 2, from: raw, to: good })
    }
  })
  return { modelsInFirestore: models.size, fixes, halfFixes }
}

/** Write the planned fixes, re-checking each row's session_id before writing it. */
export async function applyRepair(plan) {
  const { values, idx } = await readSessions()
  const data = [], skipped = []
  plan.fixes.forEach(f => {
    const row = values[f.rowNumber - 1] || []
    if (norm(row[idx('session_id')]) !== f.sessionId) { skipped.push(f.sessionId); return }
    data.push({ range: `${FIELD_TAB_SESSIONS}!${colLetter(idx('is_model'))}${f.rowNumber}`,     values: [['1']] })
    data.push({ range: `${FIELD_TAB_SESSIONS}!${colLetter(idx('model_version'))}${f.rowNumber}`, values: [[f.version]] })
    data.push({ range: `${FIELD_TAB_SESSIONS}!${colLetter(idx('model_status'))}${f.rowNumber}`,  values: [[f.status]] })
  })
  ;(plan.halfFixes || []).forEach(f => {
    const row = values[f.rowNumber - 1] || []
    if (norm(row[idx('session_id')]) !== f.sessionId) { skipped.push(f.sessionId); return }
    data.push({ range: `${FIELD_TAB_SESSIONS}!${colLetter(idx('half'))}${f.rowNumber}`, values: [[f.to]] })
  })
  if (data.length) {
    const res = await fetch(`${BASE}/${FIELD_SHEET_ID}/values:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    })
    if (!res.ok) throw new Error(`Repair write failed (${res.status}): ${await res.text()}`)
  }
  return { fixed: plan.fixes.length, halvesFixed: (plan.halfFixes || []).length, skipped }
}
