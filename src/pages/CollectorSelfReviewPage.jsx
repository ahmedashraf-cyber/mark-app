/**
 * CollectorSelfReviewPage.jsx — Collector Self-Review mode.
 * ============================================================================
 * Shows each collector their assigned halves (from the Sampled Halves sheet),
 * lets them enter what events they think they made errors on, compares with
 * the trainer review, and saves one row per result to the save tab.
 *
 * Gate: caps.selfReview must be true.
 * HR-code: taken from roleInfo.code (resolved at sign-in). Never typed by the collector.
 */

import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { db } from '../firebase/config'
import {
  doc, getDoc, runTransaction, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth'
import {
  loadCollectorHalves,
  loadSavedReviews,
  loadTrainerSheet,
  verifySaveHeader,
  appendSaveRows,
  savedRowsForRunId,
  SAVE_HEADER,
} from '../utils/selfReviewSheet'
import {
  compare,
  labelToCode,
  codeToLabel,
  codeKnown,
  trainerTsToSec,
  collectorTsToSec,
  fmtSec,
  normaliseErrorType,
  ERROR_TYPES,
  EVENT_GROUPS,
} from '../utils/selfReviewCompare'
import { HALVES } from '../utils/half'

const LOCK_COLLECTION = 'mark_self_review_locks'
const TOLERANCE_S     = 2
const HALF_LABEL = { '1H':'1st half','2H':'2nd half','ET1':'Extra time 1','ET2':'Extra time 2' }

// ── Inline styles (using mark-app CSS variables) ──────────────────────────────
const S = {
  page:     { height:'100vh', display:'flex', flexDirection:'column', background:'var(--bg)', overflow:'hidden' },
  header:   { background:'var(--bg-2)', borderBottom:'1px solid var(--b-1)', padding:'0 20px', height:52,
              display:'flex', alignItems:'center', gap:12, flexShrink:0 },
  backBtn:  { background:'none', border:'none', color:'var(--t-3)', fontSize:18, cursor:'pointer',
              padding:'0 6px 0 0', lineHeight:1 },
  title:    { fontSize:13, fontWeight:700, color:'var(--t-1)', fontFamily:'Inter' },
  sub:      { fontSize:11, color:'var(--t-3)', marginLeft:4 },
  body:     { flex:1, overflowY:'auto', padding:'24px 20px 60px' },
  card:     { background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:12, padding:'18px 20px', marginBottom:16 },
  cardTitle:{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase',
              color:'var(--t-3)', marginBottom:14 },
  label:    { fontSize:12, color:'var(--t-2)', fontWeight:500, marginBottom:6, display:'block' },
  select:   { width:'100%', background:'var(--bg-3)', border:'1px solid var(--b-2)', borderRadius:8,
              color:'var(--t-1)', fontFamily:'Inter', fontSize:13, padding:'9px 12px', outline:'none' },
  input:    { background:'var(--bg-3)', border:'1px solid var(--b-2)', borderRadius:8,
              color:'var(--t-1)', fontFamily:'JetBrains Mono, monospace', fontSize:13,
              padding:'9px 8px', outline:'none', textAlign:'center' },
  btnPrimary:{ display:'inline-flex', alignItems:'center', gap:8, padding:'9px 22px', borderRadius:8,
               border:'none', background:'var(--p2)', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer' },
  btnGhost: { display:'inline-flex', alignItems:'center', gap:8, padding:'9px 18px', borderRadius:8,
              border:'1px solid var(--b-2)', background:'none', color:'var(--t-2)', fontSize:13, cursor:'pointer' },
  btnAdd:   { display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderRadius:8,
              border:'1px dashed var(--b-2)', background:'none', color:'var(--t-3)', fontSize:13,
              cursor:'pointer', marginTop:10 },
  pill:     (sel) => ({
    display:'inline-flex', alignItems:'center', gap:6, padding:'4px 11px', borderRadius:20,
    border: sel ? '1px solid var(--p2)' : '1px solid var(--b-1)',
    background: sel ? 'rgba(232,89,12,0.12)' : 'var(--bg-3)',
    color: sel ? 'var(--p2)' : 'var(--t-2)',
    fontSize:12, cursor:'pointer', userSelect:'none',
  }),
  badge:    (type) => {
    const map = {
      matched:        { bg:'rgba(76,175,130,0.15)',  color:'#4caf82', border:'rgba(76,175,130,0.3)' },
      wrong_event:    { bg:'rgba(210,153,34,0.15)',  color:'#d29922', border:'rgba(210,153,34,0.3)' },
      missed:         { bg:'rgba(224,92,92,0.15)',   color:'#e05c5c', border:'rgba(224,92,92,0.3)' },
      collector_only: { bg:'rgba(88,166,255,0.15)',  color:'#58a6ff', border:'rgba(88,166,255,0.3)' },
    }
    const c = map[type] || { bg:'rgba(255,255,255,0.05)', color:'var(--t-2)', border:'var(--b-1)' }
    return { display:'inline-flex', alignItems:'center', padding:'2px 8px', borderRadius:12,
             fontSize:11, fontWeight:600, background:c.bg, color:c.color, border:`1px solid ${c.border}` }
  },
  statusBar:(type) => {
    const map = { info:'rgba(76,175,130,0.1)', error:'rgba(224,92,92,0.1)', loading:'rgba(88,166,255,0.1)' }
    const brd = { info:'rgba(76,175,130,0.3)', error:'rgba(224,92,92,0.3)', loading:'rgba(88,166,255,0.3)' }
    const clr = { info:'#4caf82', error:'#e05c5c', loading:'#58a6ff' }
    return { display:'flex', alignItems:'center', gap:10, padding:'11px 14px', borderRadius:8,
             background:map[type]||map.info, border:`1px solid ${brd[type]||brd.info}`,
             color:clr[type]||clr.info, fontSize:13, marginTop:12 }
  },
}

let _rowId = 0
function newRow() { return { id: ++_rowId, min:'', sec:'', eventCode:'', errorType:'Missing event' } }

// ── Component ────────────────────────────────────────────────────────────────
// isDirty: any row has a time or event filled in on an un-saved half
export function selfReviewIsDirty(rows, isLocked) {
  if (isLocked) return false
  return rows.some(r => r.eventCode || r.min !== '' || r.sec !== '')
}

export default function CollectorSelfReviewPage({ onBack, onDirtyChange }) {
  const { roleInfo } = useAuth()
  const hrCode = (roleInfo?.code || '').trim().toUpperCase()

  // Page-level state
  const [halves,       setHalves]       = useState([])        // [{key,matchId,half,sheetId}]
  const [savedMap,     setSavedMap]     = useState(new Map())  // key → rows[]
  const [loadingHalves,setLoadingHalves]= useState(false)
  const [halvesError,  setHalvesError]  = useState('')

  const [selectedKey,  setSelectedKey]  = useState('')
  const [selectedScope,setSelectedScope]= useState(new Set()) // empty = all in scope

  const [rows,         setRows]         = useState([newRow()])
  const [status,       setStatus]       = useState(null)      // {type, msg}

  const [lastRun,      setLastRun]      = useState(null)      // comparison result
  const [activeFilter, setActiveFilter] = useState('all')

  const [saving,       setSaving]       = useState(false)

  // ── Video pop-out (same mechanism as ComparisonPage) ───────────────────────
  const [videoPath,    setVideoPath]    = useState('')   // remembered per match
  const [videoUrl,     setVideoUrl]     = useState('')   // local proxy URL
  const [videoName,    setVideoName]    = useState('')
  const [popOpen,      setPopOpen]      = useState(false)
  const [popLinked,    setPopLinked]    = useState(false)
  const [seekRow,      setSeekRow]      = useState(-1)   // briefly highlighted row index
  // Current video time in whole seconds — updated by the pop-out via event
  const videoTimeSec   = useRef(0)

  // ── No HR-code guard ─────────────────────────────────────────────────────
  if (!hrCode) {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={onBack}>←</button>
          <span style={S.title}>Self-Review</span>
        </div>
        <div style={{...S.body, display:'flex', alignItems:'center', justifyContent:'center'}}>
          <div style={{...S.card, maxWidth:400, textAlign:'center'}}>
            <div style={{fontSize:28, marginBottom:12}}>⚠</div>
            <div style={{fontSize:14, fontWeight:600, color:'var(--t-1)', marginBottom:8}}>No HR-Code on your account</div>
            <div style={{fontSize:13, color:'var(--t-2)'}}>
              Your account has no HR-Code. Ask your coordinator to add it.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Load halves on mount ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingHalves(true)
      setHalvesError('')
      try {
        const [hs, saved] = await Promise.all([
          loadCollectorHalves(hrCode),
          loadSavedReviews(hrCode),
        ])
        if (cancelled) return
        setHalves(hs)
        setSavedMap(saved)
        if (hs.length) setSelectedKey(hs[0].key)
      } catch (e) {
        if (!cancelled) setHalvesError(e.message)
      } finally {
        if (!cancelled) setLoadingHalves(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [hrCode])

  const selectedHalf   = halves.find(h => h.key === selectedKey) || null
  const isLocked       = selectedKey ? savedMap.has(selectedKey) : false
  const savedRows      = isLocked ? savedMap.get(selectedKey) : null

  // Notify parent whenever dirty state changes so the update banner can warn
  useEffect(() => {
    onDirtyChange?.(selfReviewIsDirty(rows, isLocked))
  }, [rows, isLocked])

  // ── Video pop-out helpers (same mechanism as ComparisonPage) ──────────────
  async function openVideoWindow(url, name) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const existing = await WebviewWindow.getByLabel('mark-video')
      if (existing) {
        await existing.setFocus()
        const { emit } = await import('@tauri-apps/api/event')
        await emit('mark:video-load', { url, name, status: 'unknown' })
        setPopOpen(true)
        return
      }
      const qs = new URLSearchParams({ url, name: name || '', status: 'unknown' })
      const target = new URL(window.location.href)
      target.search = ''
      target.hash = '#video-player?' + qs.toString()
      const win = new WebviewWindow('mark-video', {
        url: target.href, title: 'MARK — ' + (name || 'video'),
        width: 960, height: 620, resizable: true, maximizable: true,
      })
      await win.once('tauri://created', () => setPopOpen(true))
      await win.once('tauri://error', () => setPopOpen(false))
      await win.once('tauri://destroyed', () => { setPopOpen(false); setPopLinked(false) })
      setTimeout(async () => {
        try { const { emit } = await import('@tauri-apps/api/event'); await emit('mark:video-ping', { at: Date.now() }) } catch {}
      }, 900)
      setTimeout(async () => {
        try { const w = await WebviewWindow.getByLabel('mark-video'); if (w) setPopOpen(true) } catch {}
      }, 700)
    } catch (e) {
      console.error('[SELF-REVIEW][video] open failed:', e)
    }
  }

  async function closeVideoWindow() {
    setPopLinked(false)
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const w = await WebviewWindow.getByLabel('mark-video')
      if (w) await w.close()
    } catch {}
    setPopOpen(false)
  }

  // Listen for pong (confirms two-way link) and video time updates from pop-out
  useEffect(() => {
    let unPong = null, unTime = null, alive = true
    ;(async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unPong = await listen('mark:video-pong', () => { if (alive) setPopLinked(true) })
        // The pop-out emits mark:video-time so "Now" buttons stay accurate
        unTime = await listen('mark:video-time', ev => {
          if (alive) videoTimeSec.current = Math.floor((ev.payload?.sec ?? 0))
        })
      } catch {}
    })()
    return () => { alive = false; unPong?.(); unTime?.() }
  }, [])

  // ── Pick or reuse video file for the current match ────────────────────────
  async function handleOpenVideo() {
    const matchId = selectedHalf?.matchId
    if (!matchId) return

    // Try remembered path first (same key ReviewPage uses)
    let path = videoPath
    if (!path) {
      try { path = localStorage.getItem('mark_video_path_' + matchId) || '' } catch {}
    }
    // If nothing remembered, ask the user to pick
    if (!path) {
      try {
        path = await invoke('pick_video_file') || ''
        if (!path) return
        try { localStorage.setItem('mark_video_path_' + matchId, path) } catch {}
      } catch (e) {
        console.error('[SELF-REVIEW][video] pick failed:', e)
        return
      }
    }

    let url = videoUrl
    if (!url || !popOpen) {
      try { url = await invoke('get_video_url', { path }) } catch (e) {
        console.error('[SELF-REVIEW][video] get_video_url failed:', e)
        return
      }
    }
    const name = String(path).split(/[/\\]/).pop()
    setVideoPath(path); setVideoUrl(url); setVideoName(name)
    await openVideoWindow(url, name)
  }

  // ── Emit a seek to the pop-out ────────────────────────────────────────────
  async function seekTo(sec, label) {
    if (!popOpen) {
      // Not open yet — open first, then let the user click the seek button again
      await handleOpenVideo()
      return
    }
    try {
      const { emit } = await import('@tauri-apps/api/event')
      await emit('mark:video-seek', { ms: sec * 1000, label })
    } catch (e) {
      console.error('[SELF-REVIEW][video] seek failed:', e)
    }
  }

  // ── Scope helpers ─────────────────────────────────────────────────────────
  function toggleScope(code) {
    setSelectedScope(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
    // reset results when scope changes
    setLastRun(null)
  }

  // ── Rows helpers ──────────────────────────────────────────────────────────
  function addRow() { setRows(prev => [...prev, newRow()]) }
  function removeRow(id) { setRows(prev => prev.filter(r => r.id !== id)) }
  function updateRow(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  // ── Filtered event list for dropdowns ─────────────────────────────────────
  const eventList = (() => {
    const all = Object.values(EVENT_GROUPS).flat()
    if (!selectedScope.size) return all
    return all.filter(e => selectedScope.has(e.code))
  })()

  // ── Compare ───────────────────────────────────────────────────────────────
  async function runCompare() {
    if (!selectedHalf) { setStatus({ type:'error', msg:'Choose a match and half first.' }); return }
    if (isLocked) return  // locked halves show read-only view

    // Validate rows
    const incomplete = rows.filter(r =>
      (r.eventCode || r.min !== '' || r.sec !== '') && (!r.eventCode || collectorTsToSec(r.min, r.sec) == null)
    )
    if (incomplete.length) {
      setStatus({ type:'error', msg:`${incomplete.length} row${incomplete.length > 1 ? 's are' : ' is'} missing a time or an event. Complete or remove ${incomplete.length > 1 ? 'them' : 'it'}.` })
      return
    }
    const valid = rows.filter(r => r.eventCode && collectorTsToSec(r.min, r.sec) != null)
    if (!valid.length) {
      setStatus({ type:'error', msg:'Add at least one entry with a time and an event.' })
      return
    }

    setStatus({ type:'loading', msg:`Loading trainer review for ${selectedHalf.matchId} ${HALF_LABEL[selectedHalf.half]}…` })
    setLastRun(null)
    try {
      let trainerRows = await loadTrainerSheet(selectedHalf.sheetId, selectedHalf.matchId)
      // Filter trainer rows to selected scope (empty scope = all events)
      if (selectedScope.size) {
        trainerRows = trainerRows.filter(r => selectedScope.has(labelToCode(r.eventLabel)))
      }
      const { results, summary } = compare(valid, trainerRows, TOLERANCE_S)
      setLastRun({
        hrCode, matchId: selectedHalf.matchId, half: selectedHalf.half,
        results, summary, saved: false, readOnly: false,
        runId: null, savedAt: null,
      })
      setActiveFilter('all')
      setStatus(null)
    } catch (e) {
      setStatus({ type:'error', msg: e.message })
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function saveToSheet() {
    if (!lastRun || lastRun.saved || saving) return
    setSaving(true)
    const { matchId, half } = lastRun
    const lockId = `${hrCode}_${matchId}_${half}`

    setStatus({ type:'loading', msg:'Checking this half hasn\'t been saved yet…' })

    // Step a: Firestore transaction — create lock with status "pending" or abort.
    let runId, savedAt
    try {
      const lockRef = doc(db, LOCK_COLLECTION, lockId)
      await runTransaction(db, async tx => {
        const snap = await tx.get(lockRef)
        if (snap.exists()) {
          const d = snap.data()
          if (d.status === 'saved') throw Object.assign(new Error('already_saved'), { lockData: d })
          if (d.status === 'pending') throw Object.assign(new Error('pending_lock'), { lockData: d })
          throw Object.assign(new Error('already_saved'), { lockData: d })
        }
        runId   = `${hrCode}_${matchId}_${half}_${Date.now()}`
        savedAt = new Date().toISOString()
        tx.set(lockRef, {
          hr_code: hrCode, match_id: matchId, half, status: 'pending',
          run_id: runId, created_at: serverTimestamp(), saved_at: null,
        })
      })
    } catch (e) {
      setSaving(false)
      if (e.message === 'already_saved') {
        // Refresh saved map and show read-only view
        const saved = await loadSavedReviews(hrCode).catch(() => savedMap)
        setSavedMap(saved)
        setStatus({ type:'error', msg:'This half was already saved by another session, so this review wasn\'t saved. Your saved results are shown below.' })
        return
      }
      if (e.message === 'pending_lock') {
        setStatus({ type:'error', msg:'Your last save didn\'t finish — use Retry to complete it.' })
        return
      }
      setStatus({ type:'error', msg: `Couldn't create the save lock: ${e.message}` })
      return
    }

    // Step b: verify header + append rows.
    setStatus({ type:'loading', msg:`Saving ${lastRun.results.length} rows to the sheet…` })
    const sheetRows = buildSheetRows(lastRun, runId, savedAt)
    try {
      await verifySaveHeader()
      await appendSaveRows(sheetRows)
    } catch (e) {
      // Sheet write failed — update lock to failed and surface error.
      try {
        await updateDoc(doc(db, LOCK_COLLECTION, lockId), { status: 'failed', error: e.message })
      } catch (_) {}
      setSaving(false)
      setStatus({ type:'error', msg:`${e.message} — nothing was confirmed saved. Check the tab before retrying.` })
      return
    }

    // Step c: update lock to "saved".
    try {
      await updateDoc(doc(db, LOCK_COLLECTION, lockId), { status: 'saved', saved_at: serverTimestamp() })
    } catch (_) {
      // Non-fatal — sheet write succeeded.
      console.warn('[MARK SelfReview] Lock status update to "saved" failed (non-fatal).')
    }

    // Update local saved map and show read-only view.
    const updatedSaved = await loadSavedReviews(hrCode).catch(() => {
      const m = new Map(savedMap)
      m.set(selectedKey, sheetRows.map(r => r.map(v => String(v ?? ''))))
      return m
    })
    setSavedMap(updatedSaved)
    setLastRun(prev => ({ ...prev, saved: true, readOnly: true, runId, savedAt }))
    setSaving(false)
    setStatus({ type:'info', msg:`Saved ${sheetRows.length} rows. This half is now locked.` })
  }

  // ── Retry (pending lock) ──────────────────────────────────────────────────
  async function retryPendingSave() {
    if (!lastRun || saving) return
    const { matchId, half } = lastRun
    const lockId = `${hrCode}_${matchId}_${half}`
    setSaving(true)
    setStatus({ type:'loading', msg:'Checking what was saved before…' })
    try {
      const lockSnap = await getDoc(doc(db, LOCK_COLLECTION, lockId))
      if (!lockSnap.exists()) { setStatus({ type:'error', msg:'No pending lock found.' }); setSaving(false); return }
      const { run_id: runId, status: lockStatus } = lockSnap.data()
      if (lockStatus === 'saved') {
        const saved = await loadSavedReviews(hrCode)
        setSavedMap(saved)
        setStatus({ type:'info', msg:'This half is already saved.' })
        setSaving(false); return
      }
      // Check if the run_id row already made it to the sheet
      const alreadyInSheet = await savedRowsForRunId(runId)
      if (alreadyInSheet) {
        await updateDoc(doc(db, LOCK_COLLECTION, lockId), { status: 'saved', saved_at: serverTimestamp() })
        const saved = await loadSavedReviews(hrCode)
        setSavedMap(saved)
        setStatus({ type:'info', msg:'Found your rows in the sheet — lock updated. Half is now saved.' })
        setSaving(false); return
      }
      // Not in sheet — re-append
      setStatus({ type:'loading', msg:'Re-saving…' })
      const savedAt = new Date().toISOString()
      const sheetRows = buildSheetRows(lastRun, runId, savedAt)
      await verifySaveHeader()
      await appendSaveRows(sheetRows)
      await updateDoc(doc(db, LOCK_COLLECTION, lockId), { status: 'saved', saved_at: serverTimestamp() })
      const saved = await loadSavedReviews(hrCode)
      setSavedMap(saved)
      setLastRun(prev => ({ ...prev, saved: true, readOnly: true }))
      setStatus({ type:'info', msg:'Save completed. Half is now locked.' })
    } catch (e) {
      setStatus({ type:'error', msg: `Retry failed: ${e.message}` })
    } finally { setSaving(false) }
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  function downloadCSV() {
    if (!lastRun) return
    const runId  = lastRun.runId  || `${hrCode}_${lastRun.matchId}_${lastRun.half}_${Date.now()}`
    const savedAt= lastRun.savedAt|| new Date().toISOString()
    const rows   = buildSheetRows({ ...lastRun }, runId, savedAt)
    const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s }
    const csv = '\ufeff' + [SAVE_HEADER, ...rows].map(r => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `MARK_SelfReview_${lastRun.matchId}_${lastRun.half}_${hrCode}.csv`
    a.click()
  }

  // ── Build sheet rows (19 columns) ────────────────────────────────────────
  function buildSheetRows(run, runId, savedAt) {
    const s = run.summary
    return run.results.map(r => [
      runId, savedAt, run.hrCode, run.matchId, run.half,
      s.score == null ? '' : s.score,
      s.trainerTotal, s.matched, s.missed, s.collectorOnly,
      r.status, codeToLabel(r.code),
      fmtSec(r.tSec), fmtSec(r.cSec),
      r.delta == null ? '' : r.delta,
      r.tErr, r.cErr,
      // cols 18-19: wrong_event count (summary, repeated on every row), collector event label
      s.wrongEvent ?? 0,
      r.status === 'wrong_event' ? codeToLabel(r.collectorCode) : '',
    ])
  }

  // ── Render saved (read-only) view from saved rows ─────────────────────────
  function runFromSavedRows(half, rows) {
    const f   = rows[0]
    const num = v => (v === '' || v == null ? null : Number(v))
    return {
      hrCode, matchId: half.matchId, half: half.half,
      results: rows.map(r => ({
        status:        r[10],
        code:          labelToCode(r[11] || ''),
        // collectorCode: filled from col S (index 18) on wrong_event rows;
        // blank on rows saved by v7.12.8 (only 17 cols) → falls back to trainer code
        collectorCode: r[10] === 'wrong_event'
          ? labelToCode(r[18] || r[11] || '')
          : labelToCode(r[11] || ''),
        tSec:     trainerTsToSec(r[12]),
        cSec:     trainerTsToSec(r[13]),
        delta:    num(r[14]),
        tErr:     r[15] || '',
        cErr:     r[16] || '',
        unmapped: false,
      })),
      summary: {
        score:         num(f[5]),
        trainerTotal:  num(f[6]) || 0,
        matched:       num(f[7]) || 0,
        missed:        num(f[8]) || 0,
        collectorOnly: num(f[9]) || 0,
        // col R (index 17): wrong_event count — blank on v7.12.8 rows → treat as 0
        wrongEvent:    num(f[17]) || 0,
      },
      saved: true, readOnly: true, runId: f[0], savedAt: f[1],
    }
  }

  // When a saved half is selected, build the read-only run
  useEffect(() => {
    if (!selectedKey) return
    if (isLocked && savedRows) {
      setLastRun(runFromSavedRows(selectedHalf, savedRows))
      setActiveFilter('all')
    } else {
      setLastRun(null)
    }
  }, [selectedKey, isLocked])

  // ── Render ────────────────────────────────────────────────────────────────
  const filteredResults = lastRun
    ? (activeFilter === 'all' ? lastRun.results : lastRun.results.filter(r => r.status === activeFilter))
    : []

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <button style={S.backBtn} onClick={onBack}>←</button>
        <span style={S.title}>Self-Review</span>
        {hrCode && <span style={S.sub}>· {hrCode}</span>}
        <div style={{ flex:1 }}/>
        {selectedHalf && (
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {popOpen && (
              <span style={{ fontSize:10, color: popLinked ? '#30D158' : '#FFD60A',
                display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:6, height:6, borderRadius:'50%',
                  background: popLinked ? '#30D158' : '#FFD60A', flexShrink:0 }}/>
                {popLinked ? 'video linked' : 'linking…'}
              </span>
            )}
            <button
              onClick={popOpen ? closeVideoWindow : handleOpenVideo}
              style={{ ...S.btnGhost, padding:'5px 12px', fontSize:11 }}>
              {popOpen ? 'Close video' : videoPath ? 'Reopen video' : 'Open video'}
            </button>
          </div>
        )}
      </div>

      <div style={S.body}>
        {/* ── Half selector ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>Your half</div>
          {loadingHalves ? (
            <div style={{ fontSize:13, color:'var(--t-3)' }}>Loading your halves…</div>
          ) : halvesError ? (
            <div style={{ ...S.statusBar('error') }}>{halvesError}</div>
          ) : (
            <div>
              <label style={S.label}>Match and half</label>
              <select
                style={S.select}
                value={selectedKey}
                onChange={e => { setSelectedKey(e.target.value); setStatus(null); setRows([newRow()]); setLastRun(null) }}
              >
                {!halves.length && <option value=''>No halves assigned to {hrCode}</option>}
                {halves.map(h => (
                  <option key={h.key} value={h.key}>
                    {h.matchId} · {HALF_LABEL[h.half]}{savedMap.has(h.key) ? ' · reviewed' : ''}
                  </option>
                ))}
              </select>
              {!halves.length && !loadingHalves && (
                <div style={{ fontSize:12, color:'var(--t-3)', marginTop:8 }}>
                  No trainer reviews with a sheet link are assigned to {hrCode} yet.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Already-reviewed notice ── */}
        {isLocked && selectedHalf && (
          <div style={{ ...S.statusBar('info'), marginBottom:0, marginTop:-8 }}>
            <span>
              You reviewed {selectedHalf.matchId} · {HALF_LABEL[selectedHalf.half]}
              {savedRows?.[0]?.[1] ? ` on ${new Date(savedRows[0][1]).toLocaleString()}` : ''}.
              A half can be reviewed only once, so your saved results are shown below.
            </span>
          </div>
        )}

        {/* ── Scope picker (hidden when locked) ── */}
        {!isLocked && selectedHalf && (
          <div style={S.card}>
            <div style={S.cardTitle}>Events in scope</div>
            {Object.entries(EVENT_GROUPS).map(([group, events]) => (
              <div key={group} style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase',
                              color:'var(--p2)', marginBottom:8 }}>{group}</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                  {events.map(e => (
                    <div key={e.code} style={S.pill(selectedScope.has(e.code))} onClick={() => toggleScope(e.code)}>
                      {e.label}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display:'flex', gap:12, marginTop:6 }}>
              <button style={{ background:'none', border:'none', color:'var(--t-3)', fontSize:12, cursor:'pointer' }}
                onClick={() => { const all = Object.values(EVENT_GROUPS).flat(); setSelectedScope(new Set(all.map(e=>e.code))) }}>
                Select all
              </button>
              <button style={{ background:'none', border:'none', color:'var(--t-3)', fontSize:12, cursor:'pointer' }}
                onClick={() => setSelectedScope(new Set())}>
                Clear all
              </button>
            </div>
          </div>
        )}

        {/* ── Entry rows (hidden when locked) ── */}
        {!isLocked && selectedHalf && (
          <div style={S.card}>
            <div style={S.cardTitle}>Your review entries</div>
            {/* Column headers */}
            <div style={{ display:'grid', gridTemplateColumns:'140px 1fr 180px 32px', gap:8,
                          paddingBottom:8, borderBottom:'1px solid var(--b-1)', marginBottom:8 }}>
              {['Time (min : sec)', 'Event', 'Error type', ''].map((h, i) => (
                <span key={i} style={{ fontSize:11, fontWeight:600, color:'var(--t-3)',
                                       textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</span>
              ))}
            </div>
            {rows.map(row => (
              <div key={row.id}
                style={{ display:'grid', gridTemplateColumns:'140px 1fr 180px 32px', gap:8,
                         alignItems:'center', marginBottom:8 }}>
                {/* Time inputs + Now button */}
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <input type='number' min='0' max='130' placeholder='mm'
                    style={{ ...S.input, width:50 }}
                    value={row.min}
                    onChange={e => updateRow(row.id, 'min', e.target.value)}
                  />
                  <span style={{ color:'var(--t-3)', fontFamily:'monospace' }}>:</span>
                  <input type='number' min='0' max='59' placeholder='ss'
                    style={{ ...S.input, width:50 }}
                    value={row.sec}
                    onChange={e => {
                      const v = e.target.value
                      updateRow(row.id, 'sec', v !== '' && +v > 59 ? '59' : v)
                    }}
                  />
                  {/* "Now" — fills from video current time (whole seconds, ms dropped) */}
                  <button
                    title={popOpen ? 'Fill from video current time' : 'Open video first'}
                    onClick={() => {
                      if (!popOpen) { handleOpenVideo(); return }
                      const t = videoTimeSec.current
                      updateRow(row.id, 'min', String(Math.floor(t / 60)))
                      updateRow(row.id, 'sec', String(t % 60))
                    }}
                    style={{ width:28, height:28, borderRadius:6, flexShrink:0,
                      border: `1px solid ${popOpen ? 'var(--p2)' : 'var(--b-1)'}`,
                      background: popOpen ? 'rgba(232,89,12,0.1)' : 'none',
                      color: popOpen ? 'var(--p2)' : 'var(--t-3)',
                      fontSize:9, fontWeight:700, cursor:'pointer', lineHeight:1 }}>
                    Now
                  </button>
                </div>
                {/* Event */}
                <select style={S.select} value={row.eventCode}
                  onChange={e => updateRow(row.id, 'eventCode', e.target.value)}>
                  <option value=''>Select event…</option>
                  {eventList.map(e => (
                    <option key={e.code} value={e.code}>{e.label}</option>
                  ))}
                </select>
                {/* Error type */}
                <select style={S.select} value={row.errorType}
                  onChange={e => updateRow(row.id, 'errorType', e.target.value)}>
                  {ERROR_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                {/* Remove */}
                <button onClick={() => removeRow(row.id)}
                  style={{ width:28, height:28, borderRadius:6, border:'1px solid var(--b-1)',
                           background:'none', color:'var(--t-3)', cursor:'pointer', fontSize:16,
                           display:'flex', alignItems:'center', justifyContent:'center' }}>
                  ×
                </button>
              </div>
            ))}
            <button style={S.btnAdd} onClick={addRow}>
              <span style={{ fontSize:14 }}>+</span> Add row
            </button>
          </div>
        )}

        {/* ── Actions (hidden when locked) ── */}
        {!isLocked && selectedHalf && (
          <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
            <button style={{ ...S.btnPrimary, opacity: saving ? 0.5 : 1 }}
              onClick={runCompare} disabled={saving}>
              Compare with trainer
            </button>
            <button style={S.btnGhost} onClick={() => { setRows([newRow()]); setLastRun(null); setStatus(null) }}>
              Clear entries
            </button>
          </div>
        )}

        {/* ── Status bar ── */}
        {status && (
          <div style={S.statusBar(status.type)}>
            {status.type === 'loading' && (
              <span style={{ width:14, height:14, border:'2px solid rgba(88,166,255,0.3)',
                             borderTopColor:'#58a6ff', borderRadius:'50%', flexShrink:0,
                             animation:'spin 0.7s linear infinite', display:'inline-block' }}/>
            )}
            <span>{status.msg}</span>
            {status.type === 'error' && status.msg.includes('didn\'t finish') && (
              <button style={{ ...S.btnGhost, marginLeft:'auto', padding:'4px 12px', fontSize:12 }}
                onClick={retryPendingSave} disabled={saving}>
                Retry
              </button>
            )}
          </div>
        )}

        {/* ── Results ── */}
        {lastRun && (
          <div>
            <div style={{ height:1, background:'var(--b-1)', margin:'20px 0' }}/>
            <div style={S.card}>
              {/* Results header */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                            flexWrap:'wrap', gap:12, marginBottom:18 }}>
                <div style={S.cardTitle} >Comparison results</div>
                <div style={{ display:'flex', gap:10 }}>
                  {!lastRun.readOnly && (
                    <button
                      style={{ ...S.btnPrimary, opacity: lastRun.saved || saving ? 0.5 : 1 }}
                      disabled={lastRun.saved || saving}
                      onClick={saveToSheet}>
                      {lastRun.saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save to sheet'}
                    </button>
                  )}
                  <button style={S.btnGhost} onClick={downloadCSV}>Download CSV</button>
                </div>
              </div>

              {/* Score hero */}
              {(() => {
                const s = lastRun.summary
                const sc = s.score
                const color = sc == null ? 'var(--t-2)' : sc >= 80 ? '#4caf82' : sc >= 50 ? '#d29922' : '#e05c5c'
                return (
                  <div style={{ display:'flex', alignItems:'baseline', gap:14, flexWrap:'wrap',
                                padding:'16px 18px', marginBottom:18, border:'1px solid var(--b-1)',
                                borderRadius:10, background:'var(--bg-3)' }}>
                    <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:44,
                                   fontWeight:600, color, lineHeight:1 }}>
                      {sc == null ? '—' : `${sc}%`}
                    </span>
                    <span style={{ fontSize:12, color:'var(--t-3)' }}>
                      100% − (missed {s.missed} + wrong event {s.wrongEvent ?? 0} + only you {s.collectorOnly}) ÷ trainer errors {s.trainerTotal}
                      {!s.trainerTotal ? ' — no trainer errors in scope' : ''}
                    </span>
                  </div>
                )
              })()}

              {/* Counter blocks */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:18 }}>
                {[
                  ['Matched',       lastRun.summary.matched,            '#4caf82'],
                  ['Wrong event',   lastRun.summary.wrongEvent ?? 0,    '#d29922'],
                  ['Missed',        lastRun.summary.missed,             '#e05c5c'],
                  ['Only you',      lastRun.summary.collectorOnly,      '#58a6ff'],
                  ['Trainer errors',lastRun.summary.trainerTotal,       'var(--t-1)'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ background:'var(--bg-3)', border:'1px solid var(--b-1)',
                                            borderRadius:8, padding:'14px 12px', textAlign:'center' }}>
                    <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize:28,
                                  fontWeight:700, color, lineHeight:1.1, marginBottom:4 }}>{val}</div>
                    <div style={{ fontSize:11, color:'var(--t-3)', textTransform:'uppercase',
                                  letterSpacing:'0.08em' }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Filter row */}
              <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
                {[
                  ['all',            'All',         lastRun.results.length],
                  ['matched',        'Matched',     lastRun.summary.matched],
                  ['wrong_event',    'Wrong event', lastRun.summary.wrongEvent ?? 0],
                  ['missed',         'Missed',      lastRun.summary.missed],
                  ['collector_only', 'Only you',    lastRun.summary.collectorOnly],
                ].map(([k, label, count]) => (
                  <button key={k}
                    style={{ padding:'5px 12px', borderRadius:20, border:'1px solid var(--b-1)',
                             background: activeFilter===k ? 'rgba(232,89,12,0.12)' : 'none',
                             color: activeFilter===k ? 'var(--p2)' : 'var(--t-2)',
                             fontSize:12, fontWeight:500, cursor:'pointer' }}
                    onClick={() => setActiveFilter(k)}>
                    {label} ({count})
                  </button>
                ))}
              </div>

              {/* Results table */}
              <div style={{ overflowX:'auto', borderRadius:8, border:'1px solid var(--b-1)' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                  <thead>
                    <tr>
                      {['#','Status','Event','','Trainer time','','Your time','Δ','Trainer error type','Your error type'].map((h, hi) => (
                        <th key={h} style={{ background:'var(--bg-3)', padding:'9px 12px', textAlign:'left',
                                             fontSize:11, fontWeight:600, color:'var(--t-3)',
                                             letterSpacing:'0.07em', textTransform:'uppercase',
                                             borderBottom:'1px solid var(--b-1)', whiteSpace:'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.length === 0 ? (
                      <tr><td colSpan={8} style={{ textAlign:'center', padding:28, color:'var(--t-3)', fontSize:13 }}>
                        No rows in this filter
                      </td></tr>
                    ) : filteredResults.map((r, i) => {
                      const label = {
                        matched:'Matched', wrong_event:'Wrong event',
                        missed:'Missed', collector_only:'Only you',
                      }[r.status] || r.status
                      const delta = r.delta == null ? '—'
                        : <span style={{ fontFamily:'monospace', fontSize:11,
                                         color: Math.abs(r.delta) <= 1 ? '#4caf82' : '#d29922' }}>
                            {r.delta > 0 ? '+' : ''}{r.delta}s
                          </span>
                      return (
                        <tr key={i} style={{ borderBottom:'1px solid var(--b-1)' }}>
                          <td style={{ padding:'9px 12px', color:'var(--t-3)', fontFamily:'monospace', fontSize:11 }}>{i+1}</td>
                          <td style={{ padding:'9px 12px' }}>
                            <span style={S.badge(r.status)}>{label}</span>
                            {r.unmapped && (
                              <span style={{ marginLeft:6, fontSize:10, color:'#d29922', fontStyle:'italic' }}>unmapped event</span>
                            )}
                          </td>
                          <td style={{ padding:'9px 12px', fontWeight:500 }}>
                            {codeToLabel(r.code)}
                            {r.status === 'wrong_event' && r.collectorCode && r.collectorCode !== r.code && (
                              <div style={{ fontSize:11, color:'#d29922', marginTop:2 }}>
                                You: {codeToLabel(r.collectorCode)}
                              </div>
                            )}
                          </td>
                          {/* Seek button — Trainer time */}
                          <td style={{ padding:'3px 2px 3px 4px' }}>
                            {r.tSec != null && (
                              <button
                                title={popOpen ? `Seek to ${fmtSec(r.tSec)}` : 'Open video to seek'}
                                onClick={async e => {
                                  await seekTo(r.tSec, codeToLabel(r.code))
                                  setSeekRow(i)
                                  setTimeout(() => setSeekRow(x => x === i ? -1 : x), 2200)
                                  e.currentTarget.closest('tr')?.scrollIntoView({ block:'center', behavior:'smooth' })
                                }}
                                style={{ width:19, height:19, borderRadius:4, padding:0,
                                  cursor:'pointer', fontSize:8, lineHeight:1,
                                  background:'rgba(232,89,12,0.14)', border:'1px solid var(--p2)',
                                  color:'var(--p2)' }}>▶</button>
                            )}
                          </td>
                          <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11,
                            color:'var(--t-2)',
                            background: seekRow === i ? 'rgba(232,89,12,0.13)' : 'transparent',
                            transition:'background .4s' }}>
                            {r.tSec != null ? fmtSec(r.tSec) : '—'}
                          </td>
                          {/* Seek button — Your time */}
                          <td style={{ padding:'3px 2px 3px 4px' }}>
                            {r.cSec != null && (
                              <button
                                title={popOpen ? `Seek to ${fmtSec(r.cSec)}` : 'Open video to seek'}
                                onClick={async e => {
                                  await seekTo(r.cSec, codeToLabel(r.collectorCode || r.code))
                                  setSeekRow(i)
                                  setTimeout(() => setSeekRow(x => x === i ? -1 : x), 2200)
                                  e.currentTarget.closest('tr')?.scrollIntoView({ block:'center', behavior:'smooth' })
                                }}
                                style={{ width:19, height:19, borderRadius:4, padding:0,
                                  cursor:'pointer', fontSize:8, lineHeight:1,
                                  background:'rgba(88,166,255,0.14)', border:'1px solid #58a6ff',
                                  color:'#58a6ff' }}>▶</button>
                            )}
                          </td>
                          <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11, color:'var(--t-2)' }}>
                            {r.cSec != null ? fmtSec(r.cSec) : '—'}
                          </td>
                          <td style={{ padding:'9px 12px' }}>{delta}</td>
                          <td style={{ padding:'9px 12px', fontSize:11, color:'var(--t-2)', fontStyle:'italic' }}>{r.tErr || '—'}</td>
                          <td style={{ padding:'9px 12px', fontSize:11, color:'var(--t-2)', fontStyle:'italic' }}>{r.cErr || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
