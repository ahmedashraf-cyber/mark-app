import { useState, useEffect } from 'react'
import { TORNADO_EVENTS, MISSING_EVENT_KEY } from '../data/shortcuts'
import { TAGGING_SCENARIOS } from '../data/tagging_scenarios'

// ─── key sequence for lists ───────────────────────────────────────────────────
const KEYS = '1234567890QWERTYUIOPASDFGHJKLZXCVBNM'

// MARK 4.2.0 — data sources migrated to tagging_scenarios.js
// MISSING_EXTRAS, WRONG_EXTRAS, WRONG_EVENT_MAP are now computed (memoized) from
// the sheet-derived taxonomy. GK_WRONG_EVENT_MAP stays hardcoded because the sheet
// doesn't split Goal Keeper into MARK's 4 sub-types.

// MARK event id -> sheet event name (lookup via shortcuts.js)
function sheetEventFor(eventId) {
  const e = TORNADO_EVENTS.find(x => x.id === eventId)
  return e ? e.sheetEvent : null
}

// 10 attribute-level error types the sheet defines separately but MARK collapses
// into a single "Wrong extra" step (preserves existing reviewer UX).
const ATTR_ERROR_TYPES = new Set([
  'Wrong extra','Wrong outcome','Wrong direction','Wrong body part',
  'Wrong technique','Wrong height','Wrong type','Wrong kind',
  'Wrong side','Wrong GK body state',
])

// Build the Wrong-Event correction list for a sheet event.
// Flattens "Goal keeper + Type qualifier" into "GK (Type)" to match MARK display.
function buildWrongEventList(sheetEv) {
  if (!sheetEv) return []
  const out = []
  const seen = new Set()
  for (const s of TAGGING_SCENARIOS) {
    if (s.event !== sheetEv) continue
    if (s.errorType !== 'Wrong event') continue
    if (!s.correction || s.correction === 'Null') continue
    let label = s.correction
    if (s.correction === 'Goal keeper' && s.typeQualifier) label = 'GK (' + s.typeQualifier + ')'
    if (seen.has(label)) continue
    out.push(label); seen.add(label)
  }
  return out
}

// Build the missing/not-needed extras list (combined — current MARK uses one list for both steps).
function buildMissingExtrasList(sheetEv) {
  if (!sheetEv) return []
  const out = []
  const seen = new Set()
  for (const s of TAGGING_SCENARIOS) {
    if (s.event !== sheetEv) continue
    if (s.errorType !== 'Missing extra') continue
    if (!s.correction || s.correction === 'Null') continue
    if (seen.has(s.correction)) continue
    out.push(s.correction); seen.add(s.correction)
  }
  for (const s of TAGGING_SCENARIOS) {
    if (s.event !== sheetEv) continue
    if (s.errorType !== 'Not needed extra') continue
    if (!s.tagged || s.tagged === 'Null') continue
    if (seen.has(s.tagged)) continue
    out.push(s.tagged); seen.add(s.tagged)
  }
  return out
}

// Build the wrong-extras map { tagged: [corrections] } across all 10 attribute-error types.
function buildWrongExtrasMap(sheetEv) {
  if (!sheetEv) return {}
  const map = {}
  for (const s of TAGGING_SCENARIOS) {
    if (s.event !== sheetEv) continue
    if (!ATTR_ERROR_TYPES.has(s.errorType)) continue
    if (!s.tagged || s.tagged === 'Null') continue
    if (!s.correction || s.correction === 'Null') continue
    if (!map[s.tagged]) map[s.tagged] = []
    if (!map[s.tagged].includes(s.correction)) map[s.tagged].push(s.correction)
  }
  return map
}

