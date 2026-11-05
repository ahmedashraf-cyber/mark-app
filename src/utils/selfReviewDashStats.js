/**
 * selfReviewDashStats.js: every number on the Self-Review dashboard. Pure functions, no I/O, no React.
 * ============================================================================
 * Input is the list of INCLUDED reviews from selfReviewDashData.processValues (one per half, matched rule B already
 * applied). A review looks like:
 *   { runId, hr, match, half, savedAt: Date, score, trainerRows, correct, missed, wrong, extra }
 *
 * TWO KINDS OF SCORE, never mixed:
 *  - the STORED score of one review (score_percent): shown per review, and used for pass rate, Best, Lowest and the pills.
 *  - the COUNT-BASED scores: sums of counts across the reviews in view. These are the headline Overall score and Correct
 *    ratio, and the same formulas per collector in the leaderboard and per week in the trend. They are NOT a mean of
 *    per-review percentages.
 *
 *  Overall score  = max(0, 100 - sum(missed + wrong_event + collector_only) / sum(trainer_rows) * 100)
 *  Correct ratio  = sum(matched) / sum(trainer_rows) * 100      (collector_only extras are not part of it)
 *  Error rate     = sum(missed + wrong_event + collector_only) / sum(trainer_rows) * 100   (can exceed 100)
 *
 * Every divisor is guarded: no reviewer events means null ("no data"), never NaN or Infinity.
 */
import { PASS_MARK_AMBER_BAND, TREND_DELTA_MIN_SPAN_DAYS } from '../config/selfReviewDashboardConfig.js'

export function totals(rs) {
  let T = 0, C = 0, mi = 0, wr = 0, ex = 0
  for (const x of rs) { T += x.trainerRows; C += x.correct; mi += x.missed; wr += x.wrong; ex += x.extra }
  return { trainer: T, correct: C, missed: mi, wrong: wr, extra: ex, errors: mi + wr + ex }
}

export function overallScore(rs) {
  const t = totals(rs)
  return t.trainer > 0 ? Math.max(0, 100 - t.errors / t.trainer * 100) : null
}
export function correctRatio(rs) {
  const t = totals(rs)
  return t.trainer > 0 ? t.correct / t.trainer * 100 : null
}
export function errorRate(rs) {
  const t = totals(rs)
  return t.trainer > 0 ? t.errors / t.trainer * 100 : null
}
/** Share of reviews whose STORED score is at or above the pass mark, as a whole percent. */
export function passRate(rs, passMark) {
  return rs.length ? Math.round(rs.filter(x => x.score >= passMark).length / rs.length * 100) : null
}
export function bestLowest(rs) {
  if (!rs.length) return { best: null, lowest: null }
  const sc = rs.map(x => x.score)
  return { best: Math.max(...sc), lowest: Math.min(...sc) }
}

/** 'g' at or above the pass mark, 'y' within the amber band below it, otherwise 'r'. */
export function pillClass(score, passMark) {
  if (score >= passMark) return 'g'
  return score >= passMark - PASS_MARK_AMBER_BAND ? 'y' : 'r'
}

const localKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** The viewer's local calendar date, YYYY-MM-DD. */
export const dayKey = localKey
/** The Monday (local time) of the week a date falls in, YYYY-MM-DD. */
export function weekStart(d) {
  return localKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)))
}

/** Reviews narrowed by the four filters. '' means "all". periodDays is a number of days, or 0/null for all time. */
export function filterReviews(reviews, f, now = new Date()) {
  const { half = '', periodDays = 0, match = '', collector = '' } = f || {}
  return reviews.filter(x =>
    (!half || x.half === half) &&
    (!match || x.match === match) &&
    (!collector || x.hr === collector) &&
    (!periodDays || (now - x.savedAt) / 864e5 <= periodDays))
}

// ── Dependent filters ─────────────────────────────────────────────────────────
// Each list-filter (Half, Match ID, Collector) offers only the values that still have reviews once ALL the OTHER filters are
// applied, so no combination the screen offers can come back empty. Period is a time window, not a list of values: it is not
// faceted, and a period with no reviews is an honest empty state.
const HALF_ORDER = ['1H', '2H', 'ET1', 'ET2']
export function compareHalves(a, b) {
  const ia = HALF_ORDER.indexOf(a), ib = HALF_ORDER.indexOf(b)
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  return a.localeCompare(b)
}
export const compareNumericText = (a, b) => a.localeCompare(b, undefined, { numeric: true })
/** Order in which a selection that has become impossible is reset to "All" (the one the user just changed is never reset). */
export const FILTER_RESET_ORDER = ['match', 'collector', 'half']
const FACET_FIELD = { match: 'match', collector: 'hr', half: 'half' }

