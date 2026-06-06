// Exports a completed review session as an .xlsx file using SheetJS.
// Saved locally — no Google auth needed.

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

export async function exportSessionToXlsx({ session, tags, quality, tagCount, total }) {
  const { home, away } = parseTeams(session.matchName)

  // ── Data rows ────────────────────────────────────────────────────────────────
  const rows = tags.map(tag => {
    const extras  = (tag.extras || []).map(extraLabel)
    const team    = tag.team === 'home' ? home : tag.team === 'away' ? away : (tag.team || '')
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

  // ── Determine which Extra columns have data ───────────────────────────────
  const maxExtras = Math.max(0, ...rows.map(r => r.filter(Boolean).slice(4, 9).length))
  const extraCount = Math.min(5, maxExtras) // only include columns that have data

  // Rebuild headers and rows with only needed Extra columns
  const baseHeaders = ['Match ID', 'Match Name', 'Event', 'Timestamp']
  const extraHeaders = Array.from({ length: extraCount }, (_, i) => `Extra ${i + 1}`)
  const headers = [...baseHeaders, ...extraHeaders, 'Team']

  const trimmedRows = rows.map(r => [
    r[0], r[1], r[2], r[3],           // base cols
    ...r.slice(4, 4 + extraCount),     // only used extra cols
    r[9],                               // team
  ])

  const qualityRow = [`Quality Score: ${quality}%  |  ${tagCount} errors / ${total} events reviewed`]
  const colCount = headers.length

  // ── Worksheet ────────────────────────────────────────────────────────────────
  const wsData = [qualityRow, headers, ...trimmedRows]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Merge quality row across all columns dynamically
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } }]

  // Column widths — base + extras + team
  const baseCols = [{ wch: 24 }, { wch: 28 }, { wch: 20 }, { wch: 14 }]
  const extraCols = Array.from({ length: extraCount }, () => ({ wch: 18 }))
  ws['!cols'] = [...baseCols, ...extraCols, { wch: 16 }]

  // Bold: quality row + headers
  const boldCells = ['A1', ...headers.map((_, i) => XLSX.utils.encode_cell({ r: 1, c: i }))]
  boldCells.forEach(ref => {
    if (ws[ref]) ws[ref].s = { font: { bold: true } }
  })

  // ── Workbook ─────────────────────────────────────────────────────────────────
  const wb    = XLSX.utils.book_new()
  const tabName = `${(session.matchId || 'Session').slice(0,20)} - ${session.half || 'H1'}`.slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, tabName)

  const fileName = `${session.matchName || 'Review'} - ${session.half || 'H1'}.xlsx`
    .replace(/[/\\?%*:|"<>]/g, '-')

  // ── Save via Tauri fs (write to Downloads) ────────────────────────────────────
  try {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })

    // Get the Downloads folder path via Tauri
    const { downloadDir } = await import('@tauri-apps/api/path')
    const { join }        = await import('@tauri-apps/api/path')
    const { writeFile }   = await import('@tauri-apps/plugin-fs')

    const dir      = await downloadDir()
    const filePath = await join(dir, fileName)
    await writeFile(filePath, new Uint8Array(wbout))
    return filePath
  } catch (e) {
    // Fallback: browser-style download (dev mode)
    console.warn('[MARK] fs write failed, browser download:', e)
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob  = new Blob([wbout], { type: 'application/octet-stream' })
    const url   = URL.createObjectURL(blob)
    const a     = document.createElement('a')
    a.href = url; a.download = fileName; a.click()
    URL.revokeObjectURL(url)
    return fileName
  }
}
