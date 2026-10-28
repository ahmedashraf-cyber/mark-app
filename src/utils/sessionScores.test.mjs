import {
  parseRun, buildRunIndex, buildEditIndex, isRunStale, buildSessionRows, scoreCell, countCell, COLUMNS, DEFAULT_COLUMNS,
  EMPTY_FILTERS, applyFilters, activeFilterCount, sortRows, averages, toCsv, STATE_TEXT,
} from './sessionScores.js'
import { SESSION_COLUMNS } from '../config/fieldConfig.js'
import { SCORES_COLUMNS } from '../config/comparisonConfig.js'
import { EDIT_LOG_HEADER } from './sessionEdit.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 220) + ']' : ''}`) }
const J = JSON.stringify
const SI = Object.fromEntries(SESSION_COLUMNS.map((c, i) => [c, i])), CI = Object.fromEntries(SCORES_COLUMNS.map((c, i) => [c, i]))
const sess = (o) => { const r = SESSION_COLUMNS.map(() => ''); Object.entries({ schema_version: '3', is_model: '0', collection_incomplete: '0', ...o }).forEach(([k, v]) => { r[SI[k]] = v }); return r }
const run = (o) => { const r = SCORES_COLUMNS.map(() => ''); Object.entries(o).forEach(([k, v]) => { r[CI[k]] = v }); return r }
const edit = (o) => EDIT_LOG_HEADER.map(h => o[h] ?? '')
const MODS = { a_score: '90', a_correct: '9', a_events: '10', b_score: '80', b_correct: '8', b_events: '10', c_score: '70', c_correct: '7', c_events: '10', d_score: '60', d_correct: '6', d_events: '10', to_score: '50', to_correct: '5', to_events: '10', pressure_score: '40', pressure_correct: '4', pressure_events: '10' }
const raw = ({ sessions = [], scores = [], edits = [], roster = [], scoresOk = true, editsOk = true, rosterOk = true } = {}) => ({
  sessions: [SESSION_COLUMNS, ...sessions],
  scores: scoresOk ? { ok: true, values: [SCORES_COLUMNS, ...scores] } : { ok: false, error: 'Read failed (403) on scores' },
  edits: editsOk ? { ok: true, values: [EDIT_LOG_HEADER, ...edits] } : { ok: false, error: 'Read failed (500) on session_edits' },
  roster: rosterOk ? { ok: true, list: roster } : { ok: false, error: 'tab empty' } })
const rowsOf = (r, ev = null) => buildSessionRows(r, ev).rows
const one = (r, id) => rowsOf(r).find(x => x.session_id === id)

console.log('runs: newest per session, joined by SESSION ID')
{
  const R = buildRunIndex([SCORES_COLUMNS,
    run({ run_id: 'r1', run_timestamp_iso: '2026-10-01T10:00:00.000Z', collector_session_id: 's1', model_session_id: 'M1', score: '50' }),
    run({ run_id: 'r3', run_timestamp_iso: '2026-10-03T10:00:00.000Z', collector_session_id: 's1', model_session_id: 'M1', score: '90' }),
    run({ run_id: 'r2', run_timestamp_iso: '2026-10-02T10:00:00.000Z', collector_session_id: 's1', model_session_id: 'M2', score: '70' }),
    run({ run_id: 'rx', run_timestamp_iso: '2026-10-09T10:00:00.000Z', collector_session_id: 's2', model_session_id: 's1', score: '10' })])
  ok('three runs of s1, newest first by TIMESTAMP, not by sheet order', R.get('s1').map(r => r.runId).join() === 'r3,r2,r1', R.get('s1').map(r => r.runId).join())
  ok('a run where s1 was the MODEL is not a run of s1', R.get('s1').length === 3 && R.get('s2').length === 1)
  const tie = buildRunIndex([SCORES_COLUMNS, run({ run_id: 'a', run_timestamp_iso: '2026-10-01T10:00:00.000Z', collector_session_id: 's' }), run({ run_id: 'b', run_timestamp_iso: '2026-10-01T10:00:00.000Z', collector_session_id: 's' })])
  ok('the same timestamp: the later sheet row wins', tie.get('s')[0].runId === 'b')
  const blank = buildRunIndex([SCORES_COLUMNS, run({ run_id: 'a', collector_session_id: 's' }), run({ run_id: 'b', collector_session_id: 's' })])
  ok('no timestamps at all: the later sheet row wins', blank.get('s')[0].runId === 'b')
  const mixed = buildRunIndex([SCORES_COLUMNS, run({ run_id: 'dated', run_timestamp_iso: '2026-10-01T10:00:00.000Z', collector_session_id: 's' }), run({ run_id: 'undated', collector_session_id: 's' })])
  ok('a run with a time beats one with none (undated cannot be shown to be newer)', mixed.get('s')[0].runId === 'dated')
  ok('a scores row with no collector_session_id is ignored', buildRunIndex([SCORES_COLUMNS, run({ run_id: 'z', match_id: '1' })]).size === 0)
  const link = rowsOf(raw({ sessions: [sess({ session_id: 'sB', match_id: '1366067', half: '1H', collector_hr_code: 'C-77' })], scores: [run({ run_id: 'r', run_timestamp_iso: '2026-10-01T00:00:00Z', match_id: '1366067', half: '1H', collector_hr_code: 'C-77', collector_session_id: 'sA', score: '88' })] }))
  ok('same match, half AND HR code but a DIFFERENT session id: NOT linked', link[0].state === 'not_compared' && link[0].runCount === 0)
}

