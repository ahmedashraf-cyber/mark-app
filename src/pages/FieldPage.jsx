/**
 * FieldPage.jsx — FIELD mode data collection
 * ============================================================================
 * v4 — possession engine: team inferred from possession state, not prompted.
 *      Manual override: key 0 flips possession. teamSource stored on every event.
 *      Explicit team prompt kept only for: Half start, Card, Substitution,
 *      Tactical Shift, Formation, Fifty Fifty.
 *
 * FILES MODIFIED (Scout/Audit untouched):
 *   src/utils/fieldExtras.js   — possession rules added
 *   src/pages/FieldPage.jsx    — this file
 *   src/utils/exportFieldSession.js — team_source, possession columns
 *
 * DATA: writes to mark_collected_events (never mark_error_tags).
 *   mode:'field', source:'field' on every document.
 */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { db } from '../firebase/config'
import { collection, updateDoc, doc, setDoc,
         getDocs, getDocsFromServer, query, where, serverTimestamp, deleteDoc, writeBatch } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import { runChain, teamDecision, receptionAllowed, validTypes, inheritedReceptionTeam } from '../utils/phaseChain'
import { findAtTime, pastCountAt, EVENT_HIGHLIGHT_TOLERANCE_S } from '../utils/eventHighlight'
import PerfOverlay, { perfEnabled } from '../components/PerfOverlay'
import { videoSrcFor } from '../utils/videoSrc'
import { createSource } from '../utils/comparisonSource'
import ErrorTimeline from '../components/ErrorTimeline'
import EventsSidebar from '../components/EventsSidebar'
import TaggedEventsList from '../components/TaggedEventsList'
import { downloadFieldCsv, syncSessionToSheet, findOwnSavedHalf } from '../utils/fieldSheetSync'
import { matchSummaryLine } from '../utils/tagMatchLine'
import { showToast } from '../utils/toast'
import { FIELD_LS_KEY, FIELD_SHEET_ID, validateMatchId } from '../config/fieldConfig'
import { importModelAnswers, isModelImportDone } from '../utils/importModelAnswers'
import { useInternalUser } from '../hooks/useAdmin.js'
import {
  FIELD_EVENTS, EVENT_BY_ID, EVENT_BY_KEY,
  OPEN_STATE_PAIRS, TRANSPARENT_EVENT_IDS,
  OPTIONS, PASS_TYPE_OPTIONS, inferPassType,
  POSSESSION_RULES, resolveTeam, applyFlip, getGroupOptions,
  needsExplicitTeam, teamNotMeaningful, getMiscommunicationTeam,
} from '../utils/fieldExtras'

// ─── Session helpers ──────────────────────────────────────────────────────────
function hashPath(p) {
  try { return btoa(encodeURIComponent(p)).replace(/[/+=]/g,'').slice(0,14) }
  catch { return String(Date.now()).slice(-10) }
}
function loadLocalSessions() { try { return JSON.parse(localStorage.getItem(FIELD_LS_KEY)||'[]') } catch { return [] } }
function saveLocalSession(s) {
  const all = loadLocalSessions().filter(x => x.sessionId !== s.sessionId)
  localStorage.setItem(FIELD_LS_KEY, JSON.stringify([s,...all].slice(0,50)))
}
function clearLocalSession(sessionId) {
  const all = loadLocalSessions().filter(s => s.sessionId !== sessionId)
  localStorage.setItem(FIELD_LS_KEY, JSON.stringify(all))
}
function findSessionByPath(p) { return loadLocalSessions().find(s => s.videoPath===p && s.status!=='completed')||null }
function basename(p) { return p ? (p.split(/[\\/]/).pop()||p) : 'Untitled' }

// ─── Capture state machine ────────────────────────────────────────────────────
// idle → type_confirm (pass only) → group:N → team → commit
// Each group step collects selections for that group, then advances.

// KEYS for group option selection (per spec: verbatim toggleKey, not remapped)
// The keyboard handler maps the *group's* toggleKey list, not a global array.

/**
 * Options for a group, minus any whose conditions are not met.
 *
 * WHY THIS EXISTS
 * `conditionalOn` gates a WHOLE GROUP on the selection COUNT of another group —
 * that is what Tackle's Side uses. It cannot express "add Aerial to Extras when
 * body part is Head", because that is a single OPTION appearing on the basis of
 * a selected VALUE. So options may now carry:
 *
 *   visibleWhen: [{ groupId, anyOf: ['CODE', ...] }, ...]
 *
 * ALL entries must match (AND), and within one entry any listed code matches
 * (OR). That covers both cases asked for:
 *   Aerial  — visibleWhen: [{ groupId:'body_part', anyOf:[BODY_HEAD] }]
 *   Launch  — visibleWhen: [{ groupId:'height',    anyOf:[HEIGHT_HIGH] },
 *                           { groupId:'body_part', anyOf:[L_FOOT, R_FOOT] }]
 *
 * An option with no visibleWhen always shows, so every existing option is
 * unaffected.
 *
 * `collected` is the groups answered so far; `live` is the in-progress
 * selection for the current group, needed when the condition refers to the
 * group being edited right now.
 */
// ─── Open-state helpers ───────────────────────────────────────────────────────
function getCloseAction(openStates, key) {
  // Returns the close pair if this key would close an open state
  for (const pair of OPEN_STATE_PAIRS) {
    if (pair.closeKey === key && openStates[pair.openId]) return pair
  }
  return null
}
function wouldOpenConflict(openStates, eventDef) {
  // Returns a message if pressing this event is blocked
  // Open states do NOT block each other — they only matter for their close key
  // (per spec: "open states overlap, don't block each other")
  return null
}

// ─── Team prompt ──────────────────────────────────────────────────────────────
// 1 = Home, 2 = Away — the only keys, in BOTH collection methods. H and A used to
// work as well, but they are event hotkeys too (H = Hold up duel, A = Tackle): a
// letter meant as the NEXT event, pressed while a prompt was still open, was
// silently taken as a team for the PREVIOUS one. Digits cannot be mistaken for an
// event, so a stray letter now simply does nothing.
const TEAM_OPTIONS = [
  { code:'home', label:'Home', key:'1', color:'#0A84FF', bg:'rgba(10,132,255,0.15)' },
  { code:'away', label:'Away', key:'2', color:'#E8590C', bg:'rgba(232,89,12,0.15)'  },
]

// How long a write may take before the collector is told, and before the lock is
// let go so a dead network cannot freeze collection. The write itself is not
// cancelled: it stays queued and, because the id is client-side, can only ever
// land once.
const WRITE_WAIT_MS = 2000
const LOCK_CAP_MS   = 10000
const EVENTS_COL    = 'mark_collected_events'
const byTime = (a, b) => (a.videoTimeSec || 0) - (b.videoTimeSec || 0)
/** Local-only fields (_status, _error, _docId) never go to Firestore. */
const stripLocal = e => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('_')))

/** The start screen's Part → the Half stored on the session and matched on. */
const PART_TO_HALF = { 1:'1H', 2:'2H', 3:'ET1', 4:'ET2', 5:'PEN' }
export const partToHalf = part => PART_TO_HALF[Number(part)] || ''

/**
 * Does a model answer exist for this match and half?
 *
 * A model answer counts unless its status explicitly says otherwise: approved
 * and BLANK are valid (blank covers older and imported answers), anything else
 * — draft, rejected, or a status added later — is not. So a future draft stage
 * is blocked automatically, with no code change.
 */
async function lookupModelAnswer(matchId, half) {
  const src = createSource()
  const m = await src.findSession({ matchId, half, isModel: true })
  if (!m) return null
  const status = String(m.model_status || '').trim().toLowerCase()
  if (status && status !== 'approved') return null
  return { home: m.home_team_name || '', away: m.away_team_name || '' }
}

/**
 * The End stoppage entry in the OFFENSE panel — directly under Stoppage, click only (no hotkey).
 * Enabled only while a Stoppage is open; otherwise greyed, and it says why.
 */
function EndStoppageItem({ open, onClick }) {
  return (
    <div data-testid="end-stoppage" data-open={open ? '1' : '0'} aria-disabled={!open}
      onClick={open ? onClick : undefined}
      title={open ? 'Close the open stoppage' : 'No open stoppage'}
      className={`event-card mouse-only`}
      style={{ cursor: open ? 'pointer' : 'not-allowed', opacity: open ? 1 : 0.4,
        borderLeft: open ? '2px solid var(--p2)' : '2px solid transparent' }}>
      <span style={{ fontSize: 12, color: open ? 'var(--p2)' : 'var(--t-3)', fontWeight: open ? 700 : 400, fontFamily: 'DM Sans, sans-serif' }}>
        End stoppage
      </span>
      <span style={{ fontSize: 9, color: 'var(--t-3)', fontStyle: 'italic', opacity: 0.7 }}>
        {open ? 'click' : 'No open stoppage'}
      </span>
    </div>
  )
}

