/**
 * DrillBuilderPage.jsx — quiz creation, all five steps
 * ============================================================================
 * 1 setup      name, folder, time limit, pass mark, scope
 * 2 scan       list clips, pre-flight playability
 * 3 answer key instruction + tagged events per clip (ClipTagger)
 * 4 assign     which collectors get it
 * 5 publish    review, confirm no-event clips, save
 *
 * Two rules that are easy to get wrong, handled explicitly:
 *
 * SCOPE AUTO-EXPANDS. The trainer may tag an event outside the declared scope.
 * If scope stayed as declared, the trainee would have no button for that event
 * and be marked wrong on something they could not enter. So anything the
 * trainer actually tags joins the scope.
 *
 * NO-EVENT NEEDS CONFIRMING. An empty clip records "no event" as the correct
 * answer, indistinguishable from the trainer forgetting to tag it. An
 * accidental one silently fails every trainee who answered correctly, so
 * publishing requires ticking them off.
 */
import { useState, useEffect, useMemo } from 'react'
import { FIELD_EVENTS, EVENT_BY_ID } from '../utils/fieldExtras'
import {
  scanFolder, checkAllPlayable, totalSizeBytes, formatBytes,
  parseFolderId, clipUrl as driveClipUrl,
} from '../utils/drillDrive'
import { loadTrainees, resolveHrCodes } from '../utils/drillPeople'
import { appendRows } from '../utils/drillSheet'
import {
  TAB_QUIZZES, TAB_CLIPS, TAB_ANSWERS,
  QUIZZES_COLUMNS, CLIPS_COLUMNS, ANSWERS_COLUMNS,
  QUIZ_STATUS, newId, msToClock,
} from '../config/drillConfig'
import ClipTagger, { fmtTime } from '../components/ClipTagger'

const SA_EMAIL = 'mark-reporter@mark-app-498618.iam.gserviceaccount.com'

function ErrBox({ children }) {
  return (
    <div style={{ background:'rgba(255,69,58,0.08)', border:'1px solid rgba(255,69,58,0.3)',
      borderRadius:8, padding:'10px 12px', fontSize:12, color:'#FF453A',
      marginBottom:14, lineHeight:1.5 }}>{children}</div>
  )
}

function Stat({ n, label, color }) {
  return (
    <div className="card" style={{ padding:12, textAlign:'center' }}>
      <div style={{ fontSize:22, fontWeight:900, color: color || 'var(--t-1)' }}>{n}</div>
      <div style={{ fontSize:9, color:'var(--t-3)', marginTop:2, letterSpacing:0.8 }}>{label}</div>
    </div>
  )
}

