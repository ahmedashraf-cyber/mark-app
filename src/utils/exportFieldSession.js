/**
 * exportFieldSession.js
 * ============================================================================
 * Exports collected Field-mode events as a deterministic UTF-8 CSV.
 *
 * FORMAT DECISIONS (see plan):
 *   • Wide format — one row per event, one column per extra slot (sparse, diffable)
 *   • schema_version column on every row (machine-detectable format changes)
 *   • Session metadata repeated on every row (survives naive CSV parsing)
 *   • Rows sorted ascending by video_time_ms
 *   • Two exports of identical data are byte-identical
 *   • No error columns, no Scout/Audit fields
 *   • Extras stored as stable codes (taxonomy labels), not display text
 *   • Stable column order — never reordered between versions
 *
 * COLLECTION TIME (item 4):
 *   • Wall-clock elapsed, not video time — named *_wall_* throughout
 *   • Start anchor = wall clock of first event captured in session
 *   • End anchor   = wall clock when Done is pressed (explicit user action)
 *   • Accumulated across close/reopen via session.accumulatedMs
 *   • Labeled _raw_ to signal no idle-gap exclusion
 *   • incomplete flag = 1 when half_end event was never tagged
 */
import { CURRENT_VERSION } from '../hooks/useUpdateCheck'

// ── Column definitions — stable, ordered ──────────────────────────────────────
// Changing this list is a schema version bump.
const COLUMNS = [
  'schema_version',
  // Event identity
  'event_id',
  'event_label',
  // Timing — both formats, clearly named
  'video_time_ms',
  'video_time_readable',
  // Context
  'team',
  'half',
  // Extras — up to 5 slots (sparse: empty string when not used)
  'extra_1',
  'extra_2',
  'extra_3',
  'extra_4',
  'extra_5',
  // Wall-clock capture time of this specific event
  'wall_clock_captured_iso',
  // Session metadata (repeated on every row)
  'video_filename',
  'video_duration_sec',
  'collector_email',
  'export_timestamp_iso',
  'mark_version',
  // Collection timing (item 4)
  'collection_start_wall_iso',
  'collection_end_wall_iso',
  'collection_elapsed_raw_ms',
  'collection_events_per_min',
  'collection_incomplete',
]

const SCHEMA_VERSION = '1'

function msToReadable(ms) {
  if (!ms && ms !== 0) return ''
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  const millis = Math.floor(ms % 1000)
  return `${min}:${String(sec).padStart(2,'0')}.${String(millis).padStart(3,'0')}`
}

function isoOrEmpty(ms) {
  if (!ms) return ''
  try { return new Date(ms).toISOString() } catch { return '' }
}

function csvCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  // Quote if contains comma, newline, or double-quote
  if (s.includes(',') || s.includes('\n') || s.includes('"')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function csvRow(values) {
  return values.map(csvCell).join(',')
}

/**
 * buildFieldCsv(session, events)
 *
 * session fields used:
 *   videoPath, videoName, videoDurationSec, half,
 *   collectorEmail,
 *   collectionStartWallMs, collectionEndWallMs, accumulatedMs
 *
 * events fields used:
 *   id, eventId, eventLabel, videoTimeSec, team, extras[], timestamp
 */
export function buildFieldCsv(session, events) {
  const exportTs = new Date().toISOString()
  const videoFilename = session.videoName || (session.videoPath || '').split(/[\\/]/).pop() || ''
  const videoDurSec   = session.videoDurationSec || ''
  const half          = session.half || ''
  const collEmail     = session.collectorEmail || ''

  // ── Collection timing ──────────────────────────────────────────────────────
  // Total elapsed = accumulatedMs from previous sittings
  //                 + (collectionEndWallMs - collectionStartWallMs) for final sitting
  const accMs      = session.accumulatedMs || 0
  const startMs    = session.collectionStartWallMs || null
  const endMs      = session.collectionEndWallMs   || null
  const sessionMs  = (startMs && endMs && endMs > startMs) ? (endMs - startMs) : 0
  const totalElapsedMs = accMs + sessionMs

  const startIso   = isoOrEmpty(startMs)
  const endIso     = isoOrEmpty(endMs)

  // events_per_min: total events / total elapsed minutes
  const elapsedMins = totalElapsedMs > 0 ? totalElapsedMs / 60000 : 0
  const evPerMin    = elapsedMins > 0 ? (events.length / elapsedMins).toFixed(2) : ''

  // incomplete = 1 if no half_end event was tagged
  const hasHalfEnd = events.some(e => e.eventId === 'half_end')
  const incomplete = hasHalfEnd ? '0' : '1'

  // ── Sort rows by video_time_ms ascending (deterministic) ───────────────────
  const sorted = [...events].sort((a, b) =>
    ((a.videoTimeSec || 0) * 1000) - ((b.videoTimeSec || 0) * 1000)
  )

  // ── Build rows ─────────────────────────────────────────────────────────────
  const rows = sorted.map(ev => {
    const videoMs  = Math.round((ev.videoTimeSec || 0) * 1000)
    const extras   = ev.extras || []

    return {
      schema_version:              SCHEMA_VERSION,
      event_id:                    ev.eventId   || '',
      event_label:                 ev.eventLabel || '',
      video_time_ms:               videoMs,
      video_time_readable:         msToReadable(videoMs),
      team:                        ev.team || '',
      half,
      extra_1:                     extras[0] || '',
      extra_2:                     extras[1] || '',
      extra_3:                     extras[2] || '',
      extra_4:                     extras[3] || '',
      extra_5:                     extras[4] || '',
      wall_clock_captured_iso:     isoOrEmpty(ev.timestamp),
      video_filename:              videoFilename,
      video_duration_sec:          videoDurSec,
      collector_email:             collEmail,
      export_timestamp_iso:        exportTs,
      mark_version:                CURRENT_VERSION,
      collection_start_wall_iso:   startIso,
      collection_end_wall_iso:     endIso,
      collection_elapsed_raw_ms:   totalElapsedMs || '',
      collection_events_per_min:   evPerMin,
      collection_incomplete:       incomplete,
    }
  })

  // ── Assemble CSV ───────────────────────────────────────────────────────────
  const header = csvRow(COLUMNS)
  const dataRows = rows.map(r => csvRow(COLUMNS.map(col => r[col])))
  return [header, ...dataRows].join('\r\n') + '\r\n'
}

/**
 * downloadFieldCsv(session, events)
 * Triggers a browser download of the CSV file.
 * Returns the filename used.
 */
export function downloadFieldCsv(session, events) {
  const csv = buildFieldCsv(session, events)
  const videoBase = (session.videoName || 'field_session')
    .replace(/\.[^.]+$/, '')           // strip extension
    .replace(/[/\\?%*:|"<>]/g, '-')    // safe filename
  const ts = new Date().toISOString().slice(0,16).replace(/[T:]/g, '-')
  const filename = `${videoBase}_${ts}.csv`

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
  return filename
}
