// SYNTHETIC data only. Dates are built from local parts so the suite does not depend on the machine's time zone.
import {
  totals, overallScore, correctRatio, errorRate, passRate, bestLowest, pillClass, filterReviews, weekStart, weeklyTrend, trendDelta,
  errorBreakdown, leaderboard, reviewRow, sortRows, dayKey, facetValues, resolveFilters, compareHalves, compareNumericText,
} from './selfReviewDashStats.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + d + ']' : ''}`) }
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-9
const J = JSON.stringify
const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h)
let n = 0
const rv = (o = {}) => ({ runId: `r${++n}`, hr: 'T-001', match: '1', half: '1H', savedAt: D(2026, 10, 20), score: 50, trainerRows: 10, correct: 5, missed: 4, wrong: 1, extra: 0, ...o })

// ---- an independent reference: plain loops over the raw counts, written differently on purpose ----
function ref(rs) {
  let T = 0, C = 0, E = 0
  for (const x of rs) { T += x.trainerRows; C += x.correct; E += x.missed; E += x.wrong; E += x.extra }
  return T === 0 ? null : { overall: Math.max(0, 100 * (T - E) / T), correct: 100 * C / T, error: 100 * E / T }
}

console.log('the headline formulas are sums of counts, not means of percentages')
{
  const a = rv({ trainerRows: 13, correct: 2, missed: 11, extra: 1, wrong: 0, score: 7.7 })
  const b = rv({ trainerRows: 8, correct: 1, missed: 7, extra: 2, wrong: 0, score: 0 })
  const rs = [a, b]
  ok('Overall = max(0, 100 - sum(errors) / sum(reviewer events) x 100): (12+9) errors / 21 events = 0, floored', near(overallScore(rs), 0) && near(ref(rs).overall, 0))
  ok('...whereas the MEAN of the stored scores would be 3.85: the two are different on purpose', near((a.score + b.score) / 2, 3.85) && !near(overallScore(rs), 3.85))
  ok('Correct ratio = sum(matched) / sum(reviewer events) = 3 / 21', near(correctRatio(rs), 3 / 21 * 100) && near(ref(rs).correct, 3 / 21 * 100))
  ok('collector-only extras are NOT in the correct ratio', near(correctRatio([rv({ trainerRows: 10, correct: 5, extra: 50 })]), 50))
  ok('collector-only extras ARE in the overall score', near(overallScore([rv({ trainerRows: 10, correct: 5, missed: 0, wrong: 0, extra: 3 })]), 70))
  ok('wrong_event counts as an error in the overall score', near(overallScore([rv({ trainerRows: 10, correct: 5, missed: 0, wrong: 5, extra: 0 })]), 50))
  ok('Error rate = errors / reviewer events, and can exceed 100%', near(errorRate([rv({ trainerRows: 5, correct: 2, missed: 3, wrong: 0, extra: 10 })]), 260))
  ok('Overall is floored at 0 only after summing (one bad review does not drag the total below what the counts say)',
    near(overallScore([rv({ trainerRows: 100, correct: 90, missed: 10, wrong: 0, extra: 0 }), rv({ trainerRows: 2, correct: 0, missed: 2, wrong: 0, extra: 20 })]), ref([rv({ trainerRows: 100, correct: 90, missed: 10, wrong: 0, extra: 0 }), rv({ trainerRows: 2, correct: 0, missed: 2, wrong: 0, extra: 20 })]).overall))
  // randomised agreement with the reference
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  let bad = 0
  for (let i = 0; i < 500; i++) {
    const set = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => { const T = 1 + Math.floor(rnd() * 40); const C = Math.floor(rnd() * (T + 1)); return rv({ trainerRows: T, correct: C, missed: Math.floor(rnd() * (T - C + 1)), wrong: Math.floor(rnd() * 3), extra: Math.floor(rnd() * 12) }) })
    const R = ref(set)
    if (!near(overallScore(set), R.overall) || !near(correctRatio(set), R.correct) || !near(errorRate(set), R.error)) bad++
  }
  ok('500 random sets agree with the independent reference (overall, correct ratio, error rate)', bad === 0, `${bad} differ`)
}

