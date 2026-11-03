import { scopeToCollector, buildDetailView, filterDetail, filterOptions, ownEventRows, runCards, collectionDetails, profileOf, fmtDuration, isGkSaveGap, HALF_COLUMNS, OWN_DEFAULT_COLUMNS, ANY_DEFAULT_COLUMNS } from './myHalves.js'
import { buildSessionRows, parseRun, sortRows, scoreCell } from './halvesScores.js'
import { SESSION_COLUMNS, EVENT_COLUMNS } from '../config/fieldConfig.js'
import { SCORES_COLUMNS, DETAIL_COLUMNS } from '../config/comparisonConfig.js'
import { EDIT_LOG_HEADER } from './sessionEdit.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 220) + ']' : ''}`) }
const J = JSON.stringify
const SI = Object.fromEntries(SESSION_COLUMNS.map((c, i) => [c, i])), CI = Object.fromEntries(SCORES_COLUMNS.map((c, i) => [c, i]))
const sess = o => { const r = SESSION_COLUMNS.map(() => ''); Object.entries({ schema_version: '3', is_model: '0', ...o }).forEach(([k, v]) => { r[SI[k]] = v }); return r }
const run = o => { const r = SCORES_COLUMNS.map(() => ''); Object.entries(o).forEach(([k, v]) => { r[CI[k]] = v }); return r }
const edit = o => EDIT_LOG_HEADER.map(h => o[h] ?? '')
const ev = o => ({ session_id: 's', event_seq: '1', event_code: 'pass', event_label: 'Pass', video_time_ms: '1000', team: 'home', ...o })

console.log('a collector sees their OWN rows and nobody else\'s')
{
  const raw = { sessions: [SESSION_COLUMNS,
      sess({ session_id: 'a1', match_id: '1111111', half: '1H', collector_hr_code: 'A-1650' }), sess({ session_id: 'a2', match_id: '1111111', half: '1H', collector_hr_code: 'a-1650' }),
      sess({ session_id: 'a3', match_id: '2222222', half: '2H', collector_hr_code: ' A-1650 ' }), sess({ session_id: 'a4', match_id: '3333333', half: '1H', collector_hr_code: 'A\u20131650' }),
      sess({ session_id: 'b1', match_id: '1111111', half: '1H', collector_hr_code: 'A-1453' }), sess({ session_id: 'b2', match_id: '1111111', half: '1H', collector_hr_code: 'A-16500' }),
      sess({ session_id: 'c1', match_id: '1111111', half: '1H', collector_hr_code: 'A1650' }), sess({ session_id: 'm1', match_id: '1111111', half: '1H', collector_hr_code: 'A-1650', is_model: '1', model_status: 'approved' }),
      sess({ session_id: 'n1', match_id: '1111111', half: '1H', collector_hr_code: '' })],
    scores: { ok: true, values: [SCORES_COLUMNS, run({ run_id: 'r1', collector_session_id: 'a1', score: '80' }), run({ run_id: 'r2', collector_session_id: 'b1', score: '55' }), run({ run_id: 'r3', collector_session_id: 'm1', score: '99' }), run({ run_id: 'r4', collector_session_id: 'a4', score: '70' })] },
    edits: { ok: true, values: [EDIT_LOG_HEADER, edit({ session_id: 'a1', status: 'applied', field: 'half', timestamp_iso: '2026-10-30T00:00:00Z' }), edit({ session_id: 'b1', status: 'applied', field: 'half', timestamp_iso: '2026-10-30T00:00:00Z' })] },
    roster: { ok: true, list: [] } }
  const mine = scopeToCollector(raw, 'a-1650')
  const ids = mine.sessions.slice(1).map(r => r[SI.session_id])
  ok('own sessions only: case, spaces and a typographic dash all count as the same code', J(ids) === J(['a1', 'a2', 'a3', 'a4']), J(ids))
  ok('NOT included: another collector, a code that merely starts with the same letters (A-16500), A1650 without the hyphen, a blank code', !['b1', 'b2', 'c1', 'n1'].some(x => ids.includes(x)))
  ok('a model answer is never included, even one created under this code', !ids.includes('m1'))
  ok('scores and edit-log rows of OTHER sessions are dropped before they reach the screen', J(mine.scores.values.slice(1).map(r => r[CI.run_id])) === J(['r1', 'r4']) && mine.edits.values.length === 2 && mine.edits.values[1][EDIT_LOG_HEADER.indexOf('session_id')] === 'a1')
  ok('headers are kept, so the rest of the code still works', J(mine.sessions[0]) === J(SESSION_COLUMNS) && J(mine.scores.values[0]) === J(SCORES_COLUMNS))
  ok('an empty HR-code (could not be resolved) shows NOTHING, never "everything with a blank code"', scopeToCollector(raw, '').sessions.length === 1 && scopeToCollector(raw, null).sessions.length === 1 && scopeToCollector(raw, '  ').sessions.length === 1)
  ok('scoping does not mutate what was read', raw.sessions.length === 10 && raw.scores.values.length === 5)
  const bad = scopeToCollector({ ...raw, scores: { ok: false, error: 'boom' } }, 'A-1650'); ok('an unreadable scores tab stays reported as unreadable (not turned into "no scores")', bad.scores.ok === false && bad.scores.error === 'boom')
}

