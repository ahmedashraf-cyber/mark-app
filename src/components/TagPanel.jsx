import { useState, useEffect } from 'react'
import { TORNADO_EVENTS, MISSING_EVENT_KEY } from '../data/shortcuts'

const KEYS = '1234567890QWERTYUIOPASDFGHJKLZXCVBNM'

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

export const GK_EXTRAS = [
  { key: '1', id: 'gk_punch',            label: 'Punch' },
  { key: '2', id: 'gk_smother',          label: 'Smother' },
  { key: '3', id: 'gk_save_attempt',     label: 'Save Attempt' },
  { key: '4', id: 'gk_conceded_no_save', label: 'Conceded No Save' },
  { key: '5', id: 'gk_keeper_sweeper',   label: 'Keeper Sweeper' },
  { key: '6', id: 'gk_collected',        label: 'Collected' },
]

export const GK_WRONG_EXTRAS = {
  gk_save_attempt: [
    { key: '1', id: 'gkw_save',         label: 'Save' },
    { key: null, id: 'gkw_left_foot',   label: 'Left Foot' },
    { key: null, id: 'gkw_right_foot',  label: 'Right Foot' },
    { key: null, id: 'gkw_both_hands',  label: 'Both Hands' },
    { key: null, id: 'gkw_right_hand',  label: 'Right Hand' },
    { key: null, id: 'gkw_left_hand',   label: 'Left Hand' },
    { key: null, id: 'gkw_head',        label: 'Head' },
    { key: null, id: 'gkw_chest',       label: 'Chest' },
    { key: null, id: 'gkw_other',       label: 'Other' },
    { key: '2', id: 'gkw_diving',       label: 'Diving' },
    { key: '3', id: 'gkw_standing',     label: 'Standing' },
    { key: '4', id: 'gkw_to_post',      label: 'To Post' },
    { key: '5', id: 'gkw_off_target',   label: 'Off Target' },
    { key: '6', id: 'gkw_set',          label: 'Set' },
    { key: '7', id: 'gkw_moving',       label: 'Moving' },
    { key: '8', id: 'gkw_prone',        label: 'Prone' },
    { key: '9', id: 'gkw_save_to_post', label: 'Save to Post' },
  ],
  gk_conceded_no_save: [
    { key: '1', id: 'gkw_no_touch',     label: 'No Touch' },
    { key: '2', id: 'gkw_diving',       label: 'Diving' },
    { key: '3', id: 'gkw_standing',     label: 'Standing' },
    { key: '4', id: 'gkw_to_post',      label: 'To Post' },
    { key: '5', id: 'gkw_off_target',   label: 'Off Target' },
    { key: '6', id: 'gkw_set',          label: 'Set' },
    { key: '7', id: 'gkw_moving',       label: 'Moving' },
    { key: '8', id: 'gkw_prone',        label: 'Prone' },
    { key: '9', id: 'gkw_save_to_post', label: 'Save to Post' },
  ],
}

const GK_CARD_EXTRAS = [
  { key: '1', id: 'extra_event',      label: 'Extra Event' },
  { key: '2', id: 'wrong_timestamp',  label: 'Wrong Timestamp' },
  { key: '3', id: 'wrong_team_event', label: 'Wrong Team Event' },
  { key: '4', id: 'wrong_extra',      label: 'Wrong Extra' },
  { key: '5', id: 'missing_extra',    label: 'Missing Extra' },
]
const GK_WRONG_TRIGGER_IDS = ['wrong_extra', 'missing_extra']
const GK_AUTO_SAVE_IDS     = ['extra_event', 'wrong_timestamp', 'wrong_team_event']