export default function FieldPage({ session: initialSession, onDone, onBack }) {
  const { profile, role, caps, roleInfo } = useAuth()
  // Gates the model-answer checkbox. Operators only: a model answer becomes the
  // reference every collector is scored against, so a collector must not be
  // able to record one. Previously any @hudl.com address could.
  // caps already has the Role Access Manager's overrides applied.
  const isInternal = caps.scout
  const videoRef      = useRef(null)
  const isDraggingRef = useRef(false)
  const collStartRef  = useRef(null)  // wall-clock of first event this sitting

  // ── Video ──────────────────────────────────────────────────────────────────
  const [videoLoaded,  setVideoLoaded]  = useState(false)
  const [videoPath,    setVideoPath]    = useState(null)
  const [videoError,   setVideoError]   = useState(null)
  const [playing,      setPlaying]      = useState(false)
  const [muted,        setMuted]        = useState(false)
  const [speed,        setSpeed]        = useState(1)
  const [currentTime,  setCurrentTime]  = useState(0)
  const [duration,     setDuration]     = useState(0)
  const [activeKey,    setActiveKey]    = useState(null)

  // ── Session & events ───────────────────────────────────────────────────────
  const [session,      setSession]      = useState(initialSession || null)
  // ── Collection method ────────────────────────────────────────────────────
  // 'partial' = Not all events: MARK exactly as before, every event asks.
  // 'all'     = All events: the phase chain runs and teams are inferred.
  // Chosen on a screen before the video, with no default.
  const [collectionMethod, setCollectionMethod] = useState(initialSession?.collectionMethod || null)
  const [matchPart, setMatchPart] = useState(initialSession?.part ? String(initialSession.part) : null)
  // Separate from the two choices: picking both must NOT dismiss the screen —
  // only Continue does, and Continue is what writes them onto the session.
  const [methodConfirmed, setMethodConfirmed] = useState(
    !!(initialSession?.collectionMethod && initialSession?.part))
  const allEvents = collectionMethod === 'all'
  // Match ID is chosen on the start screen now, and checked against the model
  // answers before collection can begin.
  const [startMatchId, setStartMatchId] = useState(initialSession?.matchId ? String(initialSession.matchId) : '')
  // idle | checking | found | none | error
  const [modelCheck, setModelCheck] = useState({ state:'idle' })
  // Has THIS collector already saved this half of this match? idle | checking | none | found | unverified
  // (unverified = the sheet could not be read, so only this PC's own list was checked; it never blocks.)
  // A 'found' needs one deliberate click (dupAck) before Continue works.
  const [dupCheck, setDupCheck] = useState({ state:'idle' })
  const [dupAck, setDupAck] = useState(false)

  // Runs once both Match ID and Part are set. Debounced so typing a match ID
  // doesn't query the sheet on every keystroke; `live` discards an answer for
  // an ID the collector has since changed.
  useEffect(() => {
    if (methodConfirmed) return
    const id = startMatchId.trim()
    if (!id || !matchPart) { setModelCheck({ state:'idle' }); return }
    let live = true
    setModelCheck({ state:'checking' })
    const t = setTimeout(async () => {
      try {
        const m = await lookupModelAnswer(id, partToHalf(matchPart))
        if (live) setModelCheck(m ? { state:'found', ...m } : { state:'none' })
      } catch (e) {
        // The sheet could not be reached — usually offline. Collection may
        // continue, and the session is flagged as unverified.
        if (live) setModelCheck({ state:'error', message: e?.message || String(e) })
      }
    }, 500)
    return () => { live = false; clearTimeout(t) }
  }, [startMatchId, matchPart, methodConfirmed])

  // Same moment as the model-answer check: once Match ID and Part are both set. Changing either one withdraws a
  // previous acknowledgement, so the click always refers to what is on screen now.
  useEffect(() => {
    setDupAck(false)
    if (methodConfirmed) return
    const id = startMatchId.trim(), hr = String(roleInfo?.code || '').trim()
    if (!id || !matchPart || !hr) { setDupCheck({ state:'idle' }); return }
    let live = true
    setDupCheck({ state:'checking' })
    const t = setTimeout(async () => {
      const r = await findOwnSavedHalf({ matchId:id, half:partToHalf(matchPart), hrCode:hr, local:loadLocalSessions() })
      if (live) setDupCheck(r.found ? { state:'found', sessionId:r.sessionId } : { state: r.verified ? 'none' : 'unverified' })
    }, 600)
    return () => { live = false; clearTimeout(t) }
  }, [startMatchId, matchPart, methodConfirmed])

  // Collectors need a model answer. People with model answer access never
  // need one — they may be creating the first. An unreachable sheet does not
  // block: it is flagged instead.
  const modelOk = modelCheck.state === 'found' || modelCheck.state === 'error'
    || (modelCheck.state === 'none' && !!caps.modelAnswer)
  const modelExists = modelCheck.state === 'found'
  const [events,       setEvents]       = useState([])  // committed events

  // ── Saving, and the lock that stops duplicates ───────────────────────────
  // A SYNCHRONOUS ref, not state: two keydowns inside one frame both run the
  // same stale handler closure, so state would not have changed between them.
  const commitLockRef   = useRef(false)
  const lockOwnerRef    = useRef(0)         // which commit holds the lock; a late ack must not release a newer one
  const lockTokenRef    = useRef(0)
  const pendingWritesRef = useRef(new Map())   // event id -> Promise of its Firestore write
  const deletedWhilePendingRef = useRef(new Set())
  const busyTimerRef    = useRef(0)
  const [saveUi, setSaveUi] = useState(null)    // null | { kind:'saving' | 'waiting' }
  const eventsRef       = useRef([])
  eventsRef.current = events
  const openStatesRef   = useRef({})
  const sessionRef      = useRef(null)
  sessionRef.current = session
  const renderCountRef  = useRef(0)
  renderCountRef.current++

  // ── Edit, Clear all, Done verification ───────────────────────────────────
  const editOriginalRef = useRef(null)      // the saved event being re-tagged; stays in Firestore until its replacement is saved
  const editingRef      = useRef(null)
  const autoShotRef     = useRef(false)     // the shot type was filled in by the chain, not asked
  const [allowedPassTypes, setAllowedPassTypes] = useState(null)   // codes the phase allows, or null = all
  const [showClearModal, setShowClearModal] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState('')
  const [verifyState, setVerifyState] = useState(null)   // null | {status:'checking'|'ok'|'repaired'|'blocked'|'offline', missing, total}

  // ── The video clock ──────────────────────────────────────────────────────
  // The video element is the clock. Its time lives in refs; React state is only
  // the DISPLAY, refreshed at most 10 times a second and only when it changed.
  // Re-rendering the page on every raw timeupdate (and on every seek of a held
  // arrow key) is what made playback stutter.
  const seekTargetRef  = useRef(null)       // latest requested position, applied once per animation frame
  const seekRafRef     = useRef(0)
  const lastSyncRef    = useRef({ at: 0, shown: -1 })
  const [highlightIds, setHighlightIds] = useState([])
  const [highlightNearest, setHighlightNearest] = useState(null)
  const [pastCount, setPastCount] = useState(0)
  const hlKeyRef = useRef(''), hlNearestRef = useRef(null), pastRef = useRef(0)
  const wasPlayingRef = useRef(false), resumeAfterSeekRef = useRef(false)

  // ── The phase chain (All events only) ────────────────────────────────────
  // "Mine" is the team that kicked off: the team on the latest half start.
  // The phase is RECOMPUTED from the events every render, never stored, so it
  // cannot drift after an edit, delete or reload.
  const mineTeam = useMemo(() => {
    if (!allEvents) return null
    const ks = events.filter(e => e.eventId === 'half_start' && e.team)
    return ks.length ? ks[ks.length - 1].team : null
  }, [allEvents, events])
  const toRel = t => (!mineTeam || !t) ? null : (t === mineTeam ? 'mine' : 'opponent')
  const toAbs = r => !mineTeam ? null : r === 'mine' ? mineTeam
    : (mineTeam === 'home' ? 'away' : 'home')
  const passTypeCode = t => (t && typeof t === 'object') ? (t.code || '') : (t || '')
  const toChainEvent = e => ({
    code: e.eventId, team: toRel(e.team), groups: e.groups || [],
    passType: passTypeCode(e.type),
  })
  const chainPart = Number(matchPart) || 1
  const chain = useMemo(() => allEvents
    ? runChain(events.map(toChainEvent), { part: chainPart }) : [],
    // toChainEvent depends only on mineTeam, already in the dependency list
    [allEvents, events, mineTeam, chainPart])
  const currentPhase = chain.length ? chain[chain.length - 1].phaseAfter : 'preHalf'

  // ── Possession state ───────────────────────────────────────────────────────
  // { team: 'home'|'away'|null, certain: boolean }
  // null = not yet set (before first Half start)
  // certain=false = uncertain (Block/Clearance/Punch/Miscontrol etc.)
  const [possession,   setPossession]   = useState({ team: null, certain: false })

  // The keydown handler's dependency array (see the effect near the bottom of
  // this file) does not — and should not — list `possession`: re-registering
  // the listener on every flip would tear down and rebuild it mid-capture.
  // But that meant the handler closed over a STALE possession, so pressing 0
  // updated the header chip (which re-renders) while resolveTeam() inside the
  // handler still saw the old team and stored it on the event. Header moved,
  // event did not.
  //
  // A ref is read at call time, never captured, so the two can no longer
  // disagree. Every read inside the handler goes through possessionRef;
  // rendering still reads `possession` so the UI stays reactive.
  const possessionRef = useRef({ team: null, certain: false })
  // What to do once the collector has chosen a side. A ref, not state, because
  // chooseTeam reads it in the same tick the keypress sets the step.
  const afterTeamRef = useRef(null)
  useEffect(() => { possessionRef.current = possession }, [possession])

  // ── Capture state machine ──────────────────────────────────────────────────
  // step: 'idle' | 'type_confirm' | 'group' | 'team'
  const [captureStep,      setCaptureStep]      = useState('idle')
  const [pendingEvent,     setPendingEvent]      = useState(null)
  const [pendingVideoTime, setPendingVideoTime]  = useState(0)
  const [pendingType,      setPendingType]       = useState(null)
  const [pendingTypeSource,setPendingTypeSource] = useState(null)
  const [resolvedVariant,  setResolvedVariant]   = useState(null)
  const [groupIndex,       setGroupIndex]        = useState(0)
  const [groupChain,       setGroupChain]        = useState([])
  const [collectedGroups,  setCollectedGroups]   = useState([])
  const [currentSelections,setCurrentSelections] = useState([])
  // Team resolved from possession (shown in panel, used at commit)
  const [pendingTeam,      setPendingTeam]       = useState(null)
  const [pendingTeamSource,setPendingTeamSource] = useState(null)

  // ── Open states ────────────────────────────────────────────────────────────
  // { eventId → { event, team, videoTimeSec } }
  const [openStates, setOpenStates] = useState({})
  openStatesRef.current = openStates

  // ── Flash ──────────────────────────────────────────────────────────────────
  const [flashEvent,  setFlashEvent]  = useState(null)
  const [flashError,  setFlashError]  = useState(null)  // blocked keypress message

  const [modelImportStatus, setModelImportStatus] = useState(null) // null | 'running' | 'done' | 'error'
  const [modelImportMsg,    setModelImportMsg]    = useState('')
  const [showDoneModal, setShowDoneModal] = useState(false)
  const [submitting,    setSubmitting]   = useState(false)

  // Save metadata fields (entered by collector before upload)
  const [saveMatchId,    setSaveMatchId]    = useState('')
  const [saveHalf,       setSaveHalf]       = useState('')
  const [saveHrCode,     setSaveHrCode]     = useState('')
  const [saveHomeTeam,   setSaveHomeTeam]   = useState('')
  const [saveAwayTeam,   setSaveAwayTeam]   = useState('')
  const [isModelAnswer,  setIsModelAnswer]  = useState(false)
  const [saveMatchError, setSaveMatchError] = useState('')

  // Upload result state
  const [saveResult, setSaveResult] = useState(null)
  // { status:'success'|'failed', message, rowsWritten?, duplicateHalfWarning? }

  const eventSeqRef   = useRef(0)   // monotonic per session, incremented at every commitEvent
  const openPairsRef  = useRef({})  // { eventId → { pair_id, videoTimeMs, event_seq } }

  // Pending-upload session (loaded on mount if exists)
  const [pendingUpload, setPendingUpload] = useState(null)

  // ── Load events on session load ────────────────────────────────────────────
  useEffect(() => {
    if (!session?.sessionId) return
    getDocs(query(collection(db,'mark_collected_events'),where('sessionId','==',session.sessionId)))
      .then(snap => setEvents(snap.docs.map(d=>({...d.data(),_docId:d.id})).sort((a,b)=>a.videoTimeSec-b.videoTimeSec)))
      .catch(e => console.warn('[MARK Field] load events:',e))
  }, [session?.sessionId])

  // ── On mount: start fresh. Check for pending uploads from previous sessions ──
  // FIELD opens empty and ready to collect.
  // If a previous session has status='pending_sheet_upload', show retry prompt.
  useEffect(() => {
    if (session) return  // already have a session from initialSession prop
    const pending = loadLocalSessions().find(s => s.status === 'pending_sheet_upload')
    if (pending) {
      setPendingUpload(pending)
    }
    // Do NOT auto-restore in-progress sessions — FIELD opens fresh.
  }, [])

  // ── Session creation ───────────────────────────────────────────────────────
  async function ensureSession(path) {
    const existing = findSessionByPath(path)
    if (existing) { setSession(existing); return existing }
    const sessionId = `field_${profile.uid}_${hashPath(path)}_${Date.now()}`
    const s = {
      sessionId, videoPath:path, videoName:basename(path),
      mode:'field', source:'field',
      collectorId:profile.uid, collectorEmail:profile.email,
      collectorName:profile.displayName||profile.email.split('@')[0],
      status:'in_progress', startedAt:new Date().toISOString(),
      totalEvents:0, accumulatedMs:0,
      collectionStartWallMs:null, collectionEndWallMs:null,
      // The session is created on video load, AFTER the method screen, so the
      // choice is stamped here — otherwise it would never reach the sheet.
      collectionMethod: collectionMethod || null,
      part: matchPart ? Number(matchPart) : null,
    }
    try { await setDoc(doc(db,'mark_field_sessions',sessionId),{...s,startedAt:serverTimestamp()}) }
    catch(e) { console.warn('[MARK Field] session create:',e) }
    saveLocalSession(s); setSession(s); return s
  }

  // ── Video loading ──────────────────────────────────────────────────────────
  async function handleVideoFile(forcedPath) {
    try {
      const path = forcedPath || await invoke('pick_video_file')
      if (!path) return
      setVideoError(null)
      const url = await invoke('get_video_url',{path})
      setVideoPath(path)
      const v = videoRef.current
      // Tag mode uses the server's chunked path (bounded responses, so a seek no longer waits for a read of the rest of
      // the file); see utils/videoSrc.js for the switches (mark_video_legacy, mark_perf). No other screen does this.
      if (v) { v.src = videoSrcFor(url); v.load(); setVideoLoaded(true) }
      // Fetch file size for video identity (non-blocking — failures are non-fatal)
      let sizeBytes = null
      try { sizeBytes = await invoke('get_file_size', { path }) } catch(e) { console.warn('[MARK Field] get_file_size:', e) }
      const sess = await ensureSession(path)
      if (sizeBytes && sess) {
        const updated = { ...sess, videoSizeBytes: sizeBytes }
        setSession(updated); saveLocalSession(updated)
      }
    } catch(e) { console.error('[MARK Field] video load:',e); setVideoError('Could not load video. Try mp4 (H.264).') }
  }
  function handleVideoError() { setVideoError('Could not decode video. Convert to mp4 (H.264) first.'); setVideoLoaded(false) }

  // ── Playback ───────────────────────────────────────────────────────────────
  function togglePlay() {
    const v=videoRef.current; if(!v) return
    if(v.paused){v.play();setPlaying(true)}else{v.pause();setPlaying(false)}
  }
  function changeSpeed(u) {
    const v=videoRef.current; if(!v) return
    const n=typeof u==='function'?u(v.playbackRate):u
    v.playbackRate=n; setSpeed(n)
  }
  // Where the video IS for tagging: a seek that has been requested but not yet
  // applied (it lands on the next frame) counts as already there.
  function getVideoTime() {
    const v=videoRef.current; if(!v) return 0
    return seekTargetRef.current != null ? seekTargetRef.current : v.currentTime
  }
  /**
   * One seek per animation frame, using the LATEST target. A held arrow key
   * auto-repeats ~30 times a second, and every `currentTime =` on a playing video
   * flushes the decoder — thirty restarts a second never let one finish. Relative
   * steps add to the pending target, not to v.currentTime, so no step is lost.
   */
  function requestSeek(sec, relative) {
    const v=videoRef.current; if(!v) return
    const dur = v.duration
    if (!relative && (!isFinite(sec) || !isFinite(dur))) return
    const base = seekTargetRef.current != null ? seekTargetRef.current : v.currentTime
    const t = Math.max(0, Math.min(isFinite(dur) ? dur : 0, relative ? base + sec : sec))
    seekTargetRef.current = t
    if (!seekRafRef.current) {
      seekRafRef.current = requestAnimationFrame(() => { seekRafRef.current = 0; flushSeek() })
    }
  }
  /**
   * Apply the latest requested position — unless the decoder is still landing the
   * previous one. A seek issued while another is in flight throws that work away
   * and restarts, which is the stutter; so the newest target waits for `seeked`
   * (onSeeked calls this again) and everything requested meanwhile collapses
   * into that one seek.
   */
  function flushSeek() {
    const vv = videoRef.current
    const target = seekTargetRef.current
    if (!vv || target == null) return
    if (vv.seeking) return
    seekTargetRef.current = null
    vv.currentTime = target
    syncDisplay(true)
  }
  function seekBy(s) { requestSeek(s, true) }
  function seekTo(s) { requestSeek(s, false) }

  /**
   * Bring the on-screen clock, the dimming and the highlight in line with the
   * video. Cheap when nothing changed: at most one pass per 100 ms, a binary
   * search, and a state update ONLY when the value actually differs. (A drag in
   * progress owns the playhead, so it is left alone.)
   */
  function syncDisplay(force) {
    if (isDraggingRef.current) return
    const v=videoRef.current; if(!v) return
    const t = seekTargetRef.current != null ? seekTargetRef.current : v.currentTime
    const L = lastSyncRef.current, now = performance.now()
    if (!force && now - L.at < 100) return
    L.at = now
    const shown = Math.floor(t * 10) / 10
    if (shown !== L.shown) { L.shown = shown; setCurrentTime(shown) }
    const evs = eventsRef.current
    const pc = pastCountAt(evs, t)
    if (pc !== pastRef.current) { pastRef.current = pc; setPastCount(pc) }
    const hit = findAtTime(evs, t, EVENT_HIGHLIGHT_TOLERANCE_S)
    const key = hit.ids.join(',')
    if (key !== hlKeyRef.current) { hlKeyRef.current = key; setHighlightIds(hit.ids) }
    if (hit.nearestId !== hlNearestRef.current) { hlNearestRef.current = hit.nearestId; setHighlightNearest(hit.nearestId) }
  }
  function toggleMute() { const v=videoRef.current;if(!v)return;v.muted=!v.muted;setMuted(v.muted) }

  // ── Small helpers for saving ───────────────────────────────────────────────
  function flashMsg(text, ms = 1800) {
    setFlashError(text)
    clearTimeout(busyTimerRef.current)
    busyTimerRef.current = setTimeout(() => setFlashError(null), ms)
  }
  function flashBusy() { flashMsg('Still saving — that key was ignored', 1400) }
  function releaseLock(token) {
    if (!token || lockOwnerRef.current !== token) return
    lockOwnerRef.current = 0; commitLockRef.current = false; setSaveUi(null)
  }
  function markStatus(id, status, err) {
    setEvents(prev => prev.map(e => {
      if (e.id !== id) return e
      if (status === 'saved') { const { _status, _error, ...rest } = e; return rest }
      return { ...e, _status: status, _error: err ? String(err.message || err) : undefined }
    }))
  }
  async function deleteEventDocs(id) {
    const snap = await getDocs(query(collection(db, EVENTS_COL), where('id', '==', id)))
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
  }

  /**
   * The Firestore write for one event. The document id IS the event's id, which
   * is made on this machine — so writing it twice (a retry, or a queued write that
   * finally lands) is the same document, never a second one.
   *
   * Never rejects: every outcome is recorded on the event itself —
   *   pending → saved | failed | unconfirmed
   * so an event cannot sit in the bar looking saved when it is not.
   */
  function writeEvent(ev, { token = 0, replacing = null } = {}) {
    const p = setDoc(doc(db, EVENTS_COL, ev.id), { ...stripLocal(ev), createdAt: serverTimestamp() })
    pendingWritesRef.current.set(ev.id, p)
    let t2 = 0, t10 = 0
    if (token) {
      t2  = setTimeout(() => { if (lockOwnerRef.current === token) setSaveUi({ kind: 'waiting' }) }, WRITE_WAIT_MS)
      // No answer yet: stop blocking the collector, but say so. The write stays
      // queued; if it lands later the event flips to saved on its own.
      t10 = setTimeout(() => { markStatus(ev.id, 'unconfirmed'); releaseLock(token) }, LOCK_CAP_MS)
    }
    return p.then(async () => {
      clearTimeout(t2); clearTimeout(t10)
      markStatus(ev.id, 'saved'); releaseLock(token)
      try {
        if (deletedWhilePendingRef.current.delete(ev.id)) { await deleteEventDocs(ev.id); return }
        setFlashEvent(ev.eventLabel); setTimeout(() => setFlashEvent(null), 700)
        if (replacing) await deleteEventDocs(replacing.id)       // the edit is saved: only now does the original go
      } catch (e) { console.warn('[MARK Field] post-save cleanup:', e) }
    }, err => {
      clearTimeout(t2); clearTimeout(t10)
      console.error('[MARK Field] commit failed:', err)
      markStatus(ev.id, 'failed', err); releaseLock(token)
      showToast(`Could not save ${ev.eventLabel}: ${err?.message || err}`, 'error')
    }).finally(() => { if (pendingWritesRef.current.get(ev.id) === p) pendingWritesRef.current.delete(ev.id) })
  }
  function retryUnsaved() {
    eventsRef.current.filter(e => e._status === 'failed' || e._status === 'unconfirmed')
      .forEach(e => { markStatus(e.id, 'pending'); writeEvent(e) })
  }
  const retryOne = tag => {
    const e = eventsRef.current.find(x => x.id === tag.id)
    if (e) { markStatus(e.id, 'pending'); writeEvent(e) }
  }

  // The team of the event that OPENED a pair (Shot → End shot, Pressure start →
  // Pressure end). The link is the pair_id, stamped on both when they commit.
  function pairedOpenerTeam(openId) {
    const pr = openPairsRef.current[openId]
    let t = null
    if (pr?.pairId) t = events.find(e => e.pair_id === pr.pairId && e.eventId === openId)?.team || null
    if (!t) t = openStates[openId]?.team || null
    return t
  }

  /**
   * The team is known; now the pass type. The chain decides how it is asked:
   *   exactly one type allowed in this phase → set it ('inferred'), no question
   *   several allowed                        → ask, offering ONLY those
   *   none / the phase says nothing          → ask exactly as before
   * Edit never skips: the saved type is shown pre-selected so it can be corrected.
   */
  function routePassType(def, teamAbs, vt, teamSource) {
    const editing = editingRef.current
    let allowed = null
    if (allEvents && !editing && mineTeam && teamAbs) {
      const v = validTypes(currentPhase, 'pass', toRel(teamAbs), chainPart, PASS_TYPE_OPTIONS.map(o => o.code))
      if (v.restricted && v.codes.length === 1) {
        const type = PASS_TYPE_OPTIONS.find(o => o.code === v.codes[0])
        const vs = def.variants.variants
        const chain = (vs.find(x => x.when.includes(type.code)) || vs[0]).groups
        setPendingType(type); setPendingTypeSource('inferred'); setAllowedPassTypes(null)
        setGroupChain(chain); setGroupIndex(0); setCurrentSelections([])
        if (chain.length > 0) setCaptureStep('group')
        else commitEvent(def, vt, type, [], 'inferred', null, teamAbs, teamSource)
        return
      }
      if (v.restricted && v.codes.length > 1) allowed = v.codes
    }
    setAllowedPassTypes(allowed)
    if (allowed) {
      const inf = inferPassType(events, possessionRef.current).type
      if (!allowed.includes(inf?.code)) {
        setPendingType(PASS_TYPE_OPTIONS.find(o => o.code === allowed[0])); setPendingTypeSource('inferred')
      }
    }
    setCaptureStep('type_confirm')
  }

  /** Shot "type" is the last group (Outcome). Returns its option when the chain allows exactly one. */
  function autoShotOption(group) {
    if (!allEvents || editingRef.current || pendingEvent?.id !== 'shot' || group?.id !== 'outcome') return null
    if (!mineTeam || !pendingTeam) return null
    const opts = getGroupOptions(group, [], [], { allEvents: true })
    const v = validTypes(currentPhase, 'shot', toRel(pendingTeam), chainPart, opts.map(o => o.code))
    return v.restricted && v.codes.length === 1 ? opts.find(o => o.code === v.codes[0]) : null
  }

  // ── Start capture ──────────────────────────────────────────────────────────
  // opts.editing is the saved event being re-tagged (Edit).
  function startCapture(eventDef, vt, overrideAsClose, opts = {}) {
    if (!session) return
    // One commit at a time. A key pressed while the previous event is still being
    // saved is refused — visibly — rather than queued or doubled.
    if (commitLockRef.current) { flashBusy(); return }
    const editing = opts.editing || null
    editingRef.current = editing
    autoShotRef.current = false
    seededRef.current = ''

    // All events never blocks a key. Both teams are collected, so an event that
    // looks out of place in the current phase is simply the OTHER team's — a
    // tackle while my team has the ball is the opponent's tackle. teamDecision
    // below assigns it, and its outcome then moves the chain.
    //
    // Before Half start there is no "mine" yet, so nothing can be inferred and
    // every event asks Home/Away — no wrong team can be saved.

    // The ONE key All events blocks: a Reception must follow a pass (camera
    // off/on and pressure start/end may sit between them, nothing else). With
    // no pass before it there is nothing for it to be the reception of, so the
    // key does nothing — confirmed. Not all events never reaches this check.
    // (Edit is exempt: the reception being re-tagged was allowed when it was made.)
    if (allEvents && !editing && eventDef.id === 'reception' &&
        !receptionAllowed(events.map(e => e.eventId))) return
    if (collStartRef.current===null) collStartRef.current=Date.now()

    // A second Stoppage while one is open would leave the first one never closed.
    // (Re-tagging the open Stoppage itself — Edit — is allowed.)
    if (eventDef.id === 'stoppage' && openStates.stoppage && !editing) {
      flashMsg('Close the open stoppage first')
      return
    }

    // Half end closes every open state — but NOT here. It used to happen at this point, before
    // the Home/Away question, so pressing Esc at that prompt left the stoppage / pressure /
    // shot already closed and the half not ended. The closes now happen in commitEvent, at the
    // moment Half end is actually saved, so cancelling leaves everything exactly as it was.

    setPendingEvent(eventDef)
    setPendingVideoTime(vt)
    setPendingType(null)
    setPendingTypeSource(null)
    setAllowedPassTypes(null)
    setResolvedVariant(null)
    setGroupIndex(0)
    setCollectedGroups([])
    setCurrentSelections([])

    // No team is resolved from anything. It is cleared and then asked for.
    setPendingTeam(null)
    setPendingTeamSource(null)

    // ── EVERY event asks Home/Away FIRST (unless All events can decide) ──────
    // Pass, Goal keeper and the variant events each set up whatever comes next,
    // record it, and go to the team step; chooseTeam() resumes from there once a
    // side is chosen.
    let next = { step: 'group', chain: eventDef.groups || [] }
    // Set only when the pass type is decided without asking; passed straight to
    // commitEvent below, because setPendingType is not applied until after this
    // function returns and an immediate save would otherwise read no type.
    let autoPassType = null

    // carry = MY team has the ball at its feet; defense = the OPPONENT does. A
    // pass from either is open play — the same rule, for both teams.
    if (eventDef.id === 'pass' && allEvents && !editing && (currentPhase === 'carry' || currentPhase === 'defense')) {
      // All events: after a reception the chain is in carry, and the Mark Chain
      // allows only an OPEN PLAY pass there ('pass field type is open-play').
      // So the type is not asked. The follow-up questions are the open-play
      // variant's, chosen exactly as confirming the type would choose them.
      autoPassType = PASS_TYPE_OPTIONS.find(o => o.code === 'TYPE_OPEN_PLAY') || null
      setPendingType(autoPassType)
      setPendingTypeSource('inferred')
      const vs = eventDef.variants?.variants
      const chain = vs
        ? (vs.find(v => v.when.includes('TYPE_OPEN_PLAY'))?.groups || vs[0].groups)
        : (eventDef.groups || [])
      next = { step: 'group', chain }
    } else if (eventDef.id === 'pass') {
      // Edit shows the SAVED type pre-selected; otherwise the type is inferred as before.
      const saved = editing?.type?.code ? PASS_TYPE_OPTIONS.find(o => o.code === editing.type.code) : null
      if (saved) { setPendingType(saved); setPendingTypeSource(editing.typeSource || 'manual') }
      else {
        const { type, defaulted } = inferPassType(events, possessionRef.current)
        setPendingType(type)
        setPendingTypeSource(defaulted ? 'inferred_default' : 'inferred')
      }
      next = { step: 'type_confirm', chain: eventDef.groups || [] }
    } else if (eventDef.id === 'goal_keeper' && eventDef.typeGroup) {
      next = { step: 'group', chain: [eventDef.typeGroup] }
    } else if (eventDef.variants) {
      next = { step: 'group', chain: eventDef.variants.variants[0].groups }
    }

    setGroupChain(next.chain)
    afterTeamRef.current = next

    // Team known: carry on. Shared by every way a team can be settled without asking.
    const proceed = (team, source) => {
      setPendingTeam(team)
      setPendingTeamSource(source)
      afterTeamRef.current = null
      if (next.step === 'type_confirm') { routePassType(eventDef, team, vt, source); return }
      if ((next.chain || []).length > 0) {
        setGroupIndex(0); setCurrentSelections([]); setCaptureStep('group'); return
      }
      commitEvent(eventDef, vt, autoPassType, [], autoPassType ? 'inferred' : null, null, team, source)
    }

    // End stoppage closes the Stoppage that opened it, so it takes that Stoppage's team through
    // the pair_id — in BOTH collection methods, because the button is new in both. With no
    // stoppage open there is nothing to inherit from, so it falls through and asks 1/2.
    if (eventDef.id === 'end_stoppage') {
      const t = pairedOpenerTeam('stoppage')
      if (t) { proceed(t, 'inherited'); return }
    }

    // All events: the phase decides whether the team is inferred or asked.
    // Not all events skips this and always asks, exactly as before.
    if (allEvents && eventDef.id !== 'half_start') {
      // End shot and Pressure end belong to the event that opened them: the
      // pair_id is a hard link, so the team is inherited, never guessed or asked.
      // No open shot / pressure to inherit from → fall through and ask.
      if (eventDef.closesEventId === 'shot' || eventDef.closesEventId === 'pressure_start') {
        const t = pairedOpenerTeam(eventDef.closesEventId)
        if (t) { proceed(t, 'inherited'); return }
      }
      const decision = teamDecision(currentPhase, eventDef.id)
      // Inferring needs "mine" to turn mine/opponent into a real team. If it is
      // ever missing, ask instead — never save a blank or guessed team.
      // (teamDecision no longer returns 'none': every event has a team.)
      const canInfer = !!mineTeam
      if (canInfer && (decision === 'mine' || decision === 'opponent')) {
        proceed(toAbs(decision), 'inferred')
        return
      }
      // Reception: the PHASE speaks first (above). Only when it gave no team —
      // in practice, before any Half start — may it inherit from the pass right
      // before it, and only under the strict rules in inheritedReceptionTeam.
      if (eventDef.id === 'reception') {
        const t = inheritedReceptionTeam(events)
        if (t) { proceed(t, 'inherited'); return }
      }
    }
    // half_start always asks: its answer IS the kickoff team, i.e. "mine"
    setCaptureStep('team')
  }

  /**
   * The collector has chosen Home or Away.
   *
   * Team is asked FIRST — immediately after the event key, before any attribute
   * group — so this stores the side and then opens the group chain.
   *
   * teamSource is 'manual' here: it was asked. 'inferred' (the phase decided) and
   * 'inherited' (End shot, Pressure end, and a Reception with no phase) are set in
   * startCapture, where the team is settled without a question.
   */
  function chooseTeam(side) {
    setPendingTeam(side)
    setPendingTeamSource('manual')
    const next = afterTeamRef.current || { step: 'group', chain: groupChain }
    afterTeamRef.current = null

    if (next.step === 'type_confirm') {
      routePassType(pendingEvent, side, pendingVideoTime, 'manual')
      return
    }
    if ((next.chain || []).length > 0) {
      setGroupIndex(0)
      setCurrentSelections([])
      setCaptureStep('group')
      return
    }
    commitEvent(null, undefined, null, [], null, null, side, 'manual')
  }

  // ── Advance through group chain ────────────────────────────────────────────
  function advanceGroup(newGroups) {
    const nextIdx = groupIndex + 1
    if (nextIdx < newGroups.length) {
      setGroupIndex(nextIdx)
      setCurrentSelections([])
    } else {
      // All groups done. Team was chosen BEFORE the groups, so commit now
      // rather than prompting at the end as this used to.
      commitEvent(null, undefined, null, newGroups, null, null,
        pendingTeam, pendingTeamSource || 'manual')
    }
  }

  // ── Commit selections for current group ────────────────────────────────────
  function commitGroupSelections(selections) {
    const group = groupChain[groupIndex]
    const saved = [...collectedGroups, { groupId: group.id, groupLabel: group.label, selections }]
    setCollectedGroups(saved)

    function routeAfterGroups(chain) {
      if (chain.length > 0) {
        setCaptureStep('group')
      } else {
        // Team already chosen before the groups.
        commitEvent(null, undefined, null, saved, autoShotRef.current ? 'inferred' : null, null, pendingTeam, pendingTeamSource || 'manual')
      }
    }

    /**
     * Swap in a variant's group chain and resume from the RIGHT place.
     *
     * This used to be setGroupIndex(0) unconditionally. For Shot that pointed
     * straight back at the discriminator — every Shot variant's groups array
     * begins with BODY_PART_SHOT, which the collector had just answered — so
     * the sequence stalled there and Technique never appeared.
     *
     * Pass is the opposite case: it discriminates on a synthetic `type` group
     * that appears in no variant chain, so a blanket "start at 1" would skip a
     * real question. Hence: find where the discriminator actually sits and
     * resume after it, or at 0 when it is absent.
     *
     * Conditional groups are skipped with the same predicate the normal advance
     * path uses — selection count on the referenced group — so the two cannot
     * disagree.
     */
    function applyVariantChain(matched, discriminatorId, savedGroups) {
      const chain = matched.groups || []
      const at = chain.findIndex(g => g.id === discriminatorId)
      let idx = at >= 0 ? at + 1 : 0

      const acc = [...savedGroups]
      while (idx < chain.length) {
        const g = chain[idx]
        if (!g.conditionalOn) break
        const ref = acc.find(x => x.groupId === g.conditionalOn.groupId)
        const n = ref?.selections?.length || 0
        if (n >= (g.conditionalOn.minSelections || 1)) break
        acc.push({ groupId: g.id, groupLabel: g.label, selections: [] })
        idx++
      }

      // Shot type: when the chain allows exactly ONE, it is filled in, not asked.
      while (idx < chain.length) {
        const auto = autoShotOption(chain[idx])
        if (!auto) break
        acc.push({ groupId: chain[idx].id, groupLabel: chain[idx].label, selections: [auto] })
        autoShotRef.current = true
        idx++
      }

      setGroupChain(chain)
      setCurrentSelections([])
      setCollectedGroups(acc)

      if (idx < chain.length) {
        setGroupIndex(idx)
        setCaptureStep('group')
        return
      }
      // chain exhausted — finish exactly as the normal path does
      // Team was chosen before the groups, so commit straight away.
      // The explicit / not-meaningful / inferred branching that used to
      // be here is gone — every event has a manually chosen team.
      commitEvent(null, undefined, null, acc, autoShotRef.current ? 'inferred' : null, null,
        pendingTeam, pendingTeamSource || 'manual')
    }

    // If this group is the discriminator for variants, resolve branch
    if (pendingEvent?.variants && group.id === pendingEvent.variants.discriminatorGroupId) {
      const selectedCodes = selections.map(s=>s.code)
      const matched = pendingEvent.variants.variants.find(v =>
        v.when.some(w => selectedCodes.includes(w))
      ) || pendingEvent.variants.variants[0]
      setResolvedVariant(matched)
      applyVariantChain(matched, group.id, saved)
      return
    }

    // GK type group → resolve variant
    if (pendingEvent?.id === 'goal_keeper' && group.id === 'type') {
      const selectedCode = selections[0]?.code
      const matched = pendingEvent.variants.variants.find(v => v.when.includes(selectedCode))
                   || pendingEvent.variants.variants[0]
      setResolvedVariant(matched)
      applyVariantChain(matched, group.id, saved)
      return
    }

    // Normal chain advance — with conditionalOn support
    // A group with conditionalOn is skipped if the referenced group didn't meet its condition
    const nextIdx = groupIndex + 1

    // Find the next group that is not conditionally skipped
    let skipTo = nextIdx
    while (skipTo < groupChain.length) {
      const nextGroup = groupChain[skipTo]
      if (!nextGroup.conditionalOn) break  // no condition — always show
      // Check if the condition is met in already-collected groups
      const refGroup = saved.find(g => g.groupId === nextGroup.conditionalOn.groupId)
      const selCount = refGroup?.selections?.length || 0
      if (selCount >= (nextGroup.conditionalOn.minSelections || 1)) break  // condition met
      // Condition not met — skip this group (record it as empty)
      saved.push({ groupId: nextGroup.id, groupLabel: nextGroup.label, selections: [] })
      skipTo++
    }
    // Shot type: when the chain allows exactly ONE, it is filled in, not asked.
    while (skipTo < groupChain.length) {
      const auto = autoShotOption(groupChain[skipTo])
      if (!auto) break
      saved.push({ groupId: groupChain[skipTo].id, groupLabel: groupChain[skipTo].label, selections: [auto] })
      autoShotRef.current = true
      skipTo++
    }
    setCollectedGroups(saved)

    if (skipTo < groupChain.length) {
      setGroupIndex(skipTo)
      setCurrentSelections([])
    } else {
      // All groups collected — route based on possession rule
      // Team was chosen before the groups, so commit straight away.
      // The explicit / not-meaningful / inferred branching that used to
      // be here is gone — every event has a manually chosen team.
      commitEvent(null, undefined, null, saved, autoShotRef.current ? 'inferred' : null, null,
        pendingTeam, pendingTeamSource || 'manual')
    }
  }

  // ── Commit the full event ──────────────────────────────────────────────────
  /**
   * Everything the NEXT keypress depends on happens here, synchronously: the
   * lock, the event appearing in the bar (marked pending), the capture state
   * resetting. Only the network write is asynchronous.
   *
   * It used to be the other way round — the event was added and the capture
   * reset AFTER `await addDoc`. For the length of a slow write the answer key
   * was still live, so pressing it again committed the same event again (each
   * with a fresh random id), and nothing showed in the bar, so the collector
   * kept pressing. That is the seven identical Passes.
   */
  async function commitEvent(eventDef, vt, type, groups, typeSource, variant, team, teamSrc, forceClose=false) {
    // Forced closes (Half end) are part of one user action and run in sequence;
    // everything else takes the lock, and a second attempt is refused.
    let token = 0
    if (!forceClose) {
      if (commitLockRef.current) { flashBusy(); return }
      commitLockRef.current = true
      token = ++lockTokenRef.current; lockOwnerRef.current = token
      setSaveUi({ kind: 'saving' })
    }

    let ev, replacing = null
    try {
      const realDef  = eventDef || pendingEvent
      const realVt   = vt   !== undefined ? vt   : pendingVideoTime
      const realTeam = team !== undefined ? team : pendingTeam
      const realTeamSrc = teamSrc !== undefined ? teamSrc : pendingTeamSource

      // Half end closes every open state (Stoppage, Pressure, Shot, …), and it does so HERE, when
      // it is actually saved — never earlier. Each close carries the team of the event it
      // closes and keeps the teamSource it always had ('manual': nobody was asked).
      // They are saved before Half end itself, in the same order as before.
      if (realDef.forceClosesAll && !forceClose) {
        const open = openStatesRef.current
        Object.keys(open).forEach(oid => {
          const pair = OPEN_STATE_PAIRS.find(p => p.openId === oid)
          if (pair) commitEvent(EVENT_BY_ID[pair.closeId], realVt, null, [], null, null, open[oid]?.team, 'manual', true)
        })
        setOpenStates({})
      }

      // If this closes an open state, remove it
      if (realDef.closesEventId) {
        setOpenStates(prev => { const n={...prev}; delete n[realDef.closesEventId]; return n })
      }
      // If this opens a state, register it
      if (realDef.openState) {
        setOpenStates(prev => ({ ...prev, [realDef.id]: { team:realTeam, videoTimeSec:realVt } }))
      }

      const finalGroups = groups || collectedGroups

      // Increment event_seq — monotonic per session
      eventSeqRef.current += 1
      const eventSeq = eventSeqRef.current

      // video_time_ms as integer — used for pair duration arithmetic (no float rounding)
      const videoTimeMs = Math.round(realVt * 1000)

      // Pair tracking
      let pairId     = null
      let pairStatus = null
      let durationMs = null
      const id = `field_${Date.now()}_${Math.random().toString(36).slice(2,7)}`

      if (realDef.openState) {
        // Opening event: generate pair_id using session slice + event_seq
        pairId = `${session.sessionId.slice(0,8)}_${eventSeq}`
        pairStatus = 'incomplete'  // marked complete when close event is committed
        openPairsRef.current[realDef.id] = { pairId, openVideoTimeMs: videoTimeMs, eventSeq, docId: id }
      }

      if (realDef.closesEventId) {
        // Closing event: inherit pair_id from the open event
        const openPair = openPairsRef.current[realDef.closesEventId]
        if (openPair) {
          pairId = openPair.pairId
          durationMs = videoTimeMs - openPair.openVideoTimeMs  // integer arithmetic
          pairStatus = forceClose ? 'incomplete' : 'complete'
          // Mark the open event's pair as complete in Firestore (best-effort). The
          // opener may itself still be in flight, so wait for its write first.
          if (!forceClose && openPair.docId) {
            const opener = openPair.docId
            Promise.resolve(pendingWritesRef.current.get(opener)).catch(() => {})
              .then(() => updateDoc(doc(db, EVENTS_COL, opener), { pair_status: 'complete' }))
              .catch(() => {})
          }
          delete openPairsRef.current[realDef.closesEventId]
        }
      }

      ev = {
        id, sessionId:session.sessionId,
        videoPath: videoPath||session.videoPath||'',
        videoTimeSec:   realVt,
        video_time_ms:  videoTimeMs,      // integer ms — use this for arithmetic
        event_seq:      eventSeq,
        eventId:        realDef.id,
        eventLabel:     realDef.label,
        groups:         finalGroups,
        extras: finalGroups.flatMap(g => g.selections?.map(s=>s.label)||[]),
        team: realTeam||null,
        teamSource: realTeamSrc||null,
        possessionCertain: possession.certain,
        miscommunicationTeam: getMiscommunicationTeam(realDef.id) || null,
        type: type||pendingType||null,
        typeSource: typeSource||pendingTypeSource||null,
        pair_id:     pairId     || null,
        pair_status: pairStatus || null,
        duration_ms: durationMs !== null ? durationMs : null,
        // close event marker (used by serialiser)
        closesEventId: realDef.closesEventId || null,
        source:'field', mode:'field',
        collectorId:profile.uid, collectorEmail:profile.email,
        timestamp:Date.now(),
      }

      // ── Derived fields (All events only) ────────────────────────────────
      // pass end, foul phase and block side are worked out by the chain, never
      // asked. Not all events leaves them blank, except block side, which that
      // method asks for as an ordinary question.
      if (allEvents) {
        const run = runChain([...eventsRef.current, ev].map(toChainEvent), { part: chainPart })
        const f = run.length ? run[run.length - 1].docEvent.fields : {}
        const one = k => (f[k] && f[k].size) ? [...f[k]][0] : ''
        ev.passEnd   = one('pass-end')
        ev.playPhase = realDef.id === 'foul_committed' ? one('phase') : ''
        ev.playSide  = realDef.id === 'block' ? one('side') : ''
      }

      // Apply possession flip AFTER building the event (uses the committed groups)
      const newPossession = applyFlip(realDef.id, ev, possessionRef.current)

      // For Half start: set possession from Team Side explicit prompt result
      if (realDef.id === 'half_start' && realTeam) {
        // possession tracking removed — nothing reads this any more
        possessionRef.current = { team: null, certain: false }
      } else {
        // Inferred flips (successful tackle, interception won, and the rest) must
        // update the ref as well, not just state. Otherwise the very next event
        // tagged in the same tick would still resolve against the pre-flip team —
        // the same fault as the manual 0 toggle, arriving by a different route.
        possessionRef.current = newPossession
        setPossession(newPossession)
      }

      // ── The event appears NOW, marked pending ───────────────────────────
      setEvents(prev => [...prev, { ...ev, _status: 'pending' }].sort(byTime))
      eventsRef.current = [...eventsRef.current, { ...ev, _status: 'pending' }].sort(byTime)

      // An Edit replaces its original: the original stays in Firestore until the
      // replacement is confirmed saved (writeEvent deletes it then), so nothing
      // is lost if the app closes, the write fails, or the collector gives up.
      if (!forceClose) { replacing = editOriginalRef.current; editOriginalRef.current = null }

      const cur = sessionRef.current || session
      const upd = { ...cur, totalEvents: (cur.totalEvents||0) + (replacing ? 0 : 1),
        collectionStartWallMs: cur.collectionStartWallMs || collStartRef.current }
      sessionRef.current = upd
      setSession(upd); saveLocalSession(upd)
      if (!replacing) {
        updateDoc(doc(db,'mark_field_sessions',session.sessionId),
          { totalEvents: upd.totalEvents, collectionStartWallMs: upd.collectionStartWallMs }).catch(()=>{})
      }

      if (!forceClose) {
        editingRef.current = null; autoShotRef.current = false
        setPendingEvent(null); setCaptureStep('idle')
        setCollectedGroups([]); setCurrentSelections([]); setGroupChain([])
        setPendingType(null); setPendingTypeSource(null); setResolvedVariant(null); setGroupIndex(0)
        setPendingTeam(null); setPendingTeamSource(null); setAllowedPassTypes(null)
      }
    } catch (e) {
      console.error('[MARK Field] commit (local part):', e)
      releaseLock(token)
      showToast(`Could not record the event: ${e?.message || e}`, 'error')
      return
    }

    return writeEvent(ev, { token, replacing })
  }

  function abandonCapture() {
    // Esc during an Edit puts the ORIGINAL back — it was only hidden, never deleted.
    const orig = editOriginalRef.current
    if (orig) {
      editOriginalRef.current = null
      setEvents(prev => prev.some(e => e.id === orig.id) ? prev : [...prev, orig].sort(byTime))
    }
    editingRef.current = null; autoShotRef.current = false
    setPendingEvent(null); setCaptureStep('idle')
    setCollectedGroups([]); setCurrentSelections([]); setGroupChain([])
    setPendingType(null); setPendingTypeSource(null); setResolvedVariant(null); setGroupIndex(0)
    setPendingTeam(null); setPendingTeamSource(null); setAllowedPassTypes(null)
  }

  // ── Edit / delete event ────────────────────────────────────────────────────
  /**
   * Re-tag an existing event.
   *
   * FIELD had no editor: the Edit button was rendered but FieldPage passed
   * onEdit={null}, so clicking it called null(tag) and died silently.
   *
   * Rather than build a second attribute editor that would drift from the
   * capture state machine, this replays capture for the same event type at the
   * same video time. Every rule — variants, conditional groups, possession,
   * open-state pairing — is the live one by construction.
   *
   * The original is only HIDDEN while the replay runs; it is deleted from
   * Firestore after its replacement has been saved. Esc therefore costs nothing
   * (the original reappears) where it used to lose a saved event.
   */
  async function editEvent(ev) {
    if (!ev) return
    if (commitLockRef.current) { flashBusy(); return }
    if (captureStep !== 'idle') {
      console.warn('[MARK Field] edit ignored — capture in progress:', captureStep)
      setFlashEvent('Finish the current event first')
      setTimeout(() => setFlashEvent(null), 1400)
      return
    }
    const def = EVENT_BY_ID[ev.eventId] || FIELD_EVENTS.find(e => e.id === ev.eventId)
    if (!def) { console.warn('[MARK Field] edit: unknown eventId', ev.eventId); return }

    // The stored event uses video_time_ms (snake) and videoTimeSec — there is no
    // videoTimeMs, which is what this read before, so vt silently fell to 0 and
    // Edit jumped to the start of the video instead of the event.
    const vt = ev.videoTimeSec != null ? Number(ev.videoTimeSec)
             : ev.video_time_ms != null ? Number(ev.video_time_ms) / 1000
             : 0
    // An event whose first write has not landed yet must land first, or the replay
    // would be racing its own original.
    const inflight = pendingWritesRef.current.get(ev.id)
    if (inflight) { try { await Promise.race([inflight, new Promise(r => setTimeout(r, 3000))]) } catch {} }

    editOriginalRef.current = ev
    setEvents(prev => prev.filter(e => e.id !== ev.id))
    eventsRef.current = eventsRef.current.filter(e => e.id !== ev.id)

    // park the video on the event so the collector sees what they are re-tagging
    const v = videoRef.current
    if (v) { v.pause(); requestSeek(vt, false) }

    setFlashEvent(`Re-tagging ${def.label}`)
    setTimeout(() => setFlashEvent(null), 1400)
    startCapture(def, vt, undefined, { editing: ev })
  }

  async function deleteEvent(ev) {
    try {
      // A write that has not been confirmed would land AFTER the delete and bring
      // the event back. Wait for it — but not forever when offline: then it is
      // remembered, and removed the moment it does land.
      const inflight = pendingWritesRef.current.get(ev.id)
      if (inflight) {
        const settled = await Promise.race([inflight.then(() => true, () => true), new Promise(r => setTimeout(() => r(false), 3000))])
        if (!settled) deletedWhilePendingRef.current.add(ev.id)
      }
      await deleteEventDocs(ev.id)
      setEvents(prev=>prev.filter(e=>e.id!==ev.id))
      const cur = sessionRef.current || session
      const t=Math.max(0,(cur?.totalEvents||1)-1)
      const u={...cur,totalEvents:t}; sessionRef.current=u; setSession(u); saveLocalSession(u)
      updateDoc(doc(db,'mark_field_sessions',session?.sessionId),{totalEvents:t}).catch(()=>{})
    } catch(e) { console.warn('[MARK Field] delete:',e) }
  }

  // ── Clear all events ───────────────────────────────────────────────────────
  // Deletes THIS session's events from Firestore and resets collection to a clean
  // start. It keeps the video, match ID, part and method, and never touches
  // anything already written to the Sheet (no Sheet call exists here).
  async function clearAllEvents() {
    if (clearing || commitLockRef.current) return
    setClearing(true); setClearError('')
    const token = ++lockTokenRef.current
    commitLockRef.current = true; lockOwnerRef.current = token
    try {
      // Let in-flight writes settle first, or they would land after the delete.
      await Promise.race([Promise.allSettled([...pendingWritesRef.current.values()]), new Promise(r => setTimeout(r, 8000))])
      if (pendingWritesRef.current.size > 0)
        throw new Error(`${pendingWritesRef.current.size} event(s) are still being saved — check the connection and try again.`)
      const snap = await getDocs(query(collection(db, EVENTS_COL), where('sessionId', '==', session.sessionId)))
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = writeBatch(db)
        snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
      // Firestore is clear — now, and only now, local state.
      abandonCapture()
      setEvents([]); eventsRef.current = []
      setOpenStates({}); openPairsRef.current = {}; eventSeqRef.current = 0
      possessionRef.current = { team: null, certain: false }; setPossession({ team: null, certain: false })
      hlKeyRef.current = ''; hlNearestRef.current = null; pastRef.current = 0
      setHighlightIds([]); setHighlightNearest(null); setPastCount(0)
      const cur = sessionRef.current || session
      const upd = { ...cur, totalEvents: 0 }
      sessionRef.current = upd; setSession(upd); saveLocalSession(upd)
      updateDoc(doc(db, 'mark_field_sessions', session.sessionId), { totalEvents: 0 }).catch(() => {})
      setShowClearModal(false)
      setFlashEvent('All events cleared'); setTimeout(() => setFlashEvent(null), 1500)
    } catch (e) {
      console.error('[MARK Field] clear all:', e)
      setClearError(e?.message || String(e))
      // Some documents may have gone: show what Firestore really holds.
      try {
        const snap = await getDocs(query(collection(db, EVENTS_COL), where('sessionId', '==', session.sessionId)))
        setEvents(snap.docs.map(d => ({ ...d.data() })).sort(byTime))
      } catch {}
    } finally {
      releaseLock(token); setClearing(false)
    }
  }

  // ── Done: confirm every event in the bar is really in Firestore ───────────
  // The Sheet is written from the LOCAL list, and the bar now shows events before
  // Firestore has confirmed them. This closes that gap: anything missing is
  // re-saved (same id, so it cannot duplicate) and the Sheet save stays blocked
  // until all of them are confirmed.
  async function verifyEventsInFirestore() {
    const total = eventsRef.current.length
    setVerifyState({ status: 'checking', missing: 0, total })
    try {
      await Promise.race([Promise.allSettled([...pendingWritesRef.current.values()]), new Promise(r => setTimeout(r, 5000))])
      let missing = [], repaired = false
      for (let attempt = 0; attempt < 2; attempt++) {
        const snap = await getDocsFromServer(query(collection(db, EVENTS_COL), where('sessionId', '==', session.sessionId)))
        const have = new Set(snap.docs.map(d => d.data().id))
        missing = eventsRef.current.filter(e => !have.has(e.id))
        if (!missing.length) break
        repaired = true
        await Promise.race([
          Promise.allSettled(missing.map(e => { markStatus(e.id, 'pending'); return writeEvent(e) })),
          new Promise(r => setTimeout(r, 10000)),
        ])
      }
      if (missing.length) { setVerifyState({ status: 'blocked', missing: missing.length, total }); return false }
      updateDoc(doc(db, 'mark_field_sessions', session.sessionId), { totalEvents: eventsRef.current.length }).catch(() => {})
      setVerifyState({ status: repaired ? 'repaired' : 'ok', missing: 0, total: eventsRef.current.length })
      return true
    } catch (e) {
      console.warn('[MARK Field] verify:', e)
      setVerifyState({ status: 'offline', missing: 0, total, message: e?.message || String(e) })
      return false
    }
  }
  useEffect(() => {
    if (!showDoneModal) { setVerifyState(null); return }
    verifyEventsInFirestore()
  }, [showDoneModal])

  // ── Keyboard handler ───────────────────────────────────────────────────────
  const SPEED_MIN=0.25, SPEED_MAX=2, SPEED_STEP=0.25
  useEffect(()=>{
    function onKey(e) {
      const key=e.key, shift=e.shiftKey, upper=key.toUpperCase()

      // A held key never repeats an event, an answer or a confirm. Only seeking
      // and speed may auto-repeat (a held arrow is how you scrub).
      if (e.repeat && !(key==='ArrowLeft'||key==='ArrowRight'||key==='+'||key==='='||key==='-'||key==='_')) return

      // Clear-all dialog open: nothing but Esc does anything. Enter is the key
      // used constantly during collection and must NEVER confirm a wipe.
      if (showClearModal) { if (key==='Escape') setShowClearModal(false); return }

      // ── Type confirm step ────────────────────────────────────────────────
      if (captureStep==='type_confirm') {
        if (key==='Escape') { abandonCapture(); return }
        if (key==='Enter') {
          // Confirm inferred type
          const chain = pendingEvent.variants.variants.find(v=>v.when.includes(pendingType?.code))?.groups
            || pendingEvent.variants.variants.find(v=>v.when.includes('TYPE_OPEN_PLAY'))?.groups
            || pendingEvent.variants.variants[0].groups
          // An Edit confirmed unchanged keeps the source it was saved with.
          if (!editingRef.current) setPendingTypeSource(pendingTypeSource==='inferred_default'?'inferred_default':'inferred')
          setGroupChain(chain); setGroupIndex(0); setCurrentSelections([])
          if (chain.length>0) setCaptureStep('group')
          // team already chosen; nothing left to ask
          else commitEvent(null,undefined,null,[],null,null,pendingTeam,pendingTeamSource||'manual')
          return
        }
        // Number/letter override
        const opt = PASS_TYPE_OPTIONS.find(o=>(o.toggleKey===upper||o.toggleKey===key) && (!allowedPassTypes || allowedPassTypes.includes(o.code)))
        if (opt) {
          setPendingType(opt); setPendingTypeSource('manual')
          const chain = pendingEvent.variants.variants.find(v=>v.when.includes(opt.code))?.groups
            || pendingEvent.variants.variants[0].groups
          setGroupChain(chain); setGroupIndex(0); setCurrentSelections([])
          if (chain.length>0) setCaptureStep('group')
          // team already chosen; nothing left to ask
          else commitEvent(null,undefined,null,[],null,null,pendingTeam,pendingTeamSource||'manual')
        }
        return
      }

      // ── Group step ───────────────────────────────────────────────────────
      if (captureStep==='group') {
        if (key==='Escape') { abandonCapture(); return }
        const group = groupChain[groupIndex]
        if (!group) return
        const opts = getGroupOptions(group, collectedGroups, currentSelections, { allEvents })

        // Enter = skip (if optional) or confirm multi-select
        if (key==='Enter') {
          if (!group.required || currentSelections.length>0) {
            commitGroupSelections(currentSelections)
          }
          return
        }

        // Find option by toggleKey
        const matched = opts.find(o=>o.toggleKey===key||o.toggleKey===upper)
        if (!matched) return

        if (group.selectType==='single') {
          // Single select: immediately advance
          commitGroupSelections([matched])
        } else {
          // Multi select: toggle and wait for Enter
          setCurrentSelections(prev=>
            prev.find(s=>s.code===matched.code)
              ? prev.filter(s=>s.code!==matched.code)
              : [...prev, matched]
          )
        }
        return
      }

      // ── Team step ────────────────────────────────────────────────────────
      if (captureStep==='team') {
        if (key==='Escape') { abandonCapture(); return }
        // 1 = Home, 2 = Away, in both methods. Letters are NOT accepted: H and A
        // are event hotkeys, and one meant for the next event must not become a
        // team for this one. No Enter-to-skip: team is REQUIRED on every event, so
        // there is deliberately no path out of this step without choosing a side.
        const side = key==='1' ? 'home' : key==='2' ? 'away' : null
        if (!side) return
        chooseTeam(side)
        return
      }

      // ── Idle — transport and event capture ───────────────────────────────
      if (!videoLoaded||showDoneModal) return

      // Key 0 is FREE. It was the manual possession flip, which no longer
      // exists because nothing infers team any more. Unassigned on purpose.

      if (key==='ArrowUp')   { e.preventDefault(); togglePlay(); return }
      if (key==='ArrowRight'||key==='ArrowLeft') {
        e.preventDefault()
        seekBy((key==='ArrowRight'?1:-1)*(shift?40:400)/1000); return
      }
      if (key==='+'||key==='=') { e.preventDefault(); changeSpeed(p=>Math.min(SPEED_MAX,Math.round((p+SPEED_STEP)*100)/100)); return }
      if (key==='-'||key==='_') { e.preventDefault(); changeSpeed(p=>Math.max(SPEED_MIN,Math.round((p-SPEED_STEP)*100)/100)); return }
      if (key==='Escape') { setShowDoneModal(false); return }

      // Check if this key closes an open state
      const closePair = getCloseAction(openStates, upper)||getCloseAction(openStates, key)
      if (closePair) {
        e.preventDefault()
        const closeEventDef = EVENT_BY_ID[closePair.closeId]
        setActiveKey(upper); setTimeout(()=>setActiveKey(null),600)
        startCapture(closeEventDef, getVideoTime())
        return
      }

      // Find event(s) for this key
      const candidates = EVENT_BY_KEY[upper] || []
      if (candidates.length === 0) return
      e.preventDefault()

      // Pressure toggle: G → if pressure open, close it; else open
      const pressurePair = OPEN_STATE_PAIRS.find(p=>p.closeKey===upper&&p.openId==='pressure_start')
      if (pressurePair && upper==='G') {
        if (openStates['pressure_start']) {
          const closeEv = EVENT_BY_ID['pressure_end']
          setActiveKey(upper); setTimeout(()=>setActiveKey(null),600)
          startCapture(closeEv, getVideoTime())
        } else {
          const openEv = EVENT_BY_ID['pressure_start']
          setActiveKey(upper); setTimeout(()=>setActiveKey(null),600)
          startCapture(openEv, getVideoTime())
        }
        return
      }

      // Normal event
      const eventDef = candidates[0]
      setActiveKey(upper); setTimeout(()=>setActiveKey(null),600)
      startCapture(eventDef, getVideoTime())
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  }, [videoLoaded,showDoneModal,captureStep,groupIndex,groupChain,currentSelections,
      collectedGroups,pendingEvent,pendingType,pendingTypeSource,openStates,session,videoPath,events,
      pendingTeam,pendingTeamSource,allowedPassTypes,showClearModal])

  // Playback clock: while playing, keep the display, the dimming and the highlight in
  // step with the video — at most 10 times a second, and committing state only when
  // something actually changed.
  useEffect(() => {
    if (!videoLoaded || !playing) return
    let raf = 0
    const loop = () => { syncDisplay(false); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [videoLoaded, playing])
  // New, removed or re-tagged events change what sits under the playhead.
  useEffect(() => { syncDisplay(true) }, [events])

  // Edit: the shot-type question opens with the SAVED answer already selected.
  const seededRef = useRef('')
  useEffect(() => {
    const ed = editingRef.current
    if (captureStep !== 'group' || !ed || pendingEvent?.id !== 'shot') return
    const g = groupChain[groupIndex]
    if (!g || g.id !== 'outcome') return
    const key = `${ed.id}:${groupIndex}`
    if (seededRef.current === key) return
    seededRef.current = key
    const saved = ed.groups?.find(x => x.groupId === 'outcome')?.selections || []
    const pre = getGroupOptions(g, [], [], { allEvents }).filter(o => saved.some(sv => sv.code === o.code))
    if (pre.length) setCurrentSelections(pre)
  }, [captureStep, groupIndex, groupChain, pendingEvent])

  // Scrubbing: pause while the playhead is dragged, resume on release (only if it was
  // playing), and ALWAYS clear the drag flag — on release and on cancel.
  // The flag used to be set here and never cleared, so after the first scrub
  // onTimeUpdate was ignored for the rest of the session.
  function onScrubStart() {
    isDraggingRef.current = true
    const v = videoRef.current
    wasPlayingRef.current = !!v && !v.paused
    if (v && wasPlayingRef.current) v.pause()
  }
  function onScrubEnd() {
    isDraggingRef.current = false
    const v = videoRef.current
    if (wasPlayingRef.current && v) {
      if (seekTargetRef.current != null || v.seeking) resumeAfterSeekRef.current = true   // resume once it has landed
      else { const pr = v.play(); pr && pr.catch && pr.catch(() => {}) }
    }
    wasPlayingRef.current = false
    syncDisplay(true)
  }

  // Stable identities for the events bar, so it only re-renders when its own data changes.
  const handlersRef = useRef({})
  handlersRef.current = { edit: editEvent, del: deleteEvent, seek: seekTo, retry: retryOne, endStoppage: clickEndStoppage }
  const onEditStable   = useCallback(ev => handlersRef.current.edit(ev), [])
  const onDeleteStable = useCallback(ev => handlersRef.current.del(ev), [])
  const onSeekStable   = useCallback(t  => handlersRef.current.seek(t), [])
  const onRetryStable  = useCallback(ev => handlersRef.current.retry(ev), [])
  const onEndStoppage  = useCallback(() => handlersRef.current.endStoppage(), [])
  // The End stoppage button sits directly under Stoppage in the OFFENSE panel. The sidebar is
  // memoised, so this node is rebuilt only when the stoppage opens or closes.
  const stoppageOpen = !!openStates.stoppage
  const endStoppageSlot = useMemo(() => ({
    stoppage: <EndStoppageItem key="end_stoppage" open={stoppageOpen} onClick={onEndStoppage}/>,
  }), [stoppageOpen, onEndStoppage])

  // End stoppage: closes the open Stoppage (pair_id → duration_ms); team inherited from it.
  function clickEndStoppage() {
    if (!videoLoaded || captureStep !== 'idle') return
    if (!openStatesRef.current.stoppage) { flashMsg('No open stoppage'); return }
    const def = EVENT_BY_ID['end_stoppage']
    if (def) startCapture(def, getVideoTime())
  }

  // Mouse events from sidebar
  const mouseRef=useRef(null)
  mouseRef.current=(ev)=>{
    if (!videoLoaded||captureStep!=='idle') return
    const def=FIELD_EVENTS.find(e=>e.id===ev.id)
    if (def) startCapture(def, getVideoTime())
  }
  const onMouseEvent=useCallback((ev)=>mouseRef.current(ev),[])

  // ── Save to Sheet ──────────────────────────────────────────────────────────
  async function handleSaveToSheet() {
    // Match ID, Half and HR-code are no longer typed here. They come from the
    // start screen and the sign-in; the fallbacks guard against the save
    // fields having been cleared, since there is no longer an input to refill
    // them from.
    const effMatchId = String(saveMatchId || startMatchId || '').trim()
    const effHalf    = saveHalf || partToHalf(matchPart)
    const effHr      = String(saveHrCode || roleInfo?.code || '').trim()
    const matchErr = validateMatchId(effMatchId)
    if (matchErr) { setSaveMatchError(matchErr); return }
    if (!effHalf) { setSaveMatchError('The part of the match is missing — go back to the start screen.'); return }
    if (!effHr) {
      setSaveMatchError('Your HR-code could not be read from your sign-in. Contact your Batch Manager.')
      return
    }
    setSaveMatchError('')
    setSubmitting(true)
    setSaveResult(null)

    // The Sheet is written from the local list, so first make sure every event in
    // it is really in Firestore (anything missing is re-saved).
    if (!(await verifyEventsInFirestore())) {
      setSaveResult({ status: 'failed',
        message: 'Not every event is confirmed in Firestore yet, so nothing was written to the Sheet. Check the connection and retry — your events are safe locally.' })
      setSubmitting(false)
      return
    }

    const endWall   = Date.now()
    const startWall = collStartRef.current
    const prevAcc   = session.accumulatedMs || 0
    const thisMs    = (startWall && endWall > startWall) ? (endWall - startWall) : 0
    const totalMs   = prevAcc + thisMs
    const evPerMin  = totalMs > 0 ? (events.length / (totalMs / 60000)).toFixed(2) : null
    const hasHalfEnd= events.some(e => e.eventId === 'half_end')

    // Build completed session object with metadata
    const completed = {
      ...session,
      status:                'pending_sheet_upload',
      matchId:               effMatchId,
      half:                  effHalf,
      collectorHrCode:       effHr,
      homeTeamName:          saveHomeTeam.trim(),
      awayTeamName:          saveAwayTeam.trim(),
      is_model:              (isModelAnswer && !modelExists) ? '1' : '0',
      model_version:         (isModelAnswer && !modelExists) ? '1' : '',
      model_status:          (isModelAnswer && !modelExists) ? 'approved' : '',
      model_source:          (isModelAnswer && !modelExists) ? 'field' : '',
      videoDurationMs:       duration > 0 ? Math.round(duration * 1000) : (session.videoDurationMs || null),
      totalEvents:           events.length,
      accumulatedMs:         totalMs,
      collectionEndWallMs:   endWall,
      collectionStartWallMs: session.collectionStartWallMs || startWall,
      eventsPerMinute:       evPerMin,
      videoDurationSec:      duration || null,
      collectionIncomplete:  !hasHalfEnd,
    }

    // Update Firestore metadata
    try {
      await updateDoc(doc(db, 'mark_field_sessions', session.sessionId), {
        status: 'pending_sheet_upload',
        matchId: effMatchId, half: effHalf, collectorHrCode: effHr,
        totalEvents: events.length, accumulatedMs: totalMs,
        collectionEndWallMs: endWall, eventsPerMinute: evPerMin,
        videoDurationSec: duration || null, collectionIncomplete: !hasHalfEnd,
      })
    } catch(e) { console.warn('[MARK Field] Firestore update:', e) }

    // Save locally as pending — so crash before Sheet write still preserves data
    saveLocalSession(completed)
    setSession(completed)

    // Attempt Sheet write
    try {
      const result = await syncSessionToSheet(completed, events)

      // ── CONFIRMED SUCCESS — now safe to clear ─────────────────────────────
      const cleared = { ...completed, status: 'completed' }
      saveLocalSession(cleared)

      setSaveResult({
        status: 'success',
        rowsWritten: result.rowsWritten,
        duplicateHalfWarning: result.duplicateHalfWarning,
      })
      setSubmitting(false)
      // Don't auto-close — let collector see confirmation, then onDone resets UI
    } catch(e) {
      // ── FAILED — keep data, show options ────────────────────────────────
      console.error('[MARK Field] Sheet sync failed:', e)
      setSaveResult({
        status: 'failed',
        message: e.message || String(e),
      })
      setSubmitting(false)
    }
  }

  async function handleRetryUpload(pendingSess, pendingEventsArg) {
    setSubmitting(true)
    setSaveResult(null)
    try {
      const result = await syncSessionToSheet(pendingSess, pendingEventsArg)
      const cleared = { ...pendingSess, status: 'completed' }
      saveLocalSession(cleared)
      setSaveResult({ status: 'success', rowsWritten: result.rowsWritten })
      setPendingUpload(null)
    } catch(e) {
      setSaveResult({ status: 'failed', message: e.message || String(e) })
    }
    setSubmitting(false)
  }

  const [csvDlState, setCsvDlState] = useState('idle') // idle|saving|done|error
  const [csvDlPath,  setCsvDlPath]  = useState('')
  const [csvDlError, setCsvDlError] = useState('')

  async function handleExportCsvOnly() {
    const sess = session || pendingUpload
    if (!sess || csvDlState === 'saving') return
    setCsvDlState('saving'); setCsvDlPath(''); setCsvDlError('')
    try {
      const savedPath = await downloadFieldCsv(sess, events)
      if (savedPath) { setCsvDlPath(savedPath); setCsvDlState('done'); showToast(`Saved to ${savedPath}`); setTimeout(()=>setCsvDlState('idle'), 8000) }
      else setCsvDlState('idle')
    } catch(e) {
      const msg = e?.message || String(e); setCsvDlError(msg); setCsvDlState('error'); showToast(`Download failed: ${msg}`, 'error'); setTimeout(()=>setCsvDlState('idle'), 8000)
    }
  }

  function handleDiscard() {
    const sess = session || pendingUpload
    if (sess) {
      saveLocalSession({ ...sess, status: 'discarded' })
    }
    setPendingUpload(null)
    setShowDoneModal(false)
    setSaveResult(null)
    onDone && onDone({})
  }

  function handleStartFresh() {
    // Called after confirmed successful save
    setShowDoneModal(false)
    setSaveResult(null)
    setSaveMatchId(''); setSaveHalf(''); setSaveHrCode('')
    setSaveHomeTeam(''); setSaveAwayTeam(''); setSaveMatchError('')
    // The start-screen choices are cleared too. They used to survive this reset, so the NEXT video was saved under
    // the previous Match ID and Part, with the start screen never shown again. A new session starts blank: method,
    // Part and Match ID are chosen again, and the model-answer / already-saved checks run again for them.
    setStartMatchId(''); setMatchPart(null); setCollectionMethod(null); setMethodConfirmed(false)
    setModelCheck({ state:'idle' }); setDupCheck({ state:'idle' }); setDupAck(false)
    setIsModelAnswer(false)
    setSession(null)
    setEvents([])
    setVideoPath(null)
    setVideoLoaded(false)
    setVideoError(null)
    setCurrentTime(0); setDuration(0)
    setPossession({ team: null, certain: false })
    setOpenStates({})
    eventSeqRef.current = 0
    openPairsRef.current = {}
    collStartRef.current = null
    commitLockRef.current = false; lockOwnerRef.current = 0; setSaveUi(null)
    pendingWritesRef.current.clear(); editOriginalRef.current = null; editingRef.current = null
    eventsRef.current = []; seekTargetRef.current = null
    hlKeyRef.current = ''; hlNearestRef.current = null; pastRef.current = 0
    setHighlightIds([]); setHighlightNearest(null); setPastCount(0); setVerifyState(null)
    if (videoRef.current) { videoRef.current.src = ''; videoRef.current.load() }
  }

  // Not-yet-saved events, for the top-bar chip; and whether Done may write the Sheet.
  const unsaved = events.filter(e => e._status === 'failed' || e._status === 'unconfirmed')
  const anyFailed = unsaved.some(e => e._status === 'failed')
  const verifyBlocks = !!verifyState && ['checking', 'blocked', 'offline'].includes(verifyState.status)

  // ── Current group for display ──────────────────────────────────────────────
  const currentGroup = captureStep==='group' ? groupChain[groupIndex] : null
  const videoName = basename(videoPath||session?.videoPath||'')

  // ── Open state badges ──────────────────────────────────────────────────────
  const openBadges = OPEN_STATE_PAIRS.filter(p=>openStates[p.openId])

  // ── Collection method choice ───────────────────────────────────────────
  // Shown before the video, with NO default: the trainer's instruction decides,
  // and a pre-selected answer would let a collector skip the decision. Part is
  // asked here too, once per session alongside Half.
  if (!methodConfirmed) {
    const pick = (m) => setCollectionMethod(m)
    const opt = (active) => ({
      padding:'18px 16px', borderRadius:10, cursor:'pointer', textAlign:'left',
      background: active ? 'rgba(232,89,12,0.12)' : 'var(--bg-3)',
      border:`1px solid ${active ? 'var(--p2)' : 'var(--b-1)'}`, color:'var(--t-1)',
    })
    return (
      <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
        background:'var(--bg)', color:'var(--t-1)', padding:24 }}>
        <div className="card" style={{ padding:28, width:'100%', maxWidth:520 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>How will you collect?</div>
          <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:18 }}>
            Follow your trainer&rsquo;s instructions.
          </div>
          <div style={{ display:'grid', gap:10, marginBottom:20 }}>
            <button style={opt(collectionMethod === 'partial')} onClick={() => pick('partial')}>
              <div style={{ fontSize:13, fontWeight:700 }}>Not all events</div>
              <div style={{ fontSize:11, color:'var(--t-3)', marginTop:3 }}>
                Tag only the events your trainer asked for. Every event asks Home or Away.
              </div>
            </button>
            <button style={opt(collectionMethod === 'all')} onClick={() => pick('all')}>
              <div style={{ fontSize:13, fontWeight:700 }}>All events</div>
              <div style={{ fontSize:11, color:'var(--t-3)', marginTop:3 }}>
                Tag every event in the half, in order.
              </div>
            </button>
          </div>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
            textTransform:'uppercase', marginBottom:8 }}>Part of the match</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:22 }}>
            {[['1','1st half'],['2','2nd half'],['3','Extra time 1'],['4','Extra time 2'],['5','Penalties']]
              .map(([v, l]) => (
                <button key={v} onClick={() => setMatchPart(v)}
                  style={{ padding:'7px 12px', fontSize:11, borderRadius:7, cursor:'pointer',
                    background: matchPart === v ? 'rgba(232,89,12,0.14)' : 'transparent',
                    border:`1px solid ${matchPart === v ? 'var(--p2)' : 'var(--b-1)'}`,
                    color: matchPart === v ? 'var(--p2)' : 'var(--t-2)' }}>{l}</button>
              ))}
          </div>

          <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
            textTransform:'uppercase', marginBottom:8 }}>Match ID</div>
          <input value={startMatchId} inputMode="numeric" placeholder="e.g. 1366067"
            onChange={e => setStartMatchId(e.target.value.replace(/\D/g, ''))}
            style={{ width:'100%', boxSizing:'border-box', background:'var(--bg-3)',
              border:'1px solid var(--b-1)', borderRadius:7, padding:'9px 12px', fontSize:13,
              color:'var(--t-1)', outline:'none', fontFamily:'JetBrains Mono,monospace' }}/>
          <div style={{ minHeight:20, margin:'8px 0 16px', fontSize:11, lineHeight:1.5 }}>
            {modelCheck.state === 'checking' && (
              <span style={{ color:'var(--t-3)' }}>Checking for a model answer…</span>)}
            {modelCheck.state === 'none' && !caps.modelAnswer && (
              <span style={{ color:'#FF453A' }}>No model answer found for this match and half.
                You cannot collect without a model answer.</span>)}
            {modelCheck.state === 'none' && caps.modelAnswer && (
              <span style={{ color:'var(--t-3)' }}>No model answer yet for this match and half.</span>)}
            {modelCheck.state === 'found' && caps.modelAnswer && (
              <span style={{ color:'#FFD60A' }}>A model answer already exists for this match and half.
                You can continue and collect as a regular collector.</span>)}
            {modelCheck.state === 'found' && !caps.modelAnswer && (
              <span style={{ color:'#30D158' }}>Model answer found{modelCheck.home ? ` — ${modelCheck.home} v ${modelCheck.away}` : ''}.</span>)}
            {modelCheck.state === 'error' && (
              <span style={{ color:'#FF9500' }}>Couldn&rsquo;t check for a model answer — you can
                continue, and this session will be flagged as unverified.</span>)}
          </div>

          {/* What the collector typed, read back with the teams the model answer returned: a wrong Match ID or a
              wrong Part shows up as the wrong teams or the wrong half BEFORE anything is collected. */}
          {(() => {
            const line = modelCheck.state === 'found'
              ? matchSummaryLine({ matchId:startMatchId, home:modelCheck.home, away:modelCheck.away, part:matchPart }) : ''
            return line ? (
              <div data-testid="match-confirm" style={{ margin:'0 0 14px', padding:'10px 12px', borderRadius:8,
                background:'rgba(48,209,88,0.08)', border:'1px solid rgba(48,209,88,0.25)',
                fontSize:13, fontWeight:600, color:'var(--t-1)', lineHeight:1.5 }}>{line}</div>
            ) : null
          })()}
          {dupCheck.state === 'found' && (
            <div data-testid="dup-half" style={{ margin:'0 0 14px', padding:'10px 12px', borderRadius:8,
              background:'rgba(255,159,10,0.1)', border:'1px solid rgba(255,159,10,0.4)', fontSize:12, lineHeight:1.5 }}>
              <div style={{ fontWeight:700, color:'#FF9F0A' }}>You already saved this half for this match.</div>
              {dupAck
                ? <div style={{ color:'var(--t-3)', marginTop:4 }}>Understood — you can continue and collect it again.</div>
                : <button className="btn-ghost" data-testid="dup-ack" style={{ marginTop:8, padding:'6px 12px', fontSize:11 }}
                    onClick={() => setDupAck(true)}>I want to collect it again</button>}
            </div>
          )}

          <div style={{ display:'flex', gap:8 }}>
            <button className="btn-ghost" style={{ padding:'9px 16px', fontSize:12 }}
              onClick={onBack}>Back</button>
            <div style={{ flex:1 }}/>
            {(() => {
              // method + part + match ID + a passing model answer check
              // …and the already-saved check must have answered, and a 'found' must have been clicked through
              const dupClear = dupCheck.state !== 'checking' && (dupCheck.state !== 'found' || dupAck)
              const ready = !!(collectionMethod && matchPart && startMatchId.trim() && modelOk && dupClear)
              return (
                <button className="btn-orange" style={{ padding:'9px 20px', fontSize:12,
                  opacity: ready ? 1 : 0.45 }}
                  disabled={!ready}
                  onClick={() => {
                    // Everything the save dialog used to ask for is fixed here:
                    // match ID, the half (from Part), and the teams from the
                    // model answer. The HR-code comes from the sign-in.
                    setSaveMatchId(startMatchId.trim())
                    setSaveHalf(partToHalf(matchPart))
                    setSaveHrCode(String(roleInfo?.code || ''))
                    if (modelExists) {
                      setSaveHomeTeam(modelCheck.home || ''); setSaveAwayTeam(modelCheck.away || '')
                    }
                    setSession(s => s ? { ...s, collectionMethod, part: Number(matchPart),
                      matchId: startMatchId.trim(),
                      modelCheckUnverified: modelCheck.state === 'error' } : s)
                    setMethodConfirmed(true)
                  }}>Continue</button>
              )
            })()}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{height:'100vh',display:'flex',flexDirection:'column',background:'var(--bg)',userSelect:'none',overflow:'hidden'}}>

      {/* ── Top bar ── */}
      <div style={{flexShrink:0,height:48,background:'var(--bg-2)',borderBottom:'1px solid var(--b-1)',
        display:'flex',alignItems:'center',padding:'0 16px',gap:12}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'var(--t-3)',cursor:'pointer',fontSize:11,padding:'4px 8px',borderRadius:6}}>← Back</button>
        <div style={{width:1,height:20,background:'var(--b-1)'}}/>
        <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:9,fontWeight:800,color:'#30D158',letterSpacing:1.5,background:'rgba(48,209,88,0.1)',padding:'2px 8px',borderRadius:4}}>FIELD</div>
        <div style={{flex:1,fontSize:12,fontWeight:600,color:'var(--t-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{videoName||'No video'}</div>

        {/* Open state badges */}
        {openBadges.map(p=>(
          <div key={p.openId} style={{display:'flex',alignItems:'center',gap:6,background:'rgba(232,89,12,0.12)',border:'1px solid rgba(232,89,12,0.3)',borderRadius:6,padding:'2px 8px'}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'#E8590C'}}/>
            <span style={{fontSize:10,fontWeight:700,color:'#E8590C'}}>{EVENT_BY_ID[p.openId]?.label}</span>
            {p.closeKey&&<span style={{fontSize:9,color:'var(--t-3)'}}>→ {p.closeKey} to end</span>}
          </div>
        ))}

        {/* Possession indicator */}
        <div
          title="Press 0 to flip possession manually"
          style={{
            display:'flex', alignItems:'center', gap:6, padding:'3px 10px',
            borderRadius:7, cursor:'pointer',
            background: !possession.team ? 'rgba(100,100,100,0.15)'
              : possession.certain ? (possession.team==='home' ? 'rgba(10,132,255,0.15)' : 'rgba(232,89,12,0.15)')
              : 'rgba(255,149,0,0.15)',
            border: `1px solid ${!possession.team ? 'rgba(100,100,100,0.3)'
              : possession.certain ? (possession.team==='home' ? 'rgba(10,132,255,0.4)' : 'rgba(232,89,12,0.4)')
              : 'rgba(255,149,0,0.4)'}`,
          }}
          onClick={() => {
            setPossession(prev => {
              const f = prev.team==='home'?'away':prev.team==='away'?'home':null
              return {team:f,certain:true}
            })
          }}
        >
          <div style={{width:7,height:7,borderRadius:'50%',
            background:!possession.team?'#636366':possession.certain?(possession.team==='home'?'#0A84FF':'#E8590C'):'#FF9500'}}/>
          <span style={{fontSize:10,fontWeight:700,
            color:!possession.team?'var(--t-3)':possession.certain?(possession.team==='home'?'#0A84FF':'#E8590C'):'#FF9500'}}>
            {!possession.team ? '? Possession' : (possession.certain ? '' : '≈ ')}{possession.team==='home'?'Home':possession.team==='away'?'Away':'unknown'}
          </span>
          <span style={{fontSize:8,color:'var(--t-3)'}}>0</span>
        </div>

        <div style={{fontSize:11,color:'var(--t-3)'}}><span style={{color:'#30D158',fontWeight:700}}>{events.length}</span> collected</div>
        {flashEvent&&<div style={{fontSize:11,fontWeight:700,color:'#30D158',background:'rgba(48,209,88,0.15)',padding:'3px 10px',borderRadius:6}}>✓ {flashEvent}</div>}
        {flashError&&<div style={{fontSize:11,fontWeight:700,color:'#FF453A',background:'rgba(255,69,58,0.1)',padding:'3px 10px',borderRadius:6}}>{flashError}</div>}
        {/* Saving: shown the moment a key is accepted, and honest when the network is slow */}
        {saveUi&&<div data-testid="save-chip" style={{fontSize:11,fontWeight:700,color:saveUi.kind==='waiting'?'#FFD60A':'var(--p2)',background:saveUi.kind==='waiting'?'rgba(255,214,10,0.12)':'rgba(232,89,12,0.12)',padding:'3px 10px',borderRadius:6}}>{saveUi.kind==='waiting'?'Waiting for network…':'Saving…'}</div>}
        {unsaved.length>0&&(
          <button data-testid="unsaved-chip" onClick={retryUnsaved}
            style={{fontSize:11,fontWeight:700,color:anyFailed?'#FF453A':'#FFD60A',background:anyFailed?'rgba(255,69,58,0.12)':'rgba(255,214,10,0.12)',
              border:`1px solid ${anyFailed?'rgba(255,69,58,0.4)':'rgba(255,214,10,0.4)'}`,padding:'3px 10px',borderRadius:6,cursor:'pointer'}}>
            {anyFailed?`⚠ ${unsaved.length} not saved — click to retry`:`Not confirmed - will retry (${unsaved.length})`}
          </button>
        )}
        {/* Model import — hidden once done, internal users only */}
        {isInternal && !isModelImportDone() && modelImportStatus !== 'done' && (
          <button
            disabled={modelImportStatus==='running'}
            onClick={async()=>{
              setModelImportStatus('running'); setModelImportMsg('Starting…')
              try {
                const r = await importModelAnswers(msg=>setModelImportMsg(msg))
                setModelImportStatus('done')
                setModelImportMsg(r.skipped ? r.reason : `✓ ${r.sessionsWritten} sessions, ${r.eventsWritten} events`)
              } catch(e) { setModelImportStatus('error'); setModelImportMsg(e.message||String(e)) }
            }}
            style={{padding:'4px 10px',fontSize:11,fontWeight:600,flexShrink:0,
              background:modelImportStatus==='error'?'rgba(255,69,58,0.15)':'rgba(48,209,88,0.12)',
              border:`1px solid ${modelImportStatus==='error'?'rgba(255,69,58,0.4)':'rgba(48,209,88,0.3)'}`,
              borderRadius:6,color:modelImportStatus==='error'?'#FF453A':'#30D158',
              cursor:modelImportStatus==='running'?'wait':'pointer'}}>
            {modelImportStatus==='running'?modelImportMsg:modelImportStatus==='error'?`⚠ ${modelImportMsg}`:modelImportStatus==='done'?modelImportMsg:'Import Model Answers'}
          </button>
        )}
        <button data-testid="clear-all" disabled={events.length===0||!!saveUi||clearing}
          onClick={()=>{ setClearError(''); setShowClearModal(true) }}
          title="Delete every event in this session (the video, match and part are kept)"
          style={{padding:'6px 12px',fontSize:12,background:'transparent',border:'1px solid rgba(255,69,58,0.4)',borderRadius:8,
            color:'#FF453A',cursor:(events.length===0||saveUi||clearing)?'not-allowed':'pointer',opacity:(events.length===0||saveUi||clearing)?0.4:1}}>Clear all</button>
        <button className="btn-orange" style={{padding:'6px 16px',fontSize:12}} onClick={()=>{ if(editOriginalRef.current) abandonCapture(); setShowDoneModal(true) }}>Done</button>
      </div>

      {/* ── Main ── */}
      <div style={{flex:1,display:'flex',overflow:'hidden',position:'relative'}}>
        <EventsSidebar side="left"  activeKey={activeKey} onMouseEvent={onMouseEvent} insertAfter={endStoppageSlot}/>

        {/* Video */}
        <div style={{flex:1,position:'relative',background:'#000',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <video ref={videoRef}
            style={{width:'100%',height:'100%',objectFit:'contain',display:videoLoaded?'block':'none'}}
            onTimeUpdate={()=>syncDisplay(false)}
            onSeeked={()=>{
              flushSeek()                       // a newer position was waiting for this one to land
              syncDisplay(true)
              const v=videoRef.current
              if (resumeAfterSeekRef.current && seekTargetRef.current==null && v && !v.seeking) {
                resumeAfterSeekRef.current=false
                const pr=v.play(); pr && pr.catch && pr.catch(()=>{})
              }
            }}
            onLoadedMetadata={()=>{
            const dur = videoRef.current?.duration || 0
            setDuration(dur); syncDisplay(true)
            // Store video_duration_ms on session for video identity
            if (dur > 0 && session) {
              const durMs = Math.round(dur * 1000)
              const updated = { ...session, videoDurationMs: durMs }
              setSession(updated); saveLocalSession(updated)
            }
          }}
            onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)}
            onError={handleVideoError}/>
          {!videoLoaded&&(
            <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,cursor:'pointer'}}
              onClick={()=>handleVideoFile()}
              onDragOver={e=>e.preventDefault()}
              onDrop={async e=>{e.preventDefault();handleVideoFile(e.dataTransfer.files?.[0]?.path||null)}}>
              {videoError?(
                <div style={{textAlign:'center',maxWidth:380,padding:'0 20px'}}>
                  <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
                  <div style={{fontSize:13,color:'#FF453A',fontWeight:600,marginBottom:8}}>{videoError.split('\n')[0]}</div>
                  {videoError.split('\n')[1]&&<div style={{fontSize:10,color:'var(--t-3)',marginBottom:12,fontFamily:'JetBrains Mono,monospace',wordBreak:'break-all'}}>{videoError.split('\n')[1]}</div>}
                  <button className="btn-orange" style={{padding:'8px 20px',fontSize:12}} onClick={()=>{setVideoError(null);handleVideoFile()}}>Pick Video File</button>
                </div>
              ):(
                <>
                  <div style={{width:80,height:80,borderRadius:20,border:'2px dashed var(--b-2)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M5 3l14 9-14 9V3z" stroke="var(--t-3)" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:14,fontWeight:600,color:'var(--t-2)'}}>Drop video here or click to browse</div>
                    <div style={{fontSize:12,color:'var(--t-3)',marginTop:4}}>mp4 · mkv · mov · avi · webm</div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar — unknown_pass_end injected via extraItems into the scroll container */}
        <EventsSidebar side="right" activeKey={activeKey} onMouseEvent={onMouseEvent}
          extraItems={
            <div key="unknown_pass_end"
              onClick={() => {
                if (!videoLoaded || captureStep !== 'idle') return
                const def = EVENT_BY_ID['unknown_pass_end']
                if (def) startCapture(def, getVideoTime())
              }}
              style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'7px 12px', cursor:'pointer',
                borderTop:'1px solid var(--b-1)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{fontSize:12, color:'var(--t-2)', fontFamily:'DM Sans,sans-serif'}}>
                Unknown pass end
              </span>
              <span style={{fontSize:9, color:'var(--t-3)', fontStyle:'italic', opacity:0.6}}>
                click
              </span>
            </div>
          }
        />

        {/* ── Capture panel ── */}
        {captureStep!=='idle'&&pendingEvent&&(
          <div style={{position:'absolute',bottom:0,left:168,right:168,background:'var(--bg-2)',
            borderTop:'2px solid #30D158',padding:'14px 20px 16px',zIndex:100,
            boxShadow:'0 -8px 32px rgba(0,0,0,0.5)'}}>

            {/* Header */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:12,fontWeight:700,
                  background:'#30D158',color:'#000',borderRadius:5,padding:'2px 8px'}}>
                  {pendingEvent.label}
                </span>
                {/* Breadcrumb: collected groups so far */}
                {collectedGroups.map((g,i)=>(
                  <span key={i} style={{fontSize:10,color:'var(--t-3)'}}>
                    {g.groupLabel}: <span style={{color:'var(--t-2)',fontWeight:600}}>
                      {g.selections?.map(s=>s.label).join(', ')||'—'}
                    </span>
                  </span>
                ))}
              </div>
              <button onClick={abandonCapture} style={{background:'none',border:'none',color:'var(--t-3)',cursor:'pointer',fontSize:11}}>ESC Cancel</button>
            </div>

            {/* Type confirm step */}
            {captureStep==='type_confirm'&&(
              <>
                <div style={{fontSize:9,fontWeight:800,color:'var(--t-3)',letterSpacing:1,marginBottom:8,textTransform:'uppercase'}}>
                  Pass type — Enter to confirm, letter to change
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {PASS_TYPE_OPTIONS.filter(o=>!allowedPassTypes||allowedPassTypes.includes(o.code)).map(opt=>{
                    const active=pendingType?.code===opt.code
                    return (
                      <div key={opt.code}
                        onClick={()=>{
                          setPendingType(opt); setPendingTypeSource('manual')
                          const chain=pendingEvent.variants.variants.find(v=>v.when.includes(opt.code))?.groups||pendingEvent.variants.variants[0].groups
                          setGroupChain(chain);setGroupIndex(0);setCurrentSelections([])
                          if(chain.length>0)setCaptureStep('group');else commitEvent(null,undefined,null,[],null,null,pendingTeam,pendingTeamSource||'manual')
                        }}
                        style={{display:'flex',alignItems:'center',gap:7,padding:'6px 10px',
                          background:active?'rgba(48,209,88,0.18)':'var(--bg-3)',
                          border:`1px solid ${active?'#30D158':'var(--b-1)'}`,borderRadius:7,cursor:'pointer'}}>
                        <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,fontWeight:700,
                          background:'var(--bg-3)',color:'var(--t-2)',border:'1px solid var(--b-2)',borderRadius:4,padding:'1px 5px'}}>
                          {opt.toggleKey}
                        </span>
                        <span style={{fontSize:12,color:active?'#30D158':'var(--t-1)',fontWeight:active?700:400}}>
                          {opt.label}
                        </span>
                        {active&&(
                          <span style={{fontSize:9,color:'var(--t-3)'}}>
                            {pendingTypeSource==='manual'?'(manual)':'(inferred)'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button onClick={()=>{
                  const chain=pendingEvent.variants.variants.find(v=>v.when.includes(pendingType?.code))?.groups||pendingEvent.variants.variants[0].groups
                  setGroupChain(chain);setGroupIndex(0);setCurrentSelections([])
                  if(chain.length>0)setCaptureStep('group');else commitEvent(null,undefined,null,[],null,null,pendingTeam,pendingTeamSource||'manual')
                }} style={{marginTop:10,background:'rgba(48,209,88,0.15)',border:'1px solid rgba(48,209,88,0.3)',
                  borderRadius:7,padding:'7px 16px',color:'#30D158',cursor:'pointer',fontSize:12,fontWeight:600}}>
                  Enter — Confirm {pendingType?.label}
                </button>
              </>
            )}

            {/* Group step */}
            {captureStep==='group'&&currentGroup&&(
              <>
                <div style={{fontSize:9,fontWeight:800,color:'var(--t-3)',letterSpacing:1,marginBottom:8,textTransform:'uppercase'}}>
                  {currentGroup.label} — {currentGroup.selectType==='single'?'select one':'select any, Enter when done'}{!currentGroup.required?' (optional)':''}
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {getGroupOptions(currentGroup, collectedGroups, currentSelections, { allEvents }).map(opt=>{
                    const sel=currentSelections.find(s=>s.code===opt.code)
                    return (
                      <div key={opt.code}
                        onClick={()=>{
                          if(currentGroup.selectType==='single'){commitGroupSelections([opt])}
                          else{setCurrentSelections(prev=>prev.find(s=>s.code===opt.code)?prev.filter(s=>s.code!==opt.code):[...prev,opt])}
                        }}
                        style={{display:'flex',alignItems:'center',gap:7,padding:'6px 10px',
                          background:sel?'rgba(48,209,88,0.18)':'var(--bg-3)',
                          border:`1px solid ${sel?'#30D158':'var(--b-1)'}`,borderRadius:7,cursor:'pointer'}}>
                        <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,fontWeight:700,
                          background:'var(--bg-3)',color:'var(--t-2)',border:'1px solid var(--b-2)',borderRadius:4,padding:'1px 5px'}}>
                          {opt.toggleKey}
                        </span>
                        <span style={{fontSize:12,color:sel?'#30D158':'var(--t-1)',fontWeight:sel?700:400}}>{opt.label}</span>
                        {sel&&<span style={{fontSize:10,color:'#30D158'}}>✓</span>}
                      </div>
                    )
                  })}
                </div>
                {(!currentGroup.required||(currentGroup.selectType==='multi'&&currentSelections.length>0))&&(
                  <button onClick={()=>commitGroupSelections(currentSelections)}
                    style={{marginTop:10,background:'rgba(48,209,88,0.15)',border:'1px solid rgba(48,209,88,0.3)',
                      borderRadius:7,padding:'7px 16px',color:'#30D158',cursor:'pointer',fontSize:12,fontWeight:600}}>
                    Enter — {!currentGroup.required&&currentSelections.length===0?'Skip':'Continue'}
                  </button>
                )}
              </>
            )}

            {/* Team step */}
            {captureStep==='team'&&(
              <>
                <div style={{fontSize:9,fontWeight:800,color:'var(--t-3)',letterSpacing:1,marginBottom:8,textTransform:'uppercase'}}>
                  Team — 1 Home · 2 Away · required
                </div>
                {/* No Skip. Team is required on every event, so there is no
                    button that saves without a side. ESC still cancels the
                    whole event, as it always did. */}
                <div style={{display:'flex',gap:8}}>
                  {TEAM_OPTIONS.map(t=>(
                    <button key={t.code}
                      onClick={()=>chooseTeam(t.code)}
                      style={{flex:1,padding:'10px 0',background:t.bg,border:`1px solid ${t.color}44`,
                        borderRadius:8,color:t.color,cursor:'pointer',fontWeight:700,fontSize:13,
                        display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                      <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:11,background:'rgba(255,255,255,0.07)',padding:'1px 6px',borderRadius:4}}>{t.key}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Scrub bar ── */}
      <div style={{flexShrink:0,background:'var(--bg-2)',borderTop:'1px solid var(--b-1)',padding:'4px 16px 8px'}}>
        <ErrorTimeline errors={events} videoDuration={duration} videoRef={videoRef}
          currentTime={currentTime} playing={playing} muted={muted}
          onSeek={seekTo} onSyncSeek={seekTo} onTogglePlay={togglePlay} onToggleMute={toggleMute}
          onDragStart={onScrubStart} onDragEnd={onScrubEnd}/>
      </div>

      {/* ── Events list ── */}
      <TaggedEventsList tags={events} videoDuration={duration}
        matchName="Home vs Away" onEdit={onEditStable} onDelete={onDeleteStable} onSeek={onSeekStable} onRetry={onRetryStable}
        highlightIds={highlightIds} highlightNearestId={highlightNearest} pastCount={pastCount}/>

      {perfEnabled() && <PerfOverlay videoRef={videoRef} renderCountRef={renderCountRef} eventCount={events.length}/>}

      {/* ── Clear all events — confirm with the MOUSE only ── */}
      {showClearModal && (
        <div data-testid="clear-modal" style={{position:'fixed',inset:0,zIndex:1100,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div className="card slide-up" style={{width:420,padding:26}}>
            <div style={{fontFamily:'Inter',fontWeight:800,fontSize:17,color:'var(--t-1)',marginBottom:8}}>
              Delete all {events.length} events from this session? This cannot be undone.
            </div>
            <div style={{fontSize:12,color:'var(--t-3)',marginBottom:18,lineHeight:1.5}}>
              The video, match, part and method are kept. Anything already saved to the Sheet is not touched.
            </div>
            {clearError&&<div style={{fontSize:11,color:'#FF453A',background:'rgba(255,69,58,0.08)',padding:'8px 10px',borderRadius:8,marginBottom:12,wordBreak:'break-word'}}>{clearError}</div>}
            <div style={{display:'flex',gap:10}}>
              {/* Cancel has the focus, so an accidental Enter or Space lands on Cancel */}
              <button autoFocus data-testid="clear-cancel" onClick={()=>setShowClearModal(false)}
                style={{flex:1,padding:'10px 0',fontSize:13,background:'var(--bg-3)',border:'1px solid var(--b-1)',borderRadius:8,color:'var(--t-1)',cursor:'pointer'}}>Cancel</button>
              {/* detail === 0 is a click synthesised by Enter/Space; a real mouse click has detail >= 1 */}
              <button data-testid="clear-confirm" disabled={clearing}
                onKeyDown={e=>{ if(e.key==='Enter'||e.key===' ') e.preventDefault() }}
                onClick={e=>{ if(e.detail===0) return; clearAllEvents() }}
                style={{flex:1,padding:'10px 0',fontSize:13,fontWeight:700,background:'rgba(255,69,58,0.15)',border:'1px solid rgba(255,69,58,0.5)',borderRadius:8,color:'#FF453A',cursor:clearing?'wait':'pointer'}}>
                {clearing?'Deleting…':`Delete all ${events.length} events`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending upload notification (shown on launch if previous save failed) ── */}
      {pendingUpload && !showDoneModal && (
        <div style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',
          zIndex:500,background:'var(--bg-2)',border:'1px solid rgba(255,149,0,0.5)',
          borderRadius:10,padding:'14px 20px',maxWidth:440,boxShadow:'0 4px 20px rgba(0,0,0,0.5)'}}>
          <div style={{fontSize:13,fontWeight:700,color:'#FF9500',marginBottom:6}}>
            ⚠️ Unsaved session from previous launch
          </div>
          <div style={{fontSize:11,color:'var(--t-3)',marginBottom:12}}>
            {pendingUpload.videoName} · {pendingUpload.totalEvents||0} events · Match {pendingUpload.matchId||'?'} H{pendingUpload.half||'?'}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn-orange" style={{flex:2,padding:'7px 0',fontSize:12}}
              onClick={async()=>{
                setSubmitting(true)
                const evSnap = await getDocs(query(collection(db,'mark_collected_events'),where('sessionId','==',pendingUpload.sessionId)))
                const pendingEvs = evSnap.docs.map(d=>d.data())
                await handleRetryUpload(pendingUpload, pendingEvs)
              }}>
              {submitting ? 'Uploading…' : 'Retry upload to Sheet'}
            </button>
            <div style={{flex:1,display:'flex',flexDirection:'column',gap:3}}>
              <button style={{padding:'7px 0',fontSize:12,background:'var(--bg-3)',
                border:'1px solid var(--b-1)',borderRadius:7,color:'var(--t-2)',cursor:csvDlState==='saving'?'default':'pointer',
                opacity:csvDlState==='saving'?0.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:5,width:'100%'}}
                disabled={csvDlState==='saving'}
                onClick={async()=>{
                  if (csvDlState === 'saving') return
                  setCsvDlState('saving'); setCsvDlPath(''); setCsvDlError('')
                  try {
                    const evSnap = await getDocs(query(collection(db,'mark_collected_events'),where('sessionId','==',pendingUpload.sessionId)))
                    const pendingEvs = evSnap.docs.map(d=>d.data())
                    const p = await downloadFieldCsv(pendingUpload, pendingEvs)
                    if (p) { setCsvDlPath(p); setCsvDlState('done'); showToast(`Saved to ${p}`); setTimeout(()=>setCsvDlState('idle'),8000) }
                    else setCsvDlState('idle')
                  } catch(e) { const msg=e?.message||String(e); setCsvDlError(msg); setCsvDlState('error'); showToast(`Download failed: ${msg}`,'error'); setTimeout(()=>setCsvDlState('idle'),8000) }
                }}>
                {csvDlState==='saving'
                  ? <><svg style={{animation:'spin 1s linear infinite'}} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity=".3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Saving…</>
                  : 'Export CSV'
                }
              </button>
              {csvDlState === 'done' && csvDlPath && (
                <div style={{fontSize:9,color:'#30D158',display:'flex',alignItems:'center',gap:4}}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  <button onClick={async()=>{const {invoke}=await import('@tauri-apps/api/core');invoke('open_folder',{path:csvDlPath})}} style={{fontSize:9,color:'var(--p2)',background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline'}}>Open folder</button>
                </div>
              )}
              {csvDlState === 'error' && <div style={{fontSize:9,color:'#FF453A'}}>{csvDlError}</div>}
            </div>
            <button style={{flex:1,padding:'7px 0',fontSize:12,background:'transparent',
              border:'1px solid rgba(255,69,58,0.3)',borderRadius:7,color:'#FF453A',cursor:'pointer'}}
              onClick={()=>{
                if (window.confirm('Discard this session? This cannot be undone.')) {
                  saveLocalSession({...pendingUpload,status:'discarded'})
                  setPendingUpload(null)
                }
              }}>
              Discard
            </button>
          </div>
          {saveResult?.status==='failed' && (
            <div style={{marginTop:8,fontSize:11,color:'#FF453A',background:'rgba(255,69,58,0.08)',
              padding:'6px 10px',borderRadius:6}}>{saveResult.message}</div>
          )}
          {saveResult?.status==='success' && (
            <div style={{marginTop:8,fontSize:11,color:'#30D158'}}>
              ✓ Uploaded {saveResult.rowsWritten} rows successfully
            </div>
          )}
        </div>
      )}

      {/* ── Save / Done modal ──────────────────────────────────────────────────── */}
      {showDoneModal && (
        <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.85)',
          backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div className="card slide-up" style={{width:460,padding:28,maxHeight:'90vh',overflowY:'auto'}}>

            {/* Every event in the bar must be in Firestore before the Sheet is written */}
            {verifyState && saveResult?.status !== 'success' && (
              <div data-testid="verify-banner" data-status={verifyState.status} style={{
                fontSize:11,lineHeight:1.5,padding:'8px 12px',borderRadius:8,marginBottom:14,
                color: verifyState.status==='checking' ? 'var(--t-2)' : (verifyState.status==='ok'||verifyState.status==='repaired') ? '#30D158' : '#FF453A',
                background: verifyState.status==='checking' ? 'var(--bg-3)' : (verifyState.status==='ok'||verifyState.status==='repaired') ? 'rgba(48,209,88,0.08)' : 'rgba(255,69,58,0.08)'}}>
                {verifyState.status==='checking' && `Verifying that all ${verifyState.total} events are saved in Firestore…`}
                {verifyState.status==='ok' && `✓ All ${verifyState.total} events confirmed in Firestore.`}
                {verifyState.status==='repaired' && `✓ Some events were missing from Firestore and have been re-saved. All ${verifyState.total} are now confirmed.`}
                {verifyState.status==='blocked' && <>✗ {verifyState.missing} of {verifyState.total} events are NOT in Firestore. Saving to the Sheet is blocked. <button onClick={verifyEventsInFirestore} style={{background:'none',border:'none',color:'var(--p2)',cursor:'pointer',textDecoration:'underline',fontSize:11}}>Retry</button></>}
                {verifyState.status==='offline' && <>Can't reach Firestore, so {verifyState.total} events are not confirmed. The CSV export below still works. <button onClick={verifyEventsInFirestore} style={{background:'none',border:'none',color:'var(--p2)',cursor:'pointer',textDecoration:'underline',fontSize:11}}>Retry</button></>}
              </div>
            )}

            {/* ── Success state ── */}
            {saveResult?.status === 'success' ? (
              <>
                <div style={{fontSize:32,textAlign:'center',marginBottom:12}}>✅</div>
                <div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'var(--t-1)',textAlign:'center',marginBottom:6}}>
                  Saved to Sheet
                </div>
                <div style={{fontSize:12,color:'var(--t-3)',textAlign:'center',marginBottom:16}}>
                  {saveResult.rowsWritten} rows written
                </div>
                {saveResult.duplicateHalfWarning && (
                  <div style={{background:'rgba(255,149,0,0.1)',border:'1px solid rgba(255,149,0,0.3)',
                    borderRadius:8,padding:'8px 12px',marginBottom:16,fontSize:11,color:'#FF9500'}}>
                    ⚠️ Another session for Match {saveMatchId} H{saveHalf} + {saveHrCode} already exists in the sheet ({saveResult.duplicateHalfWarning})
                  </div>
                )}
                <div style={{display:'flex',gap:10}}>
                  <div style={{flex:1,display:'flex',flexDirection:'column',gap:4}}>
                    <button style={{padding:'10px 0',fontSize:13,background:'var(--bg-3)',
                      border:'1px solid var(--b-1)',borderRadius:8,color:'var(--t-2)',cursor:csvDlState==='saving'?'default':'pointer',
                      opacity:csvDlState==='saving'?0.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,width:'100%'}}
                      disabled={csvDlState==='saving'}
                      onClick={handleExportCsvOnly}>
                      {csvDlState==='saving'
                        ? <><svg style={{animation:'spin 1s linear infinite'}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity=".3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Saving…</>
                        : 'Download CSV'
                      }
                    </button>
                    {csvDlState === 'done' && csvDlPath && (
                      <div style={{fontSize:10,color:'#30D158',display:'flex',alignItems:'center',gap:6}}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={csvDlPath}>Saved</span>
                        <button onClick={async()=>{const {invoke}=await import('@tauri-apps/api/core');invoke('open_folder',{path:csvDlPath})}} style={{fontSize:10,color:'var(--p2)',background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline'}}>Open folder</button>
                      </div>
                    )}
                    {csvDlState === 'error' && <div style={{fontSize:10,color:'#FF453A'}}>{csvDlError}</div>}
                  </div>
                  <button className="btn-orange" style={{flex:2,padding:'10px 0',fontSize:13}}
                    onClick={handleStartFresh}>
                    Start New Session
                  </button>
                </div>
              </>
            ) : saveResult?.status === 'failed' ? (
              /* ── Failed state ── */
              <>
                <div style={{fontSize:32,textAlign:'center',marginBottom:12}}>❌</div>
                <div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'#FF453A',textAlign:'center',marginBottom:8}}>
                  Upload Failed
                </div>
                <div style={{fontSize:11,color:'var(--t-3)',background:'rgba(255,69,58,0.08)',
                  padding:'10px 12px',borderRadius:8,marginBottom:16,fontFamily:'JetBrains Mono,monospace',
                  wordBreak:'break-word'}}>
                  {saveResult.message}
                </div>
                <div style={{fontSize:12,color:'var(--t-2)',marginBottom:16}}>
                  Your data is safe locally. Choose an option:
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <button className="btn-orange" style={{padding:'10px 0',fontSize:13}}
                    disabled={submitting||verifyBlocks} onClick={handleSaveToSheet}>
                    {submitting ? 'Retrying…' : 'Retry Upload'}
                  </button>
                  <div style={{display:'flex',flexDirection:'column',gap:4}}>
                    <button style={{padding:'10px 0',fontSize:13,background:'var(--bg-3)',
                      border:'1px solid var(--b-1)',borderRadius:8,color:'var(--t-2)',cursor:csvDlState==='saving'?'default':'pointer',
                      opacity:csvDlState==='saving'?0.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,width:'100%'}}
                      disabled={csvDlState==='saving'}
                      onClick={handleExportCsvOnly}>
                      {csvDlState==='saving'
                        ? <><svg style={{animation:'spin 1s linear infinite'}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity=".3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Saving…</>
                        : 'Export as CSV (offline fallback)'
                      }
                    </button>
                    {csvDlState === 'done' && csvDlPath && (
                      <div style={{fontSize:10,color:'#30D158',display:'flex',alignItems:'center',gap:6}}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}} title={csvDlPath}>{csvDlPath}</span>
                        <button onClick={async()=>{const {invoke}=await import('@tauri-apps/api/core');invoke('open_folder',{path:csvDlPath})}} style={{fontSize:10,color:'var(--p2)',background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline',flexShrink:0}}>Open folder</button>
                      </div>
                    )}
                    {csvDlState === 'error' && <div style={{fontSize:10,color:'#FF453A'}}>{csvDlError}</div>}
                  </div>
                  <button style={{padding:'10px 0',fontSize:13,background:'transparent',
                    border:'1px solid rgba(255,255,255,0.08)',borderRadius:8,color:'var(--t-3)',cursor:'pointer'}}
                    onClick={()=>setShowDoneModal(false)}>
                    Keep collecting — save later
                  </button>
                  <button style={{padding:'10px 0',fontSize:13,background:'transparent',
                    border:'1px solid rgba(255,69,58,0.2)',borderRadius:8,color:'#FF453A',cursor:'pointer'}}
                    onClick={()=>{ if(window.confirm('Discard all collected data? This cannot be undone.')) handleDiscard() }}>
                    Discard session
                  </button>
                </div>
              </>
            ) : (
              /* ── Metadata entry state ── */
              <>
                <div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'var(--t-1)',marginBottom:4}}>
                  Save Session
                </div>
                <div style={{fontSize:12,color:'var(--t-3)',marginBottom:20}}>
                  {basename(videoPath||session?.videoPath||'')} · {events.length} events
                </div>

                {/* Stats summary */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:20}}>
                  <div style={{background:'var(--bg-3)',borderRadius:8,padding:'10px',textAlign:'center'}}>
                    <div style={{fontSize:20,fontWeight:900,color:'#30D158'}}>{events.length}</div>
                    <div style={{fontSize:9,color:'var(--t-3)',marginTop:2}}>Events</div>
                  </div>
                  <div style={{background:'rgba(10,132,255,0.08)',border:'1px solid rgba(10,132,255,0.15)',borderRadius:8,padding:'10px',textAlign:'center'}}>
                    <div style={{fontSize:20,fontWeight:900,color:'#0A84FF'}}>{events.filter(e=>e.team==='home').length}</div>
                    <div style={{fontSize:9,color:'var(--t-3)',marginTop:2}}>Home</div>
                  </div>
                  <div style={{background:'rgba(232,89,12,0.08)',border:'1px solid rgba(232,89,12,0.15)',borderRadius:8,padding:'10px',textAlign:'center'}}>
                    <div style={{fontSize:20,fontWeight:900,color:'#E8590C'}}>{events.filter(e=>e.team==='away').length}</div>
                    <div style={{fontSize:9,color:'var(--t-3)',marginTop:2}}>Away</div>
                  </div>
                </div>

                {/* Required metadata */}
                <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
                  {/* Match ID, Half and HR-code were typed here. They are now fixed on
                      the start screen and from the sign-in, so this is read-only — the
                      collector confirms them rather than entering them again. */}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,padding:'10px 12px',
                    background:'var(--bg-3)',borderRadius:8,border:'1px solid var(--b-1)'}}>
                    {[['Match ID', saveMatchId || startMatchId],
                      ['Half', saveHalf || partToHalf(matchPart)],
                      ['HR-Code', saveHrCode || roleInfo?.code]].map(([l, v]) => (
                      <div key={l}>
                        <div style={{fontSize:9,fontWeight:700,color:'var(--t-3)',letterSpacing:0.8,textTransform:'uppercase'}}>{l}</div>
                        <div style={{fontSize:13,fontWeight:600,marginTop:2,fontFamily:'JetBrains Mono,monospace'}}>{v || '—'}</div>
                      </div>
                    ))}
                     {/* The last check before saving: is this the video that belongs to that Match ID? */}
                     <div style={{gridColumn:'1 / -1',minWidth:0}}>
                       <div style={{fontSize:9,fontWeight:700,color:'var(--t-3)',letterSpacing:0.8,textTransform:'uppercase'}}>Video file</div>
                       <div data-testid="save-video-name" title={videoName || session?.videoName || ''}
                         style={{fontSize:13,fontWeight:600,marginTop:2,fontFamily:'JetBrains Mono,monospace',
                           overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{videoName || session?.videoName || '—'}</div>
                     </div>
                  </div>
                </div>

                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div>
                      <div style={{fontSize:10,fontWeight:700,color:'var(--t-3)',letterSpacing:0.8,marginBottom:4,textTransform:'uppercase'}}>Home Team</div>
                      <input value={saveHomeTeam} onChange={e=>setSaveHomeTeam(e.target.value)}
                        placeholder="Home team name"
                        style={{width:'100%',background:'var(--bg-3)',border:'1px solid var(--b-1)',
                          borderRadius:7,padding:'8px 12px',fontSize:13,color:'var(--t-1)',outline:'none',boxSizing:'border-box'}}/>
                    </div>
                    <div>
                      <div style={{fontSize:10,fontWeight:700,color:'var(--t-3)',letterSpacing:0.8,marginBottom:4,textTransform:'uppercase'}}>Away Team</div>
                      <input value={saveAwayTeam} onChange={e=>setSaveAwayTeam(e.target.value)}
                        placeholder="Away team name"
                        style={{width:'100%',background:'var(--bg-3)',border:'1px solid var(--b-1)',
                          borderRadius:7,padding:'8px 12px',fontSize:13,color:'var(--t-1)',outline:'none',boxSizing:'border-box'}}/>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:'#FF453A',background:'rgba(255,69,58,0.08)',
                    padding:'7px 10px',borderRadius:6,marginBottom:12}}>
                    {saveMatchError}
                  </div>
                )}

                {!events.some(e=>e.eventId==='half_end') && events.length>0 && (
                  <div style={{fontSize:11,color:'#FF9500',background:'rgba(255,149,0,0.08)',
                    padding:'7px 10px',borderRadius:6,marginBottom:12}}>
                    ⚠️ No Half End event — collection_incomplete=1 will be set
                  </div>
                )}

                {/* Model answer toggle — internal users only */}
                {isInternal && (
                <div onClick={()=>{ if (!modelExists) setIsModelAnswer(v=>!v) }}
                  title={modelExists ? 'A model answer already exists for this match and half' : ''}
                  style={{display:'flex',alignItems:'center',gap:12,padding:'10px 12px',
                    marginBottom:12,
                    background:isModelAnswer?'rgba(48,209,88,0.1)':'var(--bg-3)',
                    border:`1px solid ${isModelAnswer?'rgba(48,209,88,0.4)':'var(--b-1)'}`,
                    borderRadius:8,cursor:modelExists?'not-allowed':'pointer',
                    opacity:modelExists?0.45:1}}>
                  <div style={{width:18,height:18,borderRadius:5,flexShrink:0,
                    background:isModelAnswer?'#30D158':'transparent',
                    border:`2px solid ${isModelAnswer?'#30D158':'var(--b-2)'}`,
                    display:'flex',alignItems:'center',justifyContent:'center'}}>
                    {isModelAnswer&&<span style={{color:'#000',fontSize:11,fontWeight:900}}>✓</span>}
                  </div>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:isModelAnswer?'#30D158':'var(--t-1)'}}>
                      This is a model answer
                    </div>
                    <div style={{fontSize:10,color:'var(--t-3)',marginTop:1}}>
                      Saves with is_model=1, model_status=approved
                    </div>
                  </div>
                </div>
                )}

                <div style={{display:'flex',gap:10}}>
                  <button style={{flex:1,padding:'10px 0',fontSize:13,background:'transparent',
                    border:'1px solid var(--b-1)',borderRadius:8,color:'var(--t-3)',cursor:'pointer'}}
                    onClick={()=>setShowDoneModal(false)}>
                    Cancel
                  </button>
                  <div style={{flex:1,display:'flex',flexDirection:'column',gap:4}}>
                    <button style={{padding:'10px 0',fontSize:13,background:'var(--bg-3)',
                      border:'1px solid var(--b-1)',borderRadius:8,color:'var(--t-2)',cursor:csvDlState==='saving'?'default':'pointer',
                      opacity:csvDlState==='saving'?0.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,width:'100%'}}
                      disabled={csvDlState==='saving'}
                      onClick={handleExportCsvOnly}>
                      {csvDlState==='saving'
                        ? <><svg style={{animation:'spin 1s linear infinite'}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity=".3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Saving…</>
                        : 'CSV only'
                      }
                    </button>
                    {csvDlState === 'done' && csvDlPath && (
                      <div style={{fontSize:10,color:'#30D158',display:'flex',alignItems:'center',gap:6}}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}} title={csvDlPath}>Saved</span>
                        <button onClick={async()=>{const {invoke}=await import('@tauri-apps/api/core');invoke('open_folder',{path:csvDlPath})}} style={{fontSize:10,color:'var(--p2)',background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline',flexShrink:0}}>Open folder</button>
                      </div>
                    )}
                    {csvDlState === 'error' && <div style={{fontSize:10,color:'#FF453A'}}>{csvDlError}</div>}
                  </div>
                  <button className="btn-orange" style={{flex:2,padding:'10px 0',fontSize:13}}
                    disabled={submitting||verifyBlocks} onClick={handleSaveToSheet}>
                    {submitting ? 'Saving…' : 'Save to Sheet'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