console.log('no divide-by-zero, ever')
ok('no reviews: every ratio is null, never NaN or Infinity', overallScore([]) === null && correctRatio([]) === null && errorRate([]) === null && passRate([], 85) === null)
ok('reviews with zero reviewer events: null, not NaN', overallScore([rv({ trainerRows: 0, correct: 0, missed: 0, wrong: 0, extra: 0 })]) === null)
ok('best / lowest of nothing are null', J(bestLowest([])) === '{"best":null,"lowest":null}')
ok('reviewRow: Correct % is null (not NaN) when a review has no reviewer events', reviewRow(rv({ trainerRows: 0, correct: 0 })).correctPct === null)
ok('error breakdown with no errors shows 0%, not NaN', (() => { const e = errorBreakdown([rv({ trainerRows: 4, correct: 4, missed: 0, wrong: 0, extra: 0 })]); return e.total === 0 && e.missedPct === 0 && e.extraPct === 0 })())

console.log('a score of 0 is a score')
{
  const rs = [rv({ score: 0 }), rv({ score: 40 })]
  ok('Lowest is 0, not skipped as falsy', bestLowest(rs).lowest === 0)
  ok('a stored 0 is a fail at pass mark 85 and counts in the pass rate denominator', passRate(rs, 85) === 0 && passRate([rv({ score: 0 }), rv({ score: 90 })], 85) === 50)
  ok('a 0 gets a red pill', pillClass(0, 85) === 'r')
}

console.log('pass mark and pill colours')
ok('at the pass mark exactly: green', pillClass(85, 85) === 'g' && pillClass(100, 85) === 'g')
ok('just below the pass mark: amber', pillClass(84.9, 85) === 'y')
ok('exactly 10 below: still amber', pillClass(75, 85) === 'y')
ok('more than 10 below: red', pillClass(74.9, 85) === 'r')
ok('the bands move with the pass mark (60: 60 green, 50 amber, 49.9 red)', pillClass(60, 60) === 'g' && pillClass(50, 60) === 'y' && pillClass(49.9, 60) === 'r')
ok('pass rate counts reviews AT the pass mark as passing', passRate([rv({ score: 85 }), rv({ score: 84.9 })], 85) === 50)
ok('pass rate is a whole percent of reviews, by STORED score', passRate([rv({ score: 90 }), rv({ score: 90 }), rv({ score: 10 })], 85) === 67)
ok('changing the pass mark changes the pass rate and nothing stored', (() => { const rs = [rv({ score: 70 }), rv({ score: 90 })]; return passRate(rs, 85) === 50 && passRate(rs, 65) === 100 && rs[0].score === 70 })())

console.log('filters')
{
  const base = D(2026, 11, 3)
  const rs = [rv({ half: '1H', match: '1', hr: 'T-001', savedAt: D(2026, 11, 3, 8) }), rv({ half: '2H', match: '2', hr: 'T-002', savedAt: D(2026, 10, 4, 12) }), rv({ half: 'ET1', match: '3', hr: 'T-002', savedAt: D(2026, 7, 1) })]
  ok('half filter', filterReviews(rs, { half: '2H' }, base).length === 1 && filterReviews(rs, { half: 'ET1' }, base)[0].match === '3')
  ok('match filter', filterReviews(rs, { match: '1' }, base).length === 1)
  ok('collector filter', filterReviews(rs, { collector: 'T-002' }, base).length === 2)
  ok('period 30 days: 30 days ago is IN, 31 days ago is OUT', filterReviews([rv({ savedAt: D(2026, 10, 4, 12) })], { periodDays: 30 }, base).length === 1 && filterReviews([rv({ savedAt: D(2026, 10, 3, 11) })], { periodDays: 30 }, base).length === 0)
  ok('period 90 days', filterReviews(rs, { periodDays: 90 }, base).length === 2)
  ok('all time (0) and empty filters keep everything', filterReviews(rs, { periodDays: 0, half: '', match: '', collector: '' }, base).length === 3 && filterReviews(rs, undefined, base).length === 3)
  ok('filters combine', filterReviews(rs, { collector: 'T-002', half: '2H', periodDays: 90 }, base).length === 1)
}

console.log('weekly trend: weeks start on Monday, local time')
ok('Monday is its own week start', weekStart(D(2026, 10, 19)) === '2026-10-19')
ok('Sunday belongs to the PREVIOUS Monday', weekStart(D(2026, 10, 25)) === '2026-10-19')
ok('the Monday after starts a new week', weekStart(D(2026, 10, 26)) === '2026-10-26')
ok('a week that crosses a month end', weekStart(D(2026, 11, 1)) === '2026-10-26')
ok('a week that crosses a year end', weekStart(D(2027, 1, 2)) === '2026-12-28')
{
  const rs = [rv({ savedAt: D(2026, 10, 19), trainerRows: 10, correct: 5, missed: 5, wrong: 0, extra: 0 }), rv({ savedAt: D(2026, 10, 22), trainerRows: 10, correct: 9, missed: 1, wrong: 0, extra: 0 }), rv({ savedAt: D(2026, 10, 28), trainerRows: 4, correct: 4, missed: 0, wrong: 0, extra: 0 })]
  const t = weeklyTrend(rs)
  ok('points are weeks, oldest first, each the COUNT-BASED overall score of that week (6 errors / 20 events = 70)', t.length === 2 && t[0].week === '2026-10-19' && near(t[0].overall, 70) && t[0].n === 2 && t[1].week === '2026-10-26' && near(t[1].overall, 100), J(t))
  ok('no reviews: no points', weeklyTrend([]).length === 0)
}