export default function DrillBuilderPage({ person, onBack, onSaved }) {
  const [step, setStep] = useState(1)

  const [name,      setName]      = useState('')
  const [folder,    setFolder]    = useState('')
  const [timeLimit, setTimeLimit] = useState('20')
  const [passMark,  setPassMark]  = useState('80')
  const [scope,     setScope]     = useState(new Set())
  const [err,       setErr]       = useState('')

  const [scanning, setScanning] = useState(false)
  const [scanMsg,  setScanMsg]  = useState('')
  const [clips,    setClips]    = useState([])
  const [checked,  setChecked]  = useState(false)
  const [forced,   setForced]   = useState(new Set())  // clips kept despite a failed probe

  const [clipIdx, setClipIdx] = useState(0)
  const [answers, setAnswers] = useState({})
  const [url,     setUrl]     = useState('')

  const [trainees, setTrainees] = useState([])
  const [assigned, setAssigned] = useState(new Set())
  const [search,   setSearch]   = useState('')
  const [paste,    setPaste]    = useState('')
  const [pasteMsg, setPasteMsg] = useState('')

  const [confirmedNoEvent, setConfirmedNoEvent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(null)

  const taggable = FIELD_EVENTS.filter(e => e.panel)
  const panels   = [...new Set(taggable.map(e => e.panel))]
  const playable = useMemo(
    () => clips.filter(c => c.playable || forced.has(c.drive_file_id)),
    [clips, forced])

  const effectiveScope = useMemo(() => {
    const s = new Set(scope)
    Object.values(answers).forEach(a => (a?.events || []).forEach(ev => s.add(ev.event_code)))
    return [...s]
  }, [scope, answers])

  const cur    = playable[clipIdx]
  const curAns = cur ? (answers[cur.clip_index] || { instruction:'', events:[] }) : null

  useEffect(() => {
    if (step !== 3 || !cur) return
    let alive = true
    driveClipUrl(cur.drive_file_id).then(u => { if (alive) setUrl(u) }).catch(() => {})
    return () => { alive = false }
  }, [step, cur?.drive_file_id])

  useEffect(() => {
    if (step !== 4 || trainees.length) return
    loadTrainees().then(setTrainees).catch(e => setErr(e.message))
  }, [step])

  function patch(clipIndex, fields) {
    setAnswers(a => ({
      ...a,
      [clipIndex]: { instruction:'', events:[], ...(a[clipIndex] || {}), ...fields },
    }))
  }

  async function handleScan() {
    setErr('')
    if (!name.trim())           return setErr('Give the quiz a name.')
    if (!parseFolderId(folder)) return setErr('That does not look like a Drive folder link or ID.')
    const tl = parseInt(timeLimit), pm = parseInt(passMark)
    if (!tl || tl < 1)          return setErr('Time limit must be at least 1 minute.')
    if (isNaN(pm) || pm < 0 || pm > 100) return setErr('Pass mark must be between 0 and 100.')
    if (!scope.size)            return setErr('Tick at least one event type for the scope.')

    setScanning(true); setChecked(false); setClips([])
    try {
      setScanMsg('Scanning the folder…')
      const { clips: found } = await scanFolder(folder)
      if (!found.length) {
        setErr(`No videos found. Either the folder is empty, or it is not shared with ${SA_EMAIL} — an unshared folder looks identical to an empty one.`)
        return
      }
      setClips(found); setStep(2)
      const verified = await checkAllPlayable(found, (d, t) => setScanMsg(`Checking clip ${d} of ${t}…`))
      setClips(verified); setChecked(true)
    } catch (e) { setErr(e.message || String(e)) }
    finally { setScanning(false); setScanMsg('') }
  }

  const noEventClips = playable.filter(c => !(answers[c.clip_index]?.events || []).length)
  const totalEvents  = playable.reduce((s, c) => s + (answers[c.clip_index]?.events || []).length, 0)
  const taggedClips  = playable.filter(c => (answers[c.clip_index]?.events || []).length).length
  const instrDone    = playable.filter(c => (answers[c.clip_index]?.instruction || '').trim()).length

  async function handlePublish(asDraft) {
    setErr('')
    const missingInstr = playable.filter(c => !(answers[c.clip_index]?.instruction || '').trim())
    if (missingInstr.length)
      return setErr(`${missingInstr.length} clip(s) still need an instruction. Every clip must tell the trainee what to do.`)
    if (!asDraft && !assigned.size)
      return setErr('Assign at least one collector, or save as a draft instead.')
    if (!asDraft && noEventClips.length && !confirmedNoEvent)
      return setErr('Confirm the "no event" clips first — an accidental one would fail every trainee who answered correctly.')

    setSaving(true)
    try {
      const quizId = newId('quiz')
      const now = new Date().toISOString()

      await appendRows(TAB_QUIZZES, [{
        quiz_id: quizId,
        quiz_name: name.trim(),
        drive_folder_id: parseFolderId(folder),
        scope_event_ids: effectiveScope.join('|'),
        time_limit_min: parseInt(timeLimit),
        pass_mark_percent: parseInt(passMark),
        clip_count: playable.length,
        assigned_hr_codes: [...assigned].join('|'),
        quiz_version: 1,
        status: asDraft ? QUIZ_STATUS.DRAFT : QUIZ_STATUS.PUBLISHED,
        created_by: person?.email || '',
        created_at: now,
        updated_at: now,
      }], QUIZZES_COLUMNS)

      await appendRows(TAB_CLIPS, playable.map((c, i) => {
        const a = answers[c.clip_index] || {}
        return {
          quiz_id: quizId, quiz_version: 1, clip_index: i,
          video_filename: c.video_filename,
          drive_file_id: c.drive_file_id,
          instruction: (a.instruction || '').trim(),
          expected_event_count: (a.events || []).length,
          is_no_event: (a.events || []).length === 0 ? 1 : 0,
          is_excluded: 0, is_missing: 0, playable: 1,
        }
      }), CLIPS_COLUMNS)

      const answerRows = []
      playable.forEach((c, i) => {
        (answers[c.clip_index]?.events || []).forEach((ev, j) => {
          answerRows.push({
            quiz_id: quizId, quiz_version: 1, clip_index: i, event_index: j,
            answer_event_code: ev.event_code,
            answer_team: ev.team || '',
            answer_video_time_ms: ev.video_time_ms,
            answer_video_time: msToClock(ev.video_time_ms),
            ...Object.fromEntries(Object.entries(ev.attrs || {}).map(([k, v]) => ['answer_' + k, v])),
          })
        })
      })
      if (answerRows.length) await appendRows(TAB_ANSWERS, answerRows, ANSWERS_COLUMNS)

      setSaved({ quizId, clips: playable.length, answers: answerRows.length, published: !asDraft })
    } catch (e) {
      setErr('Could not save: ' + (e.message || String(e)))
    } finally { setSaving(false) }
  }

  const Field = ({ label, children }) => (
    <div>
      <div style={{ fontSize:10, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
        marginBottom:5, textTransform:'uppercase' }}>{label}</div>
      {children}
    </div>
  )
  const inputStyle = {
    width:'100%', background:'var(--bg-3)', border:'1px solid var(--b-1)',
    borderRadius:7, padding:'9px 12px', fontSize:13, color:'var(--t-1)',
    outline:'none', boxSizing:'border-box',
  }
  const ghost = { padding:'11px 0', fontSize:13, background:'transparent',
    border:'1px solid var(--b-1)', borderRadius:8, color:'var(--t-3)', cursor:'pointer' }

  const filteredTrainees = trainees.filter(t => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return t.name.toLowerCase().includes(q) || t.hrCode.toLowerCase().includes(q)
  })

  if (saved) return (
    <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'var(--bg)', color:'var(--t-1)' }}>
      <div className="card" style={{ padding:32, maxWidth:440, textAlign:'center' }}>
        <div style={{ fontSize:34, marginBottom:10 }}>✓</div>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>
          {saved.published ? 'Quiz published' : 'Draft saved'}
        </div>
        <div style={{ fontSize:12, color:'var(--t-3)', lineHeight:1.7, marginBottom:20 }}>
          {name}<br/>
          {saved.clips} clips · {saved.answers} tagged events<br/>
          {saved.published
            ? `${assigned.size} collector${assigned.size === 1 ? '' : 's'} can take it now`
            : 'Not visible to trainees until you publish it'}
        </div>
        <button className="btn-orange" style={{ width:'100%', padding:'11px 0', fontSize:13 }}
          onClick={() => onSaved?.()}>Done</button>
      </div>
    </div>
  )

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', color:'var(--t-1)', overflow:'hidden' }}>

      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 16px', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none',
          color:'var(--t-3)', cursor:'pointer', fontSize:11, padding:'4px 8px' }}>← Cancel</button>
        <div style={{ width:1, height:20, background:'var(--b-1)' }}/>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800,
          color:'var(--p2)', letterSpacing:1.5, background:'rgba(232,89,12,0.12)',
          padding:'2px 8px', borderRadius:4 }}>NEW QUIZ</div>
        {step === 3 && cur && (
          <span style={{ fontSize:11, color:'var(--t-3)' }}>
            clip {clipIdx + 1} of {playable.length} · {cur.video_filename}
          </span>
        )}
        <div style={{ flex:1 }}/>
        {[1,2,3,4,5].map(n => (
          <div key={n} style={{ width:22, height:4, borderRadius:2,
            background: n <= step ? 'var(--p2)' : 'var(--b-2)' }}/>
        ))}
        <span style={{ fontSize:10, color:'var(--t-3)', marginLeft:4 }}>step {step} of 5</span>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:20,
        maxWidth: step === 3 ? 1000 : 820, margin:'0 auto', width:'100%' }}>

        {step === 1 && (
          <>
            <div className="card" style={{ padding:20, marginBottom:14 }}>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>Quiz setup</div>
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <Field label="Quiz name">
                  <input style={inputStyle} value={name} placeholder="e.g. Pressure — Batch 7"
                    onChange={e => { setName(e.target.value); setErr('') }}/>
                </Field>
                <Field label="Drive folder with the clips">
                  <input style={{ ...inputStyle, fontFamily:'JetBrains Mono,monospace', fontSize:11 }}
                    value={folder} placeholder="https://drive.google.com/drive/folders/…"
                    onChange={e => { setFolder(e.target.value); setErr('') }}/>
                  <div style={{ fontSize:10, color:'var(--t-3)', marginTop:5, lineHeight:1.5 }}>
                    Must be shared with <span style={{ fontFamily:'JetBrains Mono,monospace' }}>{SA_EMAIL}</span> as Viewer. Subfolders are scanned too.
                  </div>
                </Field>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Field label="Time limit (minutes)">
                    <input style={inputStyle} type="number" min="1" value={timeLimit}
                      onChange={e => { setTimeLimit(e.target.value); setErr('') }}/>
                  </Field>
                  <Field label="Pass mark (%)">
                    <input style={inputStyle} type="number" min="0" max="100" value={passMark}
                      onChange={e => { setPassMark(e.target.value); setErr('') }}/>
                  </Field>
                </div>
              </div>
            </div>

            <div className="card" style={{ padding:20, marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:6 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>Scope</div>
                <div style={{ fontSize:11, color:'var(--t-3)' }}>{scope.size} selected</div>
              </div>
              <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:14, lineHeight:1.5 }}>
                Which events this quiz tests. Only these buttons appear while tagging,
                for you and for the trainee. Tag something outside it and the scope
                widens automatically, so the trainee still has the button.
              </div>
              {panels.map(panel => (
                <div key={panel} style={{ marginBottom:14 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--p2)',
                    letterSpacing:1, textTransform:'uppercase', marginBottom:7 }}>{panel}</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                    {taggable.filter(e => e.panel === panel).map(e => {
                      const on = scope.has(e.id)
                      return (
                        <button key={e.id}
                          onClick={() => { setScope(p => { const n = new Set(p); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n }); setErr('') }}
                          style={{ padding:'6px 10px', fontSize:11, fontWeight:600, borderRadius:6,
                            cursor:'pointer',
                            background: on ? 'rgba(232,89,12,0.15)' : 'var(--bg-3)',
                            border:`1px solid ${on ? 'var(--p2)' : 'var(--b-1)'}`,
                            color: on ? 'var(--p2)' : 'var(--t-2)' }}>
                          {e.label}
                          {e.hotkey && <span style={{ opacity:0.5, marginLeft:5,
                            fontFamily:'JetBrains Mono,monospace' }}>{e.hotkey}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {err && <ErrBox>{err}</ErrBox>}
            <button className="btn-orange" style={{ width:'100%', padding:'12px 0', fontSize:13 }}
              disabled={scanning} onClick={handleScan}>
              {scanning ? (scanMsg || 'Scanning…') : 'Scan the folder →'}
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <div className="card" style={{ padding:20, marginBottom:14 }}>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>{name}</div>
              <div style={{ fontSize:11, color:'var(--t-3)' }}>
                {clips.length} clips · {formatBytes(totalSizeBytes(clips))} · {timeLimit} min · pass {passMark}%
              </div>
            </div>

            {scanning && (
              <div className="card" style={{ padding:16, marginBottom:14, fontSize:12, color:'var(--t-2)' }}>
                {scanMsg}
                <div style={{ fontSize:10, color:'var(--t-3)', marginTop:6, lineHeight:1.5 }}>
                  Each clip is loaded once to confirm it plays. A .mov or .mkv can open
                  its container and still have no decodable track, and that fails
                  silently — better caught now than mid-quiz.
                </div>
              </div>
            )}

            {checked && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
                <Stat n={playable.length} label="PLAYABLE" color="#30D158"/>
                <Stat n={clips.length - playable.length} label="WILL NOT PLAY"
                  color={clips.length - playable.length ? '#FF453A' : 'var(--t-3)'}/>
              </div>
            )}

            {checked && clips.length > playable.length && (
              <div style={{ background:'rgba(255,69,58,0.08)', border:'1px solid rgba(255,69,58,0.3)',
                borderRadius:8, padding:'12px 14px', marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#FF453A', marginBottom:6 }}>
                  These will be left out of the quiz
                </div>
                {clips.filter(c => c.playable === false).map(c => (
                  <div key={c.drive_file_id} style={{ display:'flex', alignItems:'center',
                    gap:10, padding:'4px 0' }}>
                    <span style={{ flex:1, fontSize:11, color:'var(--t-2)',
                      fontFamily:'JetBrains Mono,monospace' }}>
                      {c.video_filename} — {c.unplayable_reason}
                    </span>
                    <button onClick={() => setForced(f => {
                        const n = new Set(f)
                        n.has(c.drive_file_id) ? n.delete(c.drive_file_id) : n.add(c.drive_file_id)
                        return n })}
                      style={{ fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:5,
                        cursor:'pointer', whiteSpace:'nowrap',
                        background: forced.has(c.drive_file_id) ? 'rgba(48,209,88,0.15)' : 'transparent',
                        border:`1px solid ${forced.has(c.drive_file_id) ? '#30D158' : 'var(--b-1)'}`,
                        color: forced.has(c.drive_file_id) ? '#30D158' : 'var(--t-3)' }}>
                      {forced.has(c.drive_file_id) ? 'included' : 'include anyway'}
                    </button>
                  </div>
                ))}
                <div style={{ fontSize:10, color:'var(--t-3)', marginTop:8, lineHeight:1.5 }}>
                  A timeout usually means a slow connection, not a bad file — those are
                  worth including anyway. A codec error means it genuinely will not play
                  and needs re-exporting as h264 mp4.
                </div>
              </div>
            )}

            <div className="card" style={{ padding:16, marginBottom:14 }}>
              <div style={{ fontSize:12, fontWeight:700, marginBottom:10 }}>Clips ({clips.length})</div>
              <div style={{ maxHeight:300, overflowY:'auto' }}>
                {clips.map((c, i) => (
                  <div key={c.drive_file_id} style={{ display:'flex', alignItems:'center', gap:10,
                    padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize:10, color:'var(--t-3)', width:28,
                      fontFamily:'JetBrains Mono,monospace' }}>{i + 1}</span>
                    <span style={{ flex:1, fontSize:12, color:'var(--t-2)', overflow:'hidden',
                      textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.video_filename}</span>
                    <span style={{ fontSize:10, color:'var(--t-3)', width:56, textAlign:'right' }}>
                      {c.size_bytes ? (c.size_bytes / 1048576).toFixed(1) + ' MB' : '—'}
                    </span>
                    <span style={{ width:58, textAlign:'right', fontSize:9, fontWeight:700,
                      color: c.playable === true ? '#30D158'
                           : forced.has(c.drive_file_id) ? '#FFD60A'
                           : c.playable === false ? '#FF453A' : 'var(--t-3)' }}>
                      {c.playable === true ? 'PLAYS'
                       : forced.has(c.drive_file_id) ? 'FORCED'
                       : c.playable === false ? 'FAILS' : '…'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...ghost, flex:1 }} onClick={() => setStep(1)}>← Back to setup</button>
              <button className="btn-orange" style={{ flex:2, padding:'11px 0', fontSize:13 }}
                disabled={!checked || !playable.length}
                onClick={() => { setClipIdx(0); setStep(3) }}>
                {checked ? `Tag the answer key (${playable.length} clips) →` : 'Checking clips…'}
              </button>
            </div>
          </>
        )}

        {step === 3 && cur && (
          <>
            <div className="card" style={{ padding:14, marginBottom:12 }}>
              <Field label="What should the trainee do on this clip? (required)">
                <input style={inputStyle} value={curAns.instruction}
                  placeholder="e.g. Tag the pressure and identify the team"
                  onChange={e => patch(cur.clip_index, { instruction: e.target.value })}/>
              </Field>
            </div>

            <ClipTagger
              clipUrl={url}
              scopeIds={effectiveScope}
              instruction={curAns.instruction || '(write an instruction above)'}
              events={curAns.events}
              onAdd={ev => patch(cur.clip_index, { events: [...curAns.events, ev] })}
              onRemove={i => patch(cur.clip_index, { events: curAns.events.filter((_, j) => j !== i) })}
              onNext={() => clipIdx < playable.length - 1 ? setClipIdx(clipIdx + 1) : setStep(4)}
              nextLabel={clipIdx < playable.length - 1 ? 'Next clip' : 'Assign'}
            />

            <div style={{ display:'flex', gap:10, marginTop:14 }}>
              <button style={{ ...ghost, flex:1 }}
                onClick={() => clipIdx > 0 ? setClipIdx(clipIdx - 1) : setStep(2)}>
                {clipIdx > 0 ? '← Previous clip' : '← Back to clips'}
              </button>
              <button className="btn-orange" style={{ flex:2, padding:'11px 0', fontSize:13 }}
                onClick={() => clipIdx < playable.length - 1 ? setClipIdx(clipIdx + 1) : setStep(4)}>
                {clipIdx < playable.length - 1
                  ? `Next clip (${clipIdx + 2} of ${playable.length}) →`
                  : 'Assign to collectors →'}
              </button>
            </div>
            <div style={{ fontSize:10, color:'var(--t-3)', textAlign:'center', marginTop:10 }}>
              {taggedClips} of {playable.length} clips tagged · {totalEvents} events ·
              {' '}{instrDone} instructions written
              {curAns.events.length === 0 && ' · leaving this empty records “no event”'}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div className="card" style={{ padding:20, marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:12 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>Assign to collectors</div>
                <div style={{ fontSize:11, color: assigned.size ? 'var(--p2)' : 'var(--t-3)' }}>
                  {assigned.size} selected
                </div>
              </div>

              <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                <input style={{ ...inputStyle, flex:1 }} value={search}
                  placeholder="Search by name or HR code…"
                  onChange={e => setSearch(e.target.value)}/>
                <button style={{ ...ghost, padding:'9px 14px', whiteSpace:'nowrap' }}
                  onClick={() => setAssigned(new Set(filteredTrainees.map(t => t.hrCode)))}>
                  Select all{search.trim() ? ' shown' : ''} ({filteredTrainees.length})
                </button>
                <button style={{ ...ghost, padding:'9px 14px' }}
                  onClick={() => setAssigned(new Set())}>Clear</button>
              </div>

              <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                <input style={{ ...inputStyle, flex:1, fontFamily:'JetBrains Mono,monospace', fontSize:11 }}
                  value={paste} placeholder="Or paste HR codes: A-1234, A-1235 …"
                  onChange={e => setPaste(e.target.value)}/>
                <button style={{ ...ghost, padding:'9px 14px', whiteSpace:'nowrap' }}
                  onClick={async () => {
                    const { matched, unknown } = await resolveHrCodes(paste)
                    setAssigned(prev => new Set([...prev, ...matched.map(m => m.hrCode)]))
                    setPasteMsg(`Added ${matched.length}.` +
                      (unknown.length ? ` Not recognised: ${unknown.slice(0,6).join(', ')}` : ''))
                    setPaste('')
                  }}>Add pasted</button>
              </div>
              {pasteMsg && <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:10 }}>{pasteMsg}</div>}

              <div style={{ maxHeight:300, overflowY:'auto' }}>
                {!trainees.length && <div style={{ fontSize:12, color:'var(--t-3)' }}>Loading collectors…</div>}
                {filteredTrainees.map(t => {
                  const on = assigned.has(t.hrCode)
                  return (
                    <div key={t.hrCode} onClick={() => setAssigned(p => {
                        const n = new Set(p); n.has(t.hrCode) ? n.delete(t.hrCode) : n.add(t.hrCode); return n })}
                      style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 8px',
                        borderRadius:6, cursor:'pointer',
                        background: on ? 'rgba(232,89,12,0.1)' : 'transparent' }}>
                      <div style={{ width:16, height:16, borderRadius:4, flexShrink:0,
                        background: on ? 'var(--p2)' : 'transparent',
                        border:`2px solid ${on ? 'var(--p2)' : 'var(--b-2)'}`,
                        display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {on && <span style={{ color:'#000', fontSize:10, fontWeight:900 }}>✓</span>}
                      </div>
                      <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:11,
                        color:'var(--t-3)', width:70 }}>{t.hrCode}</span>
                      <span style={{ flex:1, fontSize:12, color:'var(--t-2)' }}>{t.name}</span>
                      <span style={{ fontSize:10, color:'var(--t-3)' }}>{t.role}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {err && <ErrBox>{err}</ErrBox>}
            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...ghost, flex:1 }}
                onClick={() => { setStep(3); setClipIdx(Math.max(0, playable.length - 1)) }}>
                ← Back to tagging
              </button>
              <button className="btn-orange" style={{ flex:2, padding:'11px 0', fontSize:13 }}
                onClick={() => setStep(5)}>Review and publish →</button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <div className="card" style={{ padding:20, marginBottom:14 }}>
              <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>{name}</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
                <Stat n={playable.length} label="CLIPS"/>
                <Stat n={totalEvents} label="EVENTS"/>
                <Stat n={assigned.size} label="ASSIGNED"/>
                <Stat n={timeLimit} label="MINUTES"/>
              </div>
              <div style={{ fontSize:11, color:'var(--t-3)', marginTop:12, lineHeight:1.6 }}>
                Pass mark {passMark}% · scope:{' '}
                <span style={{ fontFamily:'JetBrains Mono,monospace' }}>{effectiveScope.join(', ')}</span>
                {effectiveScope.length > scope.size &&
                  ` (widened from ${scope.size} — you tagged outside the original scope)`}
              </div>
            </div>

            {noEventClips.length > 0 && (
              <div style={{ background:'rgba(255,214,10,0.07)', border:'1px solid rgba(255,214,10,0.3)',
                borderRadius:8, padding:'14px 16px', marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#FFD60A', marginBottom:6 }}>
                  {noEventClips.length} clip{noEventClips.length === 1 ? '' : 's'} have no event tagged
                </div>
                <div style={{ fontSize:11, color:'var(--t-3)', marginBottom:10, lineHeight:1.5 }}>
                  These record “no event” as the correct answer — a trainee who tags
                  anything on them is marked wrong. If you simply missed one, go back
                  and tag it, because an accidental one fails everybody who answered
                  correctly.
                </div>
                <div style={{ maxHeight:110, overflowY:'auto', marginBottom:10 }}>
                  {noEventClips.map(c => (
                    <div key={c.drive_file_id} style={{ fontSize:11, color:'var(--t-2)',
                      fontFamily:'JetBrains Mono,monospace' }}>{c.video_filename}</div>
                  ))}
                </div>
                <div onClick={() => setConfirmedNoEvent(v => !v)}
                  style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
                  <div style={{ width:18, height:18, borderRadius:5, flexShrink:0,
                    background: confirmedNoEvent ? '#FFD60A' : 'transparent',
                    border:`2px solid ${confirmedNoEvent ? '#FFD60A' : 'var(--b-2)'}`,
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {confirmedNoEvent && <span style={{ color:'#000', fontSize:11, fontWeight:900 }}>✓</span>}
                  </div>
                  <span style={{ fontSize:12, color: confirmedNoEvent ? '#FFD60A' : 'var(--t-2)' }}>
                    Yes — these clips deliberately have no event
                  </span>
                </div>
              </div>
            )}

            <div className="card" style={{ padding:16, marginBottom:14 }}>
              <div style={{ fontSize:12, fontWeight:700, marginBottom:10 }}>Every clip</div>
              <div style={{ maxHeight:300, overflowY:'auto' }}>
                {playable.map((c, i) => {
                  const a = answers[c.clip_index] || {}
                  const evs = a.events || []
                  return (
                    <div key={c.drive_file_id} style={{ padding:'8px 0',
                      borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:10, color:'var(--t-3)', width:26,
                          fontFamily:'JetBrains Mono,monospace' }}>{i + 1}</span>
                        <span style={{ fontSize:12, color:'var(--t-2)', flex:1 }}>{c.video_filename}</span>
                        <span style={{ fontSize:10, fontWeight:700,
                          color: evs.length ? '#30D158' : '#FFD60A' }}>
                          {evs.length ? `${evs.length} event${evs.length === 1 ? '' : 's'}` : 'no event'}
                        </span>
                        {!(a.instruction || '').trim() && (
                          <span style={{ fontSize:9, color:'#FF453A' }}>NO INSTRUCTION</span>
                        )}
                      </div>
                      {(a.instruction || '').trim() && (
                        <div style={{ fontSize:10, color:'var(--t-3)', marginLeft:34, marginTop:2 }}>
                          “{a.instruction}”
                        </div>
                      )}
                      {evs.map((ev, j) => (
                        <div key={j} style={{ fontSize:10, color:'var(--t-3)', marginLeft:34,
                          fontFamily:'JetBrains Mono,monospace' }}>
                          {EVENT_BY_ID[ev.event_code]?.label || ev.event_code} @ {fmtTime(ev.video_time_ms / 1000)}
                          {Object.values(ev.attrs || {}).filter(Boolean).length
                            ? ' · ' + Object.values(ev.attrs).filter(Boolean).join(' · ') : ''}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>

            {err && <ErrBox>{err}</ErrBox>}
            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...ghost, flex:1 }} onClick={() => setStep(4)}>← Back</button>
              <button style={{ ...ghost, flex:1 }} disabled={saving}
                onClick={() => handlePublish(true)}>
                {saving ? 'Saving…' : 'Save as draft'}
              </button>
              <button className="btn-orange" style={{ flex:2, padding:'11px 0', fontSize:13 }}
                disabled={saving} onClick={() => handlePublish(false)}>
                {saving ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