const WRONG_EVENT_MAP = {
  'pass':              ['Miscontrol','Dribble','Pass recovery','Pass interception','Tackle','Clearance','Shot','Fifty fifty','Interception','Ball recovery','Block'],
  'shot':              ['Pass','Miscontrol','Clearance','Tackle','Dribble','GK (Smoother)'],
  'reception':         ['Miscontrol','Tackle','Ball recovery'],
  'miscontrol':        ['Dribble','Tackle','Pass','Shot','Clearance','Ball recovery','Block','Reception','Interception'],
  'tackle':            ['Clearance','Block','Dribble','Fifty fifty','Miscontrol','Pass','Pass recovery','Pass interception','Leg stretch duel','Hold up duel','Separation duel'],
  'interception':      ['Ball recovery','Clearance','Pass recovery','Pass interception','Block','Tackle'],
  'ball_recovery':     ['Interception','Pass recovery','Pass interception','Block','Clearance','Fifty fifty','GK (Keeper sweeper)','GK (Collected)','Tackle'],
  'block':             ['Tackle','Clearance','Interception','Miscontrol','Ball recovery','Pass','Pass recovery','Fifty fifty','Pass interception'],
  'clearance':         ['Pass recovery','GK (Keeper sweeper)','GK (Punch)','Interception','Block','Fifty fifty','Tackle','Dribble','Shot','Ball recovery'],
  'dribble':           ['Tackle','Pass','Pass recovery','Pass interception','Miscontrol','Separation duel','Leg stretch duel','Hold up duel'],
  'foul_committed':    ['Card'],
  'fifty_fifty':       ['Dribble','Pass recovery','Tackle','Positioning duel','Pass','Pass interception','Ball recovery','Interception'],
  'hold_up_duel':      ['Positioning duel','Interception','Ball recovery','Shield','Leg stretch duel'],
  'leg_stretch_duel':  ['Dribble','Tackle','Hold up duel','Positioning duel'],
  'positioning_duel':  ['Shield','Tackle','Fifty fifty','Hold up duel'],
  'separation_duel':   ['Dribble','Miscontrol'],
  'shield':            ['Hold up duel','Tackle','Ball recovery'],
  'pass_recovery':     ['Pass interception','Clearance','Ball recovery','Interception','Tackle','GK (Keeper sweeper)','Miscontrol','Dribble','Fifty fifty'],
  'pass_interception': ['Pass recovery','Clearance','Ball recovery','Interception','Tackle','Fifty fifty','Miscontrol','Dribble','GK (Keeper sweeper)'],
}

const GK_WRONG_EVENT_MAP = {
  'gk_collected':        ['GK (Punch)','Ball recovery'],
  'gk_punch':            ['GK (Collected)','GK (Save)'],
  'gk_keeper_sweeper':   ['Ball recovery','Clearance'],
  'gk_save_attempt':     ['GK (Punch)'],
}

const MISSING_EXTRA_LIST = [
  'Aerial won','Backheel','Deflection','Save','Dribble attempted',
  'Launch','Miscommunication','Through ball','Injury clearance','Advantage','Penalty',
]

const WRONG_EXTRA_LIST = [
  'Aerial won','Both hands','Set','Prone','Moving','Diving','Standing',
  'Diving header','Drop kick','Inswinging','Outswinging','Straight',
  'Half volley','Volley','Regular','Handball','Dangerous play','Offside',
  'Right','Left','Right take on','Left take on',
  'Won','Success','Second effort','Step in','Wayward','Out endline',
  'No card','Yellow card','Second yellow','Red card',
]

