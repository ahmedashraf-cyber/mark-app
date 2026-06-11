import { useState, useMemo, useEffect } from 'react'
import { TORNADO_EVENTS, MISSING_EVENT_KEY } from '../data/shortcuts'
import {
  getErrorTypesForEvent,
  getCorrectionsForScenario,
  getTypeQualifiersForCorrection,
} from '../data/tagging_scenarios'

// MARK 4.1.0 — Error tag modal driven by the official taxonomy spreadsheet.
// Workflow preserved exactly:
//   1. (already done) reviewer pressed an event key
//   2. select the Error type (filtered to this event's valid options)
//   3. select the Correction (filtered to this event + error type)
//   4. select the Type qualifier (only if the chosen correction has qualifiers — e.g. Goal keeper)
// "Missing Event" (Q key) keeps its existing single-dropdown flow.
// Events not in the taxonomy (Pressure, Out, mouse-only) fall back to a note field.

export default function ErrorTagModal({ triggeredKey, isMissing, videoTime, onConfirm, onCancel }) {
  const [errorType, setErrorType] = useState('')
  const [correction, setCorrection] = useState('')
  const [correctionSC, setCorrectionSC] = useState(null)
  const [typeQualifier, setTypeQualifier] = useState('')
  const [typeQualifierSC, setTypeQualifierSC] = useState(null)
  const [missingEvent, setMissingEvent] = useState('')
  const [note, setNote] = useState('')

  const triggeredEvent = TORNADO_EVENTS.find(
    e => e.key && e.key.toUpperCase() === triggeredKey?.toUpperCase()
  )
  const sheetEvent = triggeredEvent?.sheetEvent || null
  const allEventOptions = TORNADO_EVENTS

  // Step 2 — error types valid for this event
  const errorTypeOptions = useMemo(
    () => (sheetEvent ? getErrorTypesForEvent(sheetEvent) : []),
    [sheetEvent]
  )

  // Step 3 — corrections valid for (event + error type)
  const correctionOptions = useMemo(
    () => (sheetEvent && errorType ? getCorrectionsForScenario(sheetEvent, errorType) : []),
    [sheetEvent, errorType]
  )

  // Step 4 — type qualifiers valid for (event + error type + correction)
  const typeQualifierOptions = useMemo(
    () => (sheetEvent && errorType && correction
      ? getTypeQualifiersForCorrection(sheetEvent, errorType, correction)
      : []),
    [sheetEvent, errorType, correction]
  )

  // Reset downstream selections when an upstream choice changes
  useEffect(() => {
    setCorrection('')
    setCorrectionSC(null)
    setTypeQualifier('')
    setTypeQualifierSC(null)
  }, [errorType])
  useEffect(() => {
    setTypeQualifier('')
    setTypeQualifierSC(null)
  }, [correction])

  function handleConfirm() {
    if (isMissing) {
      onConfirm({
        errorType: 'Missing event',
        triggeredKey,
        triggeredEventId: triggeredEvent?.id || '',
        triggeredEventLabel: triggeredEvent?.label || triggeredKey,
        sheetEvent,
        extras: { missingEvent },
        videoTimeSec: videoTime,
        timestamp: Date.now(),
      })
      return
    }
    onConfirm({
      errorType,                                  // canonical name from the sheet (e.g. "Wrong event")
      triggeredKey,
      triggeredEventId: triggeredEvent?.id || '',
      triggeredEventLabel: triggeredEvent?.label || triggeredKey,
      sheetEvent,
      correction,
      correctionShortcut: correctionSC,
      typeQualifier,
      typeQualifierShortcut: typeQualifierSC,
      note: note || undefined,
      videoTimeSec: videoTime,
      timestamp: Date.now(),
    })
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2,'0')}`
  }

  // Confirm button enablement rules
  let canConfirm = false
  if (isMissing) {
    canConfirm = !!missingEvent
  } else if (sheetEvent) {
    if (!errorType) canConfirm = false
    else if (correctionOptions.length > 0 && !correction) canConfirm = false
    else if (typeQualifierOptions.length > 0 && !typeQualifier) canConfirm = false
    else canConfirm = true
  } else {
    // Event not in taxonomy — only need the note
    canConfirm = !!note.trim()
  }

  return (
    <div
      style={{
        position:'fixed', inset:0, zIndex:1000,
        background:'rgba(0,0,0,0.7)',
        display:'flex', alignItems:'center', justifyContent:'center',
      }}
      onClick={onCancel}
    >
      <div
        className="card slide-up"
        style={{width:440, maxHeight:'85vh', overflow:'auto', padding:24}}
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
          // ── Missing Event flow (unchanged) ─────────────────────────────────
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
              {allEventOptions.filter(ev => ev.key).map(ev => (
                <option key={ev.id} value={ev.id}>{ev.label} ({ev.key})</option>
              ))}
            </select>
          </div>
        ) : !sheetEvent ? (
          // ── Event not in taxonomy — note-only fallback ─────────────────────
          <div>
            <div style={{padding:10,borderRadius:8,background:'rgba(255,159,10,0.1)',
              border:'1px solid rgba(255,159,10,0.3)',marginBottom:14,fontSize:12,color:'var(--t-2)'}}>
              This event isn't part of the official error-correction taxonomy.
              Add a short note and we'll log the error.
            </div>
            <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:8,letterSpacing:.5}}>
              NOTE
            </label>
            <textarea
              className="mark-input"
              style={{width:'100%',minHeight:80,fontFamily:'inherit',resize:'vertical'}}
              placeholder="Describe what was wrong…"
              value={note}
              onChange={e => setNote(e.target.value)}
              autoFocus
            />
          </div>
        ) : (
          // ── Sheet-driven flow: error type → correction → optional qualifier ─
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Step 2 — Error type */}
            <div>
              <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:8,letterSpacing:.5}}>
                ERROR TYPE ({errorTypeOptions.length})
              </label>
              <select
                className="mark-select"
                style={{width:'100%'}}
                value={errorType}
                onChange={e => setErrorType(e.target.value)}
                autoFocus
              >
                <option value="">— Select error type —</option>
                {errorTypeOptions.map(et => (
                  <option key={et} value={et}>{et}</option>
                ))}
              </select>
            </div>

            {/* Step 3 — Correction */}
            {errorType && correctionOptions.length > 0 && (
              <div>
                <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:8,letterSpacing:.5}}>
                  CORRECTION ({correctionOptions.length})
                </label>
                <select
                  className="mark-select"
                  style={{width:'100%'}}
                  value={correction}
                  onChange={e => {
                    const v = e.target.value
                    setCorrection(v)
                    const found = correctionOptions.find(c => c.correction === v)
                    setCorrectionSC(found?.shortcut ?? null)
                  }}
                >
                  <option value="">— Select correction —</option>
                  {correctionOptions.map((c, i) => (
                    <option key={c.correction + '|' + i} value={c.correction}>
                      {c.correction}{c.shortcut != null ? ` (${c.shortcut})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Step 4 — Type qualifier (only if applicable) */}
            {errorType && correction && typeQualifierOptions.length > 0 && (
              <div>
                <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:8,letterSpacing:.5}}>
                  TYPE ({typeQualifierOptions.length})
                </label>
                <select
                  className="mark-select"
                  style={{width:'100%'}}
                  value={typeQualifier}
                  onChange={e => {
                    const v = e.target.value
                    setTypeQualifier(v)
                    const found = typeQualifierOptions.find(t => t.qualifier === v)
                    setTypeQualifierSC(found?.shortcut ?? null)
                  }}
                >
                  <option value="">— Select type —</option>
                  {typeQualifierOptions.map((t, i) => (
                    <option key={t.qualifier + '|' + i} value={t.qualifier}>
                      {t.qualifier}{t.shortcut != null ? ` (${t.shortcut})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Optional note */}
            <div>
              <label style={{display:'block',fontSize:11,color:'var(--t-3)',fontWeight:700,marginBottom:8,letterSpacing:.5}}>
                NOTE (optional)
              </label>
              <textarea
                className="mark-input"
                style={{width:'100%',minHeight:50,fontFamily:'inherit',resize:'vertical'}}
                placeholder="Any extra context…"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
            </div>
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
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            Tag Error
          </button>
        </div>
      </div>
    </div>
  )
}