console.log('trend delta: later half minus earlier half, count-based; needs more than 3 reviews AND at least two weeks of data')
ok('3 reviews or fewer: no delta', trendDelta([rv(), rv(), rv()]) === null && trendDelta([]) === null)
{
  const mk = (d, errors) => rv({ savedAt: D(2026, 10, d), trainerRows: 10, correct: 10 - errors, missed: errors, wrong: 0, extra: 0 })
  const spread = [mk(1, 5), mk(8, 5), mk(15, 1), mk(22, 1)]
  ok('4 reviews over 21 days: later two (90) minus earlier two (50) = +40', near(trendDelta(spread), 40), String(trendDelta(spread)))
  ok('the input order does not matter', near(trendDelta([...spread].reverse()), 40))
  ok('5 reviews over 28 days: the extra one goes to the later half', trendDelta([mk(1, 5), mk(8, 5), mk(15, 1), mk(22, 1), mk(29, 1)]) !== null)
  ok('4 reviews within 3 days (the real data): NO delta, however different the halves are', trendDelta([mk(1, 5), mk(2, 5), mk(3, 1), mk(4, 1)]) === null)
  ok('4 reviews spanning 13 days: no delta (less than two weeks)', trendDelta([mk(1, 5), mk(5, 5), mk(9, 1), mk(14, 1)]) === null)
  ok('4 reviews spanning exactly 14 days: the delta appears (+40)', near(trendDelta([mk(1, 5), mk(5, 5), mk(10, 1), mk(15, 1)]), 40), String(trendDelta([mk(1, 5), mk(5, 5), mk(10, 1), mk(15, 1)])))
  ok('the span is measured on the reviews in view: a long history narrowed to one week has no delta', trendDelta(filterReviews([...spread, mk(23, 1), mk(24, 1)], { periodDays: 0 }).filter(x => x.savedAt >= D(2026, 10, 22))) === null)
  ok('the span uses the actual dates, not the number of weekly buckets: two reviews either side of a Monday are 1 day apart', trendDelta([mk(24, 5), mk(25, 5), mk(26, 1), mk(27, 1)]) === null)
}

console.log('error breakdown')
{
  const e = errorBreakdown([rv({ trainerRows: 10, correct: 0, missed: 21, wrong: 0, extra: 13 })])
  ok('totals and shares: 21 missed + 0 wrong + 13 collector-only = 34 (62% / 0% / 38%)', e.total === 34 && e.missed === 21 && e.wrong === 0 && e.extra === 13 && e.missedPct === 62 && e.extraPct === 38, J(e))
}

console.log('leaderboard')
{
  const rs = [
    rv({ hr: 'T-010', trainerRows: 10, correct: 9, missed: 1, wrong: 0, extra: 0, score: 90 }),
    rv({ hr: 'T-002', trainerRows: 10, correct: 5, missed: 5, wrong: 0, extra: 0, score: 50 }), rv({ hr: 'T-002', trainerRows: 10, correct: 5, missed: 5, wrong: 0, extra: 0, score: 50 }),
    rv({ hr: 'T-003', trainerRows: 10, correct: 5, missed: 5, wrong: 0, extra: 0, score: 50 }),
  ]
  const L = leaderboard(rs, 85)
  ok('best overall score first', L[0].hr === 'T-010' && L[0].rank === 1 && near(L[0].overall, 90))
  ok('a tie on overall score is broken by MORE reviews, then by HR-code', L[1].hr === 'T-002' && L[1].reviews === 2 && L[2].hr === 'T-003', J(L.map(r => r.hr)))
  ok('per-collector figures use the same count formulas as the cards', near(L[1].overall, 50) && near(L[1].correct, 50) && near(L[1].errorRate, 50))
  ok('per-collector pass rate is by stored score', L[0].passRate === 100 && L[1].passRate === 0)
  ok('the per-collector counts add up to the whole: summed errors and events match the combined view', (() => { const sum = k => leaderboard(rs, 85).reduce((a, r) => a + r[k], 0); return sum('reviews') === rs.length })())
  ok('HR-codes with numbers sort numerically (T-2 before T-10)', leaderboard([rv({ hr: 'T-10', score: 50 }), rv({ hr: 'T-2', score: 50 })], 85).map(r => r.hr).join() === 'T-2,T-10')
}