const WRONG_EXTRA_CORR = {
  'Aerial won':    ['Regular','Step in'],
  'Both hands':    ['Right hand','Left hand'],
  'Set':           ['Prone','Moving'],
  'Prone':         ['Set','Moving'],
  'Moving':        ['Set','Prone'],
  'Diving':        ['Standing'],
  'Standing':      ['Diving'],
  'Diving header': ['Normal'],
  'Drop kick':     ['Right foot','Left foot'],
  'Inswinging':    ['Outswinging','Straight'],
  'Outswinging':   ['Inswinging','Straight'],
  'Straight':      ['Inswinging','Outswinging'],
  'Half volley':   ['Volley','Normal'],
  'Volley':        ['Half volley'],
  'Regular':       ['Handball','Dangerous play','Offside'],
  'Handball':      ['Regular','Offside'],
  'Dangerous play':['Regular','Handball','Offside'],
  'Offside':       ['Regular','Handball','Dangerous play'],
  'Right':         ['Left','Right take on','Left take on','None'],
  'Left':          ['Right','Right take on','Left take on','None'],
  'Right take on': ['Right','Left','Left take on','None'],
  'Left take on':  ['Right','Left','Right take on','None'],
  'Won':           ['Success','Second effort'],
  'Success':       ['Won','Second effort'],
  'Second effort': ['Won','Success'],
  'Step in':       ['Aerial won'],
  'Wayward':       ['Out endline'],
  'Out endline':   ['Wayward'],
  'No card':       ['Yellow card','Second yellow','Red card'],
  'Yellow card':   ['No card','Second yellow','Red card'],
  'Second yellow': ['No card','Yellow card','Red card'],
  'Red card':      ['No card','Yellow card','Second yellow'],
}

const AUTO_SAVE_ERROR_TYPES = ['missing_event','extra_event']

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

function KeyedList({ items, onSelect, color, cols = 2 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 5 }}>
      {items.map((item, i) => {
        const k = KEYS[i] || '?'
        const label = typeof item === 'string' ? item : item.label
        const c = color || 'var(--p2)'
        return (
          <button
            key={i}
            onClick={() => onSelect(item, k)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 9px', borderRadius: 7, cursor: 'pointer',
              border: '1.5px solid var(--b-2)', background: 'var(--bg-3)',
              transition: 'all .1s', textAlign: 'left',
            }}
          >
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
              color: c, minWidth: 14, flexShrink: 0,
            }}>{k}</span>
            <span style={{ fontSize: 11, color: 'var(--t-2)', lineHeight: 1.3 }}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

function StepLabel({ text, color }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, letterSpacing: 1,
      color: color || 'var(--t-3)', marginBottom: 8, textTransform: 'uppercase',
    }}>{text}</div>
  )
}

function Breadcrumb({ items }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
      {items.map((item, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {i > 0 && <span style={{ fontSize: 10, color: 'var(--t-3)' }}>→</span>}
          <span style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 4,
            background: i === items.length - 1 ? 'rgba(232,89,12,0.15)' : 'var(--bg-3)',
            color: i === items.length - 1 ? 'var(--p2)' : 'var(--t-3)',
            border: i === items.length - 1 ? '1px solid rgba(232,89,12,0.3)' : '1px solid var(--b-2)',
          }}>{item}</span>
        </span>
      ))}
    </div>
  )
}

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
      <StepLabel text="GK event" color="#FFD60A" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {GK_EXTRAS.map(ex => (
          <PillBtn key={ex.id} label={ex.label} shortcut={ex.key} active={false} color="#FFD60A" onClick={() => onSelect(ex)} />
        ))}
      </div>
    </>
  )
}

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
      <StepLabel text="error type" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {GK_CARD_EXTRAS.map(ex => (
          <PillBtn
            key={ex.id}
            label={ex.label}
            shortcut={ex.key}
            active={false}
            color={GK_WRONG_TRIGGER_IDS.includes(ex.id) ? '#FF9F0A' : 'var(--p2)'}
            onClick={() => onCardSelect(ex)}
          />
        ))}
      </div>
    </>
  )
}

