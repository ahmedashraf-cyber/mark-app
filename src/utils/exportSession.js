/**
 * exportSession.js — turn a reviewed session into a spreadsheet.
 * ============================================================================
 *
 * Two exporters share the same row-building logic:
 *   • exportSessionToXlsx          — writes a local .xlsx via a native save
 *                                    dialog (Rust save_xlsx_file). USED BY the
 *                                    download button.
 *   • exportSessionToGoogleSheets  — pushes the same data to a Google Sheet via
 *                                    a Tauri command (create_google_sheet).
 *
 * Each tagged error becomes a row: Match ID, Match Name, Event, Timestamp, up to
 * 5 Extras, Team, and (xlsx only) a clickable "open video at timestamp" link.
 * extraLabel() resolves stored extra ids back to human labels using the
 * legacy tables exported from TagPanel.
 *
 * WHY THE NATIVE SAVE DIALOG (v7.3.6): the previous version wrote silently to
 * the OS Downloads folder through the *scoped* JS fs plugin, with a browser
 * `<a download>` fallback that is a no-op inside a desktop Tauri webview — so
 * clicking download looked like nothing happened. save_xlsx_file (rfd in Rust)
 * shows a real Save dialog and writes with full fs access. Returns the chosen
 * path, or null if the user cancels.
 */
import * as XLSX from 'xlsx'
import { EXTRAS, GK_EXTRAS, GK_WRONG_EXTRAS } from '../components/TagPanel'

function extraLabel(id) {
  const all = [
    ...EXTRAS,
    ...GK_EXTRAS,
    ...Object.values(GK_WRONG_EXTRAS || {}).flat(),
  ]
  return all.find(e => e.id === id)?.label || id
}

function parseTeams(matchName) {
  const parts = (matchName || '').split(' vs ')
  return { home: parts[0]?.trim() || 'Home', away: parts[1]?.trim() || 'Away' }
}