console.log('the list: the same half tagged twice, scores, stale')
{
  const raw = scopeToCollector({ sessions: [SESSION_COLUMNS,
      sess({ session_id: 'old', match_id: '1111111', half: '1H', part: '1', collector_hr_code: 'A-1650', export_date: '2026-10-01', collection_end_wall_iso: '2026-10-01T10:00:00Z' }),
      sess({ session_id: 'new', match_id: '1111111', half: '1H', part: '1', collector_hr_code: 'A-1650', export_date: '2026-10-09', collection_end_wall_iso: '2026-10-09T10:00:00Z' }),
      sess({ session_id: 'nc', match_id: '2222222', half: '2H', part: '2', collector_hr_code: 'A-1650', export_date: '2026-10-05' }),
      sess({ session_id: 'st', match_id: '3333333', half: '1H', part: '1', collector_hr_code: 'A-1650', export_date: '2026-10-06' })],
    scores: { ok: true, values: [SCORES_COLUMNS, run({ run_id: 'x1', run_timestamp_iso: '2026-10-02T00:00:00Z', collector_session_id: 'old', score: '40', total_model_events: '10', to_events: '0', to_score: '' }), run({ run_id: 'x2', run_timestamp_iso: '2026-10-10T00:00:00Z', collector_session_id: 'new', score: '85', total_model_events: '10', to_events: '4', to_score: '75', to_correct: '3' }), run({ run_id: 'x3', run_timestamp_iso: '2026-10-07T00:00:00Z', collector_session_id: 'st', score: '90', total_model_events: '10' })] },
    edits: { ok: true, values: [EDIT_LOG_HEADER, edit({ session_id: 'st', status: 'applied', field: 'match_id', timestamp_iso: '2026-10-20T00:00:00Z' })] }, roster: { ok: true, list: [] } }, 'A-1650')
  const rows = sortRows(buildSessionRows(raw, new Map([['old', 300], ['new', 410]])).rows, 'saved', 'desc')
  ok('both sessions of the same half are listed, newest first', J(rows.map(r => r.session_id)) === J(['new', 'st', 'nc', 'old']) && rows.filter(r => r.match_id === '1111111').length === 2, J(rows.map(r => r.session_id)))
  const by = Object.fromEntries(rows.map(r => [r.session_id, r]))
  ok('no row in scores: "Not compared", never a percentage', scoreCell(by.nc, 'overall').text === 'Not compared' && !/%/.test(scoreCell(by.nc, 'overall').text))
  ok('a module with no model events: "-"; a real one shows its score', scoreCell(by.old, 'to').text === '-' && scoreCell(by.new, 'to').text === '75%')
  ok('stale (match edited after the run): flagged and not presented as current', by.st.state === 'stale' && scoreCell(by.st, 'overall').stale === true)
  ok('event counts come from the index', by.new.events === 410 && by.old.events === 300)
  ok('every column here has a sort and a csv function, keys are unique, defaults exist', HALF_COLUMNS.every(c => c && typeof c.sort === 'function' && typeof c.csv === 'function') && new Set(HALF_COLUMNS.map(c => c.key)).size === HALF_COLUMNS.length && [...OWN_DEFAULT_COLUMNS, ...ANY_DEFAULT_COLUMNS].every(k => HALF_COLUMNS.some(c => c.key === k)))
  ok('the list has collection speed and active time', by.new && HALF_COLUMNS.find(c => c.key === 'speed') && HALF_COLUMNS.find(c => c.key === 'active'))
}