console.log('table rows and sorting')
{
  const rows = [reviewRow(rv({ savedAt: D(2026, 10, 2), match: '10', score: 5, trainerRows: 4, correct: 1 })), reviewRow(rv({ savedAt: D(2026, 10, 9), match: '9', score: 0, trainerRows: 0, correct: 0 })), reviewRow(rv({ savedAt: D(2026, 10, 5), match: '100', score: 80, trainerRows: 8, correct: 8 }))]
  ok('Correct % per review = matched / reviewer events', near(rows[0].correctPct, 25) && near(rows[2].correctPct, 100))
  ok('dates sort as dates (newest first by default key)', sortRows(rows, 'date', -1).map(r => dayKey(r.date)).join() === '2026-10-09,2026-10-05,2026-10-02')
  ok('numbers sort as numbers, with a 0 score in its place', sortRows(rows, 'score', 1).map(r => r.score).join() === '0,5,80')
  ok('match ids sort numerically (9, 10, 100), not as text', sortRows(rows, 'match', 1).map(r => r.match).join() === '9,10,100')
  ok('a null Correct % sorts first ascending without crashing', sortRows(rows, 'correctPct', 1)[0].correctPct === 25 || sortRows(rows, 'correctPct', 1)[0].correctPct === null)
  ok('sorting does not change the input', rows[0].match === '10')
}