function fmtTime(s) {
  if (!isFinite(s)) return '0:00.000'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms  = Math.floor((s % 1) * 1000)
  return `${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
}

// ── Shared pressure shape lookup — single source of truth ─────────────────────
// exportScoutSession.js imports this rather than duplicating it.
// To rename a label: change it here only.
export const PRESSURE_SHAPES = [
  { code:'MP1', label:'Shooter Pressure'    },
  { code:'MP2', label:'Keeper Pressure'     },
  { code:'MP3', label:'Pre-Duel Pressure'   },
  { code:'MP4', label:'Clear Pressure'      },
  { code:'MP5', label:'Pre-Receive Pressure'},
  { code:'OP1', label:'Static Defender'     },
  { code:'OP2', label:'Space Cover'         },
]

export function pressureShapeLabel(code) {
  if (!code) return ''
  return PRESSURE_SHAPES.find(s => s.code === code)?.label || code
}

// Normalise a stored half to H1 / H2 / EX1 / EX2 for clip filenames.
function normalizeHalf(h) {
  const s = String(h || '').toUpperCase().replace(/\s/g, '')
  if (/^(1H|H1|1|FIRST)/.test(s))  return 'H1'
  if (/^(2H|H2|2|SECOND)/.test(s)) return 'H2'
  if (/^(EX1|ET1|E1)/.test(s))     return 'EX1'
  if (/^(EX2|ET2|E2)/.test(s))     return 'EX2'
  return s || 'H1'
}

// Strip characters that aren't allowed in filenames.
function sanitizeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
}

// "9:49.553" -> "9-49-553" (filename-safe timestamp)
function tsForName(s) {
  return String(s).replace(/[:.]/g, '-')
}

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby94BMwgE3kY_EUshYzd_Zxx6E-m8fEvi0_ThqOc9raUUKq2LTGV_LC43OOd3uYgqPtJw/exec'

// Shared folder where all "MARK Review" sheets are created.
// The SA (mark-reporter) is Editor on this folder, so every file created here
// is automatically readable by the SA — no per-file share call needed.
// Must be shared with each reviewer as Editor for them to be able to open
// sheets inside it.
const TRAINER_REVIEWS_FOLDER_ID = '18lGrKFiZwgg3IRJUA59ryBh3TJVWWyn8'

export async function exportSessionToGoogleSheets({ session, tags, quality, tagCount, total, videoPath }) {
  const { home, away } = parseTeams(session.matchName)

  const dataRows = tags.map(tag => {
    const extras = (tag.extras || []).map(extraLabel)
    const team   = tag.team === 'home' ? home : tag.team === 'away' ? away : (tag.team || '')
    return [
      session.matchId || session.sessionId,
      session.matchName || '',
      tag.triggeredEventLabel || tag.triggeredKey || '',
      fmtTime(tag.videoTimeSec),
      extras[0] || '', extras[1] || '', extras[2] || '',
      extras[3] || '', extras[4] || '',
      team,
    ]
  })

  const maxExtras  = Math.max(0, ...dataRows.map(r => r.slice(4, 9).filter(Boolean).length))
  const extraCount = Math.min(5, maxExtras)

  const headers = [
    'Match ID', 'Match Name', 'Event', 'Timestamp',
    ...Array.from({ length: extraCount }, (_, i) => `Extra ${i + 1}`),
    'Team',
    'Open at Timestamp',
  ]

  const trimmedRows = dataRows.map(r => [
    r[0], r[1], r[2], r[3],
    ...r.slice(4, 4 + extraCount),
    r[9],
    '',
  ])

  const videoLinks = tags.map(() =>
    videoPath ? `file:///${videoPath.replace(/\\/g, '/')}` : ''
  )
  const timestamps = tags.map(tag => fmtTime(tag.videoTimeSec))

  const payload = {
    sheetName: `${session.matchName || 'Review'} - ${session.half || 'H1'}`,
    tabName:   `${session.matchId || 'Session'} - ${session.half || 'H1'}`.slice(0, 31),
    qualityRow: `Quality Score: ${quality}%  |  ${tagCount} errors / ${total} events reviewed`,
    headers,
    rows: trimmedRows,
    videoLinks,
    timestamps,
  }

  const { invoke } = await import('@tauri-apps/api/core')
  const sheetUrl = await invoke('create_google_sheet', { payload: JSON.stringify(payload) })
  if (!sheetUrl) throw new Error('No URL returned from create_google_sheet')
  return sheetUrl
}