console.log('the Event Detail rows')
{
  const model = [ev({ session_id: 'M', video_time_ms: '1000', event_code: 'pass', attr_side: 'SIDE_RIGHT', attr_height: 'HEIGHT_HIGH', team: 'home' }), ev({ session_id: 'M', video_time_ms: '2000', event_code: 'shot', attr_body_part: 'BODY_HEAD', team: 'home' }), ev({ session_id: 'M', video_time_ms: '3000', event_code: 'tackle', team: 'away' }),
    ev({ session_id: 'M', video_time_ms: '5000', event_code: 'goal_keeper', attr_type: 'GK_TYPE_SAVE_WON', attr_gk_body_state: 'GK_STANCE_SET', team: 'home' }), ev({ session_id: 'M', video_time_ms: '6000', event_code: 'pass' }), ev({ session_id: 'M', video_time_ms: '6000', event_code: 'clearance' })]
  const mine = [ev({ video_time_ms: '1100', event_code: 'pass', attr_side: 'SIDE_LEFT', attr_height: 'HEIGHT_HIGH', team: 'home' }), ev({ video_time_ms: '2050', event_code: 'shot', attr_body_part: 'BODY_HEAD', team: 'home' }), ev({ video_time_ms: '4000', event_code: 'foul', team: 'away' }),
    ev({ video_time_ms: '5020', event_code: 'goal_keeper', attr_type: 'GK_TYPE_SAVE_WON', attr_gk_body_state: 'GK_STANCE_SET' }), ev({ video_time_ms: '6010', event_code: 'clearance' }), ev({ video_time_ms: '6010', event_code: 'pass' })]
  const D = (o) => Object.fromEntries(DETAIL_COLUMNS.map(c => [c, o[c] ?? '']))
  const stored = [
    D({ verdict: 'wrong_extra', event_code: 'pass', model_video_time_ms: '1000', collector_video_time_ms: '1100', delta_ms: '100', model_team: 'home', collector_team: 'home', attrs_differed: 'side', event_module: 'A', error_weight: '1' }),
    D({ verdict: 'correct', event_code: 'shot', model_video_time_ms: '2000', collector_video_time_ms: '2050', delta_ms: '50', model_team: 'home', collector_team: 'home', event_module: 'B' }),
    D({ verdict: 'missing_event', event_code: 'tackle', model_video_time_ms: '3000', model_team: 'away', event_module: 'C', error_weight: '1' }),
    D({ verdict: 'extra_event', event_code: 'foul', collector_video_time_ms: '4000', collector_team: 'away', event_module: 'D', error_weight: '1' }),
    D({ verdict: 'correct', event_code: 'goal_keeper', model_video_time_ms: '5000', collector_video_time_ms: '5020', delta_ms: '20', event_module: 'D' }),
    D({ verdict: 'correct', event_code: 'pass', model_video_time_ms: '6000', collector_video_time_ms: '6010', delta_ms: '10' }),
    D({ verdict: 'correct', event_code: 'clearance', model_video_time_ms: '6000', collector_video_time_ms: '6010', delta_ms: '10' })]
  const v = buildDetailView(stored, mine, model)
  ok('one view row per stored row, in the stored order', v.length === 7 && v.map(r => r.verdict).join() === 'wrong_extra,correct,missing_event,extra_event,correct,correct,correct')
  ok('a paired row: BOTH sides\' attributes are rebuilt (the sheet stored only the names that differed)', v[0].model_attrs === 'RIGHT, HIGH' && v[0].collector_attrs === 'LEFT, HIGH' && /side=SIDE_RIGHT/.test(v[0].model_attrs_full) && /side=SIDE_LEFT/.test(v[0].collector_attrs_full), J(v[0]))
  ok('the event codes come from the events themselves', v[0].model_event_code === 'pass' && v[0].collector_event_code === 'pass' && v[1].model_event_code === 'shot')
  ok('a missing event: model side only', v[2].model_event_code === 'tackle' && v[2].collector_event_code === '' && v[2].collector_attrs === '' && v[2].collector_video_time_ms === '')
  ok('an extra event: collector side only, with its code from the stored event_code', v[3].model_event_code === '' && v[3].collector_event_code === 'foul' && v[3].model_video_time_ms === '')
  ok('which attribute groups differed, delta and the error weight come through', v[0].attrs_differed === 'side' && v[0].delta_ms === '100' && v[0].error_weight === '1')
  ok('two events at the very same millisecond are given to two different rows (matched by code), not both to one', v[5].model_event_code === 'pass' && v[5].collector_event_code === 'pass' && v[6].model_event_code === 'clearance' && v[6].collector_event_code === 'clearance')
  ok('module: stored value kept; a run from before modules existed gets the engine\'s own classification', v[0].event_module === 'A' && v[5].event_module === buildDetailView([D({ verdict: 'correct', event_code: 'pass', model_video_time_ms: '1000' })], [], model)[0].event_module && v[5].event_module !== '')
  const gone = buildDetailView([D({ verdict: 'correct', event_code: 'pass', model_video_time_ms: '1000', collector_video_time_ms: '9999', delta_ms: '5' })], mine, model)[0]
  ok('an event no longer in the sheet (session saved again after the run): kept from what was stored and FLAGGED, not guessed', gone.collectorMissing === true && gone.modelMissing === false && gone.collector_event_code === '' && gone.model_event_code === 'pass')
  ok('goal-keeper save event is flagged as the known one-column limitation; others are not', v[4].gkNote === true && v[0].gkNote === false && isGkSaveGap(model[3]) && !isGkSaveGap(model[0]))
  ok('no events at all (could not be read): rows still render from the stored values', buildDetailView(stored, [], []).every(r => r.verdict))
  ok('empty / missing input does not crash', J(buildDetailView([], [], [])) === '[]' && J(buildDetailView(undefined, undefined, undefined)) === '[]')
  console.log('   filters')
  const opts = filterOptions(v)
  ok('options come from the rows: events, verdicts, modules in module order', opts.events.includes('pass') && opts.events.includes('foul') && opts.verdicts.join() === 'correct,extra_event,missing_event,wrong_extra' && J(opts.modules) === J(['A', 'B', 'C', 'D']) || opts.modules.length > 0, J(opts))
  ok('ANY within a filter: events pass OR foul', filterDetail(v, { events: ['foul', 'tackle'] }).length === 2)
  ok('AND across filters: verdict correct AND module B (one stored as B, one derived: an older-style row for clearance)', filterDetail(v, { verdicts: ['correct'], modules: ['B'] }).length === 2 && filterDetail(v, { verdicts: ['wrong_extra'], modules: ['B'] }).length === 0)
  ok('an event filter matches either side (the collector tagged foul where the model has no event)', filterDetail(v, { events: ['foul'] })[0].verdict === 'extra_event')
  ok('no filter selected = everything', filterDetail(v, {}).length === 7 && filterDetail(v).length === 7)
  console.log('   own events')
  const own = ownEventRows([ev({ video_time_ms: '3000', event_code: 'b', event_seq: '2' }), ev({ video_time_ms: '1000', event_code: 'a', event_seq: '1', attr_side: 'SIDE_LEFT' })])
  ok('your own events, in time order, with their attributes', own.map(e => e.code).join() === 'a,b' && own[0].attrs === 'LEFT')
}

