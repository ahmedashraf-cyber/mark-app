// halvesCompare.js + the Halves rows it reads (halvesScores.buildSessionRows). SYNTHETIC sheets only; the rows go through the real join.
import { buildSessionRows } from './halvesScores.js'
import { canCompareHalves, compareAction, makePreset, isValidPreset, returnFocus, candidateLabel, describeRun, MSG } from './halvesCompare.js'
import { SCORES_COLUMNS, ALGORITHM_VERSION, TOLERANCE_CONFIG_VERSION } from '../config/comparisonConfig.js'
import { EDIT_LOG_HEADER } from './sessionEdit.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 260) + ']' : ''}`) }
const J = JSON.stringify

const SESS_H = ['session_id', 'match_id', 'half', 'is_model', 'model_status', 'model_version', 'model_source', 'collector_hr_code', 'collector_email', 'export_date', 'collection_end_wall_iso']
const sess = (o) => SESS_H.map(h => o[h] ?? '')
const run = (o) => SCORES_COLUMNS.map(h => o[h] ?? '')
const model = (id, match, half, extra = {}) => sess({ session_id: id, match_id: match, half, is_model: '1', model_status: 'approved', model_version: '1', model_source: 'tag', export_date: '2026-10-01', ...extra })
const coll = (id, match, half, code, extra = {}) => sess({ session_id: id, match_id: match, half, is_model: '0', collector_hr_code: code, collector_email: code.toLowerCase() + '@x.com', export_date: '2026-11-01', ...extra })
const score = (rid, collId, modelId, algo, at, overall = '47.2', extra = {}) => run({ run_id: rid, run_timestamp_iso: at, collector_session_id: collId, model_session_id: modelId, algorithm_version: algo, tolerance_config_version: '2', score: overall, ...extra })
const build = ({ sessions, scores = [], edits = [], scoresOk = true }) => buildSessionRows({
  sessions: [SESS_H, ...sessions], scores: scoresOk ? { ok: true, values: [SCORES_COLUMNS, ...scores] } : { ok: false, error: 'HTTP 403' },
  edits: { ok: true, values: [EDIT_LOG_HEADER, ...edits] }, roster: { ok: true, list: [] } }).rows
const byId = rows => Object.fromEntries(rows.map(r => [r.session_id, r]))
const CAPS = { halvesCompare: true, comparison: true, scout: true }
const CUR = { algorithm: ALGORITHM_VERSION, tolerance: TOLERANCE_CONFIG_VERSION }

console.log('who may see it')
ok('both permissions are needed: halvesCompare AND comparison', canCompareHalves(CAPS) && !canCompareHalves({ ...CAPS, comparison: false }) && !canCompareHalves({ ...CAPS, halvesCompare: false }) && !canCompareHalves({}) && !canCompareHalves(null) && !canCompareHalves(undefined))
const rowsA = build({ sessions: [model('M1', '1307828', '2H'), coll('C1', '1307828', '2H', 'A-2286')] }), A = byId(rowsA)
ok('a role without the permission sees NO button at all, on a half that would otherwise have one', compareAction(A.C1, { ...CAPS, halvesCompare: false }).show === false && compareAction(A.C1, { ...CAPS, comparison: false }).show === false && compareAction(A.C1, {}).show === false && compareAction(A.C1, undefined).show === false)
ok('a Model answer row never has a button, even for a role that has the permission', compareAction(A.M1, CAPS).show === false && A.M1.state === 'model')

console.log('\na half with no run (like 1307828 2H, "Not compared")')
{
  const a = compareAction(A.C1, CAPS)
  ok('label "Compare", enabled, one candidate model, no stored run', a.show && a.label === 'Compare' && !a.disabled && a.candidates.length === 1 && a.candidates[0].sessionId === 'M1' && a.existing === null && A.C1.state === 'not_compared', J([a.label, a.disabled, a.existing]))
  ok('the tooltip says nothing is written until the user presses Write Results to Sheet', /Nothing is written until you press "Write Results to Sheet"/.test(a.hint))
}

console.log('\na half with an OLD algorithm-7 run (like 1458560 1H)')
{
  const rows = build({ sessions: [model('M2', '1458560', '1H'), coll('C2', '1458560', '1H', 'A-2181')], scores: [score('run_1', 'C2', 'M2', '7', '2026-10-10T10:00:00Z', '47.2')] }), C2 = byId(rows).C2
  const a = compareAction(C2, CAPS)
  ok('label "Recompare", enabled', a.label === 'Recompare' && !a.disabled && C2.state === 'compared')
  ok('it shows WHICH algorithm the existing result used: 7, and that it is not the current one', a.existing.algorithm === '7' && a.existing.current === false && a.existing.score === 47.2 && a.existing.modelSessionId === 'M2' && /algorithm 7/.test(a.hint) && new RegExp(`current one is ${ALGORITHM_VERSION}`).test(a.hint) && /a new run can be written/.test(a.hint), a.hint)
}

