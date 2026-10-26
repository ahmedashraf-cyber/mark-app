/**
 * driveExport.js — the reviewer-owned way to put an export on Google Drive
 * ============================================================================
 * Used by Session History, Scout Done and Audit. One implementation, so the three
 * cannot drift apart.
 *
 * WHY: mark-reporter used to create everything. Whoever CREATES a file owns it and is
 * charged for it (a My Drive folder's owner does not pay for what others put in it), which
 * filled mark-reporter's Drive. Now the REVIEWER's own OAuth token creates everything, so
 * the reviewer owns it and their storage is used.
 *
 * WHERE: the shared folder first. If Google refuses that PARENT (drive.file may only name
 * folders the app created), the app's own "MARK Reviews" folder in the reviewer's Drive is
 * used instead — created once, found again, never duplicated. Any other failure (storage
 * full, network, real permission refusal) is NOT retried elsewhere; it is shown as it is.
 *
 * SHARING: nothing is shared per file. The MARK Reviews folder is shared ONCE with
 * mark-reporter and the audience below; everything inside inherits it. Never "anyone with
 * the link".
 *
 * RETRY: every export keeps a `resume` record. Retry continues from it — same folder, only
 * the files that did not land, then the readability check again. It never starts over.
 */

import { SHEETS_API, USERINFO_API, getServiceToken, googleFetch } from '../services/google'

/** The shared master folder for Scout Done and Audit exports. */
export const MASTER_FOLDER_ID = '1TeuEJqnKiGrCmZZfpfOKFMzwa3KBxO0A'

/**
 * Who can open the exports that land in the reviewer's own MARK Reviews folder, besides
 * the reviewer and mark-reporter. Reader access, set ONCE on the folder.
 *   { type: 'domain', value: 'hudl.com' }          everyone at Hudl            (default)
 *   { type: 'group',  value: 'name@hudl.com' }     a Google Group              (narrower)
 *   { type: 'user',   value: 'person@hudl.com' }   one person
 *   { type: 'none',   value: '' }                  nobody else; the reviewer shares by hand
 */
export const EXPORT_AUDIENCE = { type: 'domain', value: 'hudl.com' }

const ROOT_KEY   = email => `mark_reviews_root_${email || 'unknown'}`
const SHARED_KEY = id => `mark_reviews_shared_${id}`

/** A failure with a message that is safe to show as it stands, and a kind to act on. */
export class DriveExportError extends Error {
  constructor(kind, message, extra = {}) {
    super(message)
    this.name = 'DriveExportError'
    this.kind = kind   // 'quota' | 'permission' | 'network' | 'other' | 'unreadable' | 'partial'
    Object.assign(this, extra)   // unreadable / partial carry { resume, sheetUrl, ... }
  }
}

/** Rust returns Drive failures as a JSON string; turn one into words that name the real cause. */
export function explainDriveError(raw) {
  if (raw && raw.name === 'DriveExportError') return raw
  const text = typeof raw === 'string' ? raw : (raw?.message || String(raw))
  let d = null
  try { const j = JSON.parse(text); if (j && typeof j === 'object' && j.kind) d = j } catch {}
  if (!d) return new DriveExportError('other', `The export failed: ${text}. Your review is safe in MARK.`)
  const short = String(d.reason || d.message || `HTTP ${d.status}`).replace(/\s+/g, ' ').slice(0, 140)
  if (d.kind === 'quota')
    return new DriveExportError('quota', `Google storage is full for ${d.account || 'your Google account'}, so the review couldn't be exported. Your review is safe in MARK — tell Fady.`)
  // 'parent' only reaches here if the fallback folder was refused too: a permission problem
  if (d.kind === 'permission' || d.kind === 'parent')
    return new DriveExportError('permission', `Google didn't allow this export (${short}). Tell Fady.`)
  if (d.kind === 'network')
    return new DriveExportError('network', `The export couldn't reach Google (${d.message || 'no connection'}). Your review is safe in MARK — check the connection and try again.`)
  return new DriveExportError('other', `The export failed: ${d.message || short}. Your review is safe in MARK.`)
}

