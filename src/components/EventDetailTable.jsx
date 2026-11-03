/**
 * EventDetailTable.jsx — the Comparison "Event Detail" table, read-only, for the My halves screen.
 *
 * Same columns, colours and wording as the table on the Comparison screen (which is inline markup inside that page, so
 * this is a copy, and Comparison is not edited), plus one the Comparison table does not have: which attribute groups
 * differed. It only displays rows that myHalves.buildDetailView made; it can change nothing.
 */
import { MODULE_LABELS } from '../utils/defectTypes'
import { msToReadable } from '../utils/fieldSheetSync'

const VERDICT = {
  correct: ['rgba(48,209,88,0.15)', '#30D158'], missing_event: ['rgba(255,69,58,0.15)', '#FF453A'], extra_event: ['rgba(255,149,0,0.15)', '#FF9500'],
  wrong_side: ['rgba(191,90,242,0.15)', '#BF5AF2'], wrong_timestamp: ['rgba(100,210,255,0.15)', '#64D2FF'], wrong_extra: ['rgba(255,159,10,0.15)', '#FF9F0A'],
  missing_extra: ['rgba(255,69,58,0.1)', '#FF6B6B'],
}
const MODULE_COLOR = { A: '#FF453A', B: '#30D158', C: '#64D2FF', D: '#FFD60A', TO: '#BF5AF2', PRESSURE: '#E8590C' }
const cell = { padding: '3px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const mono = { fontFamily: 'JetBrains Mono,monospace' }

function VerdictBadge({ verdict }) {
  const [bg, color] = VERDICT[verdict] || ['rgba(255,255,255,0.08)', 'var(--t-3)']
  return <span style={{ fontSize: 10, fontWeight: 700, background: bg, color, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}>{verdict}</span>
}

/** The moment to jump to: the collector's time for an extra event, otherwise the model's (as Comparison does). */
export const seekMs = row => (row.verdict === 'extra_event' ? row.collector_video_time_ms : (row.model_video_time_ms || row.collector_video_time_ms))

export default function EventDetailTable({ rows, canSeek, onSeek, seekRow }) {
  const anyShape = rows.some(r => r.model_shape)
  const heads = ['Verdict', 'Model event', 'Model attrs', 'Model time', 'Coll event', 'Coll attrs', 'Coll time', 'Mod', 'Δ', 'Team', anyShape ? 'Shape' : '', 'Attrs that differed']
  return (
    <table data-testid="detail-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: 26 }}/><col style={{ width: 92 }}/><col style={{ width: 104 }}/><col/><col style={{ width: 74 }}/>
        <col style={{ width: 104 }}/><col/><col style={{ width: 74 }}/><col style={{ width: 34 }}/><col style={{ width: 44 }}/>
        <col style={{ width: 52 }}/><col style={{ width: 46 }}/><col style={{ width: 120 }}/>
      </colgroup>
      <thead><tr style={{ borderBottom: '1px solid var(--b-1)' }}>
        <th/>{heads.map((h, i) => <th key={i} style={{ padding: '4px 6px', textAlign: 'left', fontSize: 8, fontWeight: 700, color: 'var(--t-3)', letterSpacing: 0.4, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}
      </tr></thead>
      <tbody>
        {rows.map(row => {
          const codeDiff = row.model_event_code && row.collector_event_code && row.model_event_code !== row.collector_event_code
          const attrDiff = row.model_attrs !== row.collector_attrs && !!(row.model_attrs || row.collector_attrs)
          const teamDiff = row.model_team && row.collector_team && row.model_team !== row.collector_team
          const ms = seekMs(row), has = ms !== '' && ms != null
          const mod = row.event_module
          return (
            <tr key={row.i} data-testid="detail-row" data-verdict={row.verdict}
              style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: seekRow === row.i ? 'rgba(232,89,12,0.13)' : 'transparent', transition: 'background .25s' }}>
              <td style={{ padding: '3px 2px 3px 4px' }}>
                <button data-testid="seek" disabled={!canSeek || !has}
                  title={!canSeek ? 'Load your video to jump to this moment' : !has ? 'No timestamp on this row' : `Jump to ${msToReadable(ms)}`}
                  onClick={e => { onSeek(row, ms); e.currentTarget.closest('tr')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }) }}
                  style={{ width: 19, height: 19, borderRadius: 4, cursor: canSeek && has ? 'pointer' : 'default', fontSize: 8, lineHeight: 1, padding: 0,
                    background: canSeek && has ? 'rgba(232,89,12,0.14)' : 'transparent', border: `1px solid ${canSeek && has ? 'var(--p2)' : 'var(--b-1)'}`,
                    color: canSeek && has ? 'var(--p2)' : 'var(--b-2)' }}>▶</button>
              </td>
              <td style={cell}><VerdictBadge verdict={row.verdict}/></td>
              <td style={{ ...cell, color: 'var(--t-2)' }} title={row.model_event_code}>{row.model_event_code || '—'}</td>
              <td style={{ ...cell, ...mono, color: 'var(--t-3)' }} title={row.model_attrs_full}>{row.model_attrs || '—'}</td>
              <td style={{ ...cell, ...mono, color: 'var(--t-3)' }} title={row.modelMissing ? 'This event is no longer in the sheet (the session was saved again after the comparison)' : ''}>
                {row.model_video_time_ms ? msToReadable(row.model_video_time_ms) : '—'}{row.modelMissing ? ' †' : ''}</td>
              <td style={{ ...cell, fontWeight: codeDiff ? 700 : 400, color: codeDiff ? '#FF453A' : 'var(--t-2)' }} title={row.collector_event_code}>{row.collector_event_code || '—'}</td>
              <td style={{ ...cell, ...mono, color: attrDiff ? '#FF9F0A' : 'var(--t-3)' }} title={row.collector_attrs_full}>
                {row.collector_attrs || '—'}{row.gkNote ? <span title="Goal-keeper save: the body state and the stance share one stored column, so only one of them is kept. Known limitation." style={{ color: 'var(--t-3)' }}> ⓘ</span> : null}</td>
              <td style={{ ...cell, ...mono, color: 'var(--t-3)' }} title={row.collectorMissing ? 'This event is no longer in the sheet (the session was saved again after the comparison)' : ''}>
                {row.collector_video_time_ms ? msToReadable(row.collector_video_time_ms) : '—'}{row.collectorMissing ? ' †' : ''}</td>
              <td style={cell}>{mod && <span title={MODULE_LABELS[mod] || mod} style={{ fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3, color: MODULE_COLOR[mod] || 'var(--t-3)', background: (MODULE_COLOR[mod] || '#888') + '22' }}>{mod === 'PRESSURE' ? 'P' : mod}</span>}</td>
              <td style={{ ...cell, ...mono, color: parseInt(row.delta_ms) > 1000 ? '#FF9500' : 'var(--t-3)' }}>{row.delta_ms === '' || row.delta_ms == null ? '—' : (Number(row.delta_ms) / 1000).toFixed(1) + 's'}</td>
              <td style={{ ...cell, ...mono, color: teamDiff ? '#BF5AF2' : 'var(--t-3)', fontWeight: teamDiff ? 700 : 400 }} title={`model ${row.model_team || '—'} / collector ${row.collector_team || '—'}`}>
                {row.model_team ? row.model_team[0].toUpperCase() : '–'}/{row.collector_team ? row.collector_team[0].toUpperCase() : '–'}</td>
              <td style={{ ...cell, ...mono, color: '#BF5AF2' }}>{row.model_shape || ''}</td>
              <td data-testid="differed" style={{ ...cell, ...mono, color: row.attrs_differed ? '#FF9F0A' : 'var(--t-3)' }} title={row.attrs_differed.split('|').join(', ')}>{row.attrs_differed ? row.attrs_differed.split('|').join(', ') : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
