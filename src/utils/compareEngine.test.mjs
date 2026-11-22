// compareEngine.js: the matcher, the scope filter, the label and the scores row. SYNTHETIC collector events only (the model is the
// public one compiled into the app); no real collector data is in this file.
import { compare, solveAssignment, assignmentWeights, OUT_OF_TOLERANCE } from './compareEngine.js'
import { scoreRows, summaryLine } from './comparisonScope.js'
import { buildScoreRow, findExistingRun } from './comparisonSheet.js'
import { ALGORITHM_VERSION, DEFAULT_TOLERANCE_MS, SCORES_COLUMNS } from '../config/comparisonConfig.js'
import { MODEL_EVENT_ROWS } from './modelImportData.js'
import { EVENT_COLUMNS } from '../config/fieldConfig.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 240) + ']' : ''}`) }
const J = JSON.stringify
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const T = DEFAULT_TOLERANCE_MS

// ── helpers ───────────────────────────────────────────────────────────────────────────────────
function perms(arr) { if (arr.length <= 1) return [arr]; return arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [x, ...p])) }
/** Best possible assignment of the SMALLER side, by exhaustive search: [allowed pairs, total cost of the allowed pairs]; more pairs first, then cheaper. */
function bruteBest(cost) {
  const n = cost.length, m = cost[0].length, flip = n > m, R = flip ? m : n, K = flip ? n : m
  const at = (i, j) => (flip ? cost[j][i] : cost[i][j]); let best = null
  const choose = (k, used, acc) => { if (k === R) { if (!best || acc.n > best.n || (acc.n === best.n && acc.c < best.c - 1e-9)) best = { ...acc }; return }
    for (let j = 0; j < K; j++) { if (used.has(j)) continue; const c = at(k, j); used.add(j); choose(k + 1, used, c < OUT_OF_TOLERANCE ? { n: acc.n + 1, c: acc.c + c } : acc); used.delete(j) } }
  choose(0, new Set(), { n: 0, c: 0 }); return best
}
const allowed = (cost, pairs) => { const f = pairs.filter(([i, j]) => cost[i][j] < OUT_OF_TOLERANCE); return { n: f.length, c: f.reduce((s, [i, j]) => s + cost[i][j], 0), f } }
const randMatrix = (n, m, density) => Array.from({ length: n }, () => Array.from({ length: m }, () => (rnd() < density ? Math.round(rnd() * 2000) + (rnd() < 0.4 ? 1e6 : 0) : OUT_OF_TOLERANCE)))
const ev = (code, ms, team = 'home', o = {}) => ({ session_id: 'x', event_code: code, video_time_ms: String(ms), time_from_half_start_ms: '', team, ...o })
const run = (model, coll, scope = '') => compare({ session_id: 'M', match_id: '1', half: '1H', scope_event_ids: scope }, model, { session_id: 'C', match_id: '1', half: '1H', collector_hr_code: 'A-1' }, coll, { modelSessionId: 'M', runId: 'r' })
const verdicts = res => res.detailRows.map(r => `${r.model_event_code || '-'}@${r.model_video_time_ms || '-'}:${r.collector_event_code || '-'}@${r.collector_video_time_ms || '-'}:${r.verdict}`).sort()