console.log('\nthe stored run is already on the CURRENT algorithm')
{
  const rows = build({ sessions: [model('M3', '1', '1H'), coll('C3', '1', '1H', 'A-3')], scores: [score('r', 'C3', 'M3', ALGORITHM_VERSION, '2026-11-20T10:00:00Z', '99.5')] }), C3 = byId(rows).C3, a = compareAction(C3, CAPS)
  ok('same algorithm and the same model: still "Recompare", but it says the result will be the same and nothing new would be written', a.label === 'Recompare' && a.existing.current === true && /nothing new would be written/.test(a.hint), a.hint)
  const rows2 = build({ sessions: [model('M3b', '1', '1H'), coll('C3', '1', '1H', 'A-3')], scores: [score('r', 'C3', 'M3-OLD', ALGORITHM_VERSION, '2026-11-20T10:00:00Z')] }), a2 = compareAction(byId(rows2).C3, CAPS)
  ok('same algorithm but the stored run was against a DIFFERENT model answer: a new run can be written', /different model answer/.test(a2.hint) && /a new run can be written/.test(a2.hint), a2.hint)
  const rows3 = build({ sessions: [model('M3', '1', '1H'), coll('C3', '1', '1H', 'A-3')], scores: [score('r', 'C3', 'M3', '', '2026-11-20T10:00:00Z')] }), a3 = compareAction(byId(rows3).C3, CAPS)
  ok('a run that did not record its algorithm is treated as older, and the tooltip says so', a3.existing.recorded === false && a3.existing.current === false && /did not record its algorithm/.test(a3.hint), a3.hint)
}

console.log('\nseveral runs for one collector session: the NEWEST decides (the 7.12.35 Insights rule)')
{
  const rows = build({ sessions: [model('M4', '1', '1H'), coll('C4', '1', '1H', 'A-4')], scores: [
    score('r_new', 'C4', 'M4', ALGORITHM_VERSION, '2026-11-20T10:00:00Z', '99.5'), score('r_old', 'C4', 'M4', '7', '2026-10-01T10:00:00Z', '47.2')] }), C4 = byId(rows).C4   // the NEWER run is listed FIRST in the sheet
  ok('2 runs: label "Recompare", and the algorithm shown is the newest run\'s (current), not the older 7', C4.runCount === 2 && compareAction(C4, CAPS).label === 'Recompare' && compareAction(C4, CAPS).existing.algorithm === ALGORITHM_VERSION && compareAction(C4, CAPS).existing.runId === 'r_new')
}

console.log('\nstale, unreadable and malformed rows')
{
  const rows = build({ sessions: [model('M5', '5', '1H'), coll('C5', '5', '1H', 'A-5')], scores: [score('r', 'C5', 'M5', '7', '2026-10-01T10:00:00Z')],
    edits: [EDIT_LOG_HEADER.map(h => ({ session_id: 'C5', timestamp_iso: '2026-10-15T10:00:00Z', field: 'match_id', status: 'applied' })[h] ?? '')] }), C5 = byId(rows).C5, a = compareAction(C5, CAPS)
  ok('"stale" (the match was edited after the run) gets "Recompare" and the tooltip says why', C5.state === 'stale' && a.label === 'Recompare' && !a.disabled && /edited after that run/.test(a.hint) && a.existing.stale === true, J([C5.state, a.hint]))
  const u = byId(build({ sessions: [model('M6', '6', '1H'), coll('C6', '6', '1H', 'A-6')], scoresOk: false })).C6, au = compareAction(u, CAPS)
  ok('scores UNREADABLE: the button is shown but disabled, with a message that says so', u.state === 'unknown' && au.show && au.disabled && au.reason === MSG.unknown, J(au))
  const noIds = compareAction({ ...A.C1, match_id: '' }, CAPS), noHalf = compareAction({ ...A.C1, half: '' }, CAPS), noSid = compareAction({ ...A.C1, session_id: '' }, CAPS)
  ok('a row with no match id, half or session id is disabled with a readable message, not a TypeError', [noIds, noHalf, noSid].every(x => x.show && x.disabled && x.reason === MSG.noIds))
  const noScout = compareAction(A.C1, { ...CAPS, scout: false })
  ok('Comparison\'s route needs Scout access: without it the button is DISABLED and says why, not a click that goes nowhere', noScout.show && noScout.disabled && noScout.reason === MSG.noScout)
}

