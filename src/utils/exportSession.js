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
    return [
      session.matchId || session.sessionId,
      session.matchName || '',
      tag.triggeredEventLabel || tag.triggeredKey || '',
      fmtTime(tag.videoTimeSec),
      extras[0] || '', extras[1] || '', extras[2] || '',
      extras[3] || '', extras[4] || '',
      team,
      videoLink,
    ]
  })

  const maxExtras  = Math.max(0, ...rows.map(r => r.filter(Boolean).slice(4, 9).length))
  const extraCount = Math.min(5, maxExtras)

  const baseHeaders  = ['Match ID', 'Match Name', 'Event', 'Timestamp']
  const extraHeaders = Array.from({ length: extraCount }, (_, i) => `Extra ${i + 1}`)
  const headers      = [...baseHeaders, ...extraHeaders, 'Team', 'Open at Timestamp']

  const trimmedRows = rows.map(r => [
    r[0], r[1], r[2], r[3],
    ...r.slice(4, 4 + extraCount),
    r[9],
    r[10],
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

// STAGE 1 — sign-in-as-reviewer Google Sheet (OAuth + drive.file).
// Builds the same single-session sheet, then uploads it to the SIGNED-IN USER's
// own Google Drive (converted to a native Sheet). No service account, no app
// verification — uses only the non-sensitive drive.file scope. Returns the URL.
export async function exportSessionToUserDrive({ session, tags, quality, tagCount, total }) {
  const { invoke } = await import('@tauri-apps/api/core')

  // 1. Valid access token: refresh if we already signed in, otherwise sign in.
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
  if (!accessToken) throw new Error('Could not obtain a Google access token')

  // 2. Cut a 10-second clip per error into Downloads/<matchId>_<half>/.
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

  // 3. Upload to the user's Drive as a native Sheet; return the shareable link.
  const name = `MARK Review — ${session.matchName || session.matchId || 'Session'}`
  const res  = await invoke('drive_create_sheet', {
    accessToken,
    name,
    data: Array.from(new Uint8Array(wbout)),
  })
  return res.webViewLink || (res.id ? `https://docs.google.com/spreadsheets/d/${res.id}` : '')
}