console.log('parsing: blank is not zero')
{
  const r = parseRun({ score: '0', to_score: '', to_events: '0', to_correct: '0', a_score: '0', a_events: '3', a_correct: '0' }, 0)
  ok('a real 0 stays 0 (not null)', r.overall === 0 && r.modules.a.score === 0 && r.modules.a.events === 3)
  ok('a module with 0 events: score null, recorded', r.modules.to.score === null && r.modules.to.recorded === true)
  ok('a module whose cells were never written: not recorded (older run)', r.modules.pressure.recorded === false && r.modules.pressure.score === null)
  ok('a blank overall is null', parseRun({ score: '' }, 0).overall === null)
  ok('junk text is null, not NaN', parseRun({ score: 'abc' }, 0).overall === null)
}

console.log('score cells')
{
  const data = raw({
    sessions: [sess({ session_id: 'sNone', match_id: '1111111', half: '1H' }), sess({ session_id: 'sOK', match_id: '2222222', half: '1H' }), sess({ session_id: 'sMod', match_id: '3333333', half: '1H', is_model: '1', model_status: 'approved' }),
      sess({ session_id: 'sOld', match_id: '4444444', half: '1H' }), sess({ session_id: 'sZero', match_id: '5555555', half: '1H' })],
    scores: [
      run({ run_id: 'r', run_timestamp_iso: '2026-10-01T00:00:00Z', collector_session_id: 'sOK', model_session_id: 'M', score: '87.5', total_model_events: '40', correct: '35', missing_event: '2', extra_event: '1', wrong_timestamp: '1', wrong_extra: '1', missing_extra: '0', ...MODS, to_score: '', to_events: '0', to_correct: '0' }),
      run({ run_id: 'old', run_timestamp_iso: '2026-09-01T00:00:00Z', collector_session_id: 'sOld', model_session_id: 'M', score: '60', total_model_events: '30' }),   // before the module columns existed
      run({ run_id: 'z', run_timestamp_iso: '2026-10-01T00:00:00Z', collector_session_id: 'sZero', model_session_id: 'M', score: '0', total_model_events: '20', ...MODS, a_score: '0', a_correct: '0' })] })
  const none = one(data, 'sNone'), good = one(data, 'sOK'), mod = one(data, 'sMod'), old = one(data, 'sOld'), zero = one(data, 'sZero')
  ok('no scores row -> "Not compared", muted kind, never a percentage', scoreCell(none, 'overall').text === 'Not compared' && scoreCell(none, 'overall').kind === 'notcompared' && !/%/.test(scoreCell(none, 'overall').text))
  ok('...and its module cells are blank, not 0%', ['a', 'b', 'c', 'd', 'to', 'pressure'].every(k => scoreCell(none, k).text === ''))
  ok('a model answer shows "Model answer", not a score', scoreCell(mod, 'overall').text === 'Model answer' && scoreCell(mod, 'to').text === '')
  ok('overall 87.5 -> "87.5%"; whole numbers carry no ".0"', scoreCell(good, 'overall').text === '87.5%' && scoreCell(good, 'a').text === '90%')
  ok('a module with NO model events -> "-", never 0% or 100%', scoreCell(good, 'to').text === '-' && scoreCell(good, 'to').kind === 'nodata')
  ok('a genuine 0% is shown as 0% (so "-" really is different)', scoreCell(zero, 'a').text === '0%' && scoreCell(zero, 'a').kind === 'value')
  ok('an older run with no module breakdown: "-" and flagged as not recorded', scoreCell(old, 'pressure').text === '-' && scoreCell(old, 'pressure').kind === 'norecord' && scoreCell(old, 'overall').text === '60%')
  ok('a module cell carries "n of m correct" for the tooltip', scoreCell(good, 'a').detail === '9 of 10 correct')
  ok('counts come from the run; blank when none', countCell(good, 'correct') === '35' && countCell(good, 'wrongTime') === '1' && countCell(none, 'correct') === '' && countCell(mod, 'correct') === '' && countCell(good, 'missExtra') === '0')
  ok('state names: Compared / Not compared / Model answer', STATE_TEXT.compared === 'Compared' && good.state === 'compared' && none.state === 'not_compared' && mod.state === 'model')
  ok('the model session the run was compared against, and when', good.run.modelSessionId === 'M' && good.run.at === '2026-10-01T00:00:00Z')
}

