// SYNTHETIC data only. Dates are built from local parts so the suite does not depend on the machine's time zone.
import {
  totals, overallScore, correctRatio, errorRate, passRate, bestLowest, pillClass, filterReviews, weekStart, weeklyTrend, trendDelta,
  errorBreakdown, leaderboard, reviewRow, sortRows, dayKey,
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

console.log('totals')
ok('totals sums counts', J(totals([rv({ trainerRows: 3, correct: 1, missed: 1, wrong: 1, extra: 2 }), rv({ trainerRows: 2, correct: 1, missed: 1, wrong: 0, extra: 0 })])) === '{"trainer":5,"correct":2,"missed":2,"wrong":1,"extra":2,"errors":5}')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
