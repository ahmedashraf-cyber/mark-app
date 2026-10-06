/**
 * TagEditorPage.jsx — edit a model answer. Batch Manager only.
 * ============================================================================
 * Replaces the Tag tile for Batch Manager. Every other role's Tag mode is
 * untouched.
 *
 * Attribute groups come from fieldExtras (groupsForEvent + getGroupOptions),
 * the same definitions FIELD collects with — including the variant branching,
 * so Shot + Head offers Normal / Diving header / Lob rather than the foot
 * options. Reading App_Shortcuts.csv again would be a second source able to
 * drift from the one FIELD actually uses.
 *
 * Everything is chosen, nothing typed, except the three timestamp numbers.
 *
 * A save OVERWRITES the previous version's events — chosen deliberately. See
 * modelAnswers.js for what that costs.
 */
import { useState, useEffect, useMemo } from 'react'
import {
  FIELD_EVENTS, EVENT_BY_ID, groupsForEvent, getGroupOptions,
} from '../utils/fieldExtras'
import { loadModelList, loadModelEvents, saveModelAnswer } from '../utils/modelAnswers'
import { capabilities } from '../hooks/useAdmin'
import { showToast } from '../utils/toast'

const inputStyle = { background:'var(--bg-3)', border:'1px solid var(--b-1)',
  borderRadius:6, padding:'6px 9px', fontSize:11, color:'var(--t-1)', outline:'none' }
const btn = { padding:'6px 12px', fontSize:11, background:'transparent',
  border:'1px solid var(--b-1)', borderRadius:7, color:'var(--t-2)', cursor:'pointer' }
const td = { padding:'6px 8px', fontSize:11, borderBottom:'1px solid rgba(255,255,255,0.05)',
  verticalAlign:'top' }
const th = { padding:'7px 8px', fontSize:9, fontWeight:800, color:'var(--t-3)',
  letterSpacing:0.5, textTransform:'uppercase', textAlign:'left',
  borderBottom:'1px solid var(--b-1)', whiteSpace:'nowrap' }

const ms2parts = ms => {
  const n = Math.max(0, Number(ms) || 0)
  return { m: Math.floor(n / 60000), s: Math.floor((n % 60000) / 1000), ms: n % 1000 }
}
const parts2ms = p =>
  (Number(p.m) || 0) * 60000 + (Number(p.s) || 0) * 1000 + (Number(p.ms) || 0)
const fmt = ms => {
  const p = ms2parts(ms)
  return `${String(p.m).padStart(2,'0')}:${String(p.s).padStart(2,'0')}.${String(p.ms).padStart(3,'0')}`
}

/** attr_* columns on an event row, as readable tags. */
function attrTags(ev) {
  return Object.keys(ev)
    .filter(k => k.startsWith('attr_') && String(ev[k] ?? '').trim())
    .map(k => ({ group: k.replace(/^attr_/, ''), value: String(ev[k]).trim() }))
}

export default function TagEditorPage({ role, changedBy, onBack }) {
  const caps = capabilities(role)
  // The tile is hidden for other roles, but hiding a tile is not access
  // control — this must refuse on its own if ever reached another way.
  if (!caps.admin) {
    return (
      <Shell onBack={onBack}>
        <div className="card" style={{ padding:24, fontSize:13, color:'#FF453A' }}>
          The Tag Editor is for Batch Managers only.
          <div style={{ fontSize:11, color:'var(--t-3)', marginTop:6 }}>
            Your role: {caps.role || 'unrecognised'}
          </div>
        </div>
      </Shell>
    )
  }
  return <Editor changedBy={changedBy} onBack={onBack}/>
}

