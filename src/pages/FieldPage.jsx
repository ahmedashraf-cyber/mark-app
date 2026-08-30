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
import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { db } from '../firebase/config'
import { collection, addDoc, updateDoc, doc, setDoc,
         getDocs, query, where, serverTimestamp, deleteDoc } from 'firebase/firestore'
import { useAuth } from '../hooks/useAuth.jsx'
import ErrorTimeline from '../components/ErrorTimeline'
import EventsSidebar from '../components/EventsSidebar'
import TaggedEventsList from '../components/TaggedEventsList'
import { downloadFieldCsv } from '../utils/exportFieldSession'
import {
  FIELD_EVENTS, EVENT_BY_ID, EVENT_BY_KEY,
  OPEN_STATE_PAIRS, TRANSPARENT_EVENT_IDS,
  OPTIONS, PASS_TYPE_OPTIONS, inferPassType,
  POSSESSION_RULES, resolveTeam, applyFlip,
  needsExplicitTeam, teamNotMeaningful, getMiscommunicationTeam,
} from '../utils/fieldExtras'

// ─── Session helpers ──────────────────────────────────────────────────────────
function hashPath(p) {
  try { return btoa(encodeURIComponent(p)).replace(/[/+=]/g,'').slice(0,14) }
  catch { return String(Date.now()).slice(-10) }
}
const LS_KEY = 'mark_field_sessions'
function loadLocalSessions() { try { return JSON.parse(localStorage.getItem(LS_KEY)||'[]') } catch { return [] } }
function saveLocalSession(s) {
  const all = loadLocalSessions().filter(x => x.sessionId !== s.sessionId)
  localStorage.setItem(LS_KEY, JSON.stringify([s,...all].slice(0,50)))
}
function findSessionByPath(p) { return loadLocalSessions().find(s => s.videoPath===p && s.status!=='completed')||null }
function basename(p) { return p ? (p.split(/[\\/]/).pop()||p) : 'Untitled' }

// ─── Capture state machine ────────────────────────────────────────────────────
// idle → type_confirm (pass only) → group:N → team → commit
// Each group step collects selections for that group, then advances.

// KEYS for group option selection (per spec: verbatim toggleKey, not remapped)
// The keyboard handler maps the *group's* toggleKey list, not a global array.

function getGroupOptions(group) { return group?.options || [] }

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
const TEAM_OPTIONS = [
  { code:'home', label:'Home', key:'1', color:'#0A84FF', bg:'rgba(10,132,255,0.15)' },
  { code:'away', label:'Away', key:'2', color:'#E8590C', bg:'rgba(232,89,12,0.15)'  },
]