export async function exportSessionToXlsx({ session, tags, quality, tagCount, total, videoPath }) {
  const { home, away } = parseTeams(session.matchName)

  const rows = tags.map(tag => {
    const extras = (tag.extras || []).map(extraLabel)
    const team   = tag.team === 'home' ? home : tag.team === 'away' ? away : (tag.team || '')
    const videoLink = videoPath ? `file:///${videoPath.replace(/\\/g, '/')}` : ''
    const psCode  = tag.pressureShape || ''
    const psLabel = pressureShapeLabel(psCode)
    return [
      session.matchId || session.sessionId,
      session.matchName || '',
      tag.triggeredEventLabel || tag.triggeredKey || '',
      fmtTime(tag.videoTimeSec),
      psLabel,              // Pressure Shape
      psCode,               // Pressure Code
      extras[0] || '', extras[1] || '', extras[2] || '',
      extras[3] || '', extras[4] || '',
      team,
      videoLink,
    ]
  })

  const maxExtras  = Math.max(0, ...rows.map(r => r.filter(Boolean).slice(6, 11).length))
  const extraCount = Math.min(5, maxExtras)

  const baseHeaders  = ['Match ID', 'Match Name', 'Event', 'Timestamp',
                        'Pressure Shape', 'Pressure Code']
  const extraHeaders = Array.from({ length: extraCount }, (_, i) => `Extra ${i + 1}`)
  const headers      = [...baseHeaders, ...extraHeaders, 'Team', 'Open at Timestamp']

  const trimmedRows = rows.map(r => [
    r[0], r[1], r[2], r[3],
    r[4], r[5],                        // Pressure Shape, Pressure Code
    ...r.slice(6, 6 + extraCount),     // Extras
    r[11],                             // Team
    r[12],                             // videoLink
  ])

  const qualityRow = [`Quality Score: ${quality}%  |  ${tagCount} errors / ${total} events reviewed`]
  const colCount   = headers.length

  const wsData = [qualityRow, headers, ...trimmedRows]
  const ws     = XLSX.utils.aoa_to_sheet(wsData)

  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } }]

  const baseCols  = [{ wch: 24 }, { wch: 28 }, { wch: 20 }, { wch: 14 }]
  const extraCols = Array.from({ length: extraCount }, () => ({ wch: 18 }))
  ws['!cols'] = [...baseCols, ...extraCols, { wch: 16 }, { wch: 28 }]

  const boldCells = ['A1', ...headers.map((_, i) => XLSX.utils.encode_cell({ r: 1, c: i }))]
  boldCells.forEach(ref => {
    if (ws[ref]) ws[ref].s = { font: { bold: true } }
  })

  if (videoPath) {
    const linkColIdx = headers.length - 1
    const sortedTags = [...tags].sort((a, b) => (a.videoTimeSec || 0) - (b.videoTimeSec || 0))
    trimmedRows.forEach((row, rowIdx) => {
      const link = row[linkColIdx]
      if (!link) return
      const cellRef = XLSX.utils.encode_cell({ r: rowIdx + 2, c: linkColIdx })
      const tagTs   = sortedTags[rowIdx]?.videoTimeSec || 0
      if (ws[cellRef]) {
        ws[cellRef].l = { Target: link, Tooltip: 'Click to open video file' }
        ws[cellRef].v = `Open Video  (seek to ${fmtTime(tagTs)})`
        ws[cellRef].s = { font: { color: { rgb: '0A84FF' }, underline: true } }
      }
    })
  }

  const wb      = XLSX.utils.book_new()
  const tabName = `${(session.matchId || 'Session').slice(0,20)} - ${session.half || 'H1'}`.slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, tabName)

  const fileName = `${session.matchName || 'Review'} - ${session.half || 'H1'}.xlsx`
    .replace(/[/\\?%*:|"<>]/g, '-')

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })

  // Native save dialog handled in Rust (rfd) — shows a real file picker and
  // writes via full fs access, avoiding the silent/scoped JS fs write.
  const { invoke } = await import('@tauri-apps/api/core')
  const savedPath = await invoke('save_xlsx_file', {
    name: fileName,
    data: Array.from(new Uint8Array(wbout)),
  })
  return savedPath // null if the user cancelled the dialog
}

// ─── Session History export → a Google Sheet the REVIEWER owns ──────────────────────
// The reviewer's own OAuth token creates the sheet, so the reviewer owns it and THEIR
// storage is used. (v7.12.10 had mark-reporter create it, which made mark-reporter the
// owner and filled its Drive.) It goes into the shared MARK Trainer Reviews folder when
// Google allows that, otherwise into the reviewer's own Drive — the Rust command reports
// which. Either way it is shared with mark-reporter as a reader, and the export is only
// reported as done after mark-reporter has actually READ it.

/** A failure with a message that is safe to show as it stands, and a kind to act on. */
export class DriveExportError extends Error {
  constructor(kind, message, extra = {}) {
    super(message)
    this.name = 'DriveExportError'
    this.kind = kind          // 'quota' | 'permission' | 'network' | 'other' | 'unreadable'
    Object.assign(this, extra) // unreadable: { fileId, url, path }
  }
}