console.log('the STALE rule')
{
  const base = { sessions: [sess({ session_id: 's', match_id: '1111111', half: '1H' })], scores: [run({ run_id: 'r', run_timestamp_iso: '2026-10-10T12:00:00.000Z', collector_session_id: 's', model_session_id: 'M', score: '80', ...MODS })] }
  const e = (o) => edit({ session_id: 's', status: 'applied', field: 'match_id', old_value: '1', new_value: '2', changed_by: 'mia@x', ...o })
  ok('no edits -> compared', one(raw(base), 's').state === 'compared')
  ok('match_id edited AFTER the run -> stale', one(raw({ ...base, edits: [e({ timestamp_iso: '2026-10-11T00:00:00.000Z' })] }), 's').state === 'stale')
  ok('half edited AFTER the run -> stale', one(raw({ ...base, edits: [e({ field: 'half', timestamp_iso: '2026-10-11T00:00:00.000Z' })] }), 's').state === 'stale')
  ok('edited BEFORE the run -> still compared (the run saw the corrected value)', one(raw({ ...base, edits: [e({ timestamp_iso: '2026-10-09T00:00:00.000Z' })] }), 's').state === 'compared')
  ok('edit at the very same instant is not "after"', one(raw({ ...base, edits: [e({ timestamp_iso: '2026-10-10T12:00:00.000Z' })] }), 's').state === 'compared')
  ok('a "NOT APPLIED" log row changed nothing -> not stale', one(raw({ ...base, edits: [e({ timestamp_iso: '2026-10-11T00:00:00.000Z', status: 'NOT APPLIED' })] }), 's').state === 'compared')
  ok('a part-only log row does not make it stale', one(raw({ ...base, edits: [e({ field: 'part', timestamp_iso: '2026-10-11T00:00:00.000Z' })] }), 's').state === 'compared')
  ok("another session's edit does not make this one stale", one(raw({ ...base, edits: [e({ session_id: 'other', timestamp_iso: '2026-10-11T00:00:00.000Z' })] }), 's').state === 'compared')
  const rr = one(raw({ ...base, edits: [e({ timestamp_iso: '2026-10-11T00:00:00.000Z' })] }), 's')
  ok('stale cells keep their numbers but are flagged, and the state text is "Stale, match changed"', scoreCell(rr, 'overall').stale === true && scoreCell(rr, 'overall').text === '80%' && STATE_TEXT.stale === 'Stale, match changed')
  ok('the session is flagged "edited" and its latest run is stale', rr.edited === true && rr.run.stale === true)
  ok('a run with NO readable time cannot be proved current: any match/half edit makes it stale', one(raw({ sessions: base.sessions, scores: [run({ run_id: 'r', collector_session_id: 's', score: '80' })], edits: [e({ timestamp_iso: '2026-10-01T00:00:00.000Z' })] }), 's').state === 'stale')
  // edit, THEN a newer run -> the newest is current again; an older run stays stale
  const two = one(raw({ sessions: base.sessions, scores: [...base.scores, run({ run_id: 'r2', run_timestamp_iso: '2026-10-12T12:00:00.000Z', collector_session_id: 's', score: '85', ...MODS })], edits: [e({ timestamp_iso: '2026-10-11T00:00:00.000Z' })] }), 's')
  ok('edit then a newer run: the session is compared again; the earlier run is individually stale', two.state === 'compared' && two.run.runId === 'r2' && two.runs[1].stale === true && two.runs[0].stale === false)
  ok('unreadable edit log: not claimed stale-free; the note says why', buildSessionRows(raw({ ...base, editsOk: false })).notes.some(n => n.source === 'session_edits' && /500/.test(n.message)))
}