console.log('\nwhich model: none, one, several')
{
  const none = byId(build({ sessions: [coll('C7', '7', '2H', 'A-7')] })).C7, an = compareAction(none, CAPS)
  ok('NO model for this match+half: disabled, "No approved model answer for this half"', an.show && an.disabled && an.reason === 'No approved model answer for this half' && an.candidates.length === 0)
  const other = byId(build({ sessions: [model('MX', '7', '1H'), coll('C7', '7', '2H', 'A-7')] })).C7
  ok('a model for the OTHER half of the match does not count', compareAction(other, CAPS).disabled === true && compareAction(other, CAPS).reason === MSG.noModel)
  const two = byId(build({ sessions: [model('MA', '8', '1H', { model_version: '1' }), model('MB', '8', '1H', { model_version: '3', model_source: 'tag editor' }), coll('C8', '8', '1H', 'A-8')] })).C8, a2 = compareAction(two, CAPS)
  ok('TWO approved models: both are offered, in sheet order, and the button is enabled so the user can choose (nothing is guessed)', !a2.disabled && a2.candidates.length === 2 && J(a2.candidates.map(c => c.sessionId)) === J(['MA', 'MB']) && a2.candidates[1].modelVersion === '3')
  const mix = byId(build({ sessions: [model('MS', '9', '1H', { model_status: 'superseded' }), model('MBLANK', '9', '1H', { model_status: '' }), model('MAP', '9', '1H'), model('MREJ', '9', '1H', { model_status: 'rejected' }), coll('C9', '9', '1H', 'A-9')] })).C9
  ok('only approved (or blank, the rule Tag uses) models are candidates: superseded and rejected ones are left out', J(mix.modelCandidates.map(c => c.sessionId)) === J(['MBLANK', 'MAP']), J(mix.modelCandidates.map(c => c.sessionId)))
  const halfForms = byId(build({ sessions: [model('MH', '10', '1'), coll('C10', '10', '1H', 'A-10')] })).C10
  ok('the half is matched in any spelling ("1" on the model, "1H" on the collector)', halfForms.modelCandidates.length === 1)
}

console.log('\nthe hand-off to Comparison')
{
  const rows = byId(build({ sessions: [model('M2', '1458560', '1H'), coll('C2', '1458560', '1H', 'A-2181')], scores: [score('run_1', 'C2', 'M2', '7', '2026-10-10T10:00:00Z', '47.2')] })), p = makePreset(rows.C2, rows.C2.modelCandidates[0])
  ok('the preset carries the EXACT collector and model session ids, not a match and HR-code to look up', p.collectorSessionId === 'C2' && p.modelSessionId === 'M2' && p.matchId === '1458560' && p.half === '1H' && p.fromHalves === true)
  ok('...and the stored run, so Comparison can show "Stored 47.2%, algorithm 7"', p.stored.algorithm === '7' && p.stored.score === 47.2 && p.stored.runId === 'run_1')
  ok('a half with no run has no stored run in the preset', makePreset(A.C1, A.C1.modelCandidates[0]).stored === null)
  ok('isValidPreset: both ids present and different', isValidPreset(p) && !isValidPreset({ ...p, modelSessionId: '' }) && !isValidPreset({ ...p, collectorSessionId: ' ' }) && !isValidPreset({ ...p, modelSessionId: p.collectorSessionId }) && !isValidPreset(null) && !isValidPreset(undefined) && !isValidPreset({}))
  ok('a preset built from nothing is invalid, not a crash', !isValidPreset(makePreset(null, null)) && !isValidPreset(makePreset({}, {})))
  ok('returnFocus: the match to filter to and the row to put in view; none when there is no match id', J(returnFocus(p)) === J({ matchId: '1458560', key: 'C2' }) && returnFocus({ matchId: '' }) === null && returnFocus(null) === null)
}

{
  const r = byId(build({ sessions: [model('MA', '8', '1H', { model_version: '1' }), model('MB', '8', '1H', { model_version: '3' }), coll('C8', '8', '1H', 'A-8')] })).C8
  ok('with TWO candidates the preset carries the model the user CHOSE, not the first one (MB version 3 when the second is picked, MA when the first is)', makePreset(r, r.modelCandidates[1]).modelSessionId === 'MB' && makePreset(r, r.modelCandidates[1]).modelVersion === '3' && makePreset(r, r.modelCandidates[0]).modelSessionId === 'MA')
}

console.log('\nnothing that can come back empty throws')
{
  const bad = [null, undefined, {}, { isModel: false }, { session_id: 'x', match_id: '1', half: '1H' }, { session_id: 'x', match_id: '1', half: '1H', modelCandidates: null }, { session_id: 'x', match_id: '1', half: '1H', modelCandidates: [{}], run: {} }]
  let threw = null; for (const r of bad) for (const c of [CAPS, null, undefined, {}, { halvesCompare: true, comparison: true }]) { try { compareAction(r, c); describeRun(r); makePreset(r, r?.modelCandidates?.[0]) } catch (e) { threw = threw || e.message } }
  ok('compareAction, describeRun and makePreset take null, undefined and half-built rows and caps without a TypeError', threw === null, threw)
  ok('candidateLabel copes with a candidate with nothing recorded', /version not recorded/.test(candidateLabel({ sessionId: 'abcdefghijklmnop' })) && candidateLabel({ sessionId: 'abcdefghijklmnop' }).startsWith('…ghijklmnop') && candidateLabel(null).length > 0)
  ok('describeRun is null for a half with no run', describeRun(A.C1) === null && describeRun(null) === null)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