/** Rust returns Drive failures as a JSON string; turn one into words that name the real cause. */
export function explainDriveError(raw) {
  const text = typeof raw === 'string' ? raw : (raw?.message || String(raw))
  let d = null
  try { const j = JSON.parse(text); if (j && typeof j === 'object' && j.kind) d = j } catch {}
  if (!d) return new DriveExportError('other', `The export failed: ${text}. Your review is safe in MARK.`)
  const short = String(d.reason || d.message || `HTTP ${d.status}`).replace(/\s+/g, ' ').slice(0, 140)
  if (d.kind === 'quota')
    return new DriveExportError('quota', `Google storage is full for ${d.account || 'your Google account'}, so the review couldn't be exported. Your review is safe in MARK — tell Fady.`)
  // 'parent' only reaches here if the own-Drive attempt was refused too: that is a permission problem
  if (d.kind === 'permission' || d.kind === 'parent')
    return new DriveExportError('permission', `Google didn't allow this export (${short}). Tell Fady.`)
  if (d.kind === 'network')
    return new DriveExportError('network', `The export couldn't reach Google (${d.message || 'no connection'}). Your review is safe in MARK — check the connection and try again.`)
  return new DriveExportError('other', `The export failed: ${d.message || short}. Your review is safe in MARK.`)
}