console.log('several runs, models, roster, unreadable sources')
{
  const data = raw({
    sessions: [sess({ session_id: 'm1', match_id: '1111111', half: '1H', is_model: '1', model_status: 'approved', collector_hr_code: 'C-1' }), sess({ session_id: 'm2', match_id: '2222222', half: '2H', is_model: '1', model_status: 'draft' }),
      sess({ session_id: 'm3', match_id: '3333333', half: 'ET1', is_model: '1', model_status: '' }),
      sess({ session_id: 'c1', match_id: '1111111', half: '1H', collector_hr_code: 'c-77', collector_email: 'Cal@x.com' }), sess({ session_id: 'c2', match_id: '2222222', half: '2H', collector_hr_code: 'C-12', collector_email: 'who@x.com' }), sess({ session_id: 'c3', match_id: '3333333', half: 'ET1', collector_hr_code: 'ZZ' })],
    scores: [run({ run_id: 'a', run_timestamp_iso: '2026-10-01T00:00:00Z', collector_session_id: 'c1', score: '10' }), run({ run_id: 'b', run_timestamp_iso: '2026-10-02T00:00:00Z', collector_session_id: 'c1', score: '20' }), run({ run_id: 'c', run_timestamp_iso: '2026-10-03T00:00:00Z', collector_session_id: 'c1', score: '30' })],
    roster: [{ code: 'C-77', name: 'Cal Collector', role: 'Offline Data Collector', email: 'cal@x.com' }, { code: 'C-99', name: 'Wendy', role: 'Batch Manager', email: 'who@x.com' }] })
  const c1 = one(data, 'c1')
  ok('three runs: shows the newest, runCount 3, the earlier two listed', c1.runCount === 3 && c1.run.runId === 'c' && c1.runs.slice(1).map(r => r.runId).join() === 'b,a' && scoreCell(c1, 'overall').text === '30%')
  ok('model answer exists for a match+half: approved counts, blank status counts, draft does not', one(data, 'c1').hasModel === true && one(data, 'c2').hasModel === false && one(data, 'c3').hasModel === true)
  ok('collector name and role come from the roster by HR code (case/space-insensitive)', c1.collectorName === 'Cal Collector' && c1.collectorRole === 'Offline Data Collector')
  ok('...falling back to the email when the HR code is not on the roster', one(data, 'c2').collectorName === 'Wendy')
  ok('unknown collector: blank, not "undefined"', one(data, 'c3').collectorName === '' && one(data, 'c3').collectorRole === '')
  const bad = buildSessionRows(raw({ sessions: [sess({ session_id: 'x', match_id: '1111111', half: '1H' })], scoresOk: false, rosterOk: false }))
  ok('scores unreadable: the state is "unknown" ("Scores unavailable"), NEVER "Not compared"', bad.rows[0].state === 'unknown' && scoreCell(bad.rows[0], 'overall').text === 'Scores unavailable')
  ok('every unreadable source is reported with its real error', bad.notes.map(n => n.source).sort().join() === 'roster,scores' && /403/.test(bad.notes.find(n => n.source === 'scores').message))
  ok('rows with no session id are skipped (blank lines)', rowsOf(raw({ sessions: [sess({ session_id: '', match_id: '1111111' })] })).length === 0)
}

