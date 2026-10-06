/**
 * modelAnswers.js — load and save model answers for the Tag Editor
 * ============================================================================
 * Reads and writes ONLY rows with is_model = '1'. A collector session can never
 * be opened or altered through here — that guard is in loadModelList and
 * repeated in saveModelAnswer, because a single check in the UI is not enough.
 *
 * ── Versioning, and what it does NOT do ───────────────────────────────────
 * field_events has no version column, so there is exactly one set of events per
 * session_id. A save therefore DELETES this session's event rows and appends the
 * edited set: version 1's events are gone.
 *
 * This was raised and chosen deliberately. The consequence to remember:
 * model_version on the session row still increments, so the number tells you an
 * edit happened — but it cannot take you back, and any comparison run recorded
 * against version 1 no longer matches the events now in the sheet. The
 * model_changes log is the only record of what the previous answer contained,
 * which is why it stores old and new values per change rather than just a count.
 */
import { invoke } from '@tauri-apps/api/core'
import {
  FIELD_SHEET_ID, SESSION_COLUMNS, EVENT_COLUMNS,
  FIELD_TAB_SESSIONS, FIELD_TAB_EVENTS, EVENT_BY_CODE,
} from '../config/fieldConfig'
import { msToReadable } from './fieldSheetSync'
import { OPEN_STATE_PAIRS } from './fieldExtras'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
export const CHANGES_TAB = 'model_changes'
export const CHANGES_HEADER = [
  'timestamp_iso', 'changed_by', 'match_id', 'half', 'session_id',
  'old_version', 'new_version', 'change_type', 'event_seq',
  'field', 'old_value', 'new_value',
]

const norm = v => String(v ?? '').trim()

async function token() {
  const t = await invoke('get_google_access_token_cmd')
  if (!t) throw new Error('Google auth unavailable')
  return t
}

async function readTab(tab, range = 'A:ZZ') {
  const res = await fetch(`${BASE}/${FIELD_SHEET_ID}/values/${encodeURIComponent(tab + '!' + range)}`,
    { headers: { Authorization: `Bearer ${await token()}` } })
  if (!res.ok) throw new Error(`Could not read ${tab} (${res.status})`)
  return (await res.json()).values || []
}

function toObjects(rows) {
  if (rows.length < 2) return { header: rows[0] || [], items: [] }
  const header = rows[0].map(norm)
  const items = rows.slice(1).map((r, i) => {
    const o = { __row: i + 2 }
    header.forEach((h, j) => { o[h] = norm(r[j]) })
    return o
  }).filter(o => Object.keys(o).some(k => k !== '__row' && o[k]))
  return { header, items }
}