console.log('1. THE ROW ORIENTATION: the smaller side is always on the rows (shapes both ways)')
{
  let bad = 0, runs = 0
  for (let n = 1; n <= 6; n++) for (let m = 1; m <= 6; m++) for (let t = 0; t < 25; t++) { const c = Array.from({ length: n }, () => Array.from({ length: m }, () => Math.round(rnd() * 1000))); const a = allowed(c, solveAssignment(c)), b = bruteBest(c); runs++; if (a.n !== b.n || Math.abs(a.c - b.c) > 1e-6) bad++ }
  ok(`dense finite costs, every shape 1x1 .. 6x6 (${runs} matrices): the solver's total equals the exhaustive optimum`, bad === 0, `${bad} worse`)
  const pairsOK = (n, m) => { const c = Array.from({ length: n }, () => Array.from({ length: m }, () => Math.round(rnd() * 1000))); const p = solveAssignment(c); const rows = new Set(p.map(x => x[0])), cols = new Set(p.map(x => x[1])); return p.length === Math.min(n, m) && rows.size === p.length && cols.size === p.length && p.every(([i, j]) => i >= 0 && i < n && j >= 0 && j < m) }
  ok('every element of the SMALLER side gets exactly one partner, no index is used twice, for wide, tall and square matrices', [[3, 7], [7, 3], [5, 5], [1, 9], [9, 1], [60, 61], [61, 60], [218, 437], [437, 218]].every(([n, m]) => pairsOK(n, m)))
  // the shape that broke the old routine: the collector (437) has MORE events than the model (218), and only some of them are close to anything
  let worse = 0; for (let t = 0; t < 6; t++) { const c = randMatrix(218, 437, 0.02); const a = allowed(c, solveAssignment(c)); const r = refSolve(c); if (a.n !== r.n || Math.abs(a.c - r.c) > 1e-3) worse++ }
  ok('a 218 x 437 sparse matrix (your pair\'s shape) gives the same allowed pairs and cost as an independent reference solver, 6 of 6', worse === 0, `${worse} differ`)
  const tall = randMatrix(437, 218, 0.02), wide = tall[0].map((_, j) => tall.map(r => r[j]))
  const a1 = allowed(tall, solveAssignment(tall)), a2 = allowed(wide, solveAssignment(wide))
  ok('the answer does not depend on which way round the matrix is given (437 x 218 against its transpose)', a1.n === a2.n && Math.abs(a1.c - a2.c) < 1e-3, J([a1.n, a2.n]))
}
function refSolve(cost) {   // independent reference: the classic algorithm on the transpose when needed, with its own bookkeeping
  const n = cost.length, m = cost[0].length, flip = n > m; const M = flip ? cost[0].map((_, j) => cost.map(r => r[j])) : cost, R = M.length, K = M[0].length
  const u = Array(R + 1).fill(0), v = Array(K + 1).fill(0), p = Array(K + 1).fill(0), way = Array(K + 1).fill(0)
  for (let i = 1; i <= R; i++) { p[0] = i; let j0 = 0; const minv = Array(K + 1).fill(Infinity), used = Array(K + 1).fill(false)
    do { used[j0] = true; const i0 = p[j0]; let d = Infinity, j1 = 0
      for (let j = 1; j <= K; j++) if (!used[j]) { const cur = M[i0 - 1][j - 1] - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0 } if (minv[j] < d) { d = minv[j]; j1 = j } }
      for (let j = 0; j <= K; j++) { if (used[j]) { u[p[j]] += d; v[j] -= d } else minv[j] -= d } j0 = j1 } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0) }
  const pairs = []; for (let j = 1; j <= K; j++) if (p[j]) pairs.push(flip ? [j - 1, p[j] - 1] : [p[j] - 1, j - 1]); return allowed(cost, pairs)
}

console.log('\n2. THE FINITE OUT-OF-TOLERANCE COST, on its own (not the orientation)')
{
  ok('OUT_OF_TOLERANCE is a finite number, not Infinity and not NaN', Number.isFinite(OUT_OF_TOLERANCE) && OUT_OF_TOLERANCE > 0)
  const worstAllowedTotal = 437 * (1e6 + T + 0.1)
  ok('it exceeds the cost of ANY assignment of allowed pairs (437 pairs at the largest allowed cost), by a wide margin, so an allowed pair is never traded for a forbidden one', OUT_OF_TOLERANCE > worstAllowedTotal * 100, `${OUT_OF_TOLERANCE} vs ${worstAllowedTotal}`)
  let bad = 0, runs = 0
  for (let n = 1; n <= 6; n++) for (let m = 1; m <= 6; m++) for (let t = 0; t < 25; t++) { const c = randMatrix(n, m, 0.35); const a = allowed(c, solveAssignment(c)), b = bruteBest(c); runs++; if (a.n !== b.n || Math.abs(a.c - b.c) > 1e-6) bad++ }
  ok(`matrices where most entries are out of tolerance (${runs}): the number of ALLOWED pairs is the maximum possible, then the cost the minimum (exhaustive check)`, bad === 0, `${bad} worse`)
  const allOut = Array.from({ length: 5 }, () => Array.from({ length: 8 }, () => OUT_OF_TOLERANCE))
  ok('a matrix with nothing in tolerance returns no allowed pair', allowed(allOut, solveAssignment(allOut)).n === 0)
  const withDead = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === 2 ? OUT_OF_TOLERANCE : i === j ? 100 + i : OUT_OF_TOLERANCE)))
  const r = allowed(withDead, solveAssignment(withDead))
  ok('a row with nothing in tolerance gets no allowed pair and does not disturb any other row', r.n === 5 && r.f.every(([i, j]) => i === j) && !r.f.some(([i]) => i === 2), J(r.f))
  // millisecond resolution survives a large matrix full of out-of-tolerance entries
  const big = Array.from({ length: 300 }, (_, i) => Array.from({ length: 301 }, (_, j) => (j === i && i > 0 ? 500 : OUT_OF_TOLERANCE)))
  big[0][0] = 1001; big[0][300] = 1000
  const bp = solveAssignment(big).find(([i]) => i === 0)
  ok('1 ms still decides: with 299 other rows and ~90,000 out-of-tolerance entries, row 0 takes the 1000 ms candidate over the 1001 ms one', bp && bp[1] === 300, J(bp))
  const odd = [[100, Infinity, NaN], [Infinity, 50, OUT_OF_TOLERANCE], [NaN, 70, 20]]
  let threw = false, ro = null; try { ro = allowed(odd, solveAssignment(odd)) } catch { threw = true }
  ok('Infinity and NaN entries are treated as forbidden: no crash, and they never come back as a pair', !threw && ro.f.every(([i, j]) => Number.isFinite(odd[i][j])), J(ro?.f))
  const onlyBad = [[Infinity, NaN, Infinity], [10, 20, 30], [NaN, NaN, NaN]]
  let t2 = false, ob = null; try { ob = allowed(onlyBad, solveAssignment(onlyBad)) } catch { t2 = true }
  ok('a row made ONLY of non-finite entries is clamped to forbidden: no crash, no hang, no pair for it, and the other row still gets its best partner', !t2 && ob.n === 1 && ob.f[0][0] === 1 && ob.f[0][1] === 0, J(ob))
  ok('at the engine level a collector event 2001 ms away is never paired, and one exactly 2000 ms away IS paired (as wrong_timestamp, the engine\'s own verdict for more than half the tolerance)', (() => { const a = run([ev('pressure_start', 10000)], [ev('pressure_start', 12000)]), b = run([ev('pressure_start', 10000)], [ev('pressure_start', 12001)]); return a.detailRows.length === 1 && a.verdictCounts.wrong_timestamp === 1 && a.verdictCounts.missing_event === 0 && b.verdictCounts.missing_event === 1 && b.verdictCounts.extra_event === 1 })())
}