console.log('filters (all together, AND)')
{
  const data = raw({
    sessions: [
      sess({ session_id: 'a', match_id: '1111111', half: '1H', part: '1', collector_hr_code: 'C-1', collector_email: 'a@x.com', collection_method: 'all', video_filename: 'Arsenal_Chelsea.mp4', export_date: '2026-10-05', collection_incomplete: '0' }),
      sess({ session_id: 'b', match_id: '1111111', half: '2H', part: '2', collector_hr_code: 'C-1', collector_email: 'a@x.com', collection_method: 'partial', video_filename: 'Arsenal_Chelsea_2.mp4', export_date: '2026-10-10', collection_incomplete: '1' }),
      sess({ session_id: 'c', match_id: '2222222', half: '1H', part: '1', collector_hr_code: 'C-2', collector_email: 'b@x.com', collection_method: '', video_filename: 'Inter.mp4', export_date: '2026-10-20' }),
      sess({ session_id: 'd', match_id: '2222222', half: '1H', part: '1', collector_hr_code: 'C-3', collector_email: 'c@x.com', collection_method: 'all', video_filename: 'Inter2.mp4', export_date: '2026-10-25' }),
      sess({ session_id: 'm', match_id: '1111111', half: '1H', part: '1', collector_hr_code: 'C-9', is_model: '1', model_status: 'approved', export_date: '2026-09-01' })],
    scores: [
      run({ run_id: '1', run_timestamp_iso: '2026-10-06T00:00:00Z', collector_session_id: 'a', score: '90', ...MODS }),
      run({ run_id: '2', run_timestamp_iso: '2026-10-11T00:00:00Z', collector_session_id: 'b', score: '40', ...MODS, to_score: '', to_events: '0', pressure_score: '20' }),
      run({ run_id: '3', run_timestamp_iso: '2026-10-21T00:00:00Z', collector_session_id: 'c', score: '70', ...MODS, pressure_events: '0', pressure_score: '' })],
    edits: [edit({ timestamp_iso: '2026-10-30T00:00:00Z', session_id: 'c', status: 'applied', field: 'match_id', old_value: '1', new_value: '2', changed_by: 'mia' })],
    roster: [{ code: 'C-1', name: 'Ann Alpha', role: 'Offline Data Collector', email: 'a@x.com' }, { code: 'C-2', name: 'Bob Beta', role: 'Offline Quality Reviewer', email: 'b@x.com' }, { code: 'C-3', name: 'Cy Gamma', role: 'Offline Data Collector', email: 'c@x.com' }] })
  const rows = rowsOf(data, new Map([['a', 800], ['b', 120], ['c', 500], ['d', 40]]))
  const F = (o) => applyFilters(rows, { ...EMPTY_FILTERS, ...o }).map(r => r.session_id).sort().join('')
  ok('no filters: everything', F({}) === 'abcdm')
  ok('search: match id / session id / HR code / collector NAME / email', F({ q: '2222222' }) === 'cd' && F({ q: 'd' }).includes('d') && F({ q: 'c-1' }) === 'ab' && F({ q: 'ann alp' }) === 'ab' && F({ q: 'b@x' }) === 'c')
  ok('match id: several at once (comma or space)', F({ matchIds: '1111111' }) === 'abm' && F({ matchIds: '1111111, 2222222' }) === 'abcdm' && F({ matchIds: '999' }) === '')
  ok('half / part (multi-select)', F({ halves: ['2H'] }) === 'b' && F({ halves: ['1H', '2H'] }) === 'abcdm' && F({ parts: ['2'] }) === 'b')
  ok('collector HR code(s)', F({ hrCodes: 'c-1' }) === 'ab' && F({ hrCodes: 'C-2 C-3' }) === 'cd')
  ok('collector role', F({ roles: ['Offline Quality Reviewer'] }) === 'c' && F({ roles: ['Offline Data Collector'] }) === 'abd')
  ok('model answer or collector session', F({ types: ['model'] }) === 'm' && F({ types: ['collector'] }) === 'abcd')
  ok('compared status: compared / not compared / stale / model', F({ status: ['compared'] }) === 'ab' && F({ status: ['not_compared'] }) === 'd' && F({ status: ['stale'] }) === 'c' && F({ status: ['model'] }) === 'm')
  ok('collection method (blank = "none")', F({ methods: ['all'] }) === 'ad' && F({ methods: ['partial'] }) === 'b' && F({ methods: ['none'] }) === 'cm')
  ok('Overall min/max (stale and not-compared rows are out of any range)', F({ overallMin: '50' }) === 'a' && F({ overallMax: '50' }) === 'b' && F({ overallMin: '30', overallMax: '95' }) === 'ab')
  ok('Pressure range', F({ pressureMax: '30' }) === 'b' && F({ pressureMin: '30' }) === 'a')
  ok('TO range excludes a session whose TO is "-" (no data) rather than treating it as 0', F({ toMax: '100' }) === 'a' && F({ toMin: '0' }) === 'a')
  ok('module has data: only sessions whose run had model events for TO / Pressure (b has no TO events; c has no Pressure events but is stale)', F({ hasTO: true }) === 'a' && F({ hasPressure: true }) === 'ab' && F({ hasTO: true, hasPressure: true }) === 'a')
  ok('save date range, inclusive both ends', F({ from: '2026-10-05', to: '2026-10-10' }) === 'ab' && F({ from: '2026-10-11' }) === 'cd' && F({ to: '2026-09-30' }) === 'm')
  ok('has a model answer for that match+half (only 1111111 1H has one)', F({ hasModel: ['yes'] }) === 'am' && F({ hasModel: ['no'] }) === 'bcd')
  ok('flags: incomplete (no Half end), edited by Admin', F({ flags: ['incomplete'] }) === 'b' && F({ flags: ['edited'] }) === 'c' && F({ flags: ['incomplete', 'edited'] }) === '')
  ok('video file name contains', F({ video: 'chelsea' }) === 'ab' && F({ video: 'inter2' }) === 'd')
  ok('number of events min/max (a session with no rows in field_events has 0 events)', F({ eventsMin: '400' }) === 'ac' && F({ eventsMax: '100' }) === 'dm' && F({ eventsMin: '100', eventsMax: '600' }) === 'bc')
  ok('events not loaded yet (null): an events filter does not match, instead of guessing', applyFilters(rowsOf(data), { ...EMPTY_FILTERS, eventsMin: '1' }).length === 0)
  ok('ALL filters work together (AND)', F({ matchIds: '1111111', halves: ['1H'], status: ['compared'], overallMin: '80', hrCodes: 'C-1', methods: ['all'], flags: [] }) === 'a' && F({ matchIds: '1111111', halves: ['2H'], status: ['compared'], overallMin: '80' }) === '')
  ok('"Clear all" is a return to EMPTY_FILTERS and counts what is active', activeFilterCount(EMPTY_FILTERS) === 0 && activeFilterCount({ ...EMPTY_FILTERS, q: 'x', halves: ['1H'], hasTO: true, overallMin: '5' }) === 4 && F({}) === 'abcdm')
}