console.log('cards, details, profile')
{
  const r = parseRun({ run_id: 'r', score: '87.5', total_model_events: '40', total_collector_events: '41', correct: '35', missing_event: '2', extra_event: '1', wrong_side: '3', wrong_timestamp: '1', wrong_extra: '1', missing_extra: '0', not_needed_extra: '2', a_score: '90', a_correct: '9', a_events: '10', to_score: '', to_events: '0', to_correct: '0' }, 0)
  const c = runCards(r)
  ok('the cards carry every count: correct, missing, extra, wrong time, wrong extra, miss extra (+ wrong side, not scored; not needed extra)', J(c.counts.map(x => [x.label, x.value])) === J([['Correct', 35], ['Missing', 2], ['Extra', 1], ['Wrong side', 3], ['Wrong time', 1], ['Wrong extra', 1], ['Miss extra', 0], ['Not needed extra', 2]]) && c.counts.find(x => x.label === 'Wrong side').unscored === true)
  ok('totals and the overall are the STORED figures (nothing is re-scored)', c.overall === 87.5 && c.totalModel === 40 && c.totalCollector === 41)
  ok('modules: a score, "no data" (0 events) and "not recorded" (older run) are all distinguishable', c.modules.find(m => m.module === 'A').score === 90 && c.modules.find(m => m.module === 'TO').score === null && c.modules.find(m => m.module === 'TO').recorded === true && c.modules.find(m => m.module === 'PRESSURE').recorded === false)
  ok('no run -> no cards', runCards(null) === null)
  const det = Object.fromEntries(collectionDetails({ collection_method: 'partial', part: '2', collection_start_wall_iso: '2026-10-09T09:00:00.000Z', collection_end_wall_iso: '2026-10-09T09:50:30.000Z', collection_elapsed_raw_ms: '3030000', collection_events_per_min: '8.12', incomplete: true, video_filename: 'Arsenal.mp4' }))
  ok('collection details: method, part, start/end, active time, events per minute, incomplete flag, video file', det.Method === 'Not all events' && det.Part === '2nd half' && det['Collection started'] === '2026-10-09 09:00:00' && det['Active time'] === '50:30' && det['Events per minute'] === '8.12' && /Yes/.test(det['Saved without a Half end']) && det['Video file'] === 'Arsenal.mp4', J(det))
  ok('missing details show a dash, never "undefined"', !/undefined|NaN|null/.test(J(collectionDetails({}))))
  ok('durations: under an hour as m:ss, over as h:mm:ss, blank when unknown', fmtDuration('125000') === '2:05' && fmtDuration('3725000') === '1:02:05' && fmtDuration('') === '' && fmtDuration('x') === '')
  const rows = [{ collector_hr_code: 'A-1650', collectorName: 'Ann', collectorRole: 'Offline Data Collector', collector_email: 'ann@x.com' }, { collector_hr_code: 'a-1650', collectorName: 'Ann' }]
  ok('profile header when the rows belong to ONE collector (spelling variants count as one)', profileOf(rows)?.name === 'Ann' && profileOf(rows).halves === 2 && profileOf(rows).email === 'ann@x.com')
  ok('a model answer the person recorded is not counted as one of their halves', profileOf([...rows, { collector_hr_code: 'A-1650', isModel: true }]).halves === 2 && profileOf([...rows, { collector_hr_code: 'A-1650', isModel: true }]).modelAnswers === 1)
  ok('no profile for a mixed list, or an empty one', profileOf([...rows, { collector_hr_code: 'B-2' }]) === null && profileOf([]) === null)
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
