import { useState, useEffect } from 'react'
import { TORNADO_EVENTS, MISSING_EVENT_KEY } from '../data/shortcuts'

// ── General extras (all events) ───────────────────────────────────────────────
export const EXTRAS = [
  { key: '1', id: 'extra_event',      label: 'Extra Event',      events: 'all' },
  { key: '2', id: 'wrong_event',      label: 'Wrong Event',      events: 'all' },
  { key: '3', id: 'wrong_timestamp',  label: 'Wrong Timestamp',  events: 'all' },
  { key: '4', id: 'wrong_team_event', label: 'Wrong Team Event', events: 'all' },
  { key: '5', id: 'wrong_extra',      label: 'Wrong Extra',      events: 'all' },
  { key: '6', id: 'missing_extra',    label: 'Missing Extra',    events: 'all' },
  { key: '7', id: 'wrong_player',     label: 'Wrong Player',     events: 'all' },
  { key: '8', id: 'wrong_height',     label: 'Wrong Height',     events: ['pass'] },
  { key: '9', id: 'wrong_body_part',  label: 'Wrong Body Part',  events: ['pass'] },
]

// ── GK sub-events ─────────────────────────────────────────────────────────────
export const GK_EXTRAS = [
  { key: '1', id: 'gk_punch',            label: 'Punch' },
  { key: '2', id: 'gk_smother',          label: 'Smother' },
  { key: '3', id: 'gk_save_attempt',     label: 'Save Attempt' },
  { key: '4', id: 'gk_conceded_no_save', label: 'Conceded No Save' },
  { key: '5', id: 'gk_keeper_sweeper',   label: 'Keeper Sweeper' },
  { key: '6', id: 'gk_collected',        label: 'Collected' },
]

// ── GK-specific wrong extras (shown when Wrong Extra / Missing Extra selected)
// events: which GK sub-event ids this applies to
const GK_WRONG_EXTRAS = {
  gk_save_attempt: [
    { key: '1',   id: 'gkw_save',        label: 'Save' },
    { key: null,  id: 'gkw_left_foot',   label: 'Left Foot' },
    { key: null,  id: 'gkw_right_foot',  label: 'Right Foot' },
    { key: null,  id: 'gkw_both_hands',  label: 'Both Hands' },
    { key: null,  id: 'gkw_right_hand',  label: 'Right Hand' },
    { key: null,  id: 'gkw_left_hand',   label: 'Left Hand' },
    { key: null,  id: 'gkw_head',        label: 'Head' },
    { key: null,  id: 'gkw_chest',       label: 'Chest' },
    { key: null,  id: 'gkw_other',       label: 'Other' },
    { key: '2',   id: 'gkw_diving',      label: 'Diving' },
    { key: '3',   id: 'gkw_standing',    label: 'Standing' },
    { key: '4',   id: 'gkw_to_post',     label: 'To Post' },
    { key: '5',   id: 'gkw_off_target',  label: 'Off Target' },
    { key: '6',   id: 'gkw_set',         label: 'Set' },
    { key: '7',   id: 'gkw_moving',      label: 'Moving' },
    { key: '8',   id: 'gkw_prone',       label: 'Prone' },
    { key: '9',   id: 'gkw_save_to_post',label: 'Save to Post' },
  ],
  gk_conceded_no_save: [
    { key: '1',   id: 'gkw_no_touch',    label: 'No Touch' },
    { key: '2',   id: 'gkw_diving',      label: 'Diving' },
    { key: '3',   id: 'gkw_standing',    label: 'Standing' },
    { key: '4',   id: 'gkw_to_post',     label: 'To Post' },
    { key: '5',   id: 'gkw_off_target',  label: 'Off Target' },
    { key: '6',   id: 'gkw_set',         label: 'Set' },
    { key: '7',   id: 'gkw_moving',      label: 'Moving' },
    { key: '8',   id: 'gkw_prone',       label: 'Prone' },
    { key: '9',   id: 'gkw_save_to_post',label: 'Save to Post' },
  ],
}