console.log('sort')
{
  const data = raw({ sessions: [
    sess({ session_id: 'old', match_id: '1111111', half: '1H', export_date: '2026-10-01', collection_end_wall_iso: '2026-10-01T09:00:00Z' }),
    sess({ session_id: 'new', match_id: '2222222', half: '1H', export_date: '2026-10-09', collection_end_wall_iso: '2026-10-09T09:00:00Z' }),
    sess({ session_id: 'mid', match_id: '3333333', half: '1H', export_date: '2026-10-05', collection_end_wall_iso: '2026-10-05T09:00:00Z' }),
    sess({ session_id: 'nc', match_id: '4444444', half: '1H', export_date: '2026-10-06' })],
    scores: [run({ run_id: '1', run_timestamp_iso: '2026-10-02T00:00:00Z', collector_session_id: 'old', score: '30' }), run({ run_id: '2', run_timestamp_iso: '2026-10-10T00:00:00Z', collector_session_id: 'new', score: '95' }), run({ run_id: '3', run_timestamp_iso: '2026-10-06T00:00:00Z', collector_session_id: 'mid', score: '60' })] })
  const rows = rowsOf(data); const ids = (k, d) => sortRows(rows, k, d).map(r => r.session_id).join()
  ok('default (Saved, newest first)', ids('saved', 'desc') === 'new,nc,mid,old', ids('saved', 'desc'))
  ok('Saved ascending reverses it', ids('saved', 'asc') === 'old,mid,nc,new')
  ok('numeric column sorts as numbers (95 > 60 > 30), not as text', ids('overall', 'desc').startsWith('new,mid,old') && ids('overall', 'asc').startsWith('old,mid,new'))
  ok('a session with no score goes LAST in both directions', ids('overall', 'desc').endsWith('nc') && ids('overall', 'asc').endsWith('nc'))
  ok('text column sorts alphabetically; match id sorts numerically-aware', ids('match', 'asc') === 'old,new,mid,nc')
  ok('sorting does not change the rows themselves', rows.length === 4 && sortRows(rows, 'overall', 'desc') !== rows)
  ok('every column has a sort and a csv function', COLUMNS.every(c => typeof c.sort === 'function' && typeof c.csv === 'function' && c.key && c.label))
  ok('the default columns are the ones you asked for', DEFAULT_COLUMNS.join() === 'match,half,collector,method,events,overall,to,pressure,status', DEFAULT_COLUMNS.join())
}