/** The values `key` can take given every OTHER filter: sorted, distinct. filters: { half, periodDays, match, collector }. */
export function facetValues(reviews, filters, key, now = new Date()) {
  const vals = [...new Set(filterReviews(reviews, { ...filters, [key]: '' }, now).map(x => x[FACET_FIELD[key]]))]
  return vals.sort(key === 'half' ? compareHalves : compareNumericText)
}

/**
 * Returns the filters with every impossible selection reset to "" (All). `changedKey` is the filter the user just changed: it is
 * never reset, the others give way. Pass null after a data refresh, when any selection may have become impossible.
 */
export function resolveFilters(reviews, filters, changedKey = null, now = new Date()) {
  const next = { half: '', periodDays: 0, match: '', collector: '', ...filters }
  for (const key of FILTER_RESET_ORDER) {
    if (key === changedKey || !next[key]) continue
    if (!facetValues(reviews, next, key, now).includes(next[key])) next[key] = ''
  }
  return next
}

/** Weekly points, oldest first: the COUNT-BASED overall score of the reviews saved in that week. */
export function weeklyTrend(rs) {
  const wk = new Map()
  for (const x of rs) {
    const k = weekStart(x.savedAt)
    if (!wk.has(k)) wk.set(k, [])
    wk.get(k).push(x)
  }
  return [...wk.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, list]) => ({ week, n: list.length, overall: overallScore(list) }))
}

/**
 * Later half of the reviews minus the earlier half, both count-based. null (so the screen shows nothing) unless there are more
 * than 3 reviews AND they span at least two weeks: over a few days a "trend" is noise.
 */
export function trendDelta(rs) {
  if (rs.length <= 3) return null
  const sorted = [...rs].sort((a, b) => a.savedAt - b.savedAt || a.runId.localeCompare(b.runId))
  const spanDays = (sorted[sorted.length - 1].savedAt - sorted[0].savedAt) / 864e5
  if (spanDays < TREND_DELTA_MIN_SPAN_DAYS) return null
  const half = Math.floor(sorted.length / 2)
  const later = overallScore(sorted.slice(half)), earlier = overallScore(sorted.slice(0, half))
  return later === null || earlier === null ? null : later - earlier
}

/** Counts for the error breakdown, with each share of all errors. */
export function errorBreakdown(rs) {
  const t = totals(rs)
  const pct = n => (t.errors ? Math.round(n / t.errors * 100) : 0)
  return { total: t.errors, missed: t.missed, wrong: t.wrong, extra: t.extra,
    missedPct: pct(t.missed), wrongPct: pct(t.wrong), extraPct: pct(t.extra) }
}

/** One row per collector, best overall score first; ties by more reviews, then HR-code. */
export function leaderboard(rs, passMark) {
  const by = new Map()
  for (const x of rs) { if (!by.has(x.hr)) by.set(x.hr, []); by.get(x.hr).push(x) }
  return [...by.entries()].map(([hr, list]) => ({
    hr, reviews: list.length, overall: overallScore(list), correct: correctRatio(list),
    passRate: passRate(list, passMark), errorRate: errorRate(list),
  })).sort((a, b) =>
    (b.overall ?? -1) - (a.overall ?? -1) || b.reviews - a.reviews ||
    a.hr.localeCompare(b.hr, undefined, { numeric: true }))
    .map((r, i) => ({ rank: i + 1, ...r }))
}

/** What one table row shows. Correct % is matched / reviewer events for that review. */
export function reviewRow(x) {
  return { runId: x.runId, date: x.savedAt, match: x.match, half: x.half, hr: x.hr, trainerRows: x.trainerRows,
    correct: x.correct, correctPct: x.trainerRows > 0 ? x.correct / x.trainerRows * 100 : null,
    missed: x.missed, wrong: x.wrong, extra: x.extra, score: x.score }
}

/** Sorted copy of the table rows. dir: 1 ascending, -1 descending. Dates and numbers compare as values, text as text. */
export function sortRows(rows, key, dir) {
  const val = r => r[key]
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b)
    let c
    if (x == null && y == null) c = 0
    else if (x == null) c = -1
    else if (y == null) c = 1
    else if (x instanceof Date) c = x - y
    else if (typeof x === 'number') c = x - y
    else c = String(x).localeCompare(String(y), undefined, { numeric: true })
    return c * dir || a.runId.localeCompare(b.runId)
  })
}
