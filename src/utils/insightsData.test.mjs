// insightsData.js: one run per collector session (the newest). SYNTHETIC rows only.
import { analyze, newestRunPerSession, viewRows, summary, toCsv, collectorLabel, resolveModule, normHalf, ERROR_VERDICTS } from './insightsData.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 220) + ']' : ''}`) }
const J = JSON.stringify
const norm = v => String(v ?? '').trim()
// the analyze() that shipped before this change, copied verbatim, to prove single-run halves are unchanged
function legacyAnalyze(rows, matchId, half) {
  const mid = norm(matchId), h = normHalf(half)
  const mine = rows.filter(r => norm(r.match_id) === mid && normHalf(r.half) === h)
  if (!mine.length) return null
  const allRuns = new Map()
  mine.forEach(r => { if (!allRuns.has(r.run_id)) allRuns.set(r.run_id, { label: collectorLabel(r), sDate: r._sDate || null }) })
  const totalRuns = allRuns.size
  const collectors = new Map([...allRuns.entries()].map(([id, v]) => [id, v.label]))
  const groups = new Map()
  mine.forEach(r => {
    if (!ERROR_VERDICTS.has(r.verdict)) return
    const isExtra = r.verdict === 'extra_event' || r.verdict === 'not_needed_extra'
    const anchorMs = isExtra ? r.collector_video_time_ms : r.model_video_time_ms
    const key = `${r.event_code}|${r.verdict}|${anchorMs}`
    if (!groups.has(key)) groups.set(key, { key, event_code: r.event_code, verdict: r.verdict, anchor_ms: Number(anchorMs) || 0, anchor_readable: (isExtra ? r.collector_time_readable : r.model_time_readable) || '', runs: new Set(), modules: new Set(), rows: [] })
    const g = groups.get(key); g.runs.add(r.run_id); if (norm(r.event_module)) g.modules.add(norm(r.event_module)); g.rows.push(r)
  })
  return { totalRuns, collectors, allRuns, groups: [...groups.values()].map(g => ({ ...g, module: resolveModule(g.modules) })) }
}
const row = (run, session, verdict, code = 'pressure_start', ms = 1000, o = {}) => ({ run_id: run, match_id: '1', half: '1H', collector_session_id: session, collector_hr_code: o.hr ?? 'A-1', model_session_id: o.model ?? 'M', event_code: code, verdict, model_video_time_ms: verdict === 'extra_event' ? '' : String(ms), collector_video_time_ms: String(ms), event_module: 'PRESSURE', ...o.more })
const OLD = 'run_1790000000000_aaaa', NEW = 'run_1795000000000_bbbb', NEWER = 'run_1796000000000_cccc'
const stats = res => ({ runs: res.totalRuns, groups: res.groups.map(g => `${g.event_code}|${g.verdict}|${g.anchor_ms}|${[...g.runs].join('+')}`).sort() })

console.log('a deliberate second run of the SAME collector session')
{
  const rows = [row(OLD, 'S1', 'missing_event', 'pressure_start', 5000), row(OLD, 'S1', 'extra_event', 'pressure_end', 7000), row(OLD, 'S1', 'correct', 'pressure_start', 9000),
                row(NEW, 'S1', 'correct', 'pressure_start', 5000), row(NEW, 'S1', 'correct', 'pressure_start', 9000)]
  const r = analyze(rows, '1', '1H')
  ok('counted ONCE: the Runs total is 1, not 2', r.totalRuns === 1 && r.allRuns.size === 1 && [...r.allRuns.keys()][0] === NEW, J([r.totalRuns, [...r.allRuns.keys()]]))
  ok('the errors that only the OLD run had (a missing event and an extra) are gone; nothing of the old run remains in any pattern', r.groups.length === 0 && !r.groups.some(g => g.runs.has(OLD)))
  const view = viewRows(r), sum = summary(r, view)
  ok('the chips and the percentages follow: Runs 1, no patterns, 0 missing, 0 extra', sum.runs === 1 && sum.patterns === 0 && sum.missing === 0 && sum.extra === 0)
  const withErr = analyze([...rows, row(NEW, 'S1', 'missing_event', 'pressure_start', 12000)], '1', '1H')
  ok('an error that the NEWEST run has is counted once, at 100% of 1 run (not 50% of 2)', withErr.totalRuns === 1 && viewRows(withErr)[0].count === 1 && viewRows(withErr)[0].pct === 100, J(viewRows(withErr).map(g => [g.count, g.pct])))
  ok('the CSV states total_runs: 1', toCsv(viewRows(withErr), { matchId: '1', half: '1H', totalRuns: withErr.totalRuns }).includes('total_runs: 1'))
}