console.log('\n3. YOUR REAL MODEL (218 pressure_start, compiled into the app) and a rebuilt collector of the same shape')
const model = MODEL_EVENT_ROWS.map(r => Object.fromEntries(EVENT_COLUMNS.map((c, i) => [c, r[i]]))).filter(e => e.session_id === 'model_1454815_1H').sort((a, b) => +a.video_time_ms - +b.video_time_ms)
const mT = e => +e.video_time_ms
const dupSecond = model.map((e, i) => i && mT(e) - mT(model[i - 1]) < 400 ? mT(e) : null).filter(Boolean)[0]
const PINNED = { 73667: -6, 74695: -307, 1853800: -347, 1856127: -80, 1866366: -51 }    // your five cases, as offsets from the model event
function buildCollector({ flipCount = 85, dropMiddle = null, flipAll = false } = {}) {
  seed = 20261108; const out = []; const idx = model.map((_, i) => i).filter(i => mT(model[i]) !== dupSecond)
  const flipSet = new Set(); const order = idx.slice(); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  order.slice(0, flipCount).forEach(i => flipSet.add(i))
  idx.forEach(i => { const m = model[i]
    const gp = i > 0 ? mT(m) - mT(model[i - 1]) : 1e9, gn = i < model.length - 1 ? mT(model[i + 1]) - mT(m) : 1e9
    const room = Math.min(800, Math.floor(Math.min(gp, gn) / 2) - 1)                              // never closer to a NEIGHBOURING model event than to its own
    const off = Math.round((rnd() * 2 - 1) * room), gap = 1000 + Math.round(rnd() * 1000)          // drawn first: skipping an event must not change the others
    if (dropMiddle === i) return
    const ms = mT(m) + (PINNED[mT(m)] ?? off); const team = flipAll || flipSet.has(i) ? (m.team === 'home' ? 'away' : 'home') : m.team
    out.push(ev('pressure_start', ms, team)); out.push(ev('pressure_end', ms + gap, m.team)) })
  out.push(ev('pressure_end', mT(model[10]) + 7000, 'home')); out.push(ev('half_start', 5, 'home')); out.push(ev('pass', 6, 'home'))
  return out.sort((a, b) => +a.video_time_ms - +b.video_time_ms)
}
{
  const coll = buildCollector(), res = run(model, coll, 'pressure_start'), vc = res.verdictCounts, we = res.detailRows.filter(r => r.verdict === 'wrong_event').length
  ok(`the rebuilt collector has ${coll.length} events (217 starts, 218 ends, a half_start and a pass) against ${model.length} model events`, coll.length === 437 && model.length === 218)
  ok('total model events 218; collector 437, of which 217 are compared and 220 are out of scope', res.modelEventCount === 218 && res.collectorEventCount === 437 && res.scopedCollectorEventCount === 217 && res.outOfScopeCount === 220, J([res.modelEventCount, res.collectorEventCount, res.scopedCollectorEventCount, res.outOfScopeCount]))
  ok('matched 217: 132 correct and 85 wrong_side', vc.correct === 132 && vc.wrong_side === 85, J([vc.correct, vc.wrong_side]))
  ok('exactly 1 missing (one of the model\'s two starts 172 ms apart: the collector tagged only one), 0 extra, 0 wrong_event, 0 wrong_timestamp', vc.missing_event === 1 && vc.extra_event === 0 && we === 0 && vc.wrong_timestamp === 0 && [String(dupSecond), String(dupSecond - 172)].includes(res.detailRows.find(r => r.verdict === 'missing_event').model_video_time_ms), J(vc))
  ok('Overall score 99.5 and the Pressure module 99.5 (1 error in 218)', res.score === 99.5 && res.moduleStats.PRESSURE?.score === 99.5, J([res.score, res.moduleStats.PRESSURE?.score]))
  ok('the biggest delta of any pair stays below 840 ms', Math.max(...res.detailRows.filter(r => r.delta_ms !== '').map(r => +r.delta_ms)) <= 840)
  ok('the pairing is the NEAREST-TIME one: every model event is paired with the collector start generated for it', res.detailRows.filter(r => r.model_video_time_ms && r.collector_video_time_ms).every(r => Math.abs(+r.model_video_time_ms - +r.collector_video_time_ms) < 800))
  for (const [m, off] of Object.entries(PINNED)) { const row = res.detailRows.find(r => r.model_video_time_ms === m)
    ok(`pinned case, model ${m} ms (collector ${off} ms): paired with its own pressure_start, ${row?.delta_ms} ms apart, never with a pressure_end`, row && row.collector_event_code === 'pressure_start' && +row.delta_ms === Math.abs(off) && ['correct', 'wrong_side'].includes(row.verdict), J(row && [row.collector_event_code, row.delta_ms, row.verdict])) }
  const noScope = run(model, coll, '')
  ok('with a BLANK scope the collector\'s other events are in play again, as before (extras appear, the model still gets its same-code partners)', noScope.scopedCollectorEventCount === 437 && noScope.outOfScopeCount === 0 && noScope.verdictCounts.extra_event > 200 && noScope.detailRows.filter(r => r.model_event_code && r.collector_event_code === 'pressure_start').length >= 216, J([noScope.verdictCounts.extra_event, noScope.outOfScopeCount]))
  // one bad pair affects nothing else
  const victim = model.findIndex(m => mT(m) === 1853800), coll2 = buildCollector({ dropMiddle: victim }), res2 = run(model, coll2, 'pressure_start')
  const a = new Map(res.detailRows.filter(r => r.model_video_time_ms).map(r => [r.model_video_time_ms, `${r.collector_video_time_ms}:${r.verdict}`])), b = new Map(res2.detailRows.filter(r => r.model_video_time_ms).map(r => [r.model_video_time_ms, `${r.collector_video_time_ms}:${r.verdict}`]))
  let diff = 0; a.forEach((v, k) => { if (b.get(k) !== v && k !== '1853800') diff++ })
  ok('removing ONE collector start in the middle makes exactly that model event (30:53.800) missing and changes NOTHING else (0 of the other pairs differ)', b.get('1853800') === ':missing_event' && diff === 0 && res2.verdictCounts.missing_event === 2, J([b.get('1853800'), diff, res2.verdictCounts.missing_event]))
  const early = run(model, buildCollector({ dropMiddle: model.findIndex(m => mT(m) === 73667) }), 'pressure_start')
  ok('...and the same near the START of the half', early.verdictCounts.missing_event === 2 && early.verdictCounts.extra_event === 0)
  // team never rejects a pair
  const flipped = run(model, buildCollector({ flipAll: true }), 'pressure_start')
  ok('every collector team flipped: all 217 pairs still form (wrong_side), none becomes missing + extra, the score is unchanged', flipped.verdictCounts.wrong_side === 217 && flipped.verdictCounts.extra_event === 0 && flipped.verdictCounts.missing_event === 1 && flipped.score === 99.5, J(flipped.verdictCounts))
  ok('the out-of-scope events are returned for the page and are NOT detail rows (nothing new can reach the sheet)', res.detailRows.every(r => (r.model_event_code || r.collector_event_code) === 'pressure_start') && res.outOfScope.length === 220 && res.outOfScope.every(e => e.event_code !== 'pressure_start') && !('out_of_scope' in res.verdictCounts))
}