/** Model answers only, newest first. */
export async function loadModelList() {
  const { items } = toObjects(await readTab(FIELD_TAB_SESSIONS))
  return items
    // is_model is the ONLY thing that makes a row editable here
    .filter(s => s.is_model === '1')
    .map(s => ({
      sessionId: s.session_id,
      matchId: s.match_id,
      matchName: s.match_name || '',
      half: s.half || '',
      homeTeam: s.home_team_name || '',
      awayTeam: s.away_team_name || '',
      modelVersion: s.model_version || '1',
      modelStatus: s.model_status || '',
      eventCount: s.event_count || '',
      createdAt: s.created_at || '',
      row: s.__row,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

/** The events of one model answer, ordered by time. */
export async function loadModelEvents(sessionId) {
  const { items } = toObjects(await readTab(FIELD_TAB_EVENTS))
  return items
    .filter(e => e.session_id === sessionId)
    .sort((a, b) => (Number(a.video_time_ms) || 0) - (Number(b.video_time_ms) || 0))
}

/**
 * Recompute every column that is DERIVED from another, for the whole list.
 *
 * Writing event_code without its event_id and event_label, or video_time_ms
 * without video_time_readable, leaves the row internally inconsistent — a
 * reader taking the label would describe the old event type. So derivation is
 * done here, over the whole list, rather than in the form: three of these
 * depend on OTHER events, which a single row cannot see.
 *
 * Derived from event_code:
 *   event_id      numericId from EVENT_REGISTRY
 *   event_label   label from the same entry
 *
 * Derived from video_time_ms:
 *   video_time_readable      msToReadable, the same function FIELD uses
 *   time_from_half_start_ms  needs the half_start event — cross-row
 *   duration_ms              needs the paired open event — cross-row
 *
 * Fixed for this editor:
 *   team_source   always 'manual'; the Batch Manager chooses the team by hand
 *
 * Deliberately NOT touched: inferred_type and type_source, which record what
 * FIELD inferred at collection time. Recomputing them here would invent an
 * inference that never happened.
 */
export function deriveEventFields(events) {
  // half_start anchors time_from_half_start_ms for every other event
  const halfStart = events.find(e => e.event_code === 'half_start')
  const halfStartMs = halfStart ? (Number(halfStart.video_time_ms) || 0) : null

  // open events by pair_id, so a close event can measure its duration
  const openByPair = {}
  const closeIds = new Set(OPEN_STATE_PAIRS.map(p => p.closeId))
  events.forEach(e => {
    if (e.pair_id && !closeIds.has(e.event_code)) {
      const t = Number(e.video_time_ms)
      if (Number.isFinite(t)) openByPair[e.pair_id] = t
    }
  })

  return events.map((e, i) => {
    const reg = EVENT_BY_CODE[e.event_code] || {}
    const videoMs = Number(e.video_time_ms) || 0
    const out = { ...e }

    out.event_seq            = String(i + 1)
    out.event_id             = String(reg.numericId ?? '')
    out.event_label          = reg.label ?? ''
    out.video_time_readable  = msToReadable(videoMs)
    // The Batch Manager picked the team by hand, so it is always manual.
    out.team_source          = 'manual'

    // half_start is its own zero; anything before it has no meaningful offset
    if (e.event_code === 'half_start') {
      out.time_from_half_start_ms = '0'
    } else if (halfStartMs !== null) {
      const d = videoMs - halfStartMs
      out.time_from_half_start_ms = d >= 0 ? String(d) : ''
    } else {
      out.time_from_half_start_ms = ''
    }

    // duration_ms belongs to the CLOSE event and is measured from its open
    // partner, so moving either timestamp changes it
    if (e.pair_id && closeIds.has(e.event_code) && openByPair[e.pair_id] != null) {
      const d = videoMs - openByPair[e.pair_id]
      out.duration_ms = d >= 0 ? String(d) : ''
    } else if (closeIds.has(e.event_code)) {
      out.duration_ms = ''
    }

    return out
  })
}

// ── saving ──────────────────────────────────────────────────────────────────

async function appendRows(tab, values) {
  const url = `${BASE}/${FIELD_SHEET_ID}/values/${encodeURIComponent(tab + '!A:A')}`
    + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  })
  if (!res.ok) throw new Error(`Append to ${tab} failed (${res.status}): ${await res.text()}`)
}

async function writeCell(tab, cell, value) {
  const res = await fetch(`${BASE}/${FIELD_SHEET_ID}/values/${encodeURIComponent(tab + '!' + cell)}?valueInputOption=RAW`,
    { method: 'PUT',
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[String(value)]] }) })
  if (!res.ok) throw new Error(`Write ${cell} failed (${res.status})`)
}

/** Numeric sheet id of a tab, needed by deleteDimension. */
async function sheetIdOf(tab) {
  const res = await fetch(`${BASE}/${FIELD_SHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${await token()}` } })
  if (!res.ok) throw new Error(`Could not list tabs (${res.status})`)
  const found = ((await res.json()).sheets || [])
    .find(s => s.properties.title === tab)
  if (!found) throw new Error(`Tab ${tab} not found`)
  return found.properties.sheetId
}

/**
 * Delete this session's event rows.
 *
 * Indices are collected then applied in DESCENDING order: deleting a row shifts
 * every row below it, so ascending deletion would remove the wrong rows after
 * the first. Same approach as fieldSheetSync's existing deleteRowsBySessionId,
 * but resolving the numeric sheetId rather than assuming it.
 */
