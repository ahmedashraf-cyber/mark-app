import { useState, useEffect } from 'react'
import { TORNADO_EVENTS, MISSING_EVENT_KEY } from '../data/shortcuts'

// ── Extras definition ─────────────────────────────────────────────────────────
export const EXTRAS = [
  { key: '1', id: 'extra_event',       label: 'Extra Event',       events: 'all' },
  { key: '2', id: 'wrong_event',       label: 'Wrong Event',       events: 'all' },
  { key: '3', id: 'wrong_timestamp',   label: 'Wrong Timestamp',   events: 'all' },
  { key: '4', id: 'wrong_team_event',  label: 'Wrong Team Event',  events: 'all' },
  { key: '5', id: 'wrong_extra',       label: 'Wrong Extra',       events: 'all' },
  { key: '6', id: 'missing_extra',     label: 'Missing Extra',     events: 'all' },
  { key: '7', id: 'wrong_player',      label: 'Wrong Player',      events: 'all' },
  { key: '8', id: 'wrong_height',      label: 'Wrong Height',      events: ['pass'] },
  { key: '9', id: 'wrong_body_part',   label: 'Wrong Body Part',   events: ['pass'] },
]

const fmt = (s) => {
  if (!isFinite(s) || isNaN(s)) return '0:00.000'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms  = Math.floor((s % 1) * 1000)
  return `${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
}

// ── TagPanel — shown in edit mode (full overlay modal) ────────────────────────
function TagPanelEdit({ tag, onSave, onDelete, onCancel }) {
  const event = TORNADO_EVENTS.find(e => e.key.toUpperCase() === tag.triggeredKey?.toUpperCase())
    || { label: tag.triggeredKey, id: tag.triggeredEventId, key: tag.triggeredKey }
  const isMissing = tag.triggeredKey?.toUpperCase() === MISSING_EVENT_KEY

  const [selectedExtras, setSelectedExtras] = useState(tag.extras || [])
  const [team, setTeam] = useState(tag.team || null)

  const availableExtras = EXTRAS.filter(ex =>
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

  // Keyboard shortcuts inside edit modal
  useEffect(() => {
    function onKey(e) {
      const k = e.key
      if (k === 'Escape') { onCancel(); return }
      const extra = availableExtras.find(ex => ex.key === k)
      if (extra) { toggleExtra(extra.id); return }
      if (k === '1') { setTeam('home'); return }
      if (k === '2') { setTeam('away'); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [availableExtras, selectedExtras])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div
        className="card slide-up"
        style={{ width: 460, padding: 0, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: '1px solid var(--b-1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700,
                background: 'var(--p2)', color: '#fff',
                borderRadius: 5, padding: '2px 7px',
              }}>
                {isMissing ? 'Q' : event.key}
              </span>
              <span style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 15, color: 'var(--t-1)' }}>
                {isMissing ? 'Missing Event' : event.label}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--t-3)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
              @ {fmt(tag.videoTimeSec)}
            </div>
          </div>
          <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onCancel}>✕</button>
        </div>

        <div style={{ padding: '16px 20px 20px' }}>
          {/* Extras grid */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-3)', letterSpacing: 1, marginBottom: 10 }}>
            EXTRAS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginBottom: 16 }}>
            {availableExtras.map(ex => {
              const active = selectedExtras.includes(ex.id)
              return (
                <button
                  key={ex.id}
                  onClick={() => toggleExtra(ex.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                    border: active ? '1.5px solid var(--p2)' : '1.5px solid var(--b-2)',
                    background: active ? 'rgba(232,89,12,0.12)' : 'var(--bg-3)',
                    transition: 'all .12s',
                  }}
                >
                  <span style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
                    color: active ? 'var(--p2)' : 'var(--t-3)',
                    background: active ? 'rgba(232,89,12,0.2)' : 'var(--bg-2)',
                    borderRadius: 4, padding: '1px 5px', minWidth: 16, textAlign: 'center',
                    flexShrink: 0,
                  }}>
                    {ex.key}
                  </span>
                  <span style={{ fontSize: 11, color: active ? 'var(--p2)' : 'var(--t-2)', fontWeight: active ? 600 : 400, textAlign: 'left', lineHeight: 1.2 }}>
                    {ex.label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Team */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-3)', letterSpacing: 1, marginBottom: 10 }}>
            TEAM
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
            {[
              { id: 'home', label: 'Home', key: '1', color: '#0A84FF', bg: 'rgba(10,132,255,0.12)' },
              { id: 'away', label: 'Away', key: '2', color: '#FF453A', bg: 'rgba(255,69,58,0.12)' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTeam(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 0', borderRadius: 10, cursor: 'pointer',
                  border: `1.5px solid ${team === t.id ? t.color : 'var(--b-2)'}`,
                  background: team === t.id ? t.bg : 'var(--bg-3)',
                  transition: 'all .12s',
                }}
              >
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
                  color: team === t.id ? t.color : 'var(--t-3)',
                  background: team === t.id ? 'transparent' : 'var(--bg-2)',
                  border: `1px solid ${team === t.id ? t.color + '44' : 'var(--b-2)'}`,
                  borderRadius: 4, padding: '1px 5px',
                }}>
                  {t.key}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: team === t.id ? t.color : 'var(--t-2)' }}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onDelete}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
                border: '1.5px solid rgba(255,69,58,0.4)',
                background: 'rgba(255,69,58,0.08)',
                color: '#FF453A', fontSize: 13, fontWeight: 600,
                transition: 'all .12s',
              }}
            >
              Delete
            </button>
            <button
              onClick={handleSave}
              disabled={!team || selectedExtras.length === 0}
              className="btn-orange"
              style={{ flex: 2, padding: '10px 0', fontSize: 13 }}
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── TagPanel — shown inline after pressing event key (fast tagging) ────────────
export default function TagPanel({ pendingTag, onSave, onCancel, editTag, onEditSave, onEditDelete, onEditCancel }) {
  const [selectedExtras, setSelectedExtras] = useState([])
  const [team, setTeam] = useState(null)

  const event = pendingTag
    ? (TORNADO_EVENTS.find(e => e.key.toUpperCase() === pendingTag.key?.toUpperCase())
      || { label: pendingTag.key, id: '', key: pendingTag.key })
    : null

  const isMissing = pendingTag?.isMissing

  const availableExtras = event
    ? EXTRAS.filter(ex => ex.events === 'all' || ex.events.includes(event.id))
    : []

  // Reset when new tag starts
  useEffect(() => {
    setSelectedExtras([])
    setTeam(null)
  }, [pendingTag?.key, pendingTag?.videoTime])

  // Keyboard shortcuts — number keys for extras, 1/2 for team (auto-saves)
  useEffect(() => {
    if (!pendingTag) return
    function onKey(e) {
      if (e.key === 'Escape') { onCancel(); return }
      // extras 1-9 — but 1 and 2 also mean Home/Away only AFTER at least one extra
      const num = parseInt(e.key)
      if (num >= 1 && num <= 9) {
        // Check if it's a team key (1=Home, 2=Away) — only triggers save if extras selected
        if ((num === 1 || num === 2) && selectedExtras.length > 0) {
          const t = num === 1 ? 'home' : 'away'
          // Auto-save immediately
          onSave({
            triggeredKey: pendingTag.key,
            triggeredEventId: event?.id || '',
            triggeredEventLabel: isMissing ? 'Missing Event' : (event?.label || pendingTag.key),
            extras: selectedExtras,
            team: t,
            videoTimeSec: pendingTag.videoTime,
            timestamp: Date.now(),
            isMissing,
          })
          return
        }
        // Extra keys
        const extra = availableExtras.find(ex => ex.key === e.key)
        if (extra) {
          setSelectedExtras(prev =>
            prev.includes(extra.id) ? prev.filter(x => x !== extra.id) : [...prev, extra.id]
          )
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingTag, selectedExtras, availableExtras, event, isMissing, onSave, onCancel])

  if (editTag) {
    return (
      <TagPanelEdit
        tag={editTag}
        onSave={onEditSave}
        onDelete={onEditDelete}
        onCancel={onEditCancel}
      />
    )
  }

  if (!pendingTag) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'stretch',
      pointerEvents: 'none',
    }}>
      {/* Backdrop — only behind panel */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)',
          pointerEvents: 'all',
        }}
        onClick={onCancel}
      />

      {/* Panel slides up from bottom */}
      <div
        className="slide-up"
        style={{
          position: 'relative', width: '100%', zIndex: 1,
          background: 'var(--bg-2)',
          borderTop: '1px solid var(--b-1)',
          padding: '14px 20px 18px',
          pointerEvents: 'all',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Event label + timestamp */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700,
              background: isMissing ? '#BF5AF2' : 'var(--p2)', color: '#fff',
              borderRadius: 6, padding: '3px 9px',
            }}>
              {pendingTag.key}
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
                then press <span style={{ color: '#0A84FF', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>1</span> Home / <span style={{ color: '#FF453A', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>2</span> Away to save
              </span>
            )}
            <button className="btn-ghost" style={{ padding: '3px 9px', fontSize: 11 }} onClick={onCancel}>ESC</button>
          </div>
        </div>

        {/* Extras row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
          {availableExtras.map(ex => {
            const active = selectedExtras.includes(ex.id)
            return (
              <button
                key={ex.id}
                onClick={() => setSelectedExtras(prev =>
                  prev.includes(ex.id) ? prev.filter(x => x !== ex.id) : [...prev, ex.id]
                )}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 11px', borderRadius: 20, cursor: 'pointer',
                  border: active ? '1.5px solid var(--p2)' : '1.5px solid var(--b-2)',
                  background: active ? 'rgba(232,89,12,0.15)' : 'var(--bg-3)',
                  transition: 'all .1s',
                }}
              >
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
                  color: active ? 'var(--p2)' : 'var(--t-3)',
                }}>
                  {ex.key}
                </span>
                <span style={{ fontSize: 12, color: active ? 'var(--p2)' : 'var(--t-2)', fontWeight: active ? 600 : 400 }}>
                  {ex.label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Team row — only shown after at least one extra selected */}
        <div style={{
          display: 'flex', gap: 10,
          opacity: selectedExtras.length > 0 ? 1 : 0.35,
          transition: 'opacity .2s',
          pointerEvents: selectedExtras.length > 0 ? 'all' : 'none',
        }}>
          {[
            { id: 'home', label: 'Home', key: '1', color: '#0A84FF', bg: 'rgba(10,132,255,0.15)' },
            { id: 'away', label: 'Away', key: '2', color: '#FF453A', bg: 'rgba(255,69,58,0.15)' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => {
                if (selectedExtras.length === 0) return
                onSave({
                  triggeredKey: pendingTag.key,
                  triggeredEventId: event?.id || '',
                  triggeredEventLabel: isMissing ? 'Missing Event' : (event?.label || pendingTag.key),
                  extras: selectedExtras,
                  team: t.id,
                  videoTimeSec: pendingTag.videoTime,
                  timestamp: Date.now(),
                  isMissing,
                })
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 20px', borderRadius: 10, cursor: 'pointer',
                border: `1.5px solid ${t.color}66`,
                background: t.bg,
                transition: 'all .1s',
              }}
            >
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 800,
                color: t.color,
              }}>
                {t.key}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.color }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