export default function FieldPage({ session: initialSession, onDone, onBack }) {
  const { profile } = useAuth()
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
  const [events,       setEvents]       = useState([])  // committed events

  // ── Possession state ───────────────────────────────────────────────────────
  // { team: 'home'|'away'|null, certain: boolean }
  // null = not yet set (before first Half start)
  // certain=false = uncertain (Block/Clearance/Punch/Miscontrol etc.)
  const [possession,   setPossession]   = useState({ team: null, certain: false })

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

  // ── Flash ──────────────────────────────────────────────────────────────────
  const [flashEvent,  setFlashEvent]  = useState(null)
  const [flashError,  setFlashError]  = useState(null)  // blocked keypress message

  // ── Done modal ─────────────────────────────────────────────────────────────
  const [showDoneModal, setShowDoneModal] = useState(false)
  const [submitting,    setSubmitting]   = useState(false)

  // ── Load events on session load ────────────────────────────────────────────
  useEffect(() => {
    if (!session?.sessionId) return
    getDocs(query(collection(db,'mark_collected_events'),where('sessionId','==',session.sessionId)))
      .then(snap => setEvents(snap.docs.map(d=>({...d.data(),_docId:d.id})).sort((a,b)=>a.videoTimeSec-b.videoTimeSec)))
      .catch(e => console.warn('[MARK Field] load events:',e))
  }, [session?.sessionId])

  // ── Restore session from localStorage ─────────────────────────────────────
  useEffect(() => {
    if (session) return
    const saved = loadLocalSessions().find(s => s.status !== 'completed')
    if (!saved) return
    setSession(saved)
    if (saved.videoPath) {
      invoke('get_video_url',{path:saved.videoPath})
        .then(url => { setVideoPath(saved.videoPath); const v=videoRef.current; if(v){v.src=url;v.load();setVideoLoaded(true)} })
        .catch(() => { setVideoPath(saved.videoPath); setVideoError(`Video not found — pick a new location.\n${saved.videoPath}`) })
    }
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
      if (v) { v.src=url; v.load(); setVideoLoaded(true) }
      await ensureSession(path)
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
  function seekBy(s) {
    const v=videoRef.current; if(!v) return
    v.currentTime=Math.max(0,Math.min(v.duration||0,v.currentTime+s)); setCurrentTime(v.currentTime)
  }
  function seekTo(s) {
    const v=videoRef.current; if(!v) return
    if(!isFinite(s)||!isFinite(v.duration)) return
    v.currentTime=Math.max(0,Math.min(v.duration,s)); setCurrentTime(v.currentTime)
  }
  function toggleMute() { const v=videoRef.current;if(!v)return;v.muted=!v.muted;setMuted(v.muted) }

  // ── Start capture ──────────────────────────────────────────────────────────
  function startCapture(eventDef, vt, overrideAsClose) {
    if (!session) return
    if (collStartRef.current===null) collStartRef.current=Date.now()

    // Half end force-closes all open states
    if (eventDef.forceClosesAll) {
      Object.keys(openStates).forEach(oid => {
        const pair = OPEN_STATE_PAIRS.find(p=>p.openId===oid)
        if (pair) commitEvent(EVENT_BY_ID[pair.closeId],vt,null,[],null,null,openStates[oid]?.team,'inferred',true)
      })
      setOpenStates({})
    }

    // For close events: inherit team from open state if teamInherited
    let inheritedTeam = null
    if (eventDef.closesEventId && eventDef.teamInherited) {
      inheritedTeam = openStates[eventDef.closesEventId]?.team || null
    }

    setPendingEvent(eventDef)
    setPendingVideoTime(vt)
    setPendingType(null)
    setPendingTypeSource(null)
    setResolvedVariant(null)
    setGroupIndex(0)
    setCollectedGroups([])
    setCurrentSelections([])

    // Resolve team from possession (or keep null for explicit/n/a events)
    const resolvedTeam = resolveTeam(eventDef.id, possession)
    const teamSrc = resolvedTeam !== null ? 'inferred' : null
    setPendingTeam(resolvedTeam)
    setPendingTeamSource(teamSrc)

    // Pass type inference
    if (eventDef.id === 'pass') {
      const { type, defaulted } = inferPassType(events, possession)
      setPendingType(type)
      setPendingTypeSource(defaulted ? 'inferred_default' : 'inferred')
      setCaptureStep('type_confirm')
      return
    }

    // Goal keeper: show type group first
    if (eventDef.id === 'goal_keeper' && eventDef.typeGroup) {
      setGroupChain([eventDef.typeGroup])
      setCaptureStep('group')
      return
    }

    // Variant event with discriminator: show first group
    if (eventDef.variants) {
      const firstVariantGroups = eventDef.variants.variants[0].groups
      setGroupChain(firstVariantGroups)
      setCaptureStep('group')
      return
    }

    // Close event with inherited team — skip team step
    if (eventDef.closesEventId && eventDef.teamInherited && inheritedTeam) {
      const chain = eventDef.groups || []
      setGroupChain(chain)
      if (chain.length > 0) {
        setCaptureStep('group')
      } else {
        commitEvent(eventDef, vt, null, [], null, null, inheritedTeam, 'inherited')
      }
      return
    }

    // Normal event
    const chain = eventDef.groups || []
    setGroupChain(chain)
    if (chain.length > 0) {
      setCaptureStep('group')
    } else if (needsExplicitTeam(eventDef.id)) {
      // Keep team prompt for explicit events
      setCaptureStep('team')
    } else if (teamNotMeaningful(eventDef.id)) {
      // No team — commit directly
      commitEvent(eventDef, vt, null, [], null, null, null, null)
    } else {
      // Team inferred from possession — skip prompt, commit
      commitEvent(eventDef, vt, null, [], null, null, resolvedTeam, teamSrc)
    }
  }

  // ── Advance through group chain ────────────────────────────────────────────
  function advanceGroup(newGroups) {
    const nextIdx = groupIndex + 1
    if (nextIdx < newGroups.length) {
      setGroupIndex(nextIdx)
      setCurrentSelections([])
    } else {
      // All groups done — go to team
      setCaptureStep('team')
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
      } else if (needsExplicitTeam(pendingEvent?.id)) {
        setCaptureStep('team')
      } else if (teamNotMeaningful(pendingEvent?.id)) {
        commitEvent(null, undefined, null, saved, null, null, null, null)
      } else {
        commitEvent(null, undefined, null, saved, null, null, pendingTeam, pendingTeamSource)
      }
    }

    // If this group is the discriminator for variants, resolve branch
    if (pendingEvent?.variants && group.id === pendingEvent.variants.discriminatorGroupId) {
      const selectedCodes = selections.map(s=>s.code)
      const matched = pendingEvent.variants.variants.find(v =>
        v.when.some(w => selectedCodes.includes(w))
      ) || pendingEvent.variants.variants[0]
      setResolvedVariant(matched)
      const remainingChain = matched.groups
      setGroupChain(remainingChain)
      setGroupIndex(0)
      setCurrentSelections([])
      routeAfterGroups(remainingChain)
      return
    }

    // GK type group → resolve variant
    if (pendingEvent?.id === 'goal_keeper' && group.id === 'type') {
      const selectedCode = selections[0]?.code
      const matched = pendingEvent.variants.variants.find(v => v.when.includes(selectedCode))
                   || pendingEvent.variants.variants[0]
      setResolvedVariant(matched)
      const remainingChain = matched.groups
      setGroupChain(remainingChain)
      setGroupIndex(0)
      setCurrentSelections([])
      routeAfterGroups(remainingChain)
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
    setCollectedGroups(saved)

    if (skipTo < groupChain.length) {
      setGroupIndex(skipTo)
      setCurrentSelections([])
    } else {
      // All groups collected — route based on possession rule
      if (needsExplicitTeam(pendingEvent?.id)) {
        setCaptureStep('team')
      } else if (teamNotMeaningful(pendingEvent?.id)) {
        commitEvent(null, undefined, null, saved, null, null, null, null)
      } else {
        commitEvent(null, undefined, null, saved, null, null, pendingTeam, pendingTeamSource)
      }
    }
  }

  // ── Commit the full event ──────────────────────────────────────────────────
  async function commitEvent(eventDef, vt, type, groups, typeSource, variant, team, teamSrc, forceClose=false) {
    const realDef  = eventDef || pendingEvent
    const realVt   = vt   !== undefined ? vt   : pendingVideoTime
    const realTeam = team !== undefined ? team : pendingTeam
    const realTeamSrc = teamSrc !== undefined ? teamSrc : pendingTeamSource

    // If this closes an open state, remove it
    if (realDef.closesEventId) {
      setOpenStates(prev => { const n={...prev}; delete n[realDef.closesEventId]; return n })
    }
    // If this opens a state, register it
    if (realDef.openState) {
      setOpenStates(prev => ({ ...prev, [realDef.id]: { team:realTeam, videoTimeSec:realVt } }))
    }

    const finalGroups = groups || collectedGroups

    // If Half start: set initial possession from the Team Side selection
    if (realDef.id === 'half_start') {
      const teamGroup = finalGroups.find(g => g.groupId === 'team_side')
      const teamSel   = teamGroup?.selections?.[0]?.code
      const newPoss = teamSel === 'TEAM_HOME' ? 'home'
                    : teamSel === 'TEAM_AWAY' ? 'away' : realTeam
      if (newPoss) setPossession({ team: newPoss, certain: true })
    }

    const id = `field_${Date.now()}_${Math.random().toString(36).slice(2,7)}`
    const ev = {
      id, sessionId:session.sessionId,
      videoPath: videoPath||session.videoPath||'',
      videoTimeSec: realVt,
      eventId:    realDef.id,
      eventLabel: realDef.label,
      groups:     finalGroups,
      extras: finalGroups.flatMap(g => g.selections?.map(s=>s.label)||[]),
      team: realTeam||null,
      teamSource: realTeamSrc||null,
      possessionCertain: possession.certain,
      miscommunicationTeam: getMiscommunicationTeam(realDef.id) || null,
      type: type||pendingType||null,
      typeSource: typeSource||pendingTypeSource||null,
      source:'field', mode:'field',
      collectorId:profile.uid, collectorEmail:profile.email,
      timestamp:Date.now(),
    }

    // Apply possession flip AFTER building the event (uses the committed groups)
    const newPossession = applyFlip(realDef.id, ev, possession)

    // For Half start: set possession from Team Side explicit prompt result
    if (realDef.id === 'half_start' && realTeam) {
      setPossession({ team: realTeam, certain: true })
    } else {
      setPossession(newPossession)
    }

    try {
      const ref = await addDoc(collection(db,'mark_collected_events'),{...ev,createdAt:serverTimestamp()})
      const withDoc = {...ev,_docId:ref.id}
      setEvents(prev=>[...prev,withDoc].sort((a,b)=>a.videoTimeSec-b.videoTimeSec))
      setFlashEvent(realDef.label)
      setTimeout(()=>setFlashEvent(null),700)
      const newTotal=(session.totalEvents||0)+1
      const updated={...session,totalEvents:newTotal,collectionStartWallMs:session.collectionStartWallMs||collStartRef.current}
      setSession(updated); saveLocalSession(updated)
      updateDoc(doc(db,'mark_field_sessions',session.sessionId),{totalEvents:newTotal,collectionStartWallMs:updated.collectionStartWallMs}).catch(()=>{})
    } catch(e) { console.error('[MARK Field] commit:',e) }

    if (!forceClose) {
      setPendingEvent(null); setCaptureStep('idle')
      setCollectedGroups([]); setCurrentSelections([]); setGroupChain([])
      setPendingType(null); setPendingTypeSource(null); setResolvedVariant(null); setGroupIndex(0)
      setPendingTeam(null); setPendingTeamSource(null)
    }
  }

  function abandonCapture() {
    setPendingEvent(null); setCaptureStep('idle')
    setCollectedGroups([]); setCurrentSelections([]); setGroupChain([])
    setPendingType(null); setPendingTypeSource(null); setResolvedVariant(null); setGroupIndex(0)
    setPendingTeam(null); setPendingTeamSource(null)
  }

  // ── Delete event ───────────────────────────────────────────────────────────
  async function deleteEvent(ev) {
    try {
      const q=query(collection(db,'mark_collected_events'),where('id','==',ev.id))
      const snap=await getDocs(q); snap.forEach(d=>deleteDoc(d.ref))
      setEvents(prev=>prev.filter(e=>e.id!==ev.id))
      const t=Math.max(0,(session?.totalEvents||1)-1)
      const u={...session,totalEvents:t}; setSession(u); saveLocalSession(u)
      updateDoc(doc(db,'mark_field_sessions',session?.sessionId),{totalEvents:t}).catch(()=>{})
    } catch(e) { console.warn('[MARK Field] delete:',e) }
  }

  // ── Keyboard handler ───────────────────────────────────────────────────────
  const SPEED_MIN=0.25, SPEED_MAX=2, SPEED_STEP=0.25
  useEffect(()=>{
    function onKey(e) {
      const key=e.key, shift=e.shiftKey, upper=key.toUpperCase()

      // ── Type confirm step ────────────────────────────────────────────────
      if (captureStep==='type_confirm') {
        if (key==='Escape') { abandonCapture(); return }
        if (key==='Enter') {
          // Confirm inferred type
          const chain = pendingEvent.variants.variants.find(v=>v.when.includes(pendingType?.code))?.groups
            || pendingEvent.variants.variants.find(v=>v.when.includes('TYPE_OPEN_PLAY'))?.groups
            || pendingEvent.variants.variants[0].groups
          setPendingTypeSource(pendingTypeSource==='inferred_default'?'inferred_default':'inferred')
          setGroupChain(chain); setGroupIndex(0); setCurrentSelections([])
          if (chain.length>0) setCaptureStep('group')
          else setCaptureStep('team')
          return
        }
        // Number/letter override
        const opt = PASS_TYPE_OPTIONS.find(o=>o.toggleKey===upper||o.toggleKey===key)
        if (opt) {
          setPendingType(opt); setPendingTypeSource('manual')
          const chain = pendingEvent.variants.variants.find(v=>v.when.includes(opt.code))?.groups
            || pendingEvent.variants.variants[0].groups
          setGroupChain(chain); setGroupIndex(0); setCurrentSelections([])
          if (chain.length>0) setCaptureStep('group')
          else setCaptureStep('team')
        }
        return
      }

      // ── Group step ───────────────────────────────────────────────────────
      if (captureStep==='group') {
        if (key==='Escape') { abandonCapture(); return }
        const group = groupChain[groupIndex]
        if (!group) return
        const opts = getGroupOptions(group)

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
        if (key==='1') { commitEvent(null,undefined,null,null,null,null,'home','explicit'); return }
        if (key==='2') { commitEvent(null,undefined,null,null,null,null,'away','explicit'); return }
        if (key==='Enter') { commitEvent(null,undefined,null,null,null,null,null,null); return }
        return
      }

      // ── Idle — transport and event capture ───────────────────────────────
      if (!videoLoaded||showDoneModal) return

      // Key 0 = manual possession flip
      if (key==='0') {
        e.preventDefault()
        setPossession(prev => {
          const flipped = prev.team === 'home' ? 'away' : prev.team === 'away' ? 'home' : null
          return { team: flipped, certain: true }
        })
        setFlashEvent(possession.team === 'home' ? '← Possession: Away' : possession.team === 'away' ? '→ Possession: Home' : 'Possession unknown')
        setTimeout(()=>setFlashEvent(null),1200)
        return
      }

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
        startCapture(closeEventDef, videoRef.current?.currentTime||0)
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
          startCapture(closeEv, videoRef.current?.currentTime||0)
        } else {
          const openEv = EVENT_BY_ID['pressure_start']
          setActiveKey(upper); setTimeout(()=>setActiveKey(null),600)
          startCapture(openEv, videoRef.current?.currentTime||0)
        }
        return
      }

      // Normal event
      const eventDef = candidates[0]
      setActiveKey(upper); setTimeout(()=>setActiveKey(null),600)
      startCapture(eventDef, videoRef.current?.currentTime||0)
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  }, [videoLoaded,showDoneModal,captureStep,groupIndex,groupChain,currentSelections,
      collectedGroups,pendingEvent,pendingType,pendingTypeSource,openStates,session,videoPath,events])

  // Mouse events from sidebar
  const mouseRef=useRef(null)
  mouseRef.current=(ev)=>{
    if (!videoLoaded||captureStep!=='idle') return
    const def=FIELD_EVENTS.find(e=>e.id===ev.id)
    if (def) startCapture(def, videoRef.current?.currentTime||0)
  }
  const onMouseEvent=useCallback((ev)=>mouseRef.current(ev),[])

  // ── Done ───────────────────────────────────────────────────────────────────
  async function handleDone() {
    if (!session) { onDone&&onDone({}); return }
    setSubmitting(true)
    const endWall=Date.now(), startWall=collStartRef.current
    const prevAcc=session.accumulatedMs||0
    const thisMs=(startWall&&endWall>startWall)?(endWall-startWall):0
    const totalMs=prevAcc+thisMs
    const evPerMin=totalMs>0?(events.length/(totalMs/60000)).toFixed(2):null
    const hasHalfEnd=events.some(e=>e.eventId==='half_end')
    const completed={...session,status:'completed',totalEvents:events.length,
      accumulatedMs:totalMs,collectionEndWallMs:endWall,
      collectionStartWallMs:session.collectionStartWallMs||startWall,
      eventsPerMinute:evPerMin,videoDurationSec:duration||null,
      collectionIncomplete:!hasHalfEnd}
    try {
      await updateDoc(doc(db,'mark_field_sessions',session.sessionId),{
        status:'completed',totalEvents:events.length,accumulatedMs:totalMs,
        collectionEndWallMs:endWall,eventsPerMinute:evPerMin,
        videoDurationSec:duration||null,collectionIncomplete:!hasHalfEnd,
        completedAt:serverTimestamp(),
      })
    } catch(e) { console.warn('[MARK Field] complete:',e) }
    saveLocalSession(completed)
    try { downloadFieldCsv(completed,events) } catch(e) { console.warn('[MARK Field] CSV:',e) }
    setSubmitting(false)
    onDone&&onDone({events:events.length,eventsPerMinute:evPerMin})
  }

  // ── Current group for display ──────────────────────────────────────────────
  const currentGroup = captureStep==='group' ? groupChain[groupIndex] : null
  const videoName = basename(videoPath||session?.videoPath||'')

  // ── Open state badges ──────────────────────────────────────────────────────
  const openBadges = OPEN_STATE_PAIRS.filter(p=>openStates[p.openId])

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
        <button className="btn-orange" style={{padding:'6px 16px',fontSize:12}} onClick={()=>setShowDoneModal(true)}>Done</button>
      </div>

      {/* ── Main ── */}
      <div style={{flex:1,display:'flex',overflow:'hidden',position:'relative'}}>
        <EventsSidebar side="left"  activeKey={activeKey} onMouseEvent={onMouseEvent}/>

        {/* Video */}
        <div style={{flex:1,position:'relative',background:'#000',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <video ref={videoRef}
            style={{width:'100%',height:'100%',objectFit:'contain',display:videoLoaded?'block':'none'}}
            onTimeUpdate={e=>{if(!isDraggingRef.current)setCurrentTime(e.target.currentTime)}}
            onLoadedMetadata={()=>setDuration(videoRef.current?.duration||0)}
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

        <EventsSidebar side="right" activeKey={activeKey} onMouseEvent={onMouseEvent}/>

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
                  {PASS_TYPE_OPTIONS.map(opt=>{
                    const active=pendingType?.code===opt.code
                    return (
                      <div key={opt.code}
                        onClick={()=>{
                          setPendingType(opt); setPendingTypeSource('manual')
                          const chain=pendingEvent.variants.variants.find(v=>v.when.includes(opt.code))?.groups||pendingEvent.variants.variants[0].groups
                          setGroupChain(chain);setGroupIndex(0);setCurrentSelections([])
                          if(chain.length>0)setCaptureStep('group');else setCaptureStep('team')
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
                  if(chain.length>0)setCaptureStep('group');else setCaptureStep('team')
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
                  {getGroupOptions(currentGroup).map(opt=>{
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
                  Team — 1 Home · 2 Away · Enter skip
                </div>
                <div style={{display:'flex',gap:8}}>
                  {[...TEAM_OPTIONS,{code:null,label:'Skip',key:'↩',color:'var(--t-3)',bg:'var(--bg-3)'}].map(t=>(
                    <button key={t.code||'skip'}
                      onClick={()=>commitEvent(null,undefined,null,null,null,null,t.code)}
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
          onDragStart={()=>{isDraggingRef.current=true}}/>
      </div>

      {/* ── Events list ── */}
      <TaggedEventsList tags={events} videoDuration={duration} currentTime={currentTime}
        matchName="Home vs Away" onEdit={null} onDelete={deleteEvent}/>

      {/* ── Done modal ── */}
      {showDoneModal&&(
        <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.8)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div className="card slide-up" style={{width:420,padding:28}}>
            <div style={{fontFamily:'Inter',fontWeight:800,fontSize:18,color:'var(--t-1)',marginBottom:4}}>Finish Collection</div>
            <div style={{fontSize:13,color:'var(--t-3)',marginBottom:20}}>{videoName}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
              <div style={{background:'var(--bg-3)',borderRadius:8,padding:'12px',textAlign:'center'}}>
                <div style={{fontSize:24,fontWeight:900,color:'#30D158'}}>{events.length}</div>
                <div style={{fontSize:10,color:'var(--t-3)',marginTop:2}}>Events Collected</div>
              </div>
              <div style={{background:'var(--bg-3)',borderRadius:8,padding:'12px',textAlign:'center'}}>
                {(()=>{
                  const accMs=session?.accumulatedMs||0
                  const startMs=collStartRef.current
                  const totalMs=accMs+(startMs?(Date.now()-startMs):0)
                  const mins=totalMs>0?totalMs/60000:0
                  const rate=mins>0?(events.length/mins).toFixed(1):'—'
                  return <><div style={{fontSize:24,fontWeight:900,color:'var(--t-1)'}}>{rate}</div>
                    <div style={{fontSize:10,color:'var(--t-3)',marginTop:2}}>Events/min</div></>
                })()}
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>
              <div style={{background:'rgba(10,132,255,0.08)',border:'1px solid rgba(10,132,255,0.2)',borderRadius:8,padding:'8px',textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:800,color:'#0A84FF'}}>{events.filter(e=>e.team==='home').length}</div>
                <div style={{fontSize:9,color:'var(--t-3)',marginTop:1}}>HOME</div>
              </div>
              <div style={{background:'rgba(232,89,12,0.08)',border:'1px solid rgba(232,89,12,0.2)',borderRadius:8,padding:'8px',textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:800,color:'#E8590C'}}>{events.filter(e=>e.team==='away').length}</div>
                <div style={{fontSize:9,color:'var(--t-3)',marginTop:1}}>AWAY</div>
              </div>
            </div>
            {openBadges.length>0&&<div style={{background:'rgba(255,149,0,0.1)',border:'1px solid rgba(255,149,0,0.3)',borderRadius:8,padding:'8px 12px',marginBottom:16,fontSize:11,color:'#FF9500'}}>
              ⚠️ Open states will be force-closed: {openBadges.map(p=>EVENT_BY_ID[p.openId]?.label).join(', ')}
            </div>}
            {!events.some(e=>e.eventId==='half_end')&&events.length>0&&<div style={{background:'rgba(255,149,0,0.1)',border:'1px solid rgba(255,149,0,0.3)',borderRadius:8,padding:'8px 12px',marginBottom:16,fontSize:11,color:'#FF9500'}}>
              ⚠️ No Half End tagged — export will have collection_incomplete=1
            </div>}
            <div style={{display:'flex',gap:10}}>
              <button className="btn-ghost" style={{flex:1,padding:'10px 0',fontSize:13}} onClick={()=>setShowDoneModal(false)}>Cancel</button>
              <button className="btn-orange" style={{flex:2,padding:'10px 0',fontSize:13}} disabled={submitting} onClick={handleDone}>
                {submitting?'Saving…':'Save & Export CSV'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