console.log('averages (stale excluded)')
{
  const data = raw({ sessions: ['ok1', 'ok2', 'st', 'nc', 'mo'].map((id, i) => sess({ session_id: id, match_id: String(1000000 + i), half: '1H', is_model: id === 'mo' ? '1' : '0', model_status: id === 'mo' ? 'approved' : '' })),
    scores: [run({ run_id: '1', run_timestamp_iso: '2026-10-01T00:00:00Z', collector_session_id: 'ok1', score: '80', ...MODS, to_score: '0', to_correct: '0' }), run({ run_id: '2', run_timestamp_iso: '2026-10-01T00:00:00Z', collector_session_id: 'ok2', score: '60', ...MODS, to_score: '', to_events: '0' }),
      run({ run_id: '3', run_timestamp_iso: '2026-10-01T00:00:00Z', collector_session_id: 'st', score: '10', ...MODS })],
    edits: [edit({ timestamp_iso: '2026-10-05T00:00:00Z', session_id: 'st', status: 'applied', field: 'half' })] })
  const av = averages(rowsOf(data))
  ok('overall = mean of the two compared sessions only: the stale 10 is NOT in it', av.overall.mean === 70 && av.overall.n === 2 && av.sessions === 2, J(av.overall))
  ok('a module with no data ("-") is skipped, not averaged as 0: TO has one value (0)', av.to.n === 1 && av.to.mean === 0, J(av.to))
  ok('a genuine 0 IS averaged', averages(rowsOf(data)).to.mean === 0)
  ok('nothing compared -> mean null, n 0, no NaN', averages([]).overall.mean === null && averages([]).overall.n === 0)
}

console.log('CSV')
{
  const data = raw({ sessions: [sess({ session_id: 'ok', match_id: '1111111', half: '1H', collector_hr_code: 'C-1', video_filename: 'a, "b".mp4', home_team_name: 'Arsenal', away_team_name: 'Chelsea' }), sess({ session_id: 'st', match_id: '2222222', half: '1H', collector_hr_code: 'C-2' }), sess({ session_id: 'nc', match_id: '3333333', half: '1H' }), sess({ session_id: 'mo', match_id: '4444444', half: '1H', is_model: '1', model_status: 'approved' })],
    scores: [run({ run_id: '1', run_timestamp_iso: '2026-10-01T00:00:00Z', collector_session_id: 'ok', model_session_id: 'M', score: '88.5', total_model_events: '40', correct: '35', ...MODS }), run({ run_id: '2', run_timestamp_iso: '2026-10-01T00:00:00Z', collector_session_id: 'st', model_session_id: 'M', score: '77', total_model_events: '40', correct: '30', ...MODS })],
    edits: [edit({ timestamp_iso: '2026-10-05T00:00:00Z', session_id: 'st', status: 'applied', field: 'match_id' })] })
  const rows = rowsOf(data), csv = toCsv(rows)
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean)
  ok('starts with a UTF-8 BOM (so Excel reads names correctly)', csv.charCodeAt(0) === 0xFEFF)
  ok('one header + one line per row passed in (the filtered rows)', lines.length === 5 && toCsv(rows.slice(0, 2)).split('\r\n').filter(Boolean).length === 3)
  ok('EVERY column is in the file, hidden ones included', lines[0].split(',').length >= COLUMNS.length && ['Overall', 'Pressure', 'Run time', 'Compared against', 'Correct', 'Wrong time', 'Miss extra', 'Model events', 'Session ID'].every(h => lines[0].includes(h)))
  ok('commas and quotes in a value are escaped', csv.includes('"a, ""b"".mp4"'))
  const col = k => COLUMNS.findIndex(c => c.key === k)
  const cells = id => { const r = rows.find(x => x.session_id === id); return COLUMNS.map(c => c.csv(r)) }
  ok('a compared session exports its numbers and the model it was compared against', cells('ok')[col('overall')] === '88.5' && cells('ok')[col('modelSession')] === 'M' && cells('ok')[col('runAt')] === '2026-10-01T00:00:00Z' && cells('ok')[col('correct')] === '35')
  ok('a STALE run exports NO numbers (excluded as agreed) and says why', cells('st')[col('overall')] === '' && cells('st')[col('to')] === '' && cells('st')[col('correct')] === '' && cells('st')[col('modelSession')] === '' && cells('st')[col('status')] === 'Stale, match changed')
  ok('not compared and model rows: blank scores, the status says what they are (never 0)', cells('nc')[col('overall')] === '' && cells('nc')[col('status')] === 'Not compared' && cells('mo')[col('overall')] === '' && cells('mo')[col('status')] === 'Model answer')
  ok('no cell anywhere says NaN / undefined / null', !/NaN|undefined|null/.test(csv))
}