console.log('\n4. SCOPE')
{
  const model2 = [ev('pass', 10000), ev('shot', 20000)]
  const r = run(model2, [ev('pass', 10100), ev('shot', 20100), ev('tackle', 30000), ev('foul', 31000)], 'pass|shot')
  ok('collector events of types the model does not cover are not extras and cost nothing', r.verdictCounts.extra_event === 0 && r.verdictCounts.correct === 2 && r.errorUnits === 0 && r.score === 100 && r.outOfScopeCount === 2)
  ok('a pipe, comma or semicolon list, with spaces, is read the same way', [run(model2, [ev('tackle', 1)], ' pass | shot '), run(model2, [ev('tackle', 1)], 'pass,shot'), run(model2, [ev('tackle', 1)], 'pass; shot')].every(x => x.outOfScopeCount === 1))
  const r2 = run(model2, [ev('pass', 10100), ev('shot', 20100), ev('pass', 50000)], 'pass|shot')
  ok('an UNMATCHED collector event of an in-scope type is still an extra (the scope removes types, not events)', r2.verdictCounts.extra_event === 1 && r2.errorUnits === 1)
  const r3 = run([ev('pressure_start', 10000)], [ev('pressure_end', 10050)], 'pressure_start')
  ok('a collector pressure_end 50 ms from a model pressure_start is NOT paired as a wrong_event: it is out of scope, and the model event is missing', r3.verdictCounts.missing_event === 1 && r3.detailRows.filter(x => x.verdict === 'wrong_event').length === 0 && r3.outOfScopeCount === 1)
  const r4 = run([ev('pressure_start', 10000)], [ev('pressure_end', 10050)], '')
  ok('with no scope it IS a wrong_event, exactly as before', r4.detailRows.filter(x => x.verdict === 'wrong_event').length === 1)
}