console.log('dependent filters: each list offers only what still has reviews given the OTHER filters')
{
  const NOW = D(2026, 11, 3)
  const mk = (hr, match, half, day, mon = 10) => rv({ hr, match, half, savedAt: D(2026, mon, day) })
  const R = [mk('A-073', '1445555', '1H', 19), mk('A-368', '1453624', '1H', 21), mk('A-1387', '1471525', '1H', 22), mk('A-1387', '1445206', '2H', 22), mk('A-073', '8000001', '1H', 20, 8)]
  const F = (o = {}) => ({ half: '', periodDays: 0, match: '', collector: '', ...o })
  const J = JSON.stringify
  ok('nothing selected: every value of each list is offered, numbers in numeric order', J(facetValues(R, F(), 'match', NOW)) === '["1445206","1445555","1453624","1471525","8000001"]' && J(facetValues(R, F(), 'collector', NOW)) === '["A-073","A-368","A-1387"]' && J(facetValues(R, F(), 'half', NOW)) === '["1H","2H"]')
  ok('YOUR CASE: collector A-073 selected, the Match list offers only A-073\'s matches: 1453624 is NOT among them', J(facetValues(R, F({ collector: 'A-073' }), 'match', NOW)) === '["1445555","8000001"]')
  ok('match 1453624 selected: the Collector list offers only A-368', J(facetValues(R, F({ match: '1453624' }), 'collector', NOW)) === '["A-368"]')
  ok('half follows the others: A-368 has only 1H; A-1387 has 1H and 2H', J(facetValues(R, F({ collector: 'A-368' }), 'half', NOW)) === '["1H"]' && J(facetValues(R, F({ collector: 'A-1387' }), 'half', NOW)) === '["1H","2H"]')
  ok('a list is computed WITHOUT its own selection, so the user can still switch (match 1445555 selected still lists the other matches)', J(facetValues(R, F({ match: '1445555' }), 'match', NOW)) === '["1445206","1445555","1453624","1471525","8000001"]')
  ok('the period narrows every list: Last 30 days drops the August match and nothing else', J(facetValues(R, F({ periodDays: 30 }), 'match', NOW)) === '["1445206","1445555","1453624","1471525"]')
  ok('filters combine: A-1387 + 2H offers only match 1445206', J(facetValues(R, F({ collector: 'A-1387', half: '2H' }), 'match', NOW)) === '["1445206"]')
  ok('a selection with no reviews gives an empty list, not an error', J(facetValues(R, F({ collector: 'A-368', half: '2H' }), 'match', NOW)) === '[]' && J(facetValues([], F(), 'match', NOW)) === '[]')
  ok('half sorting 1H, 2H, ET1, ET2 and unknown halves last', [...['ET2', 'X', '2H', 'ET1', '1H']].sort(compareHalves).join() === '1H,2H,ET1,ET2,X')
  ok('numeric text sorting: 9 before 10 before 100, A-2 before A-10', ['100', '10', '9'].sort(compareNumericText).join() === '9,10,100' && ['A-10', 'A-2'].sort(compareNumericText).join() === 'A-2,A-10')

  // ---- resolveFilters: a selection that has become impossible goes back to All ----
  const same = (a, b) => a.half === b.half && a.match === b.match && a.collector === b.collector && a.periodDays === b.periodDays
  ok('YOUR CASE, collector changed to A-073 while match 1453624 was selected: the MATCH resets, the collector the user picked stays', same(resolveFilters(R, F({ collector: 'A-073', match: '1453624' }), 'collector', NOW), F({ collector: 'A-073' })))
  ok('match changed to 1453624 while collector A-073 was selected: the COLLECTOR resets, the match stays', same(resolveFilters(R, F({ collector: 'A-073', match: '1453624' }), 'match', NOW), F({ match: '1453624' })))
  ok('a possible combination is left exactly alone', same(resolveFilters(R, F({ collector: 'A-1387', match: '1445206', half: '2H' }), 'match', NOW), F({ collector: 'A-1387', match: '1445206', half: '2H' })))
  ok('the period shrinks and the August match is no longer possible: the match resets, the collector (still has October reviews) stays', same(resolveFilters(R, F({ collector: 'A-073', match: '8000001', periodDays: 30 }), null, NOW), F({ collector: 'A-073', periodDays: 30 })))
  ok('after a refresh the collector no longer exists in the data: it resets, and the other valid filters stay', same(resolveFilters(R.filter(x => x.hr !== 'A-368'), F({ collector: 'A-368', half: '1H' }), null, NOW), F({ half: '1H' })))
  ok('a reset does not over-reset: half 1H stays when only the match was impossible', same(resolveFilters(R, F({ collector: 'A-073', match: '1453624', half: '1H' }), 'collector', NOW), F({ collector: 'A-073', half: '1H' })))
  ok('a period with no reviews at all clears every list filter (the empty state is then honest)', (() => { const r = resolveFilters(R, F({ collector: 'A-073', match: '1445555', periodDays: 1 }), null, NOW); return r.collector === '' && r.match === '' && filterReviews(R, r, NOW).length === 0 })())
  ok('the input object is not modified', (() => { const f = F({ collector: 'A-073', match: '1453624' }); resolveFilters(R, f, 'collector', NOW); return f.match === '1453624' })())

  // ---- the guarantee: whatever the user picks from an offered list, the screen is never empty ----
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const pick = a => a[Math.floor(rnd() * a.length)]
  let bad = 0, runs = 0
  for (let i = 0; i < 600; i++) {
    const hrs = ['A-1', 'A-2', 'A-3', 'A-10'], halves = ['1H', '2H', 'ET1']
    const set = Array.from({ length: 1 + Math.floor(rnd() * 14) }, () => rv({ hr: pick(hrs), match: String(100 + Math.floor(rnd() * 6)), half: pick(halves), savedAt: D(2026, 8 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 28)) }))
    let state = F({ periodDays: pick([0, 30, 90]) })
    for (let step = 0; step < 6; step++) {
      const key = pick(['match', 'collector', 'half'])
      const offered = facetValues(set, state, key, NOW)
      const value = pick(['', ...offered])
      state = resolveFilters(set, { ...state, [key]: value }, key, NOW)
      runs++
      const periodOnly = filterReviews(set, { periodDays: state.periodDays }, NOW).length
      if (periodOnly > 0 && filterReviews(set, state, NOW).length === 0) bad++
    }
    const newPeriod = pick([0, 30, 90]); state = resolveFilters(set, { ...state, periodDays: newPeriod }, null, NOW)
    if (filterReviews(set, { periodDays: newPeriod }, NOW).length > 0 && filterReviews(set, state, NOW).length === 0) bad++
  }
  ok(`${runs}+ random sequences of picks from the offered lists and period changes: NEVER an empty screen when the period has reviews`, bad === 0, `${bad} empty`)
}

console.log('totals')
ok('totals sums counts', J(totals([rv({ trainerRows: 3, correct: 1, missed: 1, wrong: 1, extra: 2 }), rv({ trainerRows: 2, correct: 1, missed: 1, wrong: 0, extra: 0 })])) === '{"trainer":5,"correct":2,"missed":2,"wrong":1,"extra":2,"errors":5}')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
