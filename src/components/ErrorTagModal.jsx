import { useState } from 'react'
import { TORNADO_EVENTS, MISSING_EVENT_KEY } from '../data/shortcuts'

// Shows after a key is pressed to tag an error
// Reviewer selects the extra details (Wrong Event / Wrong Player / Confused With / Missing Event)

export default function ErrorTagModal({ triggeredKey, isMissing, videoTime, onConfirm, onCancel }) {
  const [extraType, setExtraType]     = useState(null)
  const [confusedWith, setConfusedWith] = useState('')
  const [missingEvent, setMissingEvent] = useState('')

  const triggeredEvent = TORNADO_EVENTS.find(e => e.key.toUpperCase() === triggeredKey?.toUpperCase())
  const allEventOptions = TORNADO_EVENTS

  function handleConfirm() {
    const extras = {}
    if (extraType === 'confused_with' && confusedWith) extras.confusedWith = confusedWith
    if (isMissing && missingEvent) extras.missingEvent = missingEvent
    onConfirm({
      errorType: isMissing ? 'missing_event' : (extraType || 'wrong_event'),
      triggeredKey,
      triggeredEventId: triggeredEvent?.id || '',
      triggeredEventLabel: triggeredEvent?.label || triggeredKey,
      extras,
      videoTimeSec: videoTime,
      timestamp: Date.now(),
    })
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2,'0')}`
  }

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:1000,
      background:'rgba(0,0,0,0.7)',
      display:'flex', alignItems:'center', justifyContent:'center',
    }}
      onClick={onCancel}
    >
      <div
        className="card slide-up"
        style={{width:400, padding:24}}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <div>
            <div style={{fontFamily:'Inter',fontWeight:800,fontSize:16,color:'var(--t-1)'}}>
              {isMissing ? '🔴 Missing Event' : `🏷️ Tag Error — ${triggeredEvent?.label || triggeredKey}`}
            </div>
            <div style={{fontSize:12,color:'var(--t-3)',marginTop:2}}>
              at <span className="mono" style={{color:'var(--p2)'}}>{formatTime(videoTime || 0)}</span>
            </div>
          </div>
          <button className="btn-ghost" style={{padding:'4px 10px',fontSize:12}} onClick={onCancel}>✕</button>
        </div>

        {isMissing ? (
          // Missing Event — select which event was missed
          <div>
            <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:8,letterSpacing:.5}}>
              WHICH EVENT WAS MISSING?
            </label>
            <select
              className="mark-select"
              style={{width:'100%'}}
              value={missingEvent}
              onChange={e => setMissingEvent(e.target.value)}
              autoFocus
            >
              <option value="">— Select event —</option>
              {allEventOptions.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.label} ({ev.key})</option>
              ))}
            </select>
          </div>
        ) : (
          // Error extras
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:4,letterSpacing:.5}}>
              ERROR TYPE
            </label>
            {[
              { id: 'wrong_event',  label: 'Wrong Event',  desc: 'This event type was incorrect' },
              { id: 'wrong_player', label: 'Wrong Player', desc: 'Correct event, wrong player tagged' },
              { id: 'confused_with',label: 'Confused With',desc: 'Should have been a different event' },
            ].map(opt => (
              <div
                key={opt.id}
                onClick={() => setExtraType(opt.id)}
                style={{
                  padding:'12px 14px',
                  borderRadius:10,
                  border: extraType === opt.id ? '2px solid var(--p2)' : '2px solid var(--b-1)',
                  background: extraType === opt.id ? 'rgba(232,89,12,0.1)' : 'var(--bg-3)',
                  cursor:'pointer',
                  transition:'all .15s',
                }}
              >
                <div style={{fontSize:13,fontWeight:600,color: extraType===opt.id ? 'var(--p2)' : 'var(--t-1)'}}>
                  {opt.label}
                </div>
                <div style={{fontSize:11,color:'var(--t-3)',marginTop:2}}>{opt.desc}</div>
              </div>
            ))}

            {extraType === 'confused_with' && (
              <div style={{marginTop:4}}>
                <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:6,letterSpacing:.5}}>
                  SHOULD HAVE BEEN
                </label>
                <select
                  className="mark-select"
                  style={{width:'100%'}}
                  value={confusedWith}
                  onChange={e => setConfusedWith(e.target.value)}
                  autoFocus
                >
                  <option value="">— Select event —</option>
                  {allEventOptions.map(ev => (
                    <option key={ev.id} value={ev.id}>{ev.label} ({ev.key})</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Confirm */}
        <div style={{display:'flex',gap:10,marginTop:20}}>
          <button
            className="btn-ghost"
            style={{flex:1,padding:'10px 0',fontSize:13}}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="btn-orange"
            style={{flex:2,padding:'10px 0',fontSize:13}}
            disabled={isMissing ? !missingEvent : !extraType}
            onClick={handleConfirm}
          >
            Tag Error
          </button>
        </div>
      </div>
    </div>
  )
}