async function deleteEventRows(sessionId) {
  const rows = await readTab(FIELD_TAB_EVENTS, 'A:A')
  const idx = EVENT_COLUMNS.indexOf('session_id')
  const targets = []
  rows.forEach((r, i) => { if (i > 0 && norm(r[idx]) === sessionId) targets.push(i + 1) })
  if (!targets.length) return 0

  const gid = await sheetIdOf(FIELD_TAB_EVENTS)
  const requests = targets.slice().sort((a, b) => b - a).map(n => ({
    deleteDimension: { range: { sheetId: gid, dimension: 'ROWS',
      startIndex: n - 1, endIndex: n } },
  }))
  const res = await fetch(`${BASE}/${FIELD_SHEET_ID}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!res.ok) throw new Error(`Deleting old event rows failed (${res.status}): ${await res.text()}`)
  return targets.length
}

/**
 * Write the edited answer.
 *
 * Order matters and is deliberate: the change log is written FIRST, before any
 * destructive step. If the delete or append then fails, the log still records
 * what was intended and the old rows are intact — whereas logging last would
 * lose the record of a half-applied save.
 */
export async function saveModelAnswer({ model, events, changes, changedBy, onProgress }) {
  if (!model?.sessionId) throw new Error('No model answer selected')

  const oldVersion = Number(model.modelVersion) || 1
  const newVersion = oldVersion + 1
  const say = m => { try { onProgress && onProgress(m) } catch {} }

  // Re-verify this is still a model answer. A collector session must never be
  // reachable here, and the list could be stale.
  say('Checking the session…')
  const { items } = toObjects(await readTab(FIELD_TAB_SESSIONS))
  const live = items.find(s => s.session_id === model.sessionId)
  if (!live) throw new Error(`Session ${model.sessionId} no longer exists.`)
  if (live.is_model !== '1') {
    throw new Error(`${model.sessionId} is not a model answer (is_model = `
      + `"${live.is_model}"). Nothing was written.`)
  }

  say('Recording the change log…')
  await logChanges({ model, changes, changedBy, oldVersion, newVersion })

  say(`Removing version ${oldVersion} events…`)
  await deleteEventRows(model.sessionId)

  say(`Writing ${events.length} events…`)
  // Derive here, at the single point of write, so no path can persist a row
  // whose label or readable time disagrees with its code or timestamp.
  const derived = deriveEventFields(events)
  if (derived.length) {
    const rows = derived.map(e => EVENT_COLUMNS.map(c => norm(e[c])))
    // chunked: one request with a few thousand rows is refused
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      await appendRows(FIELD_TAB_EVENTS, rows.slice(i, i + CHUNK))
      say(`Writing events… ${Math.min(i + CHUNK, rows.length)}/${rows.length}`)
    }
  }

  say('Updating the version…')
  const vCol = SESSION_COLUMNS.indexOf('model_version')
  const cCol = SESSION_COLUMNS.indexOf('event_count')
  const colLetter = i => i < 26 ? String.fromCharCode(65 + i)
    : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26))
  await writeCell(FIELD_TAB_SESSIONS, `${colLetter(vCol)}${live.__row}`, newVersion)
  if (cCol >= 0) {
    await writeCell(FIELD_TAB_SESSIONS, `${colLetter(cCol)}${live.__row}`, events.length)
  }

  say('Saved')
  return { oldVersion, newVersion, eventCount: events.length }
}

async function ensureChangesTab() {
  const res = await fetch(`${BASE}/${FIELD_SHEET_ID}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${await token()}` } })
  if (!res.ok) throw new Error(`Could not list tabs (${res.status})`)
  const titles = ((await res.json()).sheets || []).map(s => s.properties.title)
  if (titles.includes(CHANGES_TAB)) return
  const mk = await fetch(`${BASE}/${FIELD_SHEET_ID}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CHANGES_TAB } } }] }),
  })
  if (!mk.ok) throw new Error(`Could not create ${CHANGES_TAB} (${mk.status})`)
  await appendRows(CHANGES_TAB, [CHANGES_HEADER])
}

async function logChanges({ model, changes, changedBy, oldVersion, newVersion }) {
  await ensureChangesTab()
  const now = new Date().toISOString()
  const rows = (changes || []).map(c => [
    now, norm(changedBy), model.matchId, model.half, model.sessionId,
    String(oldVersion), String(newVersion),
    c.type, String(c.eventSeq ?? ''),
    norm(c.field), norm(c.oldValue), norm(c.newValue),
  ])
  if (!rows.length) return
  await appendRows(CHANGES_TAB, rows)
}
