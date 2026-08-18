/**
 * exportScoutSession.js
 * Full export pipeline for Scout review sessions:
 *   1. Build styled XLSX locally → save to Downloads/<folderName>/
 *   2. Cut MP4 clips (−5s / +5s) → save to same folder
 *   3. Upload XLSX as Google Sheet to Drive subfolder
 *   4. Upload all clips to same Drive subfolder
 *
 * onProgress(phase, step, total) — called after each step:
 *   phases: 'token' | 'folder' | 'xlsx' | 'cutting' | 'uploading' | 'done'
 */

import * as XLSX from 'xlsx'

// ── Name helpers ───────────────────────────────────────────────────────────
const HALF_LABEL = { 1:'1st Half', 2:'2nd Half', '1':'1st Half', '2':'2nd Half', 'H1':'1st Half', 'H2':'2nd Half', 'EX1':'ET1', 'EX2':'ET2', 'ET1':'ET1', 'ET2':'ET2' }
const halfLabel  = h => HALF_LABEL[h] || String(h || '1st Half')

// Safe filename: keep spaces and hyphens, remove only truly invalid chars
const safeName   = s => String(s || '').replace(/[/\\?%*:|"<>]/g, '-').trim()

// Base name: "1294780_Saint-Étienne vs Angers_1st Half"
const baseName = (session) => {
  const mid  = session.matchId  || session.sessionId || 'Session'
  const name = session.matchName || 'Match'
  const half = halfLabel(session.half)
  return safeName(`${mid}_${name}_${half}`)
}

// Clip name: "<baseName>_<eventType>_<errorType>_<defectType>"
const clipName = (base, tag, dt) => {
  const ev  = safeName(tag.triggeredEventLabel || tag.triggeredEventId || 'event')
  const err = safeName((tag.extras || []).find(Boolean) || 'error')
  return `${base}_${ev}_${err}_${dt}.mp4`
}

// Format video timestamp: mm:ss.SSS
const fmtTime = s => {
  if (!s && s !== 0) return ''
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms  = Math.floor((s % 1) * 1000)
  return `${m}:${String(sec).padStart(2,'0')}.${String(ms).padStart(3,'0')}`
}

// Extra labels (reuse from TagPanel logic)
const extraLabel = e => {
  if (!e) return ''
  if (typeof e === 'string') return e
  return e.label || e.id || String(e)
}

// Defect type from triggeredEventId
const DT_A  = new Set(['card','foul-committed','end-stoppage','stoppage','player-off','player-on','referee-ball-drop','shot','end-shot','substitution','tactical-shift','own-goal-against','starting-xi','error'])
const DT_B  = new Set(['fifty-fifty','clearance','dribble','interception','miscontrol','shield','block','tackle'])
const DT_C  = new Set(['pressure-start','pressure-end','ball-recovery','pressure'])
const DT_D  = new Set(['reception'])
const DT_TO = new Set(['hold-up-duel','leg-stretch-duel','positioning-duel','separation-duel'])
const normId = id => {
  const map = { pressure:'pressure-start',pass_first_time:'pass',pass_interception:'interception',
    pass_recovery:'ball-recovery',goal_keeper:'goal-keeper',fifty_fifty:'fifty-fifty',
    foul_committed:'foul-committed',own_goal_against:'own-goal-against',ball_recovery:'ball-recovery',
    hold_up_duel:'hold-up-duel',leg_stretch_duel:'leg-stretch-duel',
    positioning_duel:'positioning-duel',separation_duel:'separation-duel' }
  return map[id] || String(id||'').replace(/_/g,'-')
}
const getDefectType = id => {
  const n = normId(id)
  if (DT_A.has(n))  return 'A'
  if (DT_B.has(n))  return 'B'
  if (DT_C.has(n))  return 'C'
  if (DT_D.has(n))  return 'D'
  if (DT_TO.has(n)) return 'TO'
  return 'D'
}

// ── MARK Visual Identity colors (as ARGB hex for XLSX) ────────────────────
const CLR = {
  bg:        '0F0A0A12',  // near-black page bg
  bg2:       '0F111120',  // card bg
  bg3:       '0F1A1A2E',  // elevated surface
  orange:    'FFE8590C',  // Hudl orange
  orangeL:   '33E8590C',  // orange light (20% alpha)
  blue:      'FF0A84FF',  // A — iOS blue
  green:     'FF30D158',  // B — iOS green
  yellow:    'FFFFD60A',  // C — iOS yellow
  amber:     'FFFF9F0A',  // D — iOS amber
  purple:    'FFBF5AF2',  // TO — iOS purple
  red:       'FFFF453A',  // error red
  white95:   'FFF2F2F7',  // t-1
  white70:   'B3F2F2F7',  // t-2
  white40:   '66F2F2F7',  // t-3
  darkBg:    'FF0A0A12',  // full opaque dark
  darkBg2:   'FF111120',
  darkBg3:   'FF1A1A2E',
}

const DT_COLOR = { A: CLR.blue, B: CLR.green, C: CLR.yellow, D: CLR.amber, TO: CLR.purple }

// Cell style helpers
const cellStyle = (opts = {}) => ({
  fill:      { fgColor: { rgb: opts.bg    || CLR.darkBg2 } },
  font:      { name:'Inter', sz: opts.sz || 10, bold: !!opts.bold,
               color: { rgb: opts.fg || CLR.white95 }, italic: !!opts.italic },
  alignment: { horizontal: opts.align || 'left', vertical: 'center', wrapText: !!opts.wrap },
  border:    { bottom: { style:'thin', color:{ rgb:'22FFFFFF' } },
               right:  { style:'thin', color:{ rgb:'22FFFFFF' } } },
})

const applyStyle = (ws, ref, style) => {
  if (!ws[ref]) ws[ref] = { v:'', t:'s' }
  ws[ref].s = style
}

const applyRangeStyle = (ws, r1, c1, r2, c2, style) => {
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++)
      applyStyle(ws, XLSX.utils.encode_cell({ r, c }), style)
}

// ── Build the styled workbook ──────────────────────────────────────────────
export function buildScoutWorkbook({ session, tags, quality, tagCount, total,
    dtScores, pressureScore, pressureReviewed, pressureErrors, videoPath, folderBase }) {

  const { invoke } = { invoke: null } // placeholder — not used here
  const matchId  = String(session.matchId  || session.sessionId || 'Session')
  const matchName= session.matchName || 'Match'
  const half     = halfLabel(session.half)
  const reviewer = session.reviewerName || session.reviewerEmail || 'Reviewer'
  const date     = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })

  // ── Section 1: Session Summary ────────────────────────────────────────────
  const summaryRows = [
    // Row 0: title
    [`MARK Scout Review — ${matchName} — ${half}`, '', '', '', '', '', '', '', '', '', '', '', '', ''],
    // Row 1: blank
    [],
    // Row 2: session info labels
    ['Match ID', 'Match Name', 'Half', 'Reviewer', 'Date', 'Total Events', 'Total Errors', 'Quality Score'],
    // Row 3: session info values
    [matchId, matchName, half, reviewer, date, total, tagCount, `${quality}%`],
    // Row 4: blank
    [],
    // Row 5: scores header
    ['A — Review', 'B — Review', 'C — Review', 'D — Review', 'TO — Review', 'Pressure', 'Overall'],
    // Row 6: scores values
    [
      dtScores?.A?.score  != null ? `${dtScores.A.score}%`  : 'N/A',
      dtScores?.B?.score  != null ? `${dtScores.B.score}%`  : 'N/A',
      dtScores?.C?.score  != null ? `${dtScores.C.score}%`  : 'N/A',
      dtScores?.D?.score  != null ? `${dtScores.D.score}%`  : 'N/A',
      dtScores?.TO?.score != null ? `${dtScores.TO.score}%` : 'N/A',
      pressureScore != null ? `${pressureScore}%` : 'N/A',
      `${quality}%`,
    ],
    // Row 7: blank
    [],
    // Row 8: errors table header
    [],
  ]

  // ── Section 2: Errors table ───────────────────────────────────────────────
  const HEADERS = [
    'Match ID', 'Match Name', 'Half', 'Reviewer', 'Video Time',
    'Event Type', 'Defect Type', 'Error Type',
    'Extra 1', 'Extra 2', 'Extra 3', 'Extra 4', 'Extra 5',
    'Team', 'Clip File',
  ]
  const COL_COUNT = HEADERS.length

  const { home, away } = (() => {
    const parts = (matchName || '').split(/\s+vs\.?\s+/i)
    return { home: parts[0]?.trim() || 'Home', away: parts[1]?.trim() || 'Away' }
  })()

  const errorRows = tags.map(tag => {
    const dt      = getDefectType(tag.triggeredEventId)
    const extras  = (tag.extras || []).map(extraLabel)
    const team    = tag.team === 'home' ? home : tag.team === 'away' ? away : (tag.team || '')
    const clip    = videoPath ? clipName(folderBase, tag, dt) : ''
    const errType = extras[0] || ''
    return [
      matchId,
      matchName,
      half,
      reviewer,
      fmtTime(tag.videoTimeSec),
      tag.triggeredEventLabel || normId(tag.triggeredEventId) || '',
      dt,
      errType,
      extras[0] || '', extras[1] || '', extras[2] || '', extras[3] || '', extras[4] || '',
      team,
      clip,
    ]
  })
  // Sort by video time
  errorRows.sort((a, b) => {
    const ta = tags.find(t => fmtTime(t.videoTimeSec) === a[4])?.videoTimeSec || 0
    const tb = tags.find(t => fmtTime(t.videoTimeSec) === b[4])?.videoTimeSec || 0
    return ta - tb
  })

  // Combine
  const HEADER_ROW_IDX  = summaryRows.length // row index where headers go
  summaryRows[8] = HEADERS                    // put headers at row 8 (0-indexed)

  const allData = [...summaryRows, ...errorRows]
  const ws      = XLSX.utils.aoa_to_sheet(allData)

  // ── Column widths ─────────────────────────────────────────────────────────
  ws['!cols'] = [
    { wch:14 }, { wch:28 }, { wch:12 }, { wch:22 }, { wch:14 },
    { wch:20 }, { wch:12 }, { wch:22 },
    { wch:18 }, { wch:18 }, { wch:18 }, { wch:18 }, { wch:18 },
    { wch:14 }, { wch:42 },
  ]

  // ── Row heights ───────────────────────────────────────────────────────────
  ws['!rows'] = allData.map((_, i) => {
    if (i === 0) return { hpt: 36 }
    if (i === 8) return { hpt: 22 }
    return { hpt: 18 }
  })

  // ── Merges ────────────────────────────────────────────────────────────────
  ws['!merges'] = [
    // Title row — full width
    { s:{ r:0, c:0 }, e:{ r:0, c:COL_COUNT-1 } },
    // Scores header row — 7 cells
    { s:{ r:5, c:0 }, e:{ r:5, c:0 } },
  ]

  // ── Apply styles ──────────────────────────────────────────────────────────

  // Row 0: Title
  applyStyle(ws, 'A1', cellStyle({ bg:CLR.orange, fg:CLR.darkBg, sz:14, bold:true, align:'center' }))

  // Row 2: Info labels
  const infoLabelCols = COL_COUNT
  ;['A','B','C','D','E','F','G','H'].slice(0,8).forEach(col => {
    applyStyle(ws, `${col}3`, cellStyle({ bg:CLR.darkBg3, fg:CLR.white70, sz:9, bold:true }))
  })

  // Row 3: Info values
  ;['A','B','C','D','E','F','G'].slice(0,7).forEach(col => {
    applyStyle(ws, `${col}4`, cellStyle({ bg:CLR.darkBg2, fg:CLR.white95, sz:10 }))
  })
  applyStyle(ws, 'H4', cellStyle({ bg:CLR.darkBg2, fg:CLR.orange, sz:11, bold:true }))

  // Row 5: Score labels
  const DT_COLS_6 = [
    { col:'A', color:CLR.blue   },
    { col:'B', color:CLR.green  },
    { col:'C', color:CLR.yellow },
    { col:'D', color:CLR.amber  },
    { col:'E', color:CLR.purple },
    { col:'F', color:CLR.orange },
    { col:'G', color:CLR.orange },
  ]
  DT_COLS_6.forEach(({ col, color }) => {
    applyStyle(ws, `${col}6`, cellStyle({ bg:CLR.darkBg3, fg:color, sz:9, bold:true, align:'center' }))
    applyStyle(ws, `${col}7`, cellStyle({ bg:CLR.darkBg2, fg:color, sz:13, bold:true, align:'center' }))
  })

  // Row 8 (index 8): Headers
  HEADERS.forEach((_, ci) => {
    const ref = XLSX.utils.encode_cell({ r:8, c:ci })
    applyStyle(ws, ref, cellStyle({ bg:CLR.orange, fg:CLR.darkBg, sz:10, bold:true, align:'center' }))
  })

  // Data rows
  errorRows.forEach((row, ri) => {
    const rowIdx  = 9 + ri
    const dt      = row[6] // Defect Type column
    const dtColor = DT_COLOR[dt] || CLR.white95
    const bgColor = ri % 2 === 0 ? CLR.darkBg2 : CLR.darkBg3

    row.forEach((_, ci) => {
      const ref = XLSX.utils.encode_cell({ r:rowIdx, c:ci })
      let fg = CLR.white95, bg = bgColor, sz = 9

      if (ci === 6) { fg = dtColor; sz = 10 }           // Defect Type — colored
      else if (ci === 4) { fg = CLR.white70; sz = 9 }   // Video Time
      else if (ci === 14) { fg = CLR.blue; sz = 8 }     // Clip filename

      applyStyle(ws, ref, cellStyle({ bg, fg, sz, align: ci === 4 ? 'center' : 'left' }))
    })
  })

  // Sheet tab name
  const tabName = `${matchId.slice(0,15)}_${half}`.slice(0, 31)
  const wb      = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, tabName)

  return { wb, tabName }
}