console.log('\n5. SAME CODE FIRST, CROSS-CODE ONLY WHEN NOTHING ELSE IS IN TOLERANCE')
{
  const m = [ev('pass', 10000)]
  const a = run(m, [ev('shot', 10010), ev('pass', 11500)], '')
  ok('a same-code candidate 1.5 s away beats a different-code one 10 ms away', a.detailRows.find(r => r.model_event_code === 'pass').collector_event_code === 'pass' && a.verdictCounts.extra_event === 1)
  const b = run(m, [ev('shot', 10010)], '')
  ok('with no same-code candidate in tolerance, the different-code one is paired as ONE wrong_event (not a missing plus an extra)', b.detailRows.length === 1 && b.detailRows[0].verdict === 'wrong_event')
  const c = run(m, [ev('pass', 13000), ev('shot', 10010)], '')
  ok('a same-code event OUTSIDE the tolerance does not count as a same-code candidate', c.detailRows.find(r => r.model_event_code === 'pass').collector_event_code === 'shot')
  const t1 = run([ev('pass', 10000, 'home')], [ev('pass', 10000, 'away'), ev('pass', 10500, 'home')], '')
  ok('team never overrides time: an exact-time wrong-team candidate beats a 500 ms later right-team one (wrong_side, and the other is an extra)', t1.verdictCounts.wrong_side === 1 && t1.verdictCounts.extra_event === 1 && t1.detailRows.find(r => r.model_event_code).collector_video_time_ms === '10000')
  const t2 = run([ev('pass', 10000, 'home')], [ev('pass', 10300, 'away'), ev('pass', 9700, 'home')], '')
  ok('team breaks only an EXACT tie: two candidates 300 ms either side, one with the right team, the right team wins', t2.verdictCounts.correct === 1 && t2.detailRows.find(r => r.model_event_code).collector_video_time_ms === '9700')
  const d = run([ev('pass', 10000, 'home')], [ev('pass', 10500, 'away')], '')
  ok('a different team never stops a pair: one wrong_side, nothing missing, nothing extra', d.verdictCounts.wrong_side === 1 && d.verdictCounts.missing_event === 0 && d.verdictCounts.extra_event === 0 && d.errorUnits === 0)
}

console.log('\n6. THE LABEL IS THE SCORE\'S OWN NUMBER')
{
  const coll = buildCollector(), res = run(model, coll, 'pressure_start')
  const sr = scoreRows(res.detailRows, Object.keys(res.verdictCounts))
  ok('rescoring the engine\'s own rows gives back its errors and its score exactly', sr.errorUnits === res.errorUnits && sr.score === res.score)
  const line = summaryLine(res, res)
  ok('the line reads "Model 218 · Collector 437 (217 compared, 220 out of scope) · 1 scored errors · 85 wrong side excluded" and the 1 is the error count inside the 99.5%', line === 'Model: 218 events · Collector: 437 events (217 compared, 220 out of scope) · 1 scored errors · 85 wrong side excluded from the score', line)
  const unscoped = run(model, coll, ''), shownF = { ...unscoped, ...scoreRows(unscoped.detailRows.filter(r => r.model_event_code === 'pressure_start' || r.collector_event_code === 'pressure_start'), Object.keys(unscoped.verdictCounts)) }
  ok('with an Event filter the line follows the FILTERED figures, not the engine\'s total (the old line said 333 where the score used 115)', summaryLine(shownF, unscoped).includes(`${shownF.errorUnits} scored errors`) && shownF.errorUnits < unscoped.errorUnits && !summaryLine(shownF, unscoped).includes(`${unscoped.errorUnits} scored errors`), summaryLine(shownF, unscoped))
  ok('no out-of-scope text when nothing is out of scope', !/out of scope/.test(summaryLine(unscoped, unscoped)))
}