/** A valid reviewer access token: silent refresh if we have signed in before, else the browser sign-in. */
async function getReviewerToken(invoke) {
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

/**
 * Can mark-reporter read the sheet? Reads A1:Z5 with the service account. A fresh share
 * can take a moment to take effect, so a non-200 is retried a couple of times before it
 * counts as a failure.
 */
export async function serviceAccountCanRead(fileId, { attempts = 3, delayMs = 1500, invoke: inv } = {}) {
  const invoke = inv || (await import('@tauri-apps/api/core')).invoke
  let status = 0, detail = ''
  for (let i = 0; i < attempts; i++) {
    try {
      const token = await invoke('get_google_access_token_cmd')
      const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/A1:Z5`,
        { headers: { Authorization: `Bearer ${token}` } })
      status = r.status
      if (r.status === 200) return { ok: true, status }
      detail = (await r.text().catch(() => '')).slice(0, 200)
    } catch (e) { status = 0; detail = e?.message || String(e) }
    if (i < attempts - 1) await sleep(delayMs)
  }
  return { ok: false, status, detail }
}

const UNREADABLE_MSG = "Your review was saved in Google Sheets, but MARK can't read it yet, so collectors can't self-review this half."

/**
 * Share the sheet with mark-reporter (as the reviewer), then confirm mark-reporter can read
 * it. Used for the first attempt AND for Retry, so Retry never creates a second sheet.
 */
export async function shareAndVerify({ fileId, url = '', path = '', invoke: inv, sleepMs } = {}) {
  const invoke = inv || (await import('@tauri-apps/api/core')).invoke
  let shareFailure = ''
  try {
    const accessToken = await getReviewerToken(invoke)
    await invoke('drive_share_sheet', { accessToken, fileId })
  } catch (e) {
    shareFailure = e instanceof DriveExportError ? e.message : (explainDriveError(e).message)
    console.warn('[MARK] share with mark-reporter failed:', shareFailure)
  }
  const check = await serviceAccountCanRead(fileId, { invoke, ...(sleepMs != null ? { delayMs: sleepMs } : {}) })
  if (check.ok) return { ok: true }
  console.warn('[MARK] mark-reporter cannot read', fileId, 'HTTP', check.status, check.detail, shareFailure)
  throw new DriveExportError('unreadable', UNREADABLE_MSG, { fileId, url, path, httpStatus: check.status, detail: shareFailure || check.detail })
}

// Creates the "MARK Review" sheet with the reviewer's token. Returns { url, id, path }.
export async function exportSessionToUserDrive({ session, tags, quality, tagCount, total }) {
  const { invoke } = await import('@tauri-apps/api/core')

  // 0. The reviewer's own Google token (silent after the first sign-in).
  const accessToken = await getReviewerToken(invoke)

  // 1. Cut a 10-second clip per error into Downloads/<matchId>_<half>/.
  const matchId   = (session.matchId || session.sessionId || 'Session').toString()
  const half      = normalizeHalf(session.half)
  const subfolder = `${matchId}_${half}`
  const clipNameFor = (tag) => {
    const ev = sanitizeName(tag.triggeredEventLabel || tag.triggeredKey || 'event')
    return `${matchId}_${half}_${ev}_${tsForName(fmtTime(tag.videoTimeSec))}.mp4`
  }
  // Source video: remembered from review, else ask the reviewer to pick it.
  let videoPath = ''
  try { videoPath = localStorage.getItem('mark_video_path_' + matchId) || '' } catch (e) {}
  if (!videoPath) { videoPath = (await invoke('pick_video_file')) || '' }
  if (videoPath) {
    const specs = tags.map(tag => ({ ts: tag.videoTimeSec || 0, name: clipNameFor(tag) }))
    await invoke('cut_clips', { videoPath, subfolder, clips: specs })
  }

  // 3. Build the workbook. "Open at Timestamp" = the clip's filename — a browser
  // Sheet can't open a local file, so we show where to find it in Downloads.
  const { home, away } = parseTeams(session.matchName)
  const rows = tags.map(tag => {
    const extras = (tag.extras || []).map(extraLabel)
    const team   = tag.team === 'home' ? home : tag.team === 'away' ? away : (tag.team || '')
    return [
      matchId,
      session.matchName || '',
      tag.triggeredEventLabel || tag.triggeredKey || '',
      fmtTime(tag.videoTimeSec),
      extras[0] || '', extras[1] || '', extras[2] || '',
      extras[3] || '', extras[4] || '',
      team,
      videoPath ? clipNameFor(tag) : '',
    ]
  })
  const maxExtras  = Math.max(0, ...rows.map(r => r.slice(4, 9).filter(Boolean).length))
  const extraCount = Math.min(5, maxExtras)
  const headers = [
    'Match ID', 'Match Name', 'Event', 'Timestamp',
    ...Array.from({ length: extraCount }, (_, i) => `Extra ${i + 1}`),
    'Team', 'Open at Timestamp',
  ]
  const trimmedRows = rows.map(r => [ r[0], r[1], r[2], r[3], ...r.slice(4, 4 + extraCount), r[9], r[10] ])
  const qualityRow  = [`Quality Score: ${quality}%  |  ${tagCount} errors / ${total} events reviewed`]
  const ws = XLSX.utils.aoa_to_sheet([qualityRow, headers, ...trimmedRows])
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }]
  const wb = XLSX.utils.book_new()
  const tabName = `${(session.matchId || 'Session').toString().slice(0,20)} - ${session.half || 'H1'}`.slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, tabName)
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })

  // 4. Create it as the reviewer. The Rust command tries the shared folder and, only if Google
  // refuses the PARENT, the reviewer's own Drive; it reports which path ran.
  const name = `MARK Review — ${session.matchName || session.matchId || 'Session'}`
  let res
  try {
    res = await invoke('drive_create_sheet', {
      accessToken,
      name,
      data: Array.from(new Uint8Array(wbout)),
      folderId: TRAINER_REVIEWS_FOLDER_ID,
    })
  } catch (e) {
    throw explainDriveError(e)
  }
  console.log('[MARK] Session History export path:', res.path, res.fallback_reason ? `(folder refused: ${res.fallback_reason})` : '')
  const url = res.webViewLink || (res.id ? `https://docs.google.com/spreadsheets/d/${res.id}` : '')

  // 5. Share with mark-reporter and confirm it can read A1:Z5 before calling this done.
  await shareAndVerify({ fileId: res.id, url, path: res.path, invoke })
  return { url, id: res.id, path: res.path }
}