// Memoized lookups by MARK event id.
const _weC = {}, _meC = {}, _wxC = {}
function getWrongEventList(eventId) {
  if (_weC[eventId] !== undefined) return _weC[eventId]
  _weC[eventId] = buildWrongEventList(sheetEventFor(eventId))
  return _weC[eventId]
}
function getMissingExtrasList(eventId) {
  if (_meC[eventId] !== undefined) return _meC[eventId]
  _meC[eventId] = buildMissingExtrasList(sheetEventFor(eventId))
  return _meC[eventId]
}
function getWrongExtrasMap(eventId) {
  if (_wxC[eventId] !== undefined) return _wxC[eventId]
  _wxC[eventId] = buildWrongExtrasMap(sheetEventFor(eventId))
  return _wxC[eventId]
}

// GK_WRONG_EVENT_MAP — MARK-specific, hardcoded. Sheet doesn't model GK subtypes the same way.
// Each entry: { correctEvents: [...], extras: [...] }. Reviewer picks a correct event (if any),
// then an expected extra (if any) as a follow-up step.
const GK_WRONG_EVENT_MAP = {
  gk_collected:      { correctEvents: ['GK (Keeper sweeper)','GK (Save)'],                                extras: ['Second effort','Success','Fail'] },
  gk_save:           { correctEvents: [],                                                                  extras: ['Won','Success','Second effort'] },
  gk_shot:           { correctEvents: ['Save attempt','Conceded no save','Post','Wayward','Out endline'], extras: ['Won','Success','Fail','Second effort'] },
  gk_punch:          { correctEvents: ['GK (Keeper sweeper)','Ball recovery','GK (Collected)'],           extras: [] },
  gk_keeper_sweeper: { correctEvents: ['GK (Punch)','GK (Save)','GK (Collected)'],                         extras: ['Clear','Claim'] },
}
const gkEntry = (id) => GK_WRONG_EVENT_MAP[id] || { correctEvents: [], extras: [] }

// ─── GK sub-types ─────────────────────────────────────────────────────────────
const GK_SUBTYPES = [
  { key:'1', id:'gk_collected',      label:'Collected'      },
  { key:'2', id:'gk_punch',          label:'Punch'          },
  { key:'3', id:'gk_keeper_sweeper', label:'Keeper sweeper' },
  { key:'4', id:'gk_save',           label:'Save'           },
  { key:'5', id:'gk_shot',           label:'Shot'           },
]

