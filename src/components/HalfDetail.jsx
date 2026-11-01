/**
 * HalfDetail.jsx — one half, read-only: how it was collected, how it scored against the model answer, every event, and
 * the person's own video to watch it with.
 *
 * It reads (through utils/myHalvesSheet.js) and shows. It writes nothing, scores nothing and changes no other screen.
 * What is always shown: the collection details and the collector's own events, even when the half was never compared.
 * What needs a current comparison: the score cards and the Event Detail table.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MultiFilter from './MultiFilter'
import EventDetailTable from './EventDetailTable'
import LocalVideoDrop from './LocalVideoDrop'
import { loadHalfDetail } from '../utils/myHalvesSheet'
import { buildDetailView, filterDetail, filterOptions, ownEventRows, runCards, collectionDetails } from '../utils/myHalves'
import { STATE_TEXT } from '../utils/sessionScores'
import { msToReadable } from '../utils/fieldSheetSync'
import { MODULE_LABELS } from '../utils/defectTypes'
import { sameHr } from '../utils/hrCode'

const mono = { fontFamily: 'JetBrains Mono,monospace' }
const card = { background: 'var(--bg-2)', border: '1px solid var(--b-1)', borderRadius: 12, padding: 16, marginBottom: 12 }
const small = { fontSize: 10, color: 'var(--t-3)' }
const HALF = { '1H': '1st half', '2H': '2nd half', ET1: 'Extra time 1', ET2: 'Extra time 2', PEN: 'Penalties' }
const note = (c, b, bg) => ({ fontSize: 11, lineHeight: 1.6, padding: '10px 12px', borderRadius: 8, color: c, border: `1px solid ${b}`, background: bg, marginBottom: 12 })

export default function HalfDetail({ row, me, canViewAny, cache, onBack, loadDetail = loadHalfDetail }) {
  const [data, setData] = useState({ status: 'loading' })
  const [f, setF] = useState({ events: [], verdicts: [], modules: [] })
  const [videoReady, setVideoReady] = useState(false)
  const [seekRow, setSeekRow] = useState(null)
  const videoRef = useRef(null)
  const own = sameHr(row.collector_hr_code, me.hrCode)

  const load = useCallback(async () => {
    setData({ status: 'loading' })
    try { setData({ status: 'ready', ...(await loadDetail(row, { cache, me, canViewAny })) }) }
    catch (e) { setData({ status: 'error', error: e?.message || String(e) }) }
  }, [row, cache, me, canViewAny, loadDetail])
  useEffect(() => { load() }, [load])

  const view = useMemo(() => (data.status === 'ready' && data.detail ? buildDetailView(data.detail, data.ownEvents, data.modelEvents) : []), [data])
  const options = useMemo(() => filterOptions(view), [view])
  const shown = useMemo(() => filterDetail(view, f), [view, f])
  const mine = useMemo(() => (data.status === 'ready' ? ownEventRows(data.ownEvents) : []), [data])
  const cards = row.state === 'compared' ? runCards(row.run) : null

  const jump = (key, ms) => {
    if (videoRef.current?.seekTo(ms)) { setSeekRow(key); setTimeout(() => setSeekRow(k => (k === key ? null : k)), 2200) }
  }
  const teams = [row.home_team_name, row.away_team_name].filter(Boolean).join(' vs ')
  const who = own ? 'Your' : `${row.collectorName || row.collector_hr_code}'s`

  return (
    <div data-testid="half-detail" style={{ padding: '0 0 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <button data-testid="back-to-list" onClick={onBack} style={{ background: 'transparent', border: '1px solid var(--b-1)', borderRadius: 6, color: 'var(--t-2)', fontSize: 11, padding: '5px 11px', cursor: 'pointer' }}>← All halves</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div data-testid="detail-title" style={{ fontSize: 15, fontWeight: 700 }}>Match {row.match_id}{teams ? ` · ${teams}` : ''} · {HALF[row.half] || row.half}</div>
          <div style={small}>Saved {row.savedAt || '—'}{!own ? ` · collector ${row.collector_hr_code}${row.collectorName ? ' (' + row.collectorName + ')' : ''}` : ''} · <span style={mono}>{row.session_id}</span></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 14, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="card" style={card} data-testid="collection-details">
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Collection details</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
              {collectionDetails(row).map(([k, v]) => (
                <div key={k} style={{ minWidth: 0 }}><div style={{ ...small, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 9, fontWeight: 700 }}>{k}</div>
                  <div title={v} style={{ fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div></div>))}
            </div>
          </div>

          {data.status === 'loading' && <div data-testid="detail-loading" style={{ ...small, fontSize: 12, padding: '14px 0' }}>Reading this half from the sheet…</div>}
          {data.status === 'error' && (
            <div data-testid="detail-error" style={note('#FF453A', 'rgba(255,69,58,0.3)', 'rgba(255,69,58,0.08)')}>
              Couldn&rsquo;t read this half: {data.error}<div style={{ marginTop: 8 }}><button onClick={load} style={{ background: 'transparent', border: '1px solid var(--b-1)', borderRadius: 6, color: 'var(--t-2)', fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>Try again</button></div>
            </div>)}
          {data.status === 'ready' && data.warning && <div style={note('#FF9F0A', 'rgba(255,159,10,0.4)', 'rgba(255,159,10,0.08)')}>{data.warning}</div>}

          {/* the comparison, only when there is a CURRENT one */}
          {row.state === 'not_compared' && <div data-testid="not-compared" style={note('var(--t-2)', 'var(--b-1)', 'var(--bg-3)')}><b>Not compared yet.</b> {who} events are listed below. The comparison with the model answer appears here once a reviewer has run it.</div>}
          {row.state === 'stale' && <div data-testid="stale-note" style={note('#FF9F0A', 'rgba(255,159,10,0.4)', 'rgba(255,159,10,0.08)')}><b>Stale, match changed.</b> The match ID or half of this session was corrected after it was compared, so that comparison is not shown as the current score. {who} events are listed below.</div>}
          {row.state === 'unknown' && <div style={note('#FF9F0A', 'rgba(255,159,10,0.4)', 'rgba(255,159,10,0.08)')}>The scores could not be read, so it is not known whether this half was compared. {who} events are listed below.</div>}
          {row.state === 'model' && <div style={note('#64D2FF', 'rgba(100,210,255,0.4)', 'rgba(100,210,255,0.08)')}><b>Model answer.</b> This session is the reference other halves are scored against, so it has no score.</div>}

          {cards && (
            <div className="card" style={card} data-testid="score-cards">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span data-testid="overall" style={{ fontSize: 44, fontWeight: 900, color: cards.overall === null ? 'var(--t-3)' : cards.overall >= 90 ? '#30D158' : cards.overall >= 75 ? '#FFD60A' : '#FF453A' }}>{cards.overall === null ? '-' : cards.overall}</span>
                {cards.overall !== null && <span style={{ fontSize: 18, color: 'var(--t-3)' }}>%</span>}
                <span style={{ ...small, marginLeft: 8 }}>Overall · run {row.run.at ? row.run.at.replace('T', ' ').slice(0, 16) : '—'}{row.run.modelSessionId ? ` · against ${row.run.modelSessionId}` : ''}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
                {cards.counts.map(c => (
                  <div key={c.label} data-testid={`count-${c.label.toLowerCase().replace(/\s+/g, '-')}`} style={{ background: 'var(--bg-3)', borderRadius: 8, padding: 8, textAlign: 'center', opacity: c.unscored ? 0.55 : 1, border: c.unscored ? '1px dashed var(--b-2)' : 'none' }}
                    title={c.unscored ? 'Recorded for review but excluded from the score' : ''}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: c.color }}>{c.value}</div><div style={{ fontSize: 9, color: 'var(--t-3)', marginTop: 2 }}>{c.label}</div>
                    {c.unscored && <div style={{ fontSize: 8, color: 'var(--t-3)', fontStyle: 'italic' }}>not scored</div>}
                  </div>))}
              </div>
              <div style={{ ...small, marginBottom: 10 }}>Model: {cards.totalModel ?? '—'} events · Collector: {cards.totalCollector ?? '—'} events</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
                {cards.modules.map(m => (
                  <div key={m.module} data-testid={`module-${m.module}`} style={{ background: 'var(--bg-3)', borderRadius: 8, padding: 8, textAlign: 'center' }}
                    title={!m.recorded ? 'This run was written before module scores existed' : m.score === null ? 'The model answer has no events for this module' : `${m.correct} of ${m.events} correct`}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--t-3)', letterSpacing: 0.5 }}>{(MODULE_LABELS[m.module] || m.module).toUpperCase()}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2, color: m.score === null ? 'var(--t-3)' : 'var(--t-1)' }}>{m.score === null ? '-' : `${m.score}%`}</div>
                    <div style={{ fontSize: 9, color: 'var(--t-3)' }}>{m.score === null ? 'no data' : `${m.correct}/${m.events}`}</div>
                  </div>))}
              </div>
            </div>
          )}

          {data.status === 'ready' && data.detail && (
            <div className="card" style={card} data-testid="detail-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Event detail</div>
                <span data-testid="detail-count" style={small}>{shown.length} of {view.length} rows</span>
                <span style={{ flex: 1 }}/>
                <MultiFilter label="All events" width={150} options={options.events} selected={f.events} onChange={events => setF(x => ({ ...x, events }))}/>
                <MultiFilter label="All verdicts" width={130} options={options.verdicts} selected={f.verdicts} onChange={verdicts => setF(x => ({ ...x, verdicts }))}/>
                <MultiFilter label="All modules" width={120} options={options.modules.map(v => ({ value: v, label: MODULE_LABELS[v] || v }))} selected={f.modules} onChange={modules => setF(x => ({ ...x, modules }))}/>
              </div>
              {view.length === 0
                ? <div data-testid="detail-empty" style={{ ...small, fontSize: 12 }}>The sheet has no detail rows stored for this run.</div>
                : <div style={{ overflowX: 'auto' }}><EventDetailTable rows={shown} canSeek={videoReady} seekRow={seekRow} onSeek={(r, ms) => jump(r.i, ms)}/></div>}
              {view.some(r => r.modelMissing || r.collectorMissing) && <div style={{ ...small, marginTop: 8 }}>† This event is no longer in the sheet (the session was saved again after the comparison); the row is shown from what the comparison stored.</div>}
              {view.some(r => r.gkNote) && <div style={{ ...small, marginTop: 4 }}>ⓘ Goal-keeper save events: Tag asks for a body state and a stance, but both go to one stored column, so only one of them is kept. Known limitation.</div>}
            </div>
          )}

          {data.status === 'ready' && (
            <div className="card" style={card} data-testid="own-events">
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{who} events <span style={{ ...small, fontWeight: 400 }}>({mine.length})</span></div>
              {mine.length === 0 ? <div style={{ ...small, fontSize: 12 }}>No events are stored for this session.</div> : (
                <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--b-1)' }}>{['', 'Time', 'Event', 'Team', 'Attributes', 'Mod'].map((h, i) => <th key={i} style={{ padding: '4px 6px', textAlign: 'left', fontSize: 8, fontWeight: 700, color: 'var(--t-3)', textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                    <tbody>{mine.map(e => (
                      <tr key={e.i} data-testid="own-event-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: seekRow === 'own' + e.i ? 'rgba(232,89,12,0.13)' : 'transparent' }}>
                        <td style={{ padding: '3px 4px' }}><button data-testid="own-seek" disabled={!videoReady || !e.ms} title={videoReady ? `Jump to ${msToReadable(e.ms)}` : 'Load your video to jump to this moment'} onClick={() => jump('own' + e.i, e.ms)}
                          style={{ width: 19, height: 19, borderRadius: 4, fontSize: 8, padding: 0, cursor: videoReady && e.ms ? 'pointer' : 'default', background: videoReady ? 'rgba(232,89,12,0.14)' : 'transparent', border: `1px solid ${videoReady ? 'var(--p2)' : 'var(--b-1)'}`, color: videoReady ? 'var(--p2)' : 'var(--b-2)' }}>▶</button></td>
                        <td style={{ padding: '3px 6px', ...mono, color: 'var(--t-3)' }}>{msToReadable(e.ms)}</td>
                        <td style={{ padding: '3px 6px' }} title={e.label}>{e.code}</td>
                        <td style={{ padding: '3px 6px', color: 'var(--t-3)' }}>{e.team}</td>
                        <td style={{ padding: '3px 6px', ...mono, color: 'var(--t-3)' }} title={e.attrs_full}>{e.attrs || '—'}{e.gkNote ? ' ⓘ' : ''}</td>
                        <td style={{ padding: '3px 6px', color: 'var(--t-3)' }}>{e.module}</td>
                      </tr>))}</tbody>
                  </table>
                </div>)}
            </div>
          )}
        </div>
        <div style={{ position: 'sticky', top: 12 }}>
          <LocalVideoDrop ref={videoRef} expectedName={row.video_filename} onChange={setVideoReady}/>
          <div style={{ ...small, marginTop: 8, lineHeight: 1.6 }}>Load the video you tagged this half on. Click ▶ on a row to jump to that moment. Compared status: <b style={{ color: 'var(--t-2)' }}>{STATE_TEXT[row.state]}</b>.</div>
        </div>
      </div>
    </div>
  )
}