// GK card extras (shown after selecting a GK sub-event)
const GK_CARD_EXTRAS = [
  { key: '1', id: 'extra_event',      label: 'Extra Event' },
  { key: '2', id: 'wrong_timestamp',  label: 'Wrong Timestamp' },
  { key: '3', id: 'wrong_team_event', label: 'Wrong Team Event' },
  { key: '4', id: 'wrong_extra',      label: 'Wrong Extra' },
  { key: '5', id: 'missing_extra',    label: 'Missing Extra' },
]
// The ones that trigger wrong extras list
const GK_WRONG_TRIGGER_IDS = ['wrong_extra', 'missing_extra']
// The ones that auto-save immediately
const GK_AUTO_SAVE_IDS = ['extra_event', 'wrong_timestamp', 'wrong_team_event']

const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00.000'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms  = Math.floor((s % 1) * 1000)
  return `${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
}

const TEAM_BTNS = [
  { id: 'home', label: 'Home', key: '1', color: '#0A84FF', bg: 'rgba(10,132,255,0.15)' },
  { id: 'away', label: 'Away', key: '2', color: '#FF453A', bg: 'rgba(255,69,58,0.15)' },
]

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
function PanelHeader({ eventKey, eventLabel, videoTime, isMissing, showTeamHint, onCancel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700,
          background: isMissing ? '#BF5AF2' : 'var(--p2)', color: '#fff',
          borderRadius: 6, padding: '3px 9px',
        }}>
          {eventKey || '•'}
        </span>
        <span style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 15, color: 'var(--t-1)' }}>
          {eventLabel}
        </span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--t-3)' }}>
          @ {fmt(videoTime)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {showTeamHint && (
          <span style={{ fontSize: 11, color: 'var(--t-3)' }}>
            press <span style={{ color: '#0A84FF', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>1</span> Home /
            <span style={{ color: '#FF453A', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}> 2</span> Away to save
          </span>
        )}
        <button className="btn-ghost" style={{ padding: '3px 9px', fontSize: 11 }} onClick={onCancel}>ESC</button>
      </div>
    </div>
  )
}

function TeamRow({ onSave, disabled }) {
  return (
    <div style={{
      display: 'flex', gap: 10,
      opacity: disabled ? 0.3 : 1,
      transition: 'opacity .2s',
      pointerEvents: disabled ? 'none' : 'all',
    }}>
      {TEAM_BTNS.map(t => (
        <button key={t.id} onClick={() => !disabled && onSave(t.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 22px', borderRadius: 10, cursor: 'pointer',
            border: `1.5px solid ${t.color}66`, background: t.bg,
            transition: 'all .1s',
          }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 800, color: t.color }}>{t.key}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: t.color }}>{t.label}</span>
        </button>
      ))}
    </div>
  )
}

function PillBtn({ label, shortcut, active, color, onClick }) {
  const c = color || 'var(--p2)'
  const activeBg = color ? `rgba(${color === '#FFD60A' ? '255,214,10' : '232,89,12'},0.12)` : 'rgba(232,89,12,0.15)'
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 11px', borderRadius: 18, cursor: 'pointer',
      border: active ? `1.5px solid ${c}` : '1.5px solid var(--b-2)',
      background: active ? activeBg : 'var(--bg-3)',
      transition: 'all .1s',
    }}>
      {shortcut && (
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: active ? c : 'var(--t-3)' }}>
          {shortcut}
        </span>
      )}
      <span style={{ fontSize: 12, color: active ? c : shortcut ? 'var(--t-2)' : 'var(--t-3)', fontWeight: active ? 600 : 400, fontStyle: shortcut ? 'normal' : 'italic' }}>
        {label}
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP COMPONENTS FOR GK FLOW
// ─────────────────────────────────────────────────────────────────────────────

// Step 1: Select GK sub-event
function GKSubEventStep({ pendingTag, onSelect, onCancel }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { onCancel(); return }
      const ex = GK_EXTRAS.find(x => x.key === e.key)
      if (ex) onSelect(ex)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSelect, onCancel])

  return (
    <>
      <PanelHeader eventKey="G" eventLabel="Goal Keeper" videoTime={pendingTag.videoTime} onCancel={onCancel} />
      <div style={{ fontSize: 9, fontWeight: 700, color: '#FFD60A', letterSpacing: 1, marginBottom: 8 }}>GK EVENT</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {GK_EXTRAS.map(ex => (
          <PillBtn key={ex.id} label={ex.label} shortcut={ex.key} active={false} color="#FFD60A" onClick={() => onSelect(ex)} />
        ))}
      </div>
    </>
  )
}

// Step 2: Select card extra (Extra Event / Wrong Timestamp / Wrong Team Event / Wrong Extra / Missing Extra)
function GKCardStep({ pendingTag, gkSubEvent, onCardSelect, onCancel }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { onCancel(); return }
      const ex = GK_CARD_EXTRAS.find(x => x.key === e.key)
      if (ex) onCardSelect(ex)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCardSelect, onCancel])

  return (
    <>
      <PanelHeader eventKey="G" eventLabel={`Goal Keeper — ${gkSubEvent.label}`} videoTime={pendingTag.videoTime} onCancel={onCancel} />
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--t-3)', letterSpacing: 1, marginBottom: 8 }}>EXTRA TYPE</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {GK_CARD_EXTRAS.map(ex => {
          const isWrongTrigger = GK_WRONG_TRIGGER_IDS.includes(ex.id)
          return (
            <PillBtn
              key={ex.id}
              label={ex.label}
              shortcut={ex.key}
              active={false}
              color={isWrongTrigger ? '#FF9F0A' : 'var(--p2)'}
              onClick={() => onCardSelect(ex)}
            />
          )
        })}
      </div>
    </>
  )
}

// Step 3: Select wrong extras (only for Save Attempt / Conceded No Save)
function GKWrongExtrasStep({ pendingTag, gkSubEvent, cardExtra, onSave, onCancel }) {
  const [selected, setSelected] = useState([])
  const wrongExtras = GK_WRONG_EXTRAS[gkSubEvent.id] || []

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { onCancel(); return }
      if ((e.key === '1' || e.key === '2') && selected.length > 0) {
        // Check if '1' or '2' is also a wrong extra key
        const we = wrongExtras.find(x => x.key === e.key)
        if (we && selected.length === 0) { toggle(we.id); return }
        onSave(selected, e.key === '1' ? 'home' : 'away')
        return
      }
      const we = wrongExtras.find(x => x.key === e.key)
      if (we) toggle(we.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, wrongExtras, onSave, onCancel])

  return (
    <>
      <PanelHeader eventKey="G" eventLabel={`${gkSubEvent.label} — ${cardExtra.label}`} videoTime={pendingTag.videoTime} showTeamHint={selected.length > 0} onCancel={onCancel} />
      <div style={{ fontSize: 9, fontWeight: 700, color: '#FF9F0A', letterSpacing: 1, marginBottom: 8 }}>WRONG EXTRAS</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {wrongExtras.map(ex => (
          <PillBtn key={ex.id} label={ex.label} shortcut={ex.key} active={selected.includes(ex.id)} color="#FF9F0A" onClick={() => toggle(ex.id)} />
        ))}
      </div>
      <TeamRow onSave={(team) => onSave(selected, team)} disabled={selected.length === 0} />
    </>
  )
}

// Step 4: Team selection (for auto-save card extras)
function GKTeamStep({ pendingTag, gkSubEvent, cardExtra, onSave, onCancel }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { onCancel(); return }
      if (e.key === '1') onSave('home')
      if (e.key === '2') onSave('away')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSave, onCancel])

  return (
    <>
      <PanelHeader eventKey="G" eventLabel={`${gkSubEvent.label} — ${cardExtra.label}`} videoTime={pendingTag.videoTime} showTeamHint={true} onCancel={onCancel} />
      <TeamRow onSave={onSave} disabled={false} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EDIT MODAL
// ─────────────────────────────────────────────────────────────────────────────
function TagPanelEdit({ tag, onSave, onDelete, onCancel }) {
  const event = TORNADO_EVENTS.find(e => e.key?.toUpperCase() === tag.triggeredKey?.toUpperCase())
    || { label: tag.triggeredEventLabel || tag.triggeredKey, id: tag.triggeredEventId, key: tag.triggeredKey }
  const isMissing = tag.triggeredKey?.toUpperCase() === MISSING_EVENT_KEY
  const isGK = event.id === 'goal_keeper'
  const [selectedExtras, setSelectedExtras] = useState(tag.extras || [])
  const [team, setTeam] = useState(tag.team || null)
  const generalExtras = EXTRAS.filter(ex => ex.events === 'all' || ex.events.includes(event.id))

  function toggleExtra(id) {
    setSelectedExtras(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function handleSave() {
    if (!team || selectedExtras.length === 0) return
    onSave({ ...tag, extras: selectedExtras, team })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div className="card slide-up" style={{ width: 480, padding: 0, overflow: 'hidden', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--b-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, background: isMissing ? '#BF5AF2' : 'var(--p2)', color: '#fff', borderRadius: 5, padding: '2px 7px' }}>
                {isMissing ? 'Q' : (event.key || '•')}
              </span>
              <span style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 15, color: 'var(--t-1)' }}>
                {isMissing ? 'Missing Event' : event.label}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>@ {fmt(tag.videoTimeSec)}</div>
          </div>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onCancel}>✕</button>
        </div>
        <div style={{ padding: '14px 20px 18px', overflowY: 'auto' }}>
          {isGK && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#FFD60A', letterSpacing: 1, marginBottom: 8 }}>GK EXTRAS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {GK_EXTRAS.map(ex => {
                  const active = selectedExtras.includes(ex.id)
                  return <PillBtn key={ex.id} label={ex.label} shortcut={ex.key} active={active} color="#FFD60A" onClick={() => toggleExtra(ex.id)} />
                })}
              </div>
              <div style={{ height: 1, background: 'var(--b-1)', marginBottom: 12 }}/>
            </>
          )}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-3)', letterSpacing: 1, marginBottom: 8 }}>EXTRAS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {generalExtras.map(ex => {
              const active = selectedExtras.includes(ex.id)
              return <PillBtn key={ex.id} label={ex.label} shortcut={ex.key} active={active} onClick={() => toggleExtra(ex.id)} />
            })}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-3)', letterSpacing: 1, marginBottom: 8 }}>TEAM</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
            {TEAM_BTNS.map(t => (
              <button key={t.id} onClick={() => setTeam(t.id)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '11px 0', borderRadius: 9, cursor: 'pointer',
                border: `1.5px solid ${team === t.id ? t.color : 'var(--b-2)'}`,
                background: team === t.id ? t.bg : 'var(--bg-3)', transition: 'all .12s',
              }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: team === t.id ? t.color : 'var(--t-3)' }}>{t.key}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: team === t.id ? t.color : 'var(--t-2)' }}>{t.label}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onDelete} style={{ flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer', border: '1.5px solid rgba(255,69,58,0.4)', background: 'rgba(255,69,58,0.08)', color: '#FF453A', fontSize: 13, fontWeight: 600 }}>Delete</button>
            <button onClick={handleSave} disabled={!team || selectedExtras.length === 0} className="btn-orange" style={{ flex: 2, padding: '10px 0', fontSize: 13 }}>Save Changes</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN TAG PANEL
// ─────────────────────────────────────────────────────────────────────────────
export default function TagPanel({ pendingTag, onSave, onCancel, editTag, onEditSave, onEditDelete, onEditCancel }) {
  const [selectedExtras, setSelectedExtras] = useState([])
  // GK multi-step state
  const [gkStep,       setGkStep]       = useState(null) // null | 'sub' | 'card' | 'wrong' | 'team'
  const [gkSubEvent,   setGkSubEvent]   = useState(null)
  const [gkCardExtra,  setGkCardExtra]  = useState(null)

  const event = pendingTag
    ? (TORNADO_EVENTS.find(e => e.key?.toUpperCase() === pendingTag.key?.toUpperCase())
      || { label: pendingTag.label || pendingTag.key, id: pendingTag.id || '', key: pendingTag.key })
    : null

  const isMissing = pendingTag?.isMissing
  const isGK      = event?.id === 'goal_keeper'

  const generalExtras = event
    ? EXTRAS.filter(ex => ex.events === 'all' || ex.events.includes(event.id))
    : []

  // Reset all state when new tag starts
  useEffect(() => {
    setSelectedExtras([])
    setGkStep(isGK ? 'sub' : null)
    setGkSubEvent(null)
    setGkCardExtra(null)
  }, [pendingTag?.key, pendingTag?.videoTime])

  function doSave(extras, team) {
    onSave({
      triggeredKey:        pendingTag.key,
      triggeredEventId:    event?.id || '',
      triggeredEventLabel: isMissing ? 'Missing Event' : (event?.label || pendingTag.key),
      extras,
      team,
      gkSubEvent:          gkSubEvent?.id || null,
      gkCardExtra:         gkCardExtra?.id || null,
      videoTimeSec:        pendingTag.videoTime,
      timestamp:           Date.now(),
      isMissing:           !!isMissing,
    })
  }

  // GK: sub-event selected
  function handleGkSubSelect(sub) {
    setGkSubEvent(sub)
    setGkStep('card')
  }

  // GK: card extra selected
  function handleGkCardSelect(cardEx) {
    setGkCardExtra(cardEx)
    if (GK_WRONG_TRIGGER_IDS.includes(cardEx.id)) {
      // Only show wrong extras if this sub-event has them
      if (GK_WRONG_EXTRAS[gkSubEvent.id]) {
        setGkStep('wrong')
      } else {
        setGkStep('team')
      }
    } else if (GK_AUTO_SAVE_IDS.includes(cardEx.id)) {
      setGkStep('team')
    }
  }

  // GK: wrong extras confirmed → go to team
  function handleGkWrongSave(wrongExtras, team) {
    doSave([gkSubEvent.id, gkCardExtra.id, ...wrongExtras], team)
  }

  // GK: team selected after auto-save card extra
  function handleGkTeamSave(team) {
    doSave([gkSubEvent.id, gkCardExtra.id], team)
  }

  // Normal flow keyboard handler
  useEffect(() => {
    if (!pendingTag || isGK) return
    function onKey(e) {
      if (e.key === 'Escape') { onCancel(); return }
      const k = e.key
      if ((k === '1' || k === '2') && selectedExtras.length > 0) {
        doSave(selectedExtras, k === '1' ? 'home' : 'away')
        return
      }
      const genEx = generalExtras.find(ex => ex.key === k)
      if (genEx) {
        setSelectedExtras(prev => prev.includes(genEx.id) ? prev.filter(x => x !== genEx.id) : [...prev, genEx.id])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingTag, isGK, selectedExtras, generalExtras])

  if (editTag) return <TagPanelEdit tag={editTag} onSave={onEditSave} onDelete={onEditDelete} onCancel={onEditCancel} />
  if (!pendingTag) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', pointerEvents: 'all' }} onClick={onCancel} />
      <div className="slide-up" style={{ position: 'relative', width: '100%', zIndex: 1, background: 'var(--bg-2)', borderTop: '2px solid var(--b-1)', padding: '14px 20px 16px', pointerEvents: 'all' }} onClick={e => e.stopPropagation()}>

        {/* ── GK MULTI-STEP FLOW ── */}
        {isGK && gkStep === 'sub' && (
          <GKSubEventStep pendingTag={pendingTag} onSelect={handleGkSubSelect} onCancel={onCancel} />
        )}
        {isGK && gkStep === 'card' && gkSubEvent && (
          <GKCardStep pendingTag={pendingTag} gkSubEvent={gkSubEvent} onCardSelect={handleGkCardSelect} onCancel={onCancel} />
        )}
        {isGK && gkStep === 'wrong' && gkSubEvent && gkCardExtra && (
          <GKWrongExtrasStep pendingTag={pendingTag} gkSubEvent={gkSubEvent} cardExtra={gkCardExtra} onSave={handleGkWrongSave} onCancel={onCancel} />
        )}
        {isGK && gkStep === 'team' && gkSubEvent && gkCardExtra && (
          <GKTeamStep pendingTag={pendingTag} gkSubEvent={gkSubEvent} cardExtra={gkCardExtra} onSave={handleGkTeamSave} onCancel={onCancel} />
        )}

        {/* ── NORMAL EVENT FLOW ── */}
        {!isGK && (
          <>
            <PanelHeader
              eventKey={pendingTag.key}
              eventLabel={isMissing ? 'Missing Event' : event?.label}
              videoTime={pendingTag.videoTime}
              isMissing={isMissing}
              showTeamHint={selectedExtras.length > 0}
              onCancel={onCancel}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {generalExtras.map(ex => {
                const active = selectedExtras.includes(ex.id)
                return <PillBtn key={ex.id} label={ex.label} shortcut={ex.key} active={active} onClick={() => setSelectedExtras(prev => prev.includes(ex.id) ? prev.filter(x => x !== ex.id) : [...prev, ex.id])} />
              })}
            </div>
            <TeamRow onSave={(team) => doSave(selectedExtras, team)} disabled={selectedExtras.length === 0} />
          </>
        )}
      </div>
    </div>
  )
}