console.log('\nre-run after a model version bump, or against a REPLACED model, for the same collector session')
{
  const rows = [row(OLD, 'S1', 'missing_event', 'pressure_start', 5000, { model: 'MODEL-V1' }), row(NEW, 'S1', 'correct', 'pressure_start', 5000, { model: 'MODEL-V1' })]
  ok('same model session after a version bump: the newer run replaces the older', analyze(rows, '1', '1H').totalRuns === 1 && analyze(rows, '1', '1H').groups.length === 0)
  const replaced = [row(OLD, 'S1', 'missing_event', 'pressure_start', 5000, { model: 'MODEL-OLD' }), row(NEW, 'S1', 'correct', 'pressure_start', 5000, { model: 'MODEL-NEW' })]
  ok('a different (replaced) model session does not matter: still the newest run only', analyze(replaced, '1', '1H').totalRuns === 1 && analyze(replaced, '1', '1H').groups.length === 0)
  const three = [row(OLD, 'S1', 'missing_event', 'a', 1), row(NEWER, 'S1', 'extra_event', 'b', 2), row(NEW, 'S1', 'wrong_event', 'c', 3)]
  ok('three runs of one session: the newest by the time INSIDE the run id wins, even when its rows are not the last in the sheet', J(stats(analyze(three, '1', '1H')).groups) === J([`b|extra_event|0|${NEWER}`]) || stats(analyze(three, '1', '1H')).groups.every(g => g.endsWith(NEWER)), J(stats(analyze(three, '1', '1H'))))
  ok('...and only that run is left', analyze(three, '1', '1H').totalRuns === 1 && [...analyze(three, '1', '1H').allRuns.keys()][0] === NEWER)
}

console.log('\nwhat is NOT collapsed')
{
  const two = [row(OLD, 'S1', 'missing_event', 'x', 1, { hr: 'A-1' }), row(NEW, 'S2', 'missing_event', 'x', 1, { hr: 'A-2' })]
  ok('two DIFFERENT collector sessions keep both runs (Runs 2, the pattern is 100%)', analyze(two, '1', '1H').totalRuns === 2 && viewRows(analyze(two, '1', '1H'))[0].pct === 100)
  const sameHr = [row(OLD, 'S1', 'missing_event', 'x', 1, { hr: 'A-1' }), row(NEW, 'S2', 'missing_event', 'x', 1, { hr: 'A-1' })]
  ok('one HR-code on two different sessions is NOT collapsed (the key is the session, never the code: codes are mis-typed and shared)', analyze(sameHr, '1', '1H').totalRuns === 2)
  const noSession = [row(OLD, '', 'missing_event', 'x', 1), row(NEW, '', 'missing_event', 'x', 1)]
  ok('runs with no collector_session_id each stand alone', analyze(noSession, '1', '1H').totalRuns === 2)
  const otherHalf = [row(OLD, 'S1', 'missing_event', 'x', 1), { ...row(NEW, 'S1', 'missing_event', 'x', 1), half: '2H' }]
  ok('the same session in ANOTHER half is a different half: each half has its own run', analyze(otherHalf, '1', '1H').totalRuns === 1 && analyze(otherHalf, '1', '2H').totalRuns === 1)
}

console.log('\nrunning order and unreadable ids')
{
  const reversed = [row(NEW, 'S1', 'missing_event', 'x', 1), row(OLD, 'S1', 'extra_event', 'y', 2)]
  ok('the newest wins by its id even when the older run\'s rows come LATER in the sheet', [...analyze(reversed, '1', '1H').allRuns.keys()][0] === NEW)
  const odd = [row('legacy-run-1', 'S1', 'missing_event', 'x', 1), row('legacy-run-2', 'S1', 'extra_event', 'y', 2)]
  ok('ids with no time in them: the later run in the sheet wins', [...analyze(odd, '1', '1H').allRuns.keys()][0] === 'legacy-run-2')
  const mixed = [row('legacy-run', 'S1', 'missing_event', 'x', 1), row(NEW, 'S1', 'missing_event', 'x', 1)]
  ok('one id with a time and one without: falls back to sheet order, never throws', analyze(mixed, '1', '1H').totalRuns === 1)
  ok('the rows of the surviving run keep their original order', J(newestRunPerSession([row(NEW, 'S1', 'a', 'p', 1), row(OLD, 'S1', 'a', 'o', 2), row(NEW, 'S1', 'a', 'q', 3)]).map(r => r.event_code)) === J(['p', 'q']))
}

console.log('\nhalves with ONE run per session: byte-for-byte what it was')
{
  const rows = []
  for (let s = 1; s <= 7; s++) { const run = `run_17900000000${s}0_${s}xxx`; for (let e = 0; e < 12; e++) rows.push(row(run, `S${s}`, ['correct', 'missing_event', 'extra_event', 'wrong_event', 'wrong_timestamp', 'wrong_side'][(e + s) % 6], e % 2 ? 'pressure_start' : 'pass', 1000 * (e % 5), { hr: `A-${s}` })) }
  const a = analyze(rows, '1', '1H'), b = legacyAnalyze(rows, '1', '1H')
  const ser = r => J({ t: r.totalRuns, c: [...r.collectors], a: [...r.allRuns], g: r.groups.map(g => ({ ...g, runs: [...g.runs], modules: [...g.modules] })) })
  ok('analyze() returns exactly the same runs, labels, groups, counts and rows as the previous version on 7 sessions x 12 events', ser(a) === ser(b))
  ok('viewRows, summary and the CSV are identical too', J(viewRows(a)) === J(viewRows(b)) && J(summary(a, viewRows(a))) === J(summary(b, viewRows(b))) && toCsv(viewRows(a), { matchId: '1', half: '1H', totalRuns: a.totalRuns }).split('\n').slice(4).join('\n') === toCsv(viewRows(b), { matchId: '1', half: '1H', totalRuns: b.totalRuns }).split('\n').slice(4).join('\n'))
  ok('a match with no rows is still null', analyze(rows, '999', '1H') === null)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
