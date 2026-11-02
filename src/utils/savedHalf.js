/**
 * savedHalf.js: the pure parts of reopening a saved half in Tag (no sheet, no Firestore, no screen).
 */
import { toSheetHalf } from './fieldSheetSync'

const norm = v => String(v ?? '').trim()
const PART_OF_HALF = { '1H': 1, '2H': 2, ET1: 3, ET2: 4, PEN: 5 }
export const PART_LABEL = { 1: '1st half', 2: '2nd half', 3: 'Extra time 1', 4: 'Extra time 2', 5: 'Penalties' }
const toMs = iso => { const t = Date.parse(norm(iso)); return Number.isFinite(t) ? t : null }

/**
 * The session object FieldPage works with, rebuilt from the saved sheet row (and Firestore's copy of the session).
 *   accumulatedMs  the half's stored ACTIVE TIME (the sheet's collection_elapsed_raw_ms): FieldPage adds this sitting's time
 *                  to it at save ("add the new active time to the old one")
 *   collectionStartWallMs  the ORIGINAL start, kept
 *   reopened       marks the session as a reopened one: it is never resumed by video path, and a failed save is retried
 *                  through the saved-half path (with the lock and the fingerprint), not the plain first-save path
 */
export function buildReopenedSession({ half, fsDoc = null, profile = {}, fingerprint, comparedAtIso = '', now = new Date() }) {
  return {
    sessionId: half.sessionId, videoPath: '', videoName: half.videoName || fsDoc?.videoName || '',
    mode: 'field', source: 'field',
    collectorId: fsDoc?.collectorId || profile.uid || '', collectorEmail: half.email || fsDoc?.collectorEmail || profile.email || '',
    collectorName: fsDoc?.collectorName || profile.displayName || '',
    status: 'in_progress', startedAt: now.toISOString(),
    totalEvents: 0, accumulatedMs: Number(half.elapsedMs) || 0,
    collectionStartWallMs: toMs(half.startIso) ?? fsDoc?.collectionStartWallMs ?? null,
    collectionEndWallMs: toMs(half.endIso),
    collectionMethod: norm(half.method) || fsDoc?.collectionMethod || null,
    part: Number(half.part) || PART_OF_HALF[toSheetHalf(half.half)] || null,
    matchId: norm(half.matchId), half: toSheetHalf(half.half), collectorHrCode: norm(half.hrCode),
    homeTeamName: norm(half.homeTeam), awayTeamName: norm(half.awayTeam),
    videoSizeBytes: half.videoSizeBytes || null, videoDurationMs: half.videoDurationMs || null,
    is_model: '0', collectionIncomplete: !!half.incomplete,
    reopened: { openedAtIso: now.toISOString(), fingerprint, comparedAtIso },
  }
}

const mmss = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const baseName = p => norm(p).split(/[\\/]/).pop().toLowerCase()

/**
 * A WARNING, never a block: is the loaded video a different file from the one this half was collected on?
 * → { differs, message }. Names are compared without folder or case; lengths within `toleranceMs` are the same video.
 */
export function videoMismatch({ savedName, savedDurationMs, loadedPath, loadedDurationMs, toleranceMs = 1000 }) {
  const loadedName = baseName(loadedPath)
  if (!loadedName) return { differs: false, message: '' }
  const nameDiffers = !!norm(savedName) && baseName(savedName) !== loadedName
  const durationDiffers = !!(savedDurationMs && loadedDurationMs) && Math.abs(savedDurationMs - loadedDurationMs) > toleranceMs
  if (!nameDiffers && !durationDiffers) return { differs: false, message: '' }
  const bits = []
  if (nameDiffers) bits.push(`name: saved "${norm(savedName)}", loaded "${norm(loadedPath).split(/[\\/]/).pop()}"`)
  if (durationDiffers) bits.push(`length: saved ${mmss(savedDurationMs)}, loaded ${mmss(loadedDurationMs)}`)
  return { differs: true, message: `This video file is not the one this half was collected on (${bits.join('; ')}). You can continue, but check it is the right match and half.` }
}

/** One line per saved session for the start-screen list. */
export function describeHalfLine({ half, firestoreCount = null, sheetCount = null, compared = null }) {
  const n = firestoreCount ?? sheetCount
  const events = n == null ? 'events: ?' : (sheetCount != null && firestoreCount != null && sheetCount !== firestoreCount) ? `${firestoreCount} events (the sheet has ${sheetCount})` : `${n} events`
  const when = norm(half.endIso || half.exportDate).slice(0, 16).replace('T', ' ')
  const state = compared === true ? 'compared' : compared === false ? 'not compared' : 'compared? could not check'
  return [when || 'saved (date unknown)', events, half.method === 'partial' ? 'not all events' : half.method === 'all' ? 'all events' : (half.method || 'method ?'), norm(half.videoName) || 'video ?', state].join(' · ')
}

/**
 * The one-off token of a save, written into the session_edits log row so a Retry can tell "my earlier attempt already
 * applied" from "this is a new save". It is derived from WHAT is being saved (the session, the version that was opened, and
 * the events themselves), not random: the same content gives the same token (so a Retry after a lost answer is recognised
 * and not saved twice), and any further edit gives a new one (so new work is never mistaken for the old save).
 */
export function makeSaveToken(sessionId, fingerprint, events) {
  const fp = fingerprint ? `${fingerprint.endIso}|${fingerprint.elapsedMs}|${fingerprint.eventRows}` : ''
  const body = JSON.stringify((events || []).map(e => { const o = {}; Object.keys(e).filter(k => !k.startsWith('_') && k !== 'createdAt').sort().forEach(k => { o[k] = e[k] }); return o })
    .sort((a, b) => String(a.id).localeCompare(String(b.id))))
  const s = `${sessionId}|${fp}|${body}`
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0 }
  return `${h1.toString(36)}${h2.toString(36)}`
}

/** JSON with every object's keys sorted, so the same content always gives the same text. */
const stable = v => Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  : JSON.stringify(v ?? null)

/**
 * A fingerprint of WHAT THE EVENTS ARE: the same hashing as makeSaveToken, but over the events only (no session, no opened
 * version), and ignoring everything that is local or server bookkeeping (_status, _docId, createdAt). Order does not matter.
 *
 * Used to tell, in view mode, whether the events on screen are the version that was last SAVED: the hash of the saved version is
 * stored on the half's session record (when it is first opened for editing, and again after each successful save), and view mode
 * compares the current events with it. A half that was never opened for editing has no baseline and cannot have unsaved edits.
 */
export function contentHash(events) {
  const body = (events || []).map(e => { const o = {}; Object.keys(e).filter(k => !k.startsWith('_') && k !== 'createdAt').forEach(k => { o[k] = e[k] }); return stable(o) }).sort().join('\n')
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < body.length; i++) { const c = body.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0 }
  return `c${(events || []).length}-${h1.toString(36)}${h2.toString(36)}`
}

/** true when the events on screen are NOT the saved version. false when they match, or when there is no baseline to judge by. */
export const hasUnsavedEdits = (baseline, events) => !!baseline && contentHash(events) !== baseline

export const UNSAVED_WARNING = 'This view includes edits that were never saved. The reviewer compared the saved version.'