console.log('speed')
{
  const mk = n => {
    const sessions = [], scores = [], edits = []
    for (let i = 0; i < n; i++) {
      const sid = 's' + i
      sessions.push(sess({ session_id: sid, match_id: String(1000000 + (i % 400)), half: ['1H', '2H', 'ET1'][i % 3], part: String(1 + (i % 3)), collector_hr_code: 'C-' + (i % 120), collector_email: `u${i % 120}@x.com`, collection_method: i % 2 ? 'all' : 'partial', video_filename: `match_${i}.mp4`, export_date: `2026-${String(1 + (i % 10)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, collection_incomplete: i % 17 === 0 ? '1' : '0', is_model: i % 50 === 0 ? '1' : '0', model_status: i % 50 === 0 ? 'approved' : '' }))
      if (i % 50 !== 0) { for (let k = 0; k < 2; k++) scores.push(run({ run_id: sid + k, run_timestamp_iso: `2026-10-${String(1 + k).padStart(2, '0')}T00:00:00Z`, collector_session_id: sid, model_session_id: 'M', score: String(40 + (i % 60)), total_model_events: '40', ...MODS })) }
      if (i % 9 === 0) edits.push(edit({ timestamp_iso: '2026-10-20T00:00:00Z', session_id: sid, status: 'applied', field: 'match_id' }))
    }
    const roster = Array.from({ length: 120 }, (_, i) => ({ code: 'C-' + i, name: 'Person ' + i, role: i % 5 ? 'Offline Data Collector' : 'Offline Quality Reviewer', email: `u${i}@x.com` }))
    return raw({ sessions, scores, edits, roster })
  }
  const T = (fn) => { const t = performance.now(); const v = fn(); return [performance.now() - t, v] }
  for (const n of [1000, 5000, 20000]) {
    const d = mk(n)
    const [tb, built] = T(() => buildSessionRows(d, new Map(d.sessions.slice(1).map((r, i) => ['s' + i, 100 + (i % 900)]))))
    const rows = built.rows
    const [tf, f] = T(() => applyFilters(rows, { ...EMPTY_FILTERS, q: 'person 1', halves: ['1H', '2H'], status: ['compared'], overallMin: '50', hasTO: true, from: '2026-02-01' }))
    const [ts, sorted] = T(() => sortRows(f.length ? f : rows, 'overall', 'desc'))
    const [tall, sortedAll] = T(() => sortRows(rows, 'saved', 'desc'))
    const [tc, csv] = T(() => toCsv(sortedAll))
    const [ta] = T(() => averages(rows))
    console.log(`    ${String(n).padStart(6)} sessions: join ${tb.toFixed(0)} ms | filter ${tf.toFixed(1)} ms (${f.length} rows) | sort ${tall.toFixed(0)} ms | averages ${ta.toFixed(1)} ms | CSV ${tc.toFixed(0)} ms (${(csv.length / 1e6).toFixed(1)} MB)`)
    ok(`${n}: join < ${n >= 20000 ? 2000 : 600} ms (once, when the tab opens); filter + sort stay interactive (< 300 ms); CSV < 2 s`, tb < (n >= 20000 ? 2000 : 600) && tf + ts < 300 && tall < 300 && tc < 2000, `join ${tb} filter ${tf} sort ${tall} csv ${tc}`)
    ok(`${n}: rows are all there and rows with a stale run were found`, rows.length === n && rows.some(r => r.state === 'stale'))
  }
}

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