function GKWrongEventStep({ pendingTag, gkSubEvent, onSave, onCancel }) {
  const corrections = GK_WRONG_EVENT_MAP[gkSubEvent.id] || []

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { onCancel(); return }
      const idx = KEYS.indexOf(e.key.toUpperCase())
      if (idx >= 0 && idx < corrections.length) onSave(corrections[idx])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [corrections, onSave, onCancel])

  return (
    <>
      <PanelHeader eventKey="G" eventLabel={`GK (${gkSubEvent.label}) — Wrong Event`} videoTime={pendingTag.videoTime} onCancel={onCancel} />
      <StepLabel text="correct event was" color="var(--p2)" />
      <KeyedList items={corrections} onSelect={(c) => onSave(c)} color="var(--p2)" cols={2} />
    </>
  )
}

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
      <StepLabel text="wrong extras" color="#FF9F0A" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {wrongExtras.map(ex => (
          <PillBtn key={ex.id} label={ex.label} shortcut={ex.key} active={selected.includes(ex.id)} color="#FF9F0A" onClick={() => toggle(ex.id)} />
        ))}
      </div>
      <TeamRow onSave={(team) => onSave(selected, team)} disabled={selected.length === 0} />
    </>
  )
}

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

export default function TagPanel({ pendingTag, onSave, onCancel, editTag, onEditSave, onEditDelete, onEditCancel }) {
  const [step, setStep]               = useState('error_type')
  const [errorTypeId, setErrorTypeId] = useState(null)
  const [wrongEventCorr, setWrongEventCorr] = useState(null)
  const [wrongExtra, setWrongExtra]   = useState(null)
  const [gkStep, setGkStep]           = useState(null)
  const [gkSubEvent, setGkSubEvent]   = useState(null)
  const [gkCardExtra, setGkCardExtra] = useState(null)

  const event = pendingTag
    ? (TORNADO_EVENTS.find(e => e.key?.toUpperCase() === pendingTag.key?.toUpperCase())
      || { label: pendingTag.label || pendingTag.key, id: pendingTag.id || '', key: pendingTag.key })
    : null

  const isMissing = pendingTag?.isMissing
  const isGK      = event?.id === 'goal_keeper'

  useEffect(() => {
    setStep('error_type')
    setErrorTypeId(null)
    setWrongEventCorr(null)
    setWrongExtra(null)
    setGkStep(isGK ? 'sub' : null)
    setGkSubEvent(null)
    setGkCardExtra(null)
  }, [pendingTag?.key, pendingTag?.videoTime])

  const ERROR_TYPES = [
    { key: '1', id: 'wrong_event',      label: 'Wrong Event',      autoSave: false },
    { key: '2', id: 'missing_event',    label: 'Missing Event',    autoSave: true  },
    { key: '3', id: 'extra_event',      label: 'Extra Event',      autoSave: true  },
    { key: '4', id: 'missing_extra',    label: 'Missing Extra',    autoSave: false },
    { key: '5', id: 'wrong_extra',      label: 'Wrong Extra',      autoSave: false },
    { key: '6', id: 'not_needed_extra', label: 'Not Needed Extra', autoSave: false },
  ]

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

  function doAutoSave(errorType) {
    onSave({
      triggeredKey:        pendingTag.key,
      triggeredEventId:    event?.id || '',
      triggeredEventLabel: isMissing ? 'Missing Event' : (event?.label || pendingTag.key),
      extras:              [errorType],
      team:                null,
      videoTimeSec:        pendingTag.videoTime,
      timestamp:           Date.now(),
      isMissing:           !!isMissing,
    })
  }

  useEffect(() => {
    if (!pendingTag || isGK) return
    function onKey(e) {
      if (e.key === 'Escape') { onCancel(); return }
      const k = e.key.toUpperCase()

      if (step === 'error_type') {
        const et = ERROR_TYPES.find(x => x.key === e.key)
        if (!et) return
        if (et.autoSave) { doAutoSave(et.id); return }
        setErrorTypeId(et.id)
        if (et.id === 'wrong_event')      setStep('wrong_event')
        else if (et.id === 'missing_extra')    setStep('missing_extra')
        else if (et.id === 'wrong_extra')      setStep('wrong_extra_pick')
        else if (et.id === 'not_needed_extra') setStep('not_needed_extra')
        return
      }

      if (step === 'wrong_event') {
        const corrections = WRONG_EVENT_MAP[event?.id] || []
        const idx = KEYS.indexOf(k)
        if (idx >= 0 && idx < corrections.length) {
          setWrongEventCorr(corrections[idx])
          setStep('team')
        }
        return
      }

      if (step === 'missing_extra' || step === 'not_needed_extra') {
        const idx = KEYS.indexOf(k)
        if (idx >= 0 && idx < MISSING_EXTRA_LIST.length) {
          setWrongEventCorr(MISSING_EXTRA_LIST[idx])
          setStep('team')
        }
        return
      }

      if (step === 'wrong_extra_pick') {
        const idx = KEYS.indexOf(k)
        if (idx >= 0 && idx < WRONG_EXTRA_LIST.length) {
          setWrongExtra(WRONG_EXTRA_LIST[idx])
          setStep('wrong_extra_corr')
        }
        return
      }

      if (step === 'wrong_extra_corr') {
        const corrs = WRONG_EXTRA_CORR[wrongExtra] || []
        const idx = KEYS.indexOf(k)
        if (idx >= 0 && idx < corrs.length) {
          setWrongEventCorr(corrs[idx])
          setStep('team')
        }
        return
      }

      if (step === 'team') {
        if (e.key === '1') doSave([errorTypeId, wrongExtra, wrongEventCorr].filter(Boolean), 'home')
        if (e.key === '2') doSave([errorTypeId, wrongExtra, wrongEventCorr].filter(Boolean), 'away')
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingTag, isGK, step, errorTypeId, wrongEventCorr, wrongExtra])

  function handleGkSubSelect(sub)         { setGkSubEvent(sub); setGkStep('card') }
  function handleGkCardSelect(cardEx) {
    setGkCardExtra(cardEx)
    if (cardEx.id === 'wrong_event') {
      setGkStep('wrong_event')
    } else if (GK_WRONG_TRIGGER_IDS.includes(cardEx.id)) {
      setGkStep(GK_WRONG_EXTRAS[gkSubEvent.id] ? 'wrong' : 'team')
    } else if (GK_AUTO_SAVE_IDS.includes(cardEx.id)) {
      setGkStep('team')
    }
  }
  function handleGkWrongEventSave(corr)   { doSave([gkSubEvent.id, 'wrong_event', corr], null); }
  function handleGkWrongSave(we, team)    { doSave([gkSubEvent.id, gkCardExtra.id, ...we], team) }
  function handleGkTeamSave(team)         { doSave([gkSubEvent.id, gkCardExtra.id], team) }

  const breadcrumb = []
  if (event) breadcrumb.push(isMissing ? 'Missing Event' : event.label)
  if (errorTypeId) breadcrumb.push(ERROR_TYPES.find(x => x.id === errorTypeId)?.label || errorTypeId)
  if (wrongExtra) breadcrumb.push(wrongExtra)

  if (editTag) return <TagPanelEdit tag={editTag} onSave={onEditSave} onDelete={onEditDelete} onCancel={onEditCancel} />
  if (!pendingTag) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', pointerEvents: 'all' }} onClick={onCancel} />
      <div className="slide-up" style={{ position: 'relative', width: '100%', zIndex: 1, background: 'var(--bg-2)', borderTop: '2px solid var(--b-1)', padding: '14px 20px 16px', pointerEvents: 'all' }} onClick={e => e.stopPropagation()}>

        {/* GK FLOW */}
        {isGK && gkStep === 'sub' && <GKSubEventStep pendingTag={pendingTag} onSelect={handleGkSubSelect} onCancel={onCancel} />}
        {isGK && gkStep === 'card' && gkSubEvent && <GKCardStep pendingTag={pendingTag} gkSubEvent={gkSubEvent} onCardSelect={handleGkCardSelect} onCancel={onCancel} />}
        {isGK && gkStep === 'wrong_event' && gkSubEvent && <GKWrongEventStep pendingTag={pendingTag} gkSubEvent={gkSubEvent} onSave={handleGkWrongEventSave} onCancel={onCancel} />}
        {isGK && gkStep === 'wrong' && gkSubEvent && gkCardExtra && <GKWrongExtrasStep pendingTag={pendingTag} gkSubEvent={gkSubEvent} cardExtra={gkCardExtra} onSave={handleGkWrongSave} onCancel={onCancel} />}
        {isGK && gkStep === 'team' && gkSubEvent && gkCardExtra && <GKTeamStep pendingTag={pendingTag} gkSubEvent={gkSubEvent} cardExtra={gkCardExtra} onSave={handleGkTeamSave} onCancel={onCancel} />}

        {/* NORMAL FLOW */}
        {!isGK && (
          <>
            <PanelHeader
              eventKey={pendingTag.key}
              eventLabel={isMissing ? 'Missing Event' : event?.label}
              videoTime={pendingTag.videoTime}
              isMissing={isMissing}
              showTeamHint={step === 'team'}
              onCancel={onCancel}
            />

            {breadcrumb.length > 1 && <Breadcrumb items={breadcrumb} />}

            {step === 'error_type' && (
              <>
                <StepLabel text="error type" />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ERROR_TYPES.map(et => (
                    <PillBtn
                      key={et.id}
                      label={et.label}
                      shortcut={et.key}
                      active={false}
                      color={et.autoSave ? '#30D158' : 'var(--p2)'}
                      onClick={() => {
                        if (et.autoSave) { doAutoSave(et.id); return }
                        setErrorTypeId(et.id)
                        if (et.id === 'wrong_event')           setStep('wrong_event')
                        else if (et.id === 'missing_extra')    setStep('missing_extra')
                        else if (et.id === 'wrong_extra')      setStep('wrong_extra_pick')
                        else if (et.id === 'not_needed_extra') setStep('not_needed_extra')
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {step === 'wrong_event' && (
              <>
                <StepLabel text="correct event was" color="var(--p2)" />
                <KeyedList
                  items={WRONG_EVENT_MAP[event?.id] || []}
                  onSelect={(c) => { setWrongEventCorr(c); setStep('team') }}
                  color="var(--p2)"
                  cols={2}
                />
              </>
            )}

            {(step === 'missing_extra' || step === 'not_needed_extra') && (
              <>
                <StepLabel text={step === 'missing_extra' ? 'which extra is missing' : 'which extra to remove'} color="#FF9F0A" />
                <KeyedList
                  items={MISSING_EXTRA_LIST}
                  onSelect={(c) => { setWrongEventCorr(c); setStep('team') }}
                  color="#FF9F0A"
                  cols={2}
                />
              </>
            )}

            {step === 'wrong_extra_pick' && (
              <>
                <StepLabel text="which extra was wrong" color="#FF9F0A" />
                <KeyedList
                  items={WRONG_EXTRA_LIST}
                  onSelect={(c) => { setWrongExtra(c); setStep('wrong_extra_corr') }}
                  color="#FF9F0A"
                  cols={2}
                />
              </>
            )}

            {step === 'wrong_extra_corr' && wrongExtra && (
              <>
                <StepLabel text={`correct ${wrongExtra} to`} color="var(--p2)" />
                <KeyedList
                  items={WRONG_EXTRA_CORR[wrongExtra] || []}
                  onSelect={(c) => { setWrongEventCorr(c); setStep('team') }}
                  color="var(--p2)"
                  cols={1}
                />
              </>
            )}

            {step === 'team' && (
              <>
                <StepLabel text="which team made the error" />
                <TeamRow
                  onSave={(team) => doSave([errorTypeId, wrongExtra, wrongEventCorr].filter(Boolean), team)}
                  disabled={false}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