// ── Main export function ──────────────────────────────────────────────────
export async function exportScoutSession({
  session, tags, quality, tagCount, total,
  dtScores, pressureScore, pressureReviewed, pressureErrors,
  onProgress,  // (phase, step, total, detail?) => void
}) {
  const { invoke } = await import('@tauri-apps/api/core')

  const MASTER_FOLDER_ID = '1TeuEJqnKiGrCmZZfpfOKFMzwa3KBxO0A'
  const folderBase  = baseName(session)
  const xlsxName    = `${folderBase}.xlsx`

  const report = (phase, step, total, detail) =>
    onProgress && onProgress({ phase, step, total, detail })

  // ── Step 0: Get Drive token ───────────────────────────────────────────────
  report('token', 0, 1, 'Connecting to Google Drive…')
  let token
  try {
    token = await invoke('get_google_access_token_cmd')
  } catch(e) { throw new Error('Google Drive auth failed: ' + (e?.message || String(e))) }
  report('token', 1, 1, 'Connected ✅')

  // ── Step 1: Create Drive subfolder ───────────────────────────────────────
  report('folder', 0, 1, `Creating folder "${folderBase}"…`)
  let subFolderId
  try {
    subFolderId = await invoke('drive_create_folder', {
      token, name: folderBase, parentId: MASTER_FOLDER_ID,
    })
  } catch(e) { throw new Error('Drive folder creation failed: ' + (e?.message || String(e))) }
  report('folder', 1, 1, 'Folder created ✅')

  // ── Step 2: Get local video path ──────────────────────────────────────────
  report('video', 0, 1, 'Locating video file…')
  const matchId = String(session.matchId || session.sessionId || '')
  let videoPath = ''
  try { videoPath = localStorage.getItem('mark_video_path_' + matchId) || '' } catch(e) {}
  if (!videoPath) {
    try { videoPath = (await invoke('pick_video_file')) || '' } catch(e) {}
  }
  report('video', 1, 1, videoPath ? `Video found ✅` : 'No video — skipping clips')

  // ── Step 3: Build XLSX ────────────────────────────────────────────────────
  report('xlsx', 0, 1, 'Building spreadsheet…')
  const { wb } = buildScoutWorkbook({
    session, tags, quality, tagCount, total,
    dtScores, pressureScore, pressureReviewed, pressureErrors,
    videoPath, folderBase,
  })
  const wbout = XLSX.write(wb, { bookType:'xlsx', type:'array', cellStyles:true })

  // ── Step 4: Save XLSX locally ─────────────────────────────────────────────
  report('xlsx', 1, 1, 'Saving spreadsheet locally…')
  let userprofile
  try { userprofile = await invoke('get_userprofile') } catch(e) { userprofile = '' }
  const localFolder = `${userprofile}\\Downloads\\${folderBase}`
  const xlsxPath    = `${localFolder}\\${xlsxName}`
  try {
    await invoke('save_text_file', {
      path: xlsxPath,
      content: String.fromCharCode(...new Uint8Array(wbout)),
    })
  } catch(e) {
    // Fallback: use save_xlsx_file with native dialog
    try {
      await invoke('save_xlsx_file', {
        name: xlsxName,
        data: Array.from(new Uint8Array(wbout)),
      })
    } catch(e2) { console.warn('[MARK] XLSX local save failed:', e2) }
  }

  // ── Step 5: Cut clips ─────────────────────────────────────────────────────
  let cutFiles = []
  if (videoPath && tags.length > 0) {
    report('cutting', 0, tags.length, 'Cutting video clips…')
    const clipSpecs = tags.map(tag => {
      const dt = getDefectType(tag.triggeredEventId)
      return {
        ts:   tag.videoTimeSec || 0,
        name: clipName(folderBase, tag, dt),
      }
    })
    try {
      cutFiles = await invoke('cut_clips', {
        videoPath,
        subfolder: folderBase,
        clips: clipSpecs,
      })
      report('cutting', cutFiles.length, tags.length, `${cutFiles.length} clips cut ✅`)
    } catch(e) {
      console.warn('[MARK] clip cutting failed:', e)
      report('cutting', 0, tags.length, `⚠️ Clip cutting failed: ${e?.message || String(e)}`)
    }
  } else {
    report('cutting', 0, 0, videoPath ? 'No errors to clip' : 'No video — skipping clips')
  }

  // ── Step 6: Upload XLSX to Drive ──────────────────────────────────────────
  report('uploading', 0, cutFiles.length + 1, 'Uploading spreadsheet to Drive…')
  let driveLink = ''
  try {
    const sheetLink = await invoke('upload_csv_as_sheet', {
      token,
      filePath: xlsxPath,
      fileName: xlsxName,
      parentFolderId: subFolderId,
    })
    driveLink = sheetLink || `https://drive.google.com/drive/folders/${subFolderId}`
    report('uploading', 1, cutFiles.length + 1, 'Sheet uploaded ✅')
  } catch(e) {
    console.warn('[MARK] sheet upload failed:', e)
    report('uploading', 1, cutFiles.length + 1, `⚠️ Sheet upload failed`)
    driveLink = `https://drive.google.com/drive/folders/${subFolderId}`
  }

  // ── Step 7: Upload clips ──────────────────────────────────────────────────
  for (let i = 0; i < cutFiles.length; i++) {
    const clipFileName = cutFiles[i]
    const localPath    = `${userprofile}\\Downloads\\${folderBase}\\${clipFileName}`
    report('uploading', i + 2, cutFiles.length + 1, `Uploading clip ${i+1}/${cutFiles.length}…`)
    try {
      await invoke('drive_upload_file', {
        token,
        filePath:       localPath,
        fileName:       clipFileName,
        parentFolderId: subFolderId,
      })
    } catch(e) {
      console.warn('[MARK] clip upload failed:', clipFileName, e)
    }
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  const folderUrl = `https://drive.google.com/drive/folders/${subFolderId}`
  report('done', cutFiles.length + 1, cutFiles.length + 1, folderUrl)
  return { driveLink, folderUrl, clipsCount: cutFiles.length }
}