function Editor({ changedBy, onBack }) {
  const [list, setList]       = useState([])
  const [loading, setLoad]    = useState(true)
  const [err, setErr]         = useState('')
  const [search, setSearch]   = useState('')
  const [model, setModel]     = useState(null)
  const [events, setEvents]   = useState([])
  const [changes, setChanges] = useState([])
  const [editing, setEditing] = useState(null)   // index, or 'new'
  const [saving, setSaving]   = useState('')

  useEffect(() => {
    (async () => {
      setLoad(true); setErr('')
      try { setList(await loadModelList()) }
      catch (e) { setErr(e?.message || String(e)) }
      finally { setLoad(false) }
    })()
  }, [])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(m =>
      String(m.matchId).includes(q) ||
      m.matchName.toLowerCase().includes(q) ||
      m.homeTeam.toLowerCase().includes(q) ||
      m.awayTeam.toLowerCase().includes(q))
  }, [list, search])

  async function open(m) {
    setLoad(true); setErr('')
    try {
      setEvents(await loadModelEvents(m.sessionId))
      setModel(m); setChanges([])
    } catch (e) { setErr(e?.message || String(e)) }
    finally { setLoad(false) }
  }

  const note = c => setChanges(x => [...x, c])

  function applyEdit(idx, next, before) {
    // record each field that actually moved, so the log says what changed
    const fields = new Set([...Object.keys(next), ...Object.keys(before || {})])
    const seq = before?.event_seq || String(idx + 1)
    ;[...fields].forEach(f => {
      if (!f.startsWith('attr_') && !['event_code','team','video_time_ms'].includes(f)) return
      const a = String(before?.[f] ?? ''), b = String(next[f] ?? '')
      if (a !== b) note({ type:'edit', eventSeq:seq, field:f, oldValue:a, newValue:b })
    })
    const copy = [...events]
    copy[idx] = next
    copy.sort((x, y) => (Number(x.video_time_ms)||0) - (Number(y.video_time_ms)||0))
    setEvents(copy)
    setEditing(null)
  }

  function addEvent(next) {
    note({ type:'add', eventSeq:'', field:'event_code',
      oldValue:'', newValue:`${next.event_code} @ ${fmt(next.video_time_ms)}` })
    const copy = [...events, next]
    copy.sort((x, y) => (Number(x.video_time_ms)||0) - (Number(y.video_time_ms)||0))
    setEvents(copy)
    setEditing(null)
  }

  function removeEvent(idx) {
    const ev = events[idx]
    const label = EVENT_BY_ID[ev.event_code]?.label || ev.event_code
    if (!window.confirm(`Remove ${label} at ${fmt(ev.video_time_ms)}?`)) return
    note({ type:'delete', eventSeq:ev.event_seq || String(idx+1),
      field:'event_code', oldValue:`${ev.event_code} @ ${fmt(ev.video_time_ms)}`, newValue:'' })
    setEvents(events.filter((_, i) => i !== idx))
  }

  async function save() {
    if (!changes.length) return
    setSaving('Starting…')
    try {
      const r = await saveModelAnswer({ model, events, changes, changedBy,
        onProgress: setSaving })
      showToast(`Saved — version ${r.oldVersion} → ${r.newVersion}, ${r.eventCount} events`)
      setModel({ ...model, modelVersion: String(r.newVersion) })
      setChanges([])
      setList(await loadModelList())
    } catch (e) {
      showToast(e?.message || String(e), 'error')
    } finally { setSaving('') }
  }

  // ── the list ─────────────────────────────────────────────────────────────
  if (!model) return (
    <Shell onBack={onBack}>
      <div className="card" style={{ padding:14, marginBottom:12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by match ID, match name or team"
          style={{ ...inputStyle, width:'100%' }}/>
        <div style={{ fontSize:10, color:'var(--t-3)', marginTop:8 }}>
          {shown.length} of {list.length} model answers
        </div>
      </div>
      {err && <div className="card" style={{ padding:14, marginBottom:12,
        fontSize:11, color:'#FF453A' }}>{err}</div>}
      <div className="card" style={{ padding:14 }}>
        {loading ? <div style={{ fontSize:12, color:'var(--t-3)' }}>Loading…</div> : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>Match</th><th style={th}>Half</th><th style={th}>Teams</th>
              <th style={{ ...th, textAlign:'right' }}>Events</th>
              <th style={{ ...th, textAlign:'right' }}>Version</th>
              <th style={th}>Status</th><th style={th}/>
            </tr></thead>
            <tbody>
              {shown.map(m => (
                <tr key={m.sessionId}>
                  <td style={{ ...td, fontFamily:'JetBrains Mono,monospace' }}>
                    {m.matchId}
                    {m.matchName && <div style={{ fontSize:10, color:'var(--t-3)',
                      fontFamily:'DM Sans' }}>{m.matchName}</div>}
                  </td>
                  <td style={td}>{m.half}</td>
                  <td style={{ ...td, color:'var(--t-3)' }}>
                    {m.homeTeam || '—'} v {m.awayTeam || '—'}</td>
                  <td style={{ ...td, textAlign:'right' }}>{m.eventCount || '—'}</td>
                  <td style={{ ...td, textAlign:'right',
                    fontFamily:'JetBrains Mono,monospace' }}>v{m.modelVersion}</td>
                  <td style={{ ...td, fontSize:10, fontWeight:700,
                    color: m.modelStatus === 'approved' ? '#30D158' : '#FFD60A' }}>
                    {m.modelStatus || 'draft'}</td>
                  <td style={{ ...td, textAlign:'right' }}>
                    <button className="btn-orange" style={{ padding:'3px 11px', fontSize:10 }}
                      onClick={() => open(m)}>Open</button>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={7} style={{ ...td, textAlign:'center', padding:20,
                  color:'var(--t-3)' }}>No model answers match.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  )

  // ── the editor ───────────────────────────────────────────────────────────
  return (
    <Shell onBack={onBack} title={`${model.matchId} ${model.half} · v${model.modelVersion}`}>
      <div className="card" style={{ padding:14, marginBottom:12, display:'flex',
        alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:12, fontWeight:700 }}>
          {events.length} events
          {changes.length > 0 && (
            <span style={{ color:'var(--p2)', fontWeight:600, marginLeft:8 }}>
              {changes.length} unsaved change{changes.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div style={{ flex:1 }}/>
        <button style={btn} onClick={() => setEditing('new')}>+ Add event</button>
        <button style={btn} onClick={() => {
          if (changes.length && !window.confirm(
            `Discard ${changes.length} unsaved change(s)?`)) return
          setModel(null); setEvents([]); setChanges([])
        }}>Cancel</button>
        <button className="btn-orange" style={{ padding:'6px 14px', fontSize:11,
          opacity: changes.length && !saving ? 1 : 0.45 }}
          disabled={!changes.length || !!saving} onClick={save}>
          {saving || `Save as v${(Number(model.modelVersion)||1) + 1}`}
        </button>
      </div>

      {changes.length > 0 && (
        <div className="card" style={{ padding:'9px 14px', marginBottom:12,
          fontSize:10, color:'var(--t-3)', background:'rgba(255,214,10,0.06)',
          border:'1px solid rgba(255,214,10,0.25)', lineHeight:1.6 }}>
          Saving replaces this model answer's events. Version {model.modelVersion}'s
          events are not kept — the model_changes log is the only record of what
          they were. Comparison runs already recorded against v{model.modelVersion}
          will no longer match the events in the sheet.
        </div>
      )}

      {editing !== null && (
        <EventForm
          initial={editing === 'new' ? null : events[editing]}
          onCancel={() => setEditing(null)}
          onSave={next => editing === 'new'
            ? addEvent(next)
            : applyEdit(editing, next, events[editing])}
          sessionId={model.sessionId}/>
      )}

      <div className="card" style={{ padding:14 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <th style={{ ...th, width:36 }}>#</th>
            <th style={th}>Event</th><th style={{ ...th, width:96 }}>Time</th>
            <th style={{ ...th, width:70 }}>Team</th>
            <th style={th}>Attributes</th><th style={{ ...th, width:120 }}/>
          </tr></thead>
          <tbody>
            {events.map((ev, i) => (
              <tr key={i}>
                <td style={{ ...td, color:'var(--t-3)' }}>{i + 1}</td>
                <td style={td}>{EVENT_BY_ID[ev.event_code]?.label || ev.event_code}</td>
                <td style={{ ...td, fontFamily:'JetBrains Mono,monospace',
                  color:'var(--t-3)' }}>{fmt(ev.video_time_ms)}</td>
                <td style={{ ...td, textTransform:'capitalize' }}>{ev.team || '—'}</td>
                <td style={td}>
                  {attrTags(ev).length === 0
                    ? <span style={{ color:'var(--t-3)' }}>—</span>
                    : attrTags(ev).map((t, j) => (
                      <span key={j} style={{ display:'inline-block', fontSize:9,
                        padding:'2px 6px', margin:'0 4px 4px 0', borderRadius:4,
                        background:'var(--bg-3)', color:'var(--t-2)',
                        fontFamily:'JetBrains Mono,monospace' }}>
                        {t.group}: {t.value}
                      </span>
                    ))}
                </td>
                <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                  <button style={{ ...btn, padding:'3px 9px', fontSize:10, marginRight:5 }}
                    onClick={() => setEditing(i)}>Edit</button>
                  <button style={{ ...btn, padding:'3px 9px', fontSize:10,
                    color:'#FF453A', borderColor:'rgba(255,69,58,0.4)' }}
                    onClick={() => removeEvent(i)}>Delete</button>
                </td>
              </tr>
            ))}
            {!events.length && (
              <tr><td colSpan={6} style={{ ...td, textAlign:'center', padding:20,
                color:'var(--t-3)' }}>No events. Use Add event.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  )
}

/**
 * The edit / add form. Dropdowns throughout; only the three timestamp numbers
 * are typed, as number inputs.
 */
function EventForm({ initial, onCancel, onSave, sessionId }) {
  const [code, setCode]   = useState(initial?.event_code || '')
  const [team, setTeam]   = useState(initial?.team || '')
  const [t, setT]         = useState(ms2parts(initial?.video_time_ms || 0))
  // groupId -> chosen code
  const [attrs, setAttrs] = useState(() => {
    const out = {}
    Object.keys(initial || {}).forEach(k => {
      if (k.startsWith('attr_') && String(initial[k] ?? '').trim()) {
        out[k.replace(/^attr_/, '')] = String(initial[k]).trim()
      }
    })
    return out
  })

  // Changing the event type clears the attributes: the groups a tackle uses are
  // not the groups a shot uses, so keeping them would leave values belonging to
  // groups that are no longer offered.
  const changeCode = next => { setCode(next); setAttrs({}) }

  // Groups resolve from the chosen codes, which is what gives the variant
  // branching — pick Shot then Head and Technique switches to the header options.
  const chosen = Object.values(attrs)
  const groups = useMemo(() => code ? groupsForEvent(code, chosen) : [],
    [code, chosen.join('|')])

  const collected = useMemo(() => groups
    .filter(g => attrs[g.id])
    .map(g => ({ groupId:g.id, selections:[{ code:attrs[g.id] }] })), [groups, attrs])

  const valid = code && team && (t.m || t.s || t.ms || initial)

  function submit() {
    if (!valid) { showToast('Event type, team and a timestamp are required', 'error'); return }
    const row = { ...(initial || {}) }
    row.session_id    = sessionId
    row.event_code    = code
    row.team          = team
    row.video_time_ms = String(parts2ms(t))
    // clear every attr_ column, then set the chosen ones — otherwise an
    // attribute from the previous event type would linger in the row
    Object.keys(row).forEach(k => { if (k.startsWith('attr_')) row[k] = '' })
    Object.entries(attrs).forEach(([g, v]) => { row['attr_' + g] = v })
    onSave(row)
  }

  return (
    <div className="card" style={{ padding:16, marginBottom:12,
      border:'1px solid var(--p2)' }}>
      <div style={{ fontSize:12, fontWeight:700, marginBottom:12 }}>
        {initial ? 'Edit event' : 'Add event'}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1fr 1fr', gap:12,
        marginBottom:12 }}>
        <div>
          <Lbl>Event type</Lbl>
          <select value={code} onChange={e => changeCode(e.target.value)}
            style={{ ...inputStyle, width:'100%', cursor:'pointer' }}>
            <option value="">Choose…</option>
            {FIELD_EVENTS.map(e => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
        </div>
        <div>
          <Lbl>Timestamp</Lbl>
          <div style={{ display:'flex', gap:5, alignItems:'center' }}>
            <input type="number" min="0" value={t.m} style={{ ...inputStyle, width:52 }}
              onChange={e => setT({ ...t, m:e.target.value })}/>
            <span style={{ color:'var(--t-3)', fontSize:11 }}>:</span>
            <input type="number" min="0" max="59" value={t.s} style={{ ...inputStyle, width:52 }}
              onChange={e => setT({ ...t, s:e.target.value })}/>
            <span style={{ color:'var(--t-3)', fontSize:11 }}>.</span>
            <input type="number" min="0" max="999" value={t.ms} style={{ ...inputStyle, width:62 }}
              onChange={e => setT({ ...t, ms:e.target.value })}/>
          </div>
          <div style={{ fontSize:9, color:'var(--t-3)', marginTop:3 }}>
            {fmt(parts2ms(t))}
          </div>
        </div>
        <div>
          <Lbl>Team</Lbl>
          <div style={{ display:'flex', gap:6 }}>
            {['home','away'].map(s => (
              <button key={s} onClick={() => setTeam(s)}
                style={{ ...btn, flex:1, textTransform:'capitalize',
                  background: team === s ? 'rgba(232,89,12,0.15)' : 'transparent',
                  borderColor: team === s ? 'var(--p2)' : 'var(--b-1)',
                  color: team === s ? 'var(--p2)' : 'var(--t-3)' }}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      {code && groups.length > 0 && (
        <>
          <Lbl>Attributes</Lbl>
          <div style={{ display:'grid',
            gridTemplateColumns:'repeat(auto-fill, minmax(190px, 1fr))', gap:10,
            marginBottom:12 }}>
            {groups.map(g => {
              const opts = getGroupOptions(g, collected,
                attrs[g.id] ? [{ code:attrs[g.id] }] : [])
              return (
                <div key={g.id}>
                  <div style={{ fontSize:9, color:'var(--t-3)', marginBottom:3 }}>
                    {g.label}{g.required ? ' *' : ''}
                  </div>
                  <select value={attrs[g.id] || ''}
                    onChange={e => setAttrs(a => {
                      const next = { ...a }
                      if (e.target.value) next[g.id] = e.target.value
                      else delete next[g.id]
                      return next
                    })}
                    style={{ ...inputStyle, width:'100%', cursor:'pointer' }}>
                    <option value="">—</option>
                    {opts.map(o => (
                      <option key={o.code} value={o.code}>{o.label || o.code}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
        <button style={btn} onClick={onCancel}>Cancel</button>
        <button className="btn-orange" style={{ padding:'6px 16px', fontSize:11,
          opacity: valid ? 1 : 0.45 }} disabled={!valid} onClick={submit}>
          {initial ? 'Update event' : 'Add event'}
        </button>
      </div>
    </div>
  )
}

const Lbl = ({ children }) => (
  <div style={{ fontSize:9, fontWeight:700, color:'var(--t-3)', letterSpacing:0.8,
    textTransform:'uppercase', marginBottom:5 }}>{children}</div>
)

function Shell({ onBack, title, children }) {
  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      background:'var(--bg)', color:'var(--t-1)', overflow:'hidden' }}>
      <div style={{ flexShrink:0, height:48, background:'var(--bg-2)',
        borderBottom:'1px solid var(--b-1)', display:'flex', alignItems:'center',
        padding:'0 16px', gap:12 }}>
        <button onClick={onBack} style={{ background:'none', border:'none',
          color:'var(--t-3)', cursor:'pointer', fontSize:11, padding:'4px 8px' }}>← Back</button>
        <div style={{ width:1, height:20, background:'var(--b-1)' }}/>
        <div style={{ fontFamily:'JetBrains Mono,monospace', fontSize:9, fontWeight:800,
          color:'var(--p2)', letterSpacing:1.5, background:'rgba(232,89,12,0.12)',
          padding:'2px 8px', borderRadius:4 }}>TAG EDITOR</div>
        {title && <span style={{ fontSize:12, fontWeight:600 }}>{title}</span>}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:18, maxWidth:1300,
        margin:'0 auto', width:'100%' }}>{children}</div>
    </div>
  )
}
