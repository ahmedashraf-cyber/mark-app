import { useState, useEffect } from 'react'
import { TORNADO_EVENTS, MISSING_EVENT_KEY } from '../data/shortcuts'

// ─── key sequence for lists ───────────────────────────────────────────────────
const KEYS = '1234567890QWERTYUIOPASDFGHJKLZXCVBNM'

// ─── per-event: missing / not-needed extras ───────────────────────────────────
const MISSING_EXTRAS = {
  pass:              ['Through ball','Backheel','Injury clearance','Launch','Miscommunication'],
  shot:              ['Aerial won','Backheel'],
  miscontrol:        ['Aerial won'],
  tackle:            ['Dribble attempted'],
  interception:      ['Miscommunication'],
  ball_recovery:     ['Miscommunication'],
  block:             ['Deflection','Save','Miscommunication'],
  clearance:         ['Aerial won','Miscommunication'],
  pass_recovery:     ['Through ball','Backheel','Injury clearance','Launch','Miscommunication'],
  pass_interception: ['Through ball','Backheel','Injury clearance','Launch','Miscommunication'],
  foul_committed:    ['Advantage','Penalty'],
  goal_keeper:       ['Miscommunication'],
}

// ─── per-event: wrong extras → corrections ────────────────────────────────────
const WRONG_EXTRAS = {
  pass: {
    'Inswinging':  ['Outswinging','Straight'],
    'Outswinging': ['Inswinging','Straight'],
    'Straight':    ['Inswinging','Outswinging'],
  },
  shot: {
    'Aerial won':    ['Regular','Step in'],
    'Diving header': ['Normal'],
    'Volley':        ['Half volley'],
    'Half volley':   ['Volley','Normal'],
    'Set':           ['Prone','Moving'],
    'Prone':         ['Set','Moving'],
    'Moving':        ['Set','Prone'],
    'Open play':     ['First time'],
    'First time':    ['Open play'],
  },
  miscontrol: {
    'Regular':    ['Handball','Dangerous play','Offside'],
    'Aerial won': ['Regular','Step in'],
  },
  tackle: {
    'Won':          ['Success','Second effort'],
    'Success':      ['Won','Second effort'],
    'Right':        ['Left','Right take on','Left take on','None'],
    'Left':         ['Right','Right take on','Left take on','None'],
    'Right take on':['Right','Left','Left take on','None'],
    'Left take on': ['Right','Left','Right take on','None'],
  },
  dribble: {
    'Right':        ['Left','Right take on','Left take on','None'],
    'Left':         ['Right','Right take on','Left take on','None'],
    'Right take on':['Right','Left','Left take on','None'],
    'Left take on': ['Right','Left','Right take on','None'],
  },
  interception: {
    'Step in': ['Aerial won'],
    'Won':     ['Success','Second effort'],
    'Success': ['Won','Second effort'],
  },
  clearance: {
    'Regular':    ['Handball','Dangerous play','Offside'],
    'Aerial won': ['Regular','Step in'],
  },
  pass_interception: {
    'Step in': ['Aerial won'],
  },
  fifty_fifty: {
    'Won':     ['Success','Second effort'],
    'Success': ['Won','Second effort'],
  },
  foul_committed: {
    'Regular':       ['Handball','Dangerous play','Offside'],
    'Handball':      ['Regular','Offside'],
    'Dangerous play':['Regular','Handball','Offside'],
    'Offside':       ['Regular','Handball','Dangerous play'],
    'No card':       ['Yellow card','Second yellow','Red card'],
    'Yellow card':   ['No card','Second yellow','Red card'],
    'Second yellow': ['No card','Yellow card','Red card'],
    'Red card':      ['No card','Yellow card','Second yellow'],
  },
  goal_keeper: {
    'Both hands':    ['Right hand','Left hand'],
    'Diving':        ['Standing'],
    'Standing':      ['Diving'],
    'Set':           ['Prone','Moving'],
    'Prone':         ['Set','Moving'],
    'Moving':        ['Set','Prone'],
    'Won':           ['Success','Second effort'],
    'Success':       ['Won','Second effort'],
    'Second effort': ['Won','Success'],
  },
  stoppage: {
    'Injury': ['Review','Other'],
    'Review': ['Injury','Other'],
    'Other':  ['Injury','Review'],
  },
}

