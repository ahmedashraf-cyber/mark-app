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

// ── Goal Keeper specific extras ───────────────────────────────────────────────
export const GK_EXTRAS = [
  { key: '1', id: 'gk_punch',           label: 'Punch' },
  { key: '2', id: 'gk_smother',         label: 'Smother' },
  { key: '3', id: 'gk_save_attempt',    label: 'Save Attempt' },
  { key: '4', id: 'gk_conceded_no_save',label: 'Conceded No Save' },
  { key: '5', id: 'gk_keeper_sweeper',  label: 'Keeper Sweeper' },
  { key: '6', id: 'gk_collected',       label: 'Collected' },
]

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

// ── Edit modal ────────────────────────────────────────────────────────────────
function TagPanelEdit({ tag, onSave, onDelete, onCancel }) {
  const event = TORNADO_EVENTS.find(e => e.key?.toUpperCase() === tag.triggeredKey?.toUpperCase())
    || { label: tag.triggeredEventLabel || tag.triggeredKey, id: tag.triggeredEventId, key: tag.triggeredKey }
  const isMissing = tag.triggeredKey?.toUpperCase() === MISSING_EVENT_KEY
  const isGK = event.id === 'goal_keeper'

  const [selectedExtras, setSelectedExtras] = useState(tag.extras || [])
  const [team, setTeam] = useState(tag.team || null)

  const generalExtras = EXTRAS.filter(ex =>
    ex.events === 'all' || ex.events.includes(event.id)
  )

  function toggleExtra(id) {
    setSelectedExtras(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function handleSave() {
    if (!team || selectedExtras.length === 0) return
    onSave({ ...tag, extras: selectedExtras, team })
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { onCancel(); return }
      const num = parseInt(e.key)
      if (isNaN(num)) return
      // GK extras first if GK event
      if (isGK) {
        const gkEx = GK_EXTRAS.find(ex => ex.key === e.key)
        if (gkEx) { toggleExtra(gkEx.id); return }
      }
      const genEx = generalExtras.find(ex => ex.key === e.key)
      if (genEx) { toggleExtra(genEx.id); return }
      if (e.key === '1') setTeam('home')
      if (e.key === '2') setTeam('away')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedExtras, generalExtras, isGK])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div className="card slide-up" style={{ width: 480, padding: 0, overflow: 'hidden', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
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
            <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>
              @ {fmt(tag.videoTimeSec)}
            </div>
          </div>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onCancel}>✕</button>
        </div>

        <div style={{ padding: '14px 20px 18px', overflowY: 'auto' }}>
          {/* GK extras section */}
          {isGK && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#FFD60A', letterSpacing: 1, marginBottom: 8 }}>GK EXTRAS</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 14 }}>
                {GK_EXTRAS.map(ex => {
                  const active = selectedExtras.includes(ex.id)
                  return (
                    <button key={ex.id} onClick={() => toggleExtra(ex.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px',
                      borderRadius: 7, cursor: 'pointer',
                      border: active ? '1.5px solid #FFD60A' : '1.5px solid var(--b-2)',
                      background: active ? 'rgba(255,214,10,0.1)' : 'var(--bg-3)',
                      transition: 'all .12s',
                    }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: active ? '#FFD60A' : 'var(--t-3)', flexShrink: 0 }}>{ex.key}</span>
                      <span style={{ fontSize: 11, color: active ? '#FFD60A' : 'var(--t-2)', fontWeight: active ? 600 : 400, lineHeight: 1.2, textAlign: 'left' }}>{ex.label}</span>
                    </button>
                  )
                })}
              </div>
              <div style={{ height: 1, background: 'var(--b-1)', marginBottom: 12 }}/>
            </>
          )}

          {/* General extras */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-3)', letterSpacing: 1, marginBottom: 8 }}>EXTRAS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 14 }}>
            {generalExtras.map(ex => {
              const active = selectedExtras.includes(ex.id)
              return (
                <button key={ex.id} onClick={() => toggleExtra(ex.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px',
                  borderRadius: 7, cursor: 'pointer',
                  border: active ? '1.5px solid var(--p2)' : '1.5px solid var(--b-2)',
                  background: active ? 'rgba(232,89,12,0.12)' : 'var(--bg-3)',
                  transition: 'all .12s',
                }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: active ? 'var(--p2)' : 'var(--t-3)', flexShrink: 0 }}>{ex.key}</span>
                  <span style={{ fontSize: 11, color: active ? 'var(--p2)' : 'var(--t-2)', fontWeight: active ? 600 : 400, lineHeight: 1.2, textAlign: 'left' }}>{ex.label}</span>
                </button>
              )
            })}
          </div>

          {/* Team */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-3)', letterSpacing: 1, marginBottom: 8 }}>TEAM</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
            {TEAM_BTNS.map(t => (
              <button key={t.id} onClick={() => setTeam(t.id)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '11px 0', borderRadius: 9, cursor: 'pointer',
                border: `1.5px solid ${team === t.id ? t.color : 'var(--b-2)'}`,
                background: team === t.id ? t.bg : 'var(--bg-3)',
                transition: 'all .12s',
              }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: team === t.id ? t.color : 'var(--t-3)' }}>{t.key}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: team === t.id ? t.color : 'var(--t-2)' }}>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onDelete} style={{
              flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
              border: '1.5px solid rgba(255,69,58,0.4)', background: 'rgba(255,69,58,0.08)',
              color: '#FF453A', fontSize: 13, fontWeight: 600, transition: 'all .12s',
            }}>Delete</button>
            <button onClick={handleSave} disabled={!team || selectedExtras.length === 0}
              className="btn-orange" style={{ flex: 2, padding: '10px 0', fontSize: 13 }}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main TagPanel — slides up from bottom after event key press ───────────────