console.log('\n7. THE SCORES ROW AND THE VERSION')
{
  const coll = buildCollector(), res = run(model, coll, 'pressure_start')
  const asObj = arr => Object.fromEntries(SCORES_COLUMNS.map((c, i) => [c, arr[i]]))
  const rowArr = buildScoreRow('r1', { session_id: 'M', match_id: '1', half: '1H', model_version: '1' }, { session_id: 'C', collector_hr_code: 'A-1' }, res), row = asObj(rowArr)
  ok('scope_event_ids holds the model\'s scope; total_collector_events is everything (437); total_scoped_collector_events is what was compared (217)', row.scope_event_ids === 'pressure_start' && row.total_collector_events === '437' && row.total_scoped_collector_events === '217' && row.total_model_events === '218', J([row.scope_event_ids, row.total_collector_events, row.total_scoped_collector_events]))
  ok('the stored score is 99.5 (it was 0: the engine\'s own total counted the 218 pressure_end extras)', row.score === '99.5' && row.correct === '132' && row.wrong_side === '85' && row.missing_event === '1' && row.extra_event === '0')
  ok('the row is exactly as wide as the existing scores header: no new column, so the header check is unaffected', rowArr.length === SCORES_COLUMNS.length && SCORES_COLUMNS.includes('scope_event_ids') && SCORES_COLUMNS.includes('total_scoped_collector_events'))
  const blank = asObj(buildScoreRow('r2', { session_id: 'M' }, { session_id: 'C' }, run([ev('pass', 1)], [ev('pass', 2)], '')))
  ok('a model with no scope writes a blank scope and the same count twice, as before', blank.scope_event_ids === '' && blank.total_scoped_collector_events === blank.total_collector_events)
  ok('ALGORITHM_VERSION is 8', ALGORITHM_VERSION === '8')
  const hdr = SCORES_COLUMNS, mk = ver => Object.fromEntries(hdr.map(h => [h, h === 'model_session_id' ? 'M' : h === 'collector_session_id' ? 'C' : h === 'tolerance_config_version' ? '2' : h === 'algorithm_version' ? ver : '']))
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async () => 'TOKEN' } }
  const realFetch = globalThis.fetch
  const withScores = async (rows, fn) => { globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ values: [hdr, ...rows.map(r => hdr.map(h => r[h]))] }) }); try { return await fn() } finally { globalThis.fetch = realFetch } }
  ok('a run recorded under algorithm 7 does NOT block the same pair under 8 (so it can be re-run)', (await withScores([mk('7')], () => findExistingRun('M', 'C'))) === null)
  ok('...but a run under 8 does ("no changes detected" still protects identical re-runs)', (await withScores([mk('7'), mk('8')], () => findExistingRun('M', 'C')))?.algorithm_version === '8')
}