// ─── error types ──────────────────────────────────────────────────────────────
const ERROR_TYPES = [
  { key:'1', id:'wrong_event',      label:'Wrong event',      autoSave:false },
  { key:'2', id:'missing_event',    label:'Missing event',    autoSave:false },
  { key:'3', id:'extra_event',      label:'Extra event',      autoSave:false },
  { key:'4', id:'missing_extra',    label:'Missing extra',    autoSave:false },
  { key:'5', id:'wrong_extra',      label:'Wrong extra',      autoSave:false },
  { key:'6', id:'not_needed_extra', label:'Not needed extra', autoSave:false },
  { key:'7', id:'wrong_timestamp',  label:'Wrong timestamp',  autoSave:false },
]

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00.000'
  const m  = Math.floor(s / 60)
  const sc = Math.floor(s % 60)
  const ms = Math.floor((s % 1) * 1000)
  return `${m}:${sc.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
}

const TEAM_BTNS = [
  { id:'home', label:'Home', key:'1', color:'#0A84FF', bg:'rgba(10,132,255,0.15)' },
  { id:'away', label:'Away', key:'2', color:'#FF453A', bg:'rgba(255,69,58,0.15)'  },
]

// ─── shared primitives ────────────────────────────────────────────────────────
function PanelHeader({ eventKey, eventLabel, videoTime, isMissing, onCancel }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{
          fontFamily:'JetBrains Mono,monospace', fontSize:12, fontWeight:700,
          background: isMissing ? '#BF5AF2' : 'var(--p2)', color:'#fff',
          borderRadius:6, padding:'3px 9px',
        }}>{eventKey || '•'}</span>
        <span style={{ fontFamily:'Inter', fontWeight:800, fontSize:15, color:'var(--t-1)' }}>
          {eventLabel}
        </span>
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11, color:'var(--t-3)' }}>
          @ {fmt(videoTime)}
        </span>
      </div>
      <button className="btn-ghost" style={{ padding:'3px 9px', fontSize:11 }} onClick={onCancel}>ESC</button>
    </div>
  )
}

function Breadcrumb({ items }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:10, flexWrap:'wrap' }}>
      {items.map((item, i) => (
        <span key={i} style={{ display:'flex', alignItems:'center', gap:5 }}>
          {i > 0 && <span style={{ fontSize:10, color:'var(--t-3)' }}>→</span>}
          <span style={{
            fontSize:10, padding:'2px 7px', borderRadius:4,
            background: i === items.length-1 ? 'rgba(232,89,12,0.15)' : 'var(--bg-3)',
            color:       i === items.length-1 ? 'var(--p2)'            : 'var(--t-3)',
            border:      i === items.length-1 ? '1px solid rgba(232,89,12,0.3)' : '1px solid var(--b-2)',
          }}>{item}</span>
        </span>
      ))}
    </div>
  )
}

function StepLabel({ text, color }) {
  return (
    <div style={{
      fontSize:9, fontWeight:700, letterSpacing:1, textTransform:'uppercase',
      color: color || 'var(--t-3)', marginBottom:8,
    }}>{text}</div>
  )
}

function PillBtn({ label, shortcut, active, color, autoSave, onClick }) {
  const c = color || 'var(--p2)'
  return (
    <button onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:6,
      padding:'5px 11px', borderRadius:18, cursor:'pointer',
      border: active ? `1.5px solid ${c}` : '1.5px solid var(--b-2)',
      background: active ? `${c}22` : 'var(--bg-3)',
      transition:'all .1s',
    }}>
      {shortcut && (
        <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:10, fontWeight:700, color: active ? c : 'var(--t-3)' }}>
          {shortcut}
        </span>
      )}
      <span style={{ fontSize:12, color: active ? c : 'var(--t-2)', fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
      {autoSave && (
        <span style={{ fontSize:9, color:'#30D158', background:'rgba(48,209,88,0.15)', borderRadius:8, padding:'1px 5px', marginLeft:2 }}>
          auto
        </span>
      )}
    </button>
  )
}

function KeyedList({ items, onSelect, color, cols }) {
  const c = color || 'var(--p2)'
  const gridCols = cols || (items.length > 5 ? 2 : 1)
  return (
    <div style={{ display:'grid', gridTemplateColumns:`repeat(${gridCols}, minmax(0,1fr))`, gap:4 }}>
      {items.map((item, i) => {
        const k     = KEYS[i] || '?'
        const label = typeof item === 'string' ? item : item.label
        return (
          <button key={i} onClick={() => onSelect(item, k)} style={{
            display:'flex', alignItems:'center', gap:7,
            padding:'5px 9px', borderRadius:7, cursor:'pointer',
            border:'1.5px solid var(--b-2)', background:'var(--bg-3)',
            transition:'all .1s', textAlign:'left',
          }}>
            <span style={{
              fontFamily:'JetBrains Mono,monospace', fontSize:10, fontWeight:700,
              color:c, minWidth:14, flexShrink:0,
            }}>{k}</span>
            <span style={{ fontSize:11, color:'var(--t-2)', lineHeight:1.3 }}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

function TeamRow({ onSave, disabled }) {
  return (
    <div style={{
      display:'flex', gap:10,
      opacity: disabled ? 0.3 : 1,
      pointerEvents: disabled ? 'none' : 'all',
      transition:'opacity .2s',
    }}>
      {TEAM_BTNS.map(t => (
        <button key={t.id} onClick={() => onSave(t.id)} style={{
          display:'flex', alignItems:'center', gap:8,
          padding:'8px 22px', borderRadius:10, cursor:'pointer',
          border:`1.5px solid ${t.color}66`, background:t.bg,
          transition:'all .1s',
        }}>
          <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11, fontWeight:800, color:t.color }}>{t.key}</span>
          <span style={{ fontSize:13, fontWeight:700, color:t.color }}>{t.label}</span>
        </button>
      ))}
    </div>
  )
}

// ─── edit modal (unchanged) ───────────────────────────────────────────────────
function TagPanelEdit({ tag, onSave, onDelete, onCancel }) {
  const event = TORNADO_EVENTS.find(e => e.key?.toUpperCase() === tag.triggeredKey?.toUpperCase())
    || { label: tag.triggeredEventLabel || tag.triggeredKey, id: tag.triggeredEventId, key: tag.triggeredKey }
  const isMissing = tag.triggeredKey?.toUpperCase() === MISSING_EVENT_KEY
  const [team, setTeam] = useState(tag.team || null)

  function handleSave() {
    if (!team) return
    onSave({ ...tag, team })
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1100, background:'rgba(0,0,0,0.85)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onCancel}>
      <div className="card slide-up" style={{ width:420, padding:0, overflow:'hidden', maxHeight:'85vh', display:'flex', flexDirection:'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding:'16px 20px 12px', borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11, fontWeight:700, background: isMissing ? '#BF5AF2' : 'var(--p2)', color:'#fff', borderRadius:5, padding:'2px 7px' }}>
                {isMissing ? 'Q' : (event.key || '•')}
              </span>
              <span style={{ fontFamily:'Inter', fontWeight:800, fontSize:15, color:'var(--t-1)' }}>
                {isMissing ? 'Missing Event' : event.label}
              </span>
            </div>
            <div style={{ fontSize:11, color:'var(--t-3)', marginTop:3, fontFamily:'JetBrains Mono,monospace' }}>@ {fmt(tag.videoTimeSec)}</div>
          </div>
          <button className="btn-ghost" style={{ padding:'4px 10px', fontSize:12 }} onClick={onCancel}>✕</button>
        </div>
        <div style={{ padding:'14px 20px 18px', overflowY:'auto' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:1, marginBottom:8 }}>TEAM</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:18 }}>
            {TEAM_BTNS.map(t => (
              <button key={t.id} onClick={() => setTeam(t.id)} style={{
                display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                padding:'11px 0', borderRadius:9, cursor:'pointer',
                border:`1.5px solid ${team === t.id ? t.color : 'var(--b-2)'}`,
                background: team === t.id ? t.bg : 'var(--bg-3)', transition:'all .12s',
              }}>
                <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:10, fontWeight:700, color: team === t.id ? t.color : 'var(--t-3)' }}>{t.key}</span>
                <span style={{ fontSize:13, fontWeight:700, color: team === t.id ? t.color : 'var(--t-2)' }}>{t.label}</span>
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onDelete} style={{ flex:1, padding:'10px 0', borderRadius:8, cursor:'pointer', border:'1.5px solid rgba(255,69,58,0.4)', background:'rgba(255,69,58,0.08)', color:'#FF453A', fontSize:13, fontWeight:600 }}>Delete</button>
            <button onClick={handleSave} disabled={!team} className="btn-orange" style={{ flex:2, padding:'10px 0', fontSize:13 }}>Save changes</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── main TagPanel ─────────────────────────────────────────────────────────────
export default function TagPanel({ pendingTag, onSave, onCancel, editTag, onEditSave, onEditDelete, onEditCancel }) {
  const [step,          setStep]          = useState('error_type')
  const [errorTypeId,   setErrorTypeId]   = useState(null)
  const [gkSubType,     setGkSubType]     = useState(null)
  const [selectedExtra, setSelectedExtra] = useState(null)
  const [correction,    setCorrection]    = useState(null)

  const event    = pendingTag
    ? (TORNADO_EVENTS.find(e => e.key?.toUpperCase() === pendingTag.key?.toUpperCase())
      || { label: pendingTag.label || pendingTag.key, id: pendingTag.id || '', key: pendingTag.key })
    : null
  const isMissing = pendingTag?.isMissing
  const isGK      = event?.id === 'goal_keeper'
  const eventId   = event?.id || ''

  // reset on new tag
  useEffect(() => {
    setStep(isGK ? 'gk_subtype' : 'error_type')
    setErrorTypeId(null)
    setGkSubType(null)
    setSelectedExtra(null)
    setCorrection(null)
  }, [pendingTag?.key, pendingTag?.videoTime])

  function doSave(extras, team) {
    onSave({
      triggeredKey:        pendingTag.key,
      triggeredEventId:    eventId,
      triggeredEventLabel: isMissing ? 'Missing Event' : (event?.label || pendingTag.key),
      extras,
      team,
      videoTimeSec:        pendingTag.videoTime,
      timestamp:           Date.now(),
      isMissing:           !!isMissing,
    })
  }

  function doAutoSave(errorId) {
    doSave([errorId], null)
  }

  // keyboard handler
  useEffect(() => {
    if (!pendingTag) return
    function onKey(e) {
      const k = e.key.toUpperCase()
      if (e.key === 'Escape') { onCancel(); return }

      if (step === 'gk_subtype') {
        const sub = GK_SUBTYPES.find(s => s.key === e.key)
        if (sub) { setGkSubType(sub); setStep('error_type') }
        return
      }

      if (step === 'error_type') {
        const et = ERROR_TYPES.find(x => x.key === e.key)
        if (!et) return
        setErrorTypeId(et.id)
        if      (et.id === 'wrong_event') {
          if (!isGK) setStep('wrong_event')
          else { const ent = gkEntry(gkSubType?.id); setStep(ent.correctEvents.length ? 'gk_wrong_event' : (ent.extras.length ? 'gk_extra' : 'team')) }
        }
        else if (et.id === 'missing_event')    setStep('team')
        else if (et.id === 'extra_event')      setStep('team')
        else if (et.id === 'wrong_timestamp')  setStep('team')
        else if (et.id === 'missing_extra')    setStep('missing_extra')
        else if (et.id === 'not_needed_extra') setStep('not_needed_extra')
        else if (et.id === 'wrong_extra')      setStep('wrong_extra_pick')
        return
      }

      if (step === 'wrong_event') {
        const list = getWrongEventList(eventId) || []
        const idx  = KEYS.indexOf(k)
        if (idx >= 0 && idx < list.length) { setCorrection(list[idx]); setStep('team') }
        return
      }

      if (step === 'gk_wrong_event') {
        const ent  = gkEntry(gkSubType?.id)
        const list = ent.correctEvents
        const idx  = KEYS.indexOf(k)
        if (idx >= 0 && idx < list.length) { setCorrection(list[idx]); setStep(ent.extras.length ? 'gk_extra' : 'team') }
        return
      }

      if (step === 'gk_extra') {
        const list = gkEntry(gkSubType?.id).extras
        const idx  = KEYS.indexOf(k)
        if (idx >= 0 && idx < list.length) { setSelectedExtra(list[idx]); setStep('team') }
        return
      }

      if (step === 'missing_extra' || step === 'not_needed_extra') {
        const list = getMissingExtrasList(eventId) || []
        const idx  = KEYS.indexOf(k)
        if (idx >= 0 && idx < list.length) { setSelectedExtra(list[idx]); setStep('team') }
        return
      }

      if (step === 'wrong_extra_pick') {
        const map  = getWrongExtrasMap(eventId) || {}
        const list = Object.keys(map)
        const idx  = KEYS.indexOf(k)
        if (idx >= 0 && idx < list.length) { setSelectedExtra(list[idx]); setStep('wrong_extra_corr') }
        return
      }

      if (step === 'wrong_extra_corr') {
        const map   = getWrongExtrasMap(eventId) || {}
        const corrs = map[selectedExtra] || []
        const idx   = KEYS.indexOf(k)
        if (idx >= 0 && idx < corrs.length) { setCorrection(corrs[idx]); setStep('team') }
        return
      }

      if (step === 'team') {
        if (e.key === '1') doSave([errorTypeId, gkSubType?.id, selectedExtra, correction].filter(Boolean), 'home')
        if (e.key === '2') doSave([errorTypeId, gkSubType?.id, selectedExtra, correction].filter(Boolean), 'away')
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingTag, step, errorTypeId, gkSubType, selectedExtra, correction, isGK, eventId])

  if (editTag) return <TagPanelEdit tag={editTag} onSave={onEditSave} onDelete={onEditDelete} onCancel={onEditCancel} />
  if (!pendingTag) return null

  // breadcrumb
  const crumbs = [isMissing ? 'Missing Event' : (event?.label || '')]
  if (gkSubType)     crumbs.push(gkSubType.label)
  if (errorTypeId)   crumbs.push(ERROR_TYPES.find(x => x.id === errorTypeId)?.label || '')
  if (selectedExtra) crumbs.push(selectedExtra)

  const wrongExtraMap  = getWrongExtrasMap(eventId) || {}
  const wrongExtraKeys = Object.keys(wrongExtraMap)
  const missingList    = getMissingExtrasList(eventId) || []
  const gkEnt          = isGK ? gkEntry(gkSubType?.id) : null
  const wrongEventList = isGK
    ? (gkEnt.correctEvents || [])
    : (getWrongEventList(eventId) || [])
  const gkExtraList    = isGK ? (gkEnt.extras || []) : []

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'flex-end', pointerEvents:'none' }}>
      <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(3px)', pointerEvents:'all' }} onClick={onCancel} />
      <div className="slide-up" style={{ position:'relative', width:'100%', zIndex:1, background:'var(--bg-2)', borderTop:'2px solid var(--b-1)', padding:'14px 20px 16px', pointerEvents:'all' }} onClick={e => e.stopPropagation()}>

        <PanelHeader
          eventKey={pendingTag.key}
          eventLabel={isMissing ? 'Missing Event' : event?.label}
          videoTime={pendingTag.videoTime}
          isMissing={isMissing}
          onCancel={onCancel}
        />

        {crumbs.length > 1 && <Breadcrumb items={crumbs} />}

        {/* GK sub-type */}
        {step === 'gk_subtype' && (
          <>
            <StepLabel text="GK event" color="#FFD60A" />
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {GK_SUBTYPES.map(s => (
                <PillBtn key={s.id} label={s.label} shortcut={s.key} active={false} color="#FFD60A"
                  onClick={() => { setGkSubType(s); setStep('error_type') }} />
              ))}
            </div>
          </>
        )}

        {/* Error type */}
        {step === 'error_type' && (
          <>
            <StepLabel text="error type" />
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {ERROR_TYPES.map(et => {
                // hide missing/not-needed/wrong-extra if event has none
                if (et.id === 'missing_extra'    && missingList.length    === 0) return null
                if (et.id === 'not_needed_extra' && missingList.length    === 0) return null
                if (et.id === 'wrong_extra'      && wrongExtraKeys.length === 0) return null
                if (et.id === 'wrong_event'      && wrongEventList.length === 0 && !isGK) return null
                return (
                  <PillBtn key={et.id} label={et.label} shortcut={et.key} active={false}
                    color={et.autoSave ? '#30D158' : 'var(--p2)'} autoSave={et.autoSave}
                    onClick={() => {
                      setErrorTypeId(et.id)
                      if      (et.id === 'wrong_event') {
                        if (!isGK) setStep('wrong_event')
                        else setStep(gkEnt.correctEvents.length ? 'gk_wrong_event' : (gkEnt.extras.length ? 'gk_extra' : 'team'))
                      }
                      else if (et.id === 'missing_event')    setStep('team')
                      else if (et.id === 'extra_event')      setStep('team')
                      else if (et.id === 'wrong_timestamp')  setStep('team')
                      else if (et.id === 'missing_extra')    setStep('missing_extra')
                      else if (et.id === 'not_needed_extra') setStep('not_needed_extra')
                      else if (et.id === 'wrong_extra')      setStep('wrong_extra_pick')
                    }}
                  />
                )
              })}
            </div>
          </>
        )}

        {/* Wrong event */}
        {(step === 'wrong_event' || step === 'gk_wrong_event') && (
          <>
            <StepLabel text="correct event was" color="var(--p2)" />
            <KeyedList items={wrongEventList} color="var(--p2)" cols={wrongEventList.length > 5 ? 2 : 1}
              onSelect={(c) => { setCorrection(c); setStep(isGK && gkExtraList.length ? 'gk_extra' : 'team') }} />
          </>
        )}

        {/* GK expected extra (follow-up) */}
        {step === 'gk_extra' && (
          <>
            <StepLabel text="expected extra" color="#FF9F0A" />
            <KeyedList items={gkExtraList} color="#FF9F0A" cols={gkExtraList.length > 4 ? 2 : 1}
              onSelect={(c) => { setSelectedExtra(c); setStep('team') }} />
          </>
        )}

        {/* Missing extra */}
        {step === 'missing_extra' && (
          <>
            <StepLabel text="which extra is missing" color="#FF9F0A" />
            <KeyedList items={missingList} color="#FF9F0A" cols={missingList.length > 4 ? 2 : 1}
              onSelect={(c) => { setSelectedExtra(c); setStep('team') }} />
          </>
        )}

        {/* Not needed extra */}
        {step === 'not_needed_extra' && (
          <>
            <StepLabel text="which extra to remove" color="#FF9F0A" />
            <KeyedList items={missingList} color="#FF9F0A" cols={missingList.length > 4 ? 2 : 1}
              onSelect={(c) => { setSelectedExtra(c); setStep('team') }} />
          </>
        )}

        {/* Wrong extra — pick which */}
        {step === 'wrong_extra_pick' && (
          <>
            <StepLabel text="which extra was wrong" color="#FF9F0A" />
            <KeyedList items={wrongExtraKeys} color="#FF9F0A" cols={wrongExtraKeys.length > 4 ? 2 : 1}
              onSelect={(c) => { setSelectedExtra(c); setStep('wrong_extra_corr') }} />
          </>
        )}

        {/* Wrong extra — pick correction */}
        {step === 'wrong_extra_corr' && selectedExtra && (
          <>
            <StepLabel text={`correct "${selectedExtra}" to`} color="var(--p2)" />
            <KeyedList items={wrongExtraMap[selectedExtra] || []} color="var(--p2)" cols={1}
              onSelect={(c) => { setCorrection(c); setStep('team') }} />
          </>
        )}

        {/* Team */}
        {step === 'team' && (
          <>
            <StepLabel text="which team" />
            <TeamRow
              onSave={(team) => doSave([errorTypeId, gkSubType?.id, selectedExtra, correction].filter(Boolean), team)}
              disabled={false}
            />
          </>
        )}

      </div>
    </div>
  )
}

// ─── legacy exports for TaggedEventsList label lookups ────────────────────────
export const EXTRAS = [
  { key:'1', id:'wrong_event',      label:'Wrong event'      },
  { key:'2', id:'missing_event',    label:'Missing event'    },
  { key:'3', id:'extra_event',      label:'Extra event'      },
  { key:'4', id:'missing_extra',    label:'Missing extra'    },
  { key:'5', id:'wrong_extra',      label:'Wrong extra'      },
  { key:'6', id:'not_needed_extra', label:'Not needed extra' },
  { key:'7', id:'wrong_timestamp',  label:'Wrong timestamp'  },
]

export const GK_EXTRAS = [
  { key:'1', id:'gk_collected',      label:'Collected'       },
  { key:'2', id:'gk_punch',          label:'Punch'           },
  { key:'3', id:'gk_keeper_sweeper', label:'Keeper sweeper'  },
  { key:'4', id:'gk_save',           label:'Save'            },
  { key:'5', id:'gk_shot',           label:'Shot'            },
]

export const GK_WRONG_EXTRAS = {}
