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
 *
 * There is deliberately NO playability probe. Every clip in the folder is
 * included. The probe it replaced rejected sound mp4s whenever a request was
 * slow, and silently dropping a good clip from an answer key is worse than
 * letting a bad one through — a bad one is obvious the moment it is opened.
 */
import { invoke } from '@tauri-apps/api/core'
import { SUPPORTED_VIDEO_EXT } from '../config/drillConfig'

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
  }))
  return { folderId, clips }
}

/** Local proxy URL a <video> can play. */
export async function clipUrl(driveFileId) {
  return invoke('drill_clip_url', { fileId: driveFileId })
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