console.log('\n8. FULL-HALF SIZE: a model of 1,000+ events (the fixed weights were only right up to about 500)')
{
  const N = 1024        // a full half: well beyond the ~500 pairs the old fixed weights could handle
  ok('the weights keep their ORDER at every size: all team nudges together stay below half a millisecond, CODE exceeds the whole time budget of any assignment, OUT exceeds any assignment of allowed pairs', [1, 2, 10, 218, 437, 500, 1000, 1200, 3000, 5000, 20000].every(k => { const w = assignmentWeights(k, T); return w.TEAM * k < 0.5 && w.TEAM > 0 && w.CODE > k * (T + 1) && w.OUT > k * (w.CODE + T + 1) && Number.isFinite(w.OUT) }), J([1, 1200, 20000].map(k => assignmentWeights(k, T))))
  ok('the weights were NOT enough at the old fixed values: at 1,024 pairs the old team total (0.1 each) is 102 ms, and at 1,200 the old code penalty (1e6) is below the time budget (1200 x 2001)', 0.1 * N > 1 && 1e6 < N * (T + 1) && 1e6 < 1200 * (T + 1))
  // (1) TEAM can never override TIME: a unique time-optimum, 1 ms cheaper, in which EVERY pair has the wrong team
  const M1 = Array.from({ length: N }, (_, i) => ev('pass', 10000 + 1000 * i, i % 2 ? 'away' : 'home'))
  const opp = t => (t === 'home' ? 'away' : 'home')
  const ladder = handicap => { const c = [ev('pass', 10000 - 500 - handicap, M1[0].team)]; for (let j = 0; j <= N - 1; j++) c.push(ev('pass', 10000 + 1000 * j + 500, j <= N - 2 ? M1[j + 1].team : opp(M1[N - 1].team))); return c }
  const r1 = run(M1, ladder(1)), d1 = r1.detailRows.reduce((x, r) => x + (+r.delta_ms || 0), 0)
  ok(`${N} events, the time-optimum is unique and 1 ms cheaper but all ${N} of its pairs have the wrong team: the engine takes it (total ${500 * N} ms, not ${500 * N + 1}) and reports ${N} wrong_side`, d1 === 500 * N && r1.verdictCounts.wrong_side === N && r1.verdictCounts.correct === 0 && r1.verdictCounts.missing_event === 0 && r1.verdictCounts.extra_event === 1, J([d1, r1.verdictCounts.wrong_side, r1.verdictCounts.extra_event]))
  // ...and team still does its one job: an EXACT tie in time goes to the assignment with fewer team mismatches
  const r2 = run(M1, ladder(0)), d2 = r2.detailRows.reduce((x, r) => x + (+r.delta_ms || 0), 0)
  ok(`with an EXACT tie in total time the team settles it: the same ladder with no handicap pairs every event with its own team (0 wrong_side, ${N} correct), at the same total time`, d2 === 500 * N && r2.verdictCounts.wrong_side === 0 && r2.verdictCounts.correct === N, J([d2, r2.verdictCounts.wrong_side, r2.verdictCounts.correct]))
  // (2) SAME CODE FIRST at full-half size: one different-code event at the start would save 1.2 million ms of delta in the rest
  const M3 = Array.from({ length: N }, (_, i) => ev('pass', 10000 + 1000 * i, 'home'))
  const C3 = [ev('shot', 10000, 'home'), ...Array.from({ length: N }, (_, j) => ev('pass', 10000 + 1000 * j + 1000, 'home'))]
  const r3 = run(M3, C3)
  ok(`${N} events: a different-code event that would save ${N * 1000} ms of time elsewhere is NOT preferred to the same-code pairs (0 wrong_event, ${N} same-code pairs)`, r3.detailRows.filter(r => r.verdict === 'wrong_event').length === 0 && r3.detailRows.filter(r => r.model_event_code && r.collector_event_code === 'pass').length === N, J(r3.verdictCounts))
  ok('...and the different-code event is simply an extra', r3.verdictCounts.extra_event === 1)
  // (3) team flipped on EVERY collector event changes no pairing at 1,200 events
  const spaced = Array.from({ length: N }, (_, i) => ev(['pass', 'shot', 'tackle'][i % 3], 20000 + 2400 * i, i % 2 ? 'home' : 'away'))
  seed = 99; const near = spaced.map(m => ev(m.event_code, +m.video_time_ms + Math.round((rnd() * 2 - 1) * 500), m.team))
  const flipped = near.map(c => ({ ...c, team: opp(c.team) }))
  const pairs = r => J(r.detailRows.filter(x => x.model_video_time_ms).map(x => [x.model_video_time_ms, x.collector_video_time_ms]).sort())
  const ra = run(spaced, near), rb = run(spaced, flipped)
  ok(`flipping the team of every collector event changes NO pairing at ${N} events (same ${ra.detailRows.length} pairs), only the verdict: ${ra.verdictCounts.correct} correct becomes ${rb.verdictCounts.wrong_side} wrong_side`, pairs(ra) === pairs(rb) && ra.verdictCounts.correct === N && rb.verdictCounts.wrong_side === N, J([ra.verdictCounts.correct, rb.verdictCounts.wrong_side]))
  // performance guard on a REALISTIC full half (events spread over 47 minutes, ~60% extra collector events of another type)
  seed = 7; const span = 47 * 60000
  const big = Array.from({ length: 2000 }, (_, i) => ev(['pass', 'shot', 'tackle'][i % 3], Math.round(i * span / 2000) + Math.round(rnd() * 500), i % 2 ? 'home' : 'away'))
  const bigC = [...big.map(m => ev(m.event_code, +m.video_time_ms + Math.round((rnd() * 2 - 1) * 400), m.team)), ...Array.from({ length: 1200 }, () => ev('reception', Math.round(rnd() * span), 'home'))]
  const t1 = Date.now(), rbig = run(big, bigC)
  ok(`a realistic half of 2,000 model and 3,200 collector events matches every model event and takes ${Date.now() - t1} ms (limit 10 s; a regular chain with exact ties is the slow case, not real data)`, rbig.verdictCounts.correct + rbig.verdictCounts.wrong_side === 2000 && Date.now() - t1 < 10000, J([rbig.verdictCounts.correct, Date.now() - t1]))
}