export default function TagPanel({ pendingTag, onSave, onCancel, editTag, onEditSave, onEditDelete, onEditCancel }) {
  const [selectedExtras, setSelectedExtras] = useState([])

  const event = pendingTag
    ? (TORNADO_EVENTS.find(e => e.key?.toUpperCase() === pendingTag.key?.toUpperCase())
      || { label: pendingTag.label || pendingTag.key, id: pendingTag.id || '', key: pendingTag.key })
    : null

  const isMissing = pendingTag?.isMissing
  const isGK = event?.id === 'goal_keeper'

  const generalExtras = event
    ? EXTRAS.filter(ex => ex.events === 'all' || ex.events.includes(event.id))
    : []

  useEffect(() => {
    setSelectedExtras([])
  }, [pendingTag?.key, pendingTag?.videoTime])

  function doSave(team) {
    onSave({
      triggeredKey:        pendingTag.key,
      triggeredEventId:    event?.id || '',
      triggeredEventLabel: isMissing ? 'Missing Event' : (event?.label || pendingTag.key),
      extras:              selectedExtras,
      team,
      videoTimeSec:        pendingTag.videoTime,
      timestamp:           Date.now(),
      isMissing:           !!isMissing,
    })
  }

  useEffect(() => {
    if (!pendingTag) return
    function onKey(e) {
      if (e.key === 'Escape') { onCancel(); return }
      const k = e.key

      // Team keys — only save if at least one extra selected
      if ((k === '1' || k === '2') && selectedExtras.length > 0) {
        // Check if this key is also a GK extra — GK extras take priority when no team yet
        if (isGK) {
          const gkEx = GK_EXTRAS.find(ex => ex.key === k)
          if (gkEx) {
            setSelectedExtras(prev => prev.includes(gkEx.id) ? prev.filter(x => x !== gkEx.id) : [...prev, gkEx.id])
            return
          }
        }
        doSave(k === '1' ? 'home' : 'away')
        return
      }

      // GK extras (keys 1-6) when GK event
      if (isGK) {
        const gkEx = GK_EXTRAS.find(ex => ex.key === k)
        if (gkEx) {
          setSelectedExtras(prev => prev.includes(gkEx.id) ? prev.filter(x => x !== gkEx.id) : [...prev, gkEx.id])
          return
        }
      }

      // General extras
      const genEx = generalExtras.find(ex => ex.key === k)
      if (genEx) {
        setSelectedExtras(prev => prev.includes(genEx.id) ? prev.filter(x => x !== genEx.id) : [...prev, genEx.id])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingTag, selectedExtras, generalExtras, isGK, event, isMissing])

  if (editTag) {
    return <TagPanelEdit tag={editTag} onSave={onEditSave} onDelete={onEditDelete} onCancel={onEditCancel} />
  }

  if (!pendingTag) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'flex-end',
      pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)',
        pointerEvents: 'all',
      }} onClick={onCancel} />

      <div className="slide-up" style={{
        position: 'relative', width: '100%', zIndex: 1,
        background: 'var(--bg-2)', borderTop: '2px solid var(--b-1)',
        padding: '14px 20px 16px',
        pointerEvents: 'all',
      }} onClick={e => e.stopPropagation()}>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700,
              background: isMissing ? '#BF5AF2' : 'var(--p2)', color: '#fff',
              borderRadius: 6, padding: '3px 9px',
            }}>
              {pendingTag.key || '•'}
            </span>
            <span style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 15, color: 'var(--t-1)' }}>
              {isMissing ? 'Missing Event' : event?.label}
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--t-3)' }}>
              @ {fmt(pendingTag.videoTime)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {selectedExtras.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--t-3)' }}>
                press <span style={{ color: '#0A84FF', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>1</span> Home /
                <span style={{ color: '#FF453A', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}> 2</span> Away to save
              </span>
            )}
            <button className="btn-ghost" style={{ padding: '3px 9px', fontSize: 11 }} onClick={onCancel}>ESC</button>
          </div>
        </div>

        {/* GK extras row */}
        {isGK && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#FFD60A', letterSpacing: 1, marginBottom: 6 }}>GK EXTRAS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {GK_EXTRAS.map(ex => {
                const active = selectedExtras.includes(ex.id)
                return (
                  <button key={ex.id}
                    onClick={() => setSelectedExtras(prev => prev.includes(ex.id) ? prev.filter(x => x !== ex.id) : [...prev, ex.id])}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 10px', borderRadius: 18, cursor: 'pointer',
                      border: active ? '1.5px solid #FFD60A' : '1.5px solid var(--b-2)',
                      background: active ? 'rgba(255,214,10,0.12)' : 'var(--bg-3)',
                      transition: 'all .1s',
                    }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: active ? '#FFD60A' : 'var(--t-3)' }}>{ex.key}</span>
                    <span style={{ fontSize: 12, color: active ? '#FFD60A' : 'var(--t-2)', fontWeight: active ? 600 : 400 }}>{ex.label}</span>
                  </button>
                )
              })}
            </div>
            <div style={{ height: 1, background: 'var(--b-1)', margin: '10px 0 0' }}/>
          </div>
        )}

        {/* General extras row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {generalExtras.map(ex => {
            const active = selectedExtras.includes(ex.id)
            return (
              <button key={ex.id}
                onClick={() => setSelectedExtras(prev => prev.includes(ex.id) ? prev.filter(x => x !== ex.id) : [...prev, ex.id])}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 11px', borderRadius: 18, cursor: 'pointer',
                  border: active ? '1.5px solid var(--p2)' : '1.5px solid var(--b-2)',
                  background: active ? 'rgba(232,89,12,0.15)' : 'var(--bg-3)',
                  transition: 'all .1s',
                }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, color: active ? 'var(--p2)' : 'var(--t-3)' }}>{ex.key}</span>
                <span style={{ fontSize: 12, color: active ? 'var(--p2)' : 'var(--t-2)', fontWeight: active ? 600 : 400 }}>{ex.label}</span>
              </button>
            )
          })}
        </div>

        {/* Team row */}
        <div style={{
          display: 'flex', gap: 10,
          opacity: selectedExtras.length > 0 ? 1 : 0.3,
          transition: 'opacity .2s',
          pointerEvents: selectedExtras.length > 0 ? 'all' : 'none',
        }}>
          {TEAM_BTNS.map(t => (
            <button key={t.id} onClick={() => { if (selectedExtras.length > 0) doSave(t.id) }}
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
      </div>
    </div>
  )
}