/** A valid reviewer access token: silent refresh if we have signed in before, else the browser sign-in. */
export async function getReviewerToken(invoke) {
  let accessToken = ''
  const stored = localStorage.getItem('mark_g_refresh')
  if (stored) {
    try {
      const r = await invoke('google_oauth_refresh', { refreshToken: stored })
      accessToken = r.access_token || ''
    } catch (e) { /* refresh failed → fall through to interactive sign-in */ }
  }
  if (!accessToken) {
    const t = await invoke('google_oauth_sign_in')
    accessToken = t.access_token || ''
    if (t.refresh_token) localStorage.setItem('mark_g_refresh', t.refresh_token)
  }
  if (!accessToken) throw new DriveExportError('other', 'The export failed: Google did not return an access token. Your review is safe in MARK.')
  return accessToken
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
export const fileIdFromLink = link => (/\/d\/([a-zA-Z0-9_-]+)/.exec(link || '') || [])[1] || ''

/**
 * Can mark-reporter read the sheet? Reads A1:Z5 with the service account. A fresh share can
 * take a moment to take effect, so a non-200 is retried before it counts as a failure.
 */
export async function serviceAccountCanRead(fileId, { attempts = 3, delayMs = 1500, invoke: inv } = {}) {
  const invoke = inv || (await import('@tauri-apps/api/core')).invoke
  let status = 0, detail = ''
  for (let i = 0; i < attempts; i++) {
    try {
      const token = await getServiceToken(invoke)
      const r = await googleFetch(`${SHEETS_API}/${fileId}/values/A1:Z5`, { token })
      status = r.status
      if (r.status === 200) return { ok: true, status }
      detail = (await r.text().catch(() => '')).slice(0, 200)
    } catch (e) { status = 0; detail = e?.message || String(e) }
    if (i < attempts - 1) await sleep(delayMs)
  }
  return { ok: false, status, detail }
}

export const UNREADABLE_MSG = "Your review was saved in Google Sheets, but MARK can't read it yet, so collectors can't self-review this half."

/**
 * Share the MARK Reviews folder (once per folder) with mark-reporter and the audience.
 * A failed audience share does not fail the export — the files exist and mark-reporter can
 * read them — so it comes back as a warning to show, not an error.
 */
export async function ensureRootShared({ invoke, accessToken, rootId, force = false }) {
  if (!rootId) return { ok: true, warnings: [] }
  if (!force && localStorage.getItem(SHARED_KEY(rootId)) === '1') return { ok: true, warnings: [] }
  const warnings = []
  let r
  try {
    r = await invoke('drive_share_folder', { accessToken, folderId: rootId, audienceType: EXPORT_AUDIENCE.type, audienceValue: EXPORT_AUDIENCE.value })
  } catch (e) {
    return { ok: false, warnings: [explainDriveError(e).message] }
  }
  const audienceOk = r.audience_shared === null || r.audience_shared === true
  if (!r.sa_shared) warnings.push('mark-reporter could not be given access to your MARK Reviews folder.')
  if (!audienceOk) warnings.push(`Your MARK Reviews folder could not be shared with ${EXPORT_AUDIENCE.value}, so they can't open these files yet.`)
  if (r.sa_shared && audienceOk) localStorage.setItem(SHARED_KEY(rootId), '1')
  if (warnings.length) console.warn('[MARK] share MARK Reviews folder:', r.errors)
  return { ok: r.sa_shared && audienceOk, saShared: r.sa_shared, warnings }
}

/** The folder cache is kept per Google account, so signing in as someone else never reuses another account's folder. */
async function rootCacheKey(invoke, accessToken) {
  try { const r = await googleFetch(USERINFO_API, { token: accessToken }); const j = await r.json(); return ROOT_KEY(j.email) } catch { return ROOT_KEY('') }
}
/** The cached id of this reviewer's MARK Reviews folder (or null), and how to store a new one. */
export async function rootCache(invoke, accessToken) {
  const key = await rootCacheKey(invoke, accessToken)
  return { id: localStorage.getItem(key) || null, store: id => { if (id) localStorage.setItem(key, id) } }
}

/**
 * Re-share and re-check ONE sheet. Used by the first attempt and by Retry, so Retry never
 * creates a second sheet.
 *  - sheet is inside the MARK Reviews folder → re-share the folder (mark-reporter + audience)
 *  - otherwise (the shared folder) → share the one file with mark-reporter
 */
export async function shareAndVerify({ fileId, url = '', path = '', rootId = '', invoke: inv, sleepMs, force = true } = {}) {
  const invoke = inv || (await import('@tauri-apps/api/core')).invoke
  let shareFailure = '', warnings = []
  try {
    const accessToken = await getReviewerToken(invoke)
    if (rootId) {
      const r = await ensureRootShared({ invoke, accessToken, rootId, force })
      warnings = r.warnings
      if (!r.saShared) shareFailure = r.warnings[0] || ''
    } else {
      await invoke('drive_share_sheet', { accessToken, fileId })
    }
  } catch (e) {
    shareFailure = explainDriveError(e).message
    console.warn('[MARK] share with mark-reporter failed:', shareFailure)
  }
  const check = await serviceAccountCanRead(fileId, { invoke, ...(sleepMs != null ? { delayMs: sleepMs } : {}) })
  if (check.ok) return { ok: true, warnings }
  console.warn('[MARK] mark-reporter cannot read', fileId, 'HTTP', check.status, check.detail, shareFailure)
  throw new DriveExportError('unreadable', UNREADABLE_MSG, { fileId, url, path, rootId, httpStatus: check.status, detail: shareFailure || check.detail })
}

/**
 * Upload one export to Drive: folder → spreadsheet → clips → "can mark-reporter read it?".
 *
 *   resume    the record of an earlier attempt, or null for a first run. It is updated in
 *             place, so on ANY failure the caller still holds exactly what already landed.
 *   spec      { folderName, sheet: { filePath, fileName, command }, clips: [{ fileName, localPath }] }
 *             command: 'upload_xlsx_as_sheet' (Scout) | 'upload_csv_as_sheet' (Audit)
 *
 * Success → { folderUrl, sheetLink, sheetId, path, warnings }.
 * Failure → throws a DriveExportError whose `.resume` is the record to hand to Retry.
 *   quota / permission  stop at once (every later file would fail the same way)
 *   network / other     keep going, so one bad clip does not hide the rest, but stop after
 *                       three in a row; whatever failed is listed for Retry
 *   partial             some clips did not land (the others did)
 *   unreadable          everything landed but mark-reporter cannot read the sheet
 */
export async function uploadExportToDrive({ spec, resume = null, invoke: inv, onProgress = () => {} }) {
  const invoke = inv || (await import('@tauri-apps/api/core')).invoke
  const r = resume || { folderName: spec.folderName, subFolderId: '', path: '', rootId: '', sheet: { done: false, id: '', link: '' }, clips: spec.clips.map(c => ({ ...c, done: false, error: '' })), warnings: [] }
  const total = r.clips.length + 1
  const fail = (e) => { const x = explainDriveError(e); x.resume = r; return x }

  let accessToken
  try { accessToken = await getReviewerToken(invoke) } catch (e) { throw fail(e) }

  // ── folder ──────────────────────────────────────────────────────────────────
  if (!r.subFolderId) {
    onProgress({ phase: 'folder', step: 0, total, detail: `Creating folder "${r.folderName}"…` })
    const cacheKey = await rootCacheKey(invoke, accessToken)
    let f
    try {
      f = await invoke('drive_create_export_folder', { accessToken, name: r.folderName, parentId: MASTER_FOLDER_ID, rootId: localStorage.getItem(cacheKey) || null })
    } catch (e) { throw fail(e) }
    r.subFolderId = f.id; r.path = f.path; r.rootId = f.root_id || ''
    if (r.rootId) localStorage.setItem(cacheKey, r.rootId)
    console.log('[MARK] export folder path:', r.path, f.fallback_reason ? `(shared folder refused: ${f.fallback_reason})` : '')
    if (r.path === 'app_root') {
      const share = await ensureRootShared({ invoke, accessToken, rootId: r.rootId })
      r.warnings.push(...share.warnings)
    }
  }

  // ── spreadsheet ─────────────────────────────────────────────────────────────
  if (!r.sheet.done) {
    onProgress({ phase: 'uploading', step: 0, total, detail: 'Uploading spreadsheet to Drive…' })
    try {
      const link = await invoke(spec.sheet.command, { token: accessToken, filePath: spec.sheet.filePath, fileName: spec.sheet.fileName, parentFolderId: r.subFolderId })
      r.sheet = { done: true, link: link || '', id: fileIdFromLink(link) }
    } catch (e) { throw fail(e) }
  }

  // ── clips ───────────────────────────────────────────────────────────────────
  let consecutive = 0
  for (let i = 0; i < r.clips.length; i++) {
    const c = r.clips[i]
    if (c.done) continue
    onProgress({ phase: 'uploading', step: i + 1, total, detail: `Uploading clip ${i + 1}/${r.clips.length}…` })
    try {
      await invoke('drive_upload_file', { token: accessToken, filePath: c.localPath, fileName: c.fileName, parentFolderId: r.subFolderId })
      c.done = true; c.error = ''; consecutive = 0
    } catch (e) {
      const x = explainDriveError(e)
      c.error = x.message
      if (x.kind === 'quota' || x.kind === 'permission') throw fail(e)    // every later clip would fail the same way
      if (++consecutive >= 3) break
    }
  }
  const failed = r.clips.filter(c => !c.done)
  if (failed.length) {
    const first = failed.find(c => c.error)
    throw Object.assign(new DriveExportError('partial',
      `${failed.length} of ${r.clips.length} clips could not be uploaded. ${first?.error || ''}`.trim(),
      { resume: r }), {})
  }

  // ── can mark-reporter read the spreadsheet? ────────────────────────────────
  if (r.sheet.id && !r.verified) {
    onProgress({ phase: 'verifying', step: total, total, detail: 'Checking that mark-reporter can read the sheet…' })
    const check = await serviceAccountCanRead(r.sheet.id, { invoke })
    if (!check.ok) {
      throw new DriveExportError('unreadable', UNREADABLE_MSG, { fileId: r.sheet.id, url: r.sheet.link, path: r.path, rootId: r.rootId, httpStatus: check.status, resume: r })
    }
    r.verified = true
  }
  return { folderUrl: `https://drive.google.com/drive/folders/${r.subFolderId}`, sheetLink: r.sheet.link, sheetId: r.sheet.id, path: r.path, warnings: r.warnings, resume: r }
}

/**
 * Retry. 'unreadable' → re-share and re-check (no uploads). Anything else → run
 * uploadExportToDrive again on the SAME record: it reuses the folder and the files that
 * already landed, and re-uploads only what did not.
 */
export async function retryDriveExport({ error, spec, invoke: inv, onProgress }) {
  const resume = error?.resume
  if (!resume) throw new DriveExportError('other', 'There is nothing to retry — start the export again.')
  if (error.kind === 'unreadable') {
    try { await shareAndVerify({ fileId: error.fileId, url: error.url, path: error.path, rootId: error.rootId, invoke: inv }) }
    catch (e) { if (e && e.name === 'DriveExportError') e.resume = resume; throw e }   // still unreadable: keep the record for the next Retry
    resume.verified = true
  }
  return uploadExportToDrive({ spec, resume, invoke: inv, onProgress })
}