// ─── wrong event corrections (unchanged from confirmed data) ──────────────────
const WRONG_EVENT_MAP = {
  pass:              ['Miscontrol','Dribble','Pass recovery','Pass interception','Tackle','Clearance','Shot','Fifty fifty','Interception','Ball recovery','Block'],
  shot:              ['Pass','Miscontrol','Clearance','Tackle','Dribble','GK (Smoother)'],
  reception:         ['Miscontrol','Tackle','Ball recovery'],
  miscontrol:        ['Dribble','Tackle','Pass','Shot','Clearance','Ball recovery','Block','Reception','Interception'],
  tackle:            ['Clearance','Block','Dribble','Fifty fifty','Miscontrol','Pass','Pass recovery','Pass interception','Leg stretch duel','Hold up duel','Separation duel'],
  interception:      ['Ball recovery','Clearance','Pass recovery','Pass interception','Block','Tackle'],
  ball_recovery:     ['Interception','Pass recovery','Pass interception','Block','Clearance','Fifty fifty','GK (Keeper sweeper)','GK (Collected)','Tackle'],
  block:             ['Tackle','Clearance','Interception','Miscontrol','Ball recovery','Pass','Pass recovery','Fifty fifty','Pass interception'],
  clearance:         ['Pass recovery','GK (Keeper sweeper)','GK (Punch)','Interception','Block','Fifty fifty','Tackle','Dribble','Shot','Ball recovery'],
  dribble:           ['Tackle','Pass','Pass recovery','Pass interception','Miscontrol','Separation duel','Leg stretch duel','Hold up duel'],
  foul_committed:    ['Card'],
  fifty_fifty:       ['Dribble','Pass recovery','Tackle','Positioning duel','Pass','Pass interception','Ball recovery','Interception'],
  hold_up_duel:      ['Positioning duel','Interception','Ball recovery','Shield','Leg stretch duel'],
  leg_stretch_duel:  ['Dribble','Tackle','Hold up duel','Positioning duel'],
  positioning_duel:  ['Shield','Tackle','Fifty fifty','Hold up duel'],
  separation_duel:   ['Dribble','Miscontrol'],
  shield:            ['Hold up duel','Tackle','Ball recovery'],
  pass_recovery:     ['Pass interception','Clearance','Ball recovery','Interception','Tackle','GK (Keeper sweeper)','Miscontrol','Dribble','Fifty fifty'],
  pass_interception: ['Pass recovery','Clearance','Ball recovery','Interception','Tackle','Fifty fifty','Miscontrol','Dribble','GK (Keeper sweeper)'],
  goal_keeper:       null, // handled via GK sub-type flow
}

const GK_WRONG_EVENT_MAP = {
  gk_collected:      ['GK (Punch)','Ball recovery'],
  gk_punch:          ['GK (Collected)','GK (Save)'],
  gk_keeper_sweeper: ['Ball recovery','Clearance'],
  gk_save:           ['GK (Punch)'],
}

// ─── GK sub-types ─────────────────────────────────────────────────────────────
const GK_SUBTYPES = [
  { key:'1', id:'gk_collected',      label:'Collected'      },
  { key:'2', id:'gk_punch',          label:'Punch'          },
  { key:'3', id:'gk_keeper_sweeper', label:'Keeper sweeper' },
  { key:'4', id:'gk_save',           label:'Save'           },
]

// ─── error types ──────────────────────────────────────────────────────────────
const ERROR_TYPES = [
  { key:'1', id:'wrong_event',      label:'Wrong event',      autoSave:false },
  { key:'2', id:'missing_event',    label:'Missing event',    autoSave:true  },
  { key:'3', id:'extra_event',      label:'Extra event',      autoSave:true  },
  { key:'4', id:'missing_extra',    label:'Missing extra',    autoSave:false },
  { key:'5', id:'wrong_extra',      label:'Wrong extra',      autoSave:false },
  { key:'6', id:'not_needed_extra', label:'Not needed extra', autoSave:false },
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
        if (et.autoSave) { doAutoSave(et.id); return }
        setErrorTypeId(et.id)
        if      (et.id === 'wrong_event')      setStep(isGK ? 'gk_wrong_event' : 'wrong_event')
        else if (et.id === 'missing_extra')    setStep('missing_extra')
        else if (et.id === 'not_needed_extra') setStep('not_needed_extra')
        else if (et.id === 'wrong_extra')      setStep('wrong_extra_pick')
        return
      }

      if (step === 'wrong_event') {
        const list = WRONG_EVENT_MAP[eventId] || []
        const idx  = KEYS.indexOf(k)
        if (idx >= 0 && idx < list.length) { setCorrection(list[idx]); setStep('team') }
        return
      }

      if (step === 'gk_wrong_event') {
        const list = GK_WRONG_EVENT_MAP[gkSubType?.id] || []
        const idx  = KEYS.indexOf(k)
        if (idx >= 0 && idx < list.length) { setCorrection(list[idx]); setStep('team') }
        return
      }

      if (step === 'missing_extra' || step === 'not_needed_extra') {
        const list = MISSING_EXTRAS[eventId] || []
        const idx  = KEYS.indexOf(k)
        if (idx >= 0 && idx < list.length) { setSelectedExtra(list[idx]); setStep('team') }
        return
      }

      if (step === 'wrong_extra_pick') {
        const map  = WRONG_EXTRAS[eventId] || {}
        const list = Object.keys(map)
        const idx  = KEYS.indexOf(k)
        if (idx >= 0 && idx < list.length) { setSelectedExtra(list[idx]); setStep('wrong_extra_corr') }
        return
      }

      if (step === 'wrong_extra_corr') {
        const map   = WRONG_EXTRAS[eventId] || {}
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

  const wrongExtraMap  = WRONG_EXTRAS[eventId] || {}
  const wrongExtraKeys = Object.keys(wrongExtraMap)
  const missingList    = MISSING_EXTRAS[eventId] || []
  const wrongEventList = isGK
    ? (GK_WRONG_EVENT_MAP[gkSubType?.id] || [])
    : (WRONG_EVENT_MAP[eventId] || [])

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
                      if (et.autoSave) { doAutoSave(et.id); return }
                      setErrorTypeId(et.id)
                      if      (et.id === 'wrong_event')      setStep(isGK ? 'gk_wrong_event' : 'wrong_event')
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
              onSelect={(c) => { setCorrection(c); setStep('team') }} />
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
]

export const GK_EXTRAS = [
  { key:'1', id:'gk_collected',      label:'Collected'       },
  { key:'2', id:'gk_punch',          label:'Punch'           },
  { key:'3', id:'gk_keeper_sweeper', label:'Keeper sweeper'  },
  { key:'4', id:'gk_save',           label:'Save'            },
]

export const GK_WRONG_EXTRAS = {}