console.log('\n9. THE SCOPE VALUES THAT ARE NOT EVENT CODES (real values from the sheet: "Duels", "All Events", "TagOnce", "Pressure start")')
{
  // A "Duels"-shaped half: the model tags 12 different event types (not just the four duel codes), the collector tags the same
  // events a little off in time plus 6 events of types the model never tags (reception, out) and a half_start.
  const CODES = ['tackle', 'leg_stretch_duel', 'positioning_duel', 'separation_duel', 'hold_up_duel', 'clearance', 'dribble', 'shield', 'pass_first_time', 'pass_recovery', 'pass_interception', 'pass']
  const dm = Array.from({ length: 60 }, (_, i) => ev(CODES[i % CODES.length], 10000 + 4000 * i, i % 2 ? 'home' : 'away'))
  const dc = [...dm.map(m => ev(m.event_code, +m.video_time_ms + 150, m.team)), ev('reception', 11000, 'home'), ev('reception', 19000, 'home'), ev('out', 27000, 'home'), ev('reception', 35000, 'away'), ev('out', 43000, 'away'), ev('reception', 51000, 'home'), ev('half_start', 5, 'home')]
  const base = run(dm, dc, '')
  for (const v of ['Duels', 'TagOnce', 'Tag Once']) {
    const x = run(dm, dc, v)
    ok(`scope "${v}": NOT a zero. Same pairing and score as no scope at all (${x.score}), 60 matched, nothing set aside, nothing missing`, x.score > 0 && x.score === base.score && J(x.verdictCounts) === J(base.verdictCounts) && x.outOfScopeCount === 0 && x.verdictCounts.missing_event === 0 && x.verdictCounts.correct + x.verdictCounts.wrong_side === 60, J([x.score, base.score, x.outOfScopeCount]))
    ok(`scope "${v}": the page is told (scopeMode unresolved, a warning that names it); never silent`, x.scopeMode === 'unresolved' && x.scopeWarning.includes(v) && x.scopeWarning.includes('NOT applied'))
  }
  const all = run(dm, dc, 'All Events')
  ok('scope "All Events": no filter, no warning, same result as blank', all.scopeMode === 'all' && all.scopeWarning === '' && all.score === base.score && all.outOfScopeCount === 0)
  ok('a blank scope: no filter, no warning', base.scopeMode === 'all' && base.scopeWarning === '' && base.outOfScopeCount === 0)
  // label -> code
  const pm = [ev('pressure_start', 10000), ev('pressure_start', 20000)], pc = [ev('pressure_start', 10100), ev('pressure_end', 11200), ev('pressure_start', 20100), ev('pressure_end', 21200)]
  const lab = run(pm, pc, 'Pressure start')
  ok('scope "Pressure start" (a label): normalised to pressure_start, the two pressure_end events are set aside, score 100, no warning', lab.scopeMode === 'codes' && J(lab.scopeEventIds) === J(['pressure_start']) && lab.outOfScopeCount === 2 && lab.score === 100 && lab.scopeWarning === '', J([lab.scopeMode, lab.scopeEventIds, lab.outOfScopeCount, lab.score]))
  ok('...and it is the same result as the code spelled out', J(run(pm, pc, 'pressure_start').verdictCounts) === J(lab.verdictCounts) && run(pm, pc, 'pressure_start').score === lab.score)
  // an unknown word never zeroes a score and never hides an error
  const unk = run(pm, pc, 'pressure_start|banana')
  ok('an unknown part in a list: no filter at all (the pressure_end events are compared, so they are extras), and a warning', unk.scopeMode === 'unresolved' && unk.outOfScopeCount === 0 && unk.verdictCounts.extra_event === 2 && /banana/.test(unk.scopeWarning))
  // every real value, identical collector and model: never a zero from the scope
  const same = [ev('pass', 10000), ev('tackle', 20000), ev('shot', 30000)]
  ok('for EVERY real value, a collector identical to the model scores 100, never 0 (Duels, TagOnce, All Events, "", Pressure start with a matching model)', ['Duels', 'TagOnce', 'All Events', '', 'duels', 'DUELS'].every(v => run(same, same.map(e => ({ ...e })), v).score === 100), J(['Duels', 'TagOnce', 'All Events', '', 'duels'].map(v => run(same, same.map(e => ({ ...e })), v).score)))
  // the safeguard: a type the model itself tags is never out of scope, whatever the declared scope says
  const sg = run([ev('pass', 10000), ev('shot', 20000)], [ev('pass', 10100), ev('shot', 20100), ev('reception', 30000)], 'pass')
  ok('SAFEGUARD: a declared scope "pass" on a model that also tags a shot does not set the collector\'s shot aside (it pairs, nothing missing); only the reception is set aside', sg.verdictCounts.missing_event === 0 && sg.verdictCounts.correct === 2 && sg.outOfScopeCount === 1 && sg.outOfScope[0].event_code === 'reception', J([sg.verdictCounts, sg.outOfScopeCount]))
  ok('nothing the model itself tags is ever listed as out of scope (60 Duels events, 12 types)', dc.every(c => !run(dm, dc, 'pass').outOfScope.some(o => dm.some(m => m.event_code === o.event_code))))
  // the scores row
  const asObj = arr => Object.fromEntries(SCORES_COLUMNS.map((c, i) => [c, arr[i]]))
  const rowD = asObj(buildScoreRow('r', { session_id: 'M', scope_event_ids: 'Duels' }, { session_id: 'C' }, run(dm, dc, 'Duels'))), rowL = asObj(buildScoreRow('r', { session_id: 'M' }, { session_id: 'C' }, lab))
  ok('the scores row records only what was really applied: blank for "Duels" (no filter), "pressure_start" for the label', rowD.scope_event_ids === '' && rowD.total_scoped_collector_events === rowD.total_collector_events && rowL.scope_event_ids === 'pressure_start', J([rowD.scope_event_ids, rowL.scope_event_ids]))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
