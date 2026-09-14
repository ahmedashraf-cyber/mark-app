/**
 * drillDrive.js — Drive folder scan, clip URLs, playability pre-flight
 * ============================================================================
 * DRILL only.
 *
 * Auth: the SERVICE ACCOUNT, not the signed-in user. MARK's user OAuth holds
 * only `drive.file`, which sees files the app itself created — it can never
 * read a trainer's folder. The service account holds full `drive` scope.
 * Consequence: the folder MUST be shared with
 *   mark-reporter@mark-app-498618.iam.gserviceaccount.com  (Viewer)
 * A trainee needs no Drive access at all; the service account fetches for them.
 *
 * Streaming: a <video> element cannot send an Authorization header, so it
 * cannot play a private Drive file directly. MARK's local axum server proxies
 * it instead (route /drive in main.rs) and attaches the token.
 */
import { invoke } from '@tauri-apps/api/core'
import { SUPPORTED_VIDEO_EXT, PLAYABILITY_TIMEOUT_MS } from '../config/drillConfig'

/**
 * Pull a folder ID out of whatever the trainer pasted.
 * Accepts a bare ID, /folders/<id>, or ?id=<id>.
 */
export function parseFolderId(input) {
  const s = String(input || '').trim()
  if (!s) return null
  const folders = s.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (folders) return folders[1]
  const idParam = s.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (idParam) return idParam[1]
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s   // looks like a bare ID
  return null
}

export function extensionOf(filename) {
  const m = String(filename || '').match(/\.([a-zA-Z0-9]+)$/)
  return m ? m[1].toLowerCase() : ''
}

/** Scan recursively. Returns clips sorted by filename so clip_index is stable. */
export async function scanFolder(folderInput) {
  const folderId = parseFolderId(folderInput)
  if (!folderId) throw new Error('That does not look like a Drive folder link or ID.')
  const res = await invoke('drill_scan_folder', { folderId })
  const clips = (res?.clips || []).map((c, i) => ({
    clip_index:      i,
    drive_file_id:   c.drive_file_id,
    video_filename:  c.video_filename,
    mime_type:       c.mime_type || '',
    size_bytes:      c.size_bytes ? Number(c.size_bytes) : null,
    duration_ms:     c.duration_ms ? Number(c.duration_ms) : null,
    extension:       extensionOf(c.video_filename),
    supported_ext:   SUPPORTED_VIDEO_EXT.includes(extensionOf(c.video_filename)),
    playable:        null,   // filled by checkPlayability
  }))
  return { folderId, clips }
}

/** Local proxy URL a <video> can play. */
export async function clipUrl(driveFileId) {
  return invoke('drill_clip_url', { fileId: driveFileId })
}

/**
 * Pre-flight playability. The extension alone is not enough: .mov and .mkv are
 * containers, so an h264 .mov plays while a ProRes .mov does not, and WebView2
 * fails silently. The only reliable test is asking the element to load it.
 *
 * Checked at scan time so a trainee never meets a dead clip mid-exam.
 */
export function checkPlayability(url) {
  return new Promise(resolve => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    let settled = false
    const done = (ok, reason) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      v.removeAttribute('src')
      v.load()
      resolve({ ok, reason })
    }
    const timer = setTimeout(() => done(false, 'timed out'), PLAYABILITY_TIMEOUT_MS)
    v.onloadedmetadata = () => {
      // duration 0 or NaN means the container opened but there is no usable track
      if (!isFinite(v.duration) || v.duration <= 0) return done(false, 'no playable track')
      done(true, '')
    }
    v.onerror = () => {
      const code = v.error?.code
      done(false, code === 4 ? 'codec not supported' : 'failed to load')
    }
    v.src = url
  })
}

/**
 * Run the pre-flight over every clip, sequentially — parallel loads thrash the
 * proxy and give false negatives. onProgress(done, total, clip).
 */
export async function checkAllPlayable(clips, onProgress) {
  const out = []
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]
    // One retry. A first-attempt timeout is usually the connection warming up,
    // not a bad file, and wrongly excluding a good clip is worse than a slower
    // scan.
    let result
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await checkPlayability(await clipUrl(c.drive_file_id))
      } catch (e) {
        result = { ok: false, reason: e.message || 'error' }
      }
      if (result.ok) break
      if (attempt === 0) onProgress?.(i + 1, clips.length, { ...c, retrying: true })
    }
    const checked = { ...c, playable: result.ok, unplayable_reason: result.reason }
    out.push(checked)
    onProgress?.(i + 1, clips.length, checked)
  }
  return out
}

export function totalSizeBytes(clips) {
  return clips.reduce((s, c) => s + (c.size_bytes || 0), 0)
}

export function formatBytes(n) {
  if (!n) return '—'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}
