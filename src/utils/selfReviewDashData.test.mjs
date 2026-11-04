// Run: esbuild this file --bundle --platform=node --format=esm, then node. SYNTHETIC data only (fake HR-codes T-xxx):
// this repository is public, so no real collector data belongs in a fixture.
import fs from 'node:fs'
import { processValues, checkHeader, loadDashboardData, DashDataError } from './selfReviewDashData.js'
import { SELF_REVIEW_HEADER, SELF_REVIEW_HEADER_LEGACY, SELF_REVIEW_RESULTS_SPREADSHEET_ID, SELF_REVIEW_RESULTS_TAB } from '../config/selfReviewDashboardConfig.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + d + ']' : ''}`) }
const throwsCode = (fn, code) => { try { fn(); return false } catch (e) { return e instanceof DashDataError && e.code === code } }
const J = JSON.stringify

// one run = one row per result event, the run summary repeated on every row (as Self-Review writes it)
function run({ id, hr = 'T-001', match = '1000001', half = '1H', at = '2026-10-20T10:00:00.000Z', score, trainer = 4, ok: matched, missed = 2, extra = 0, wrong = 0, rows, wide = true }) {
  // CONSISTENT BY DEFAULT: matched = trainer - missed - wrong (check A) and score = the app's own formula to one decimal (check B).
  // A test that needs a contradictory run passes ok / score explicitly.
  if (matched === undefined) matched = trainer - missed - wrong
  if (score === undefined) score = trainer > 0 ? String(Math.round(Math.max(0, 100 - (missed + wrong + extra) / trainer * 100) * 10) / 10) : ''
  const n = rows ?? (trainer + extra)
  const out = []
  for (let i = 0; i < n; i++) {
    const r = [id, at, hr, match, half, score, trainer, matched, missed, extra, 'missed', 'Pass', '1:00', '', '', '', '']
    if (wide) r.push(wrong, '')
    out.push(r)
  }
  return out
}
const sheet = (...runs) => [SELF_REVIEW_HEADER, ...runs.flat()]
const own = hr => ({ scope: 'own', hrCode: hr })
const all = { scope: 'all', hrCode: '' }

console.log('header')
ok('the 19-column header is accepted', J(checkHeader(SELF_REVIEW_HEADER)) === '{"legacy":false}')
ok('the 17-column legacy header is accepted, flagged legacy', J(checkHeader(SELF_REVIEW_HEADER_LEGACY)) === '{"legacy":true}')
ok('trailing blank cells in the header (a CSV keeps them, the API drops them) do not matter', J(checkHeader([...SELF_REVIEW_HEADER, '', ''])) === '{"legacy":false}')
const renamed = SELF_REVIEW_HEADER.map((h, i) => (i === 17 ? 'wrong_events' : h))
ok('a renamed column fails loudly and names the column', throwsCode(() => checkHeader(renamed), 'HEADER_MISMATCH'))
try { checkHeader(renamed) } catch (e) { ok('...the message says which column and what was found', /column 18: expected "wrong_event", found "wrong_events"/.test(e.message), e.message) }
ok('18 columns (neither accepted header) fails', throwsCode(() => checkHeader(SELF_REVIEW_HEADER.slice(0, 18)), 'HEADER_MISMATCH'))
ok('the same columns in another order fail (no silent shift)', throwsCode(() => checkHeader([SELF_REVIEW_HEADER[1], SELF_REVIEW_HEADER[0], ...SELF_REVIEW_HEADER.slice(2)]), 'HEADER_MISMATCH'))
ok('a header mismatch means NOTHING is read from the rows', throwsCode(() => processValues([renamed, ...run({ id: 'a' })], all), 'HEADER_MISMATCH'))
ok('no values at all is TAB_EMPTY', throwsCode(() => processValues([], all), 'TAB_EMPTY') && throwsCode(() => processValues(undefined, all), 'TAB_EMPTY'))
ok('a header with no rows is simply empty, not an error', processValues([SELF_REVIEW_HEADER], all).reviews.length === 0)

console.log('one run, and what is read from it')
{
  const r = processValues(sheet(run({ id: 'a', trainer: 13, ok: 2, missed: 11, extra: 1, score: '7.7' })), all)
  const x = r.reviews[0]
  ok('rows are grouped into one review per run_id', r.reviews.length === 1 && r.runsRead === 1 && r.rowsRead === 14)
  ok('the summary comes from the run: trainer 13, correct 2, missed 11, collector-only 1, stored score 7.7', x.trainerRows === 13 && x.correct === 2 && x.missed === 11 && x.extra === 1 && x.score === 7.7, J(x))
  ok('a complete run (rows = trainer rows + extras) is not flagged incomplete', r.incomplete === 0)
}
ok('a run with fewer rows than its summary says is counted incomplete (a partial copy)', processValues(sheet(run({ id: 'a', trainer: 4, rows: 3 })), all).incomplete === 1)
ok('wrong_event blank on a legacy-width row means 0', processValues([SELF_REVIEW_HEADER_LEGACY, ...run({ id: 'a', wide: false })], all).reviews[0].wrong === 0)
ok('wrong_event is read when present', processValues(sheet(run({ id: 'a', trainer: 6, wrong: 3 })), all).reviews[0].wrong === 3)
ok('numbers (the API) and text (a CSV) give identical reviews',
  J(processValues(sheet(run({ id: 'a', trainer: 4, score: '50', match: '1000001' })), all).reviews[0]) ===
  J(processValues(sheet(run({ id: 'a', trainer: 4, score: 50, match: 1000001 }).map(r => r.map(c => (typeof c === 'string' && /^\d+(\.\d+)?$/.test(c) && c !== r[3] ? Number(c) : c)))), all).reviews[0]))
ok('a numeric match_id becomes a trimmed string', processValues(sheet(run({ id: 'a', match: 1445555 })), all).reviews[0].match === '1445555')
ok('spaces and lower case in HR-code / half are normalised', (() => { const x = processValues(sheet(run({ id: 'a', hr: ' t-001 ', half: ' 1h ' })), all).reviews[0]; return x.hr === 'T-001' && x.half === '1H' })())

console.log('a score of 0 is a real score; rule B')
{
  const zero = processValues(sheet(run({ id: 'z', score: '0', trainer: 8, ok: 1, missed: 7, extra: 2 })), all)
  ok('score "0" (text) is INCLUDED and is never treated as blank', zero.reviews.length === 1 && zero.reviews[0].score === 0 && zero.noComparison === 0, J(zero.reviews))
  ok('score 0 (a number) is INCLUDED too', processValues(sheet(run({ id: 'z', score: 0, trainer: 8, ok: 1, missed: 7, extra: 2 })), all).reviews[0].score === 0)
  ok('...and it is the Lowest, not skipped', processValues(sheet(run({ id: 'z', score: 0, trainer: 4, ok: 0, missed: 4, extra: 1, match: '1' }), run({ id: 'y', match: '2' })), all).reviews.map(x => x.score).sort((a, b) => a - b)[0] === 0)
  const blank = processValues(sheet(run({ id: 'b', score: '', trainer: 0, ok: 0, missed: 0, extra: 3 })), all)
  ok('a blank score (nothing to compare) is excluded and counted', blank.reviews.length === 0 && blank.noComparison === 1)
  ok('trainer_rows = 0 is excluded even if a score were present', processValues(sheet(run({ id: 'b', score: '100', trainer: 0, ok: 0, missed: 0, extra: 2 })), all).noComparison === 1)
  ok('a blank score with trainer rows is excluded (no comparison was scored)', processValues(sheet(run({ id: 'b', score: '', trainer: 3 })), all).noComparison === 1)
}

console.log('loud failures: nothing is silently dropped')
{
  // the change is applied to EVERY row of the run, so the rows agree with each other and only the rule under test can fire
  const bad = (mut, id = 'bad') => { const rows = run({ id }); rows.forEach(mut); return processValues(sheet(run({ id: 'good', match: '9' }), rows), all) }
  const code = (mut) => { try { bad(mut); return null } catch (e) { return e } }
  const why = (e, re) => !!e && e.code === 'BAD_DATA' && e.problems.length === 1 && re.test(e.problems[0].reason) && e.problems[0].runId === 'bad'
  let e = code(r => { r[1] = 46315.4 })
  ok('a saved_at_iso that Sheets converted to a date serial fails loudly, naming the run and the sheet row', why(e, /not an ISO date-time/) && e.problems[0].row === 6 && /bad \(row 6 and 3 more row\(s\)\)/.test(e.message), e?.message)
  e = code(r => { r[1] = 'yesterday' }); ok('non-ISO text in saved_at_iso fails, for that reason', why(e, /not an ISO date-time/), e?.message)
  e = code(r => { r[1] = '2026-10-20 10:00' }); ok('a date without the T separator fails (JavaScript would accept it; we do not guess)', why(e, /not an ISO date-time/), e?.message)
  e = code(r => { r[1] = '2026-10-20' }); ok('a date with no time fails', why(e, /not an ISO date-time/), e?.message)
  e = code(r => { r[1] = '2026-13-45T10:00:00Z' }); ok('an impossible date fails', why(e, /not an ISO date-time/), e?.message)
  e = code(r => { r[6] = 'four' }); ok('a non-numeric trainer_rows fails, naming the column', why(e, /trainer_rows/), e?.message)
  e = code(r => { r[8] = '1.5' }); ok('a fractional count fails, naming the column', why(e, /missed/), e?.message)
  e = code(r => { r[7] = -1 }); ok('a negative count fails', why(e, /matched/), e?.message)
  e = code(r => { r[5] = 101 }); ok('a score above 100 fails', why(e, /score_percent/), e?.message)
  e = code(r => { r[5] = 'ninety' }); ok('a non-numeric score fails', why(e, /score_percent/), e?.message)
  e = code(r => { r[17] = 'x' }); ok('a non-numeric wrong_event fails', why(e, /wrong_event/), e?.message)
  e = code(r => { r[3] = '' }); ok('a blank match_id fails', why(e, /match_id is blank/), e?.message)
  e = code(r => { r[4] = '' }); ok('a blank half fails', why(e, /half is blank/), e?.message)
  e = code(r => { r[2] = '' }); ok('a blank HR-code fails for the all-collectors view', why(e, /collector_hr_code is blank/), e?.message)
  e = code(r => { r[0] = '' }); ok('a row with no run_id fails', e?.code === 'BAD_DATA' && e.problems.every(p => p.runId === '(blank)' && /run_id is blank/.test(p.reason)), e?.message)
  try { processValues(sheet(run({ id: 'x', trainer: 3 }).map((r, i) => (i === 2 ? r.map((c, k) => (k === 5 ? '99' : c)) : r))), all); ok('rows of one run that disagree fail', false) }
  catch (er) { ok('rows of one run that disagree fail and say which rows', er.code === 'BAD_DATA' && /disagree/.test(er.message) && er.problems[0].row === 4, er.message) }
  try { processValues(sheet(run({ id: 'wide', trainer: 14 }).map(r => { r[1] = 'x'; return r })), all); ok('a bad run is reported', false) }
  catch (er) { ok('a 14-row run with one bad date is ONE problem, with the number of affected rows, not fourteen', er.problems.length === 1 && er.problems[0].moreRows === 13 && /1 problem\(s\)/.test(er.message) && /and 13 more row\(s\)/.test(er.message), er.message) }
  const many = processValues.bind(null, sheet(run({ id: 'p', trainer: 1 }).map(r => { r[1] = 'x'; return r }), run({ id: 'q', match: '2', trainer: 1 }).map(r => { r[6] = 'n'; return r })), all)
  try { many(); ok('several problems are all reported', false) } catch (er) { ok('several problems are all reported, not just the first', er.problems.length === 2 && /2 problem/.test(er.message), er.message) }
}

console.log('mixed cell types in one sheet: match_id as a number for some rows and text for others; mangled time cells')
{
  const withMatch = (rows, v) => rows.map(r => { const c = [...r]; c[3] = v; return c })
  const mixed = sheet(withMatch(run({ id: 'num', hr: 'T-001', match: 'x' }), 1445555), withMatch(run({ id: 'txt', hr: 'T-002', match: 'x' }), '1453624'))
  const r = processValues(mixed, all)
  ok('a number in one run and text in another both come out as plain text ids', r.reviews.map(x => x.match).sort().join() === '1445555,1453624' && r.reviews.every(x => typeof x.match === 'string'))
  ok('the Match filter list holds both, sorted as numbers', JSON.stringify(r.matches) === '["1445555","1453624"]')
  ok('a collector whose rows are numbers and one whose rows are text are both read in the own-halves view', processValues(mixed, own('T-001')).reviews[0].match === '1445555' && processValues(mixed, own('T-002')).reviews[0].match === '1453624')
  const half = run({ id: 'half', hr: 'T-001', match: 'x', trainer: 6 }); half.forEach((row, i) => { row[3] = i % 2 ? 1445555 : '1445555' })
  ok('ONE run whose own rows mix number and text for the same match id is not "disagreeing rows": it is one run', processValues(sheet(half), all).reviews.length === 1)
  const dupMixed = processValues(sheet(withMatch(run({ id: 'first', hr: 'T-001', match: 'x' }), 1445555), withMatch(run({ id: 'second', hr: 'T-001', match: 'x', at: '2026-10-25T10:00:00.000Z' }), '1445555')), all)
  ok('the SAME half saved once as a number and once as text is still ONE half: the later run is a duplicate', dupMixed.reviews.length === 1 && dupMixed.duplicates === 1 && dupMixed.reviews[0].runId === 'first')
  ok('a match id with surrounding spaces is trimmed', processValues(sheet(withMatch(run({ id: 'a' }), '  1445555 ')), all).reviews[0].match === '1445555')
  // the dashboard reads NO time column: columns 12 and 13 can hold anything
  const timeShapes = ['2:50', '24:26:00', 2400, 0.0170, '', null, true, '  ', 'abc']
  const odd = run({ id: 'times', hr: 'T-001', match: '5', trainer: 9 }); odd.forEach((row, i) => { row[12] = timeShapes[i % timeShapes.length]; row[13] = timeShapes[(i + 3) % timeShapes.length] })
  const clean = run({ id: 'times', hr: 'T-001', match: '5', trainer: 9 })
  ok('trainer_time / collector_time as text, "24:26:00", a number, a time fraction, blank, boolean or garbage change NOTHING in the result', JSON.stringify(processValues(sheet(odd), all).reviews) === JSON.stringify(processValues(sheet(clean), all).reviews))
}

console.log('a run must agree with ITSELF (check A and check B)')
{
  const fails = (rs, scope = all) => { try { processValues(sheet(...rs), scope); return null } catch (e) { return e.code === 'BAD_DATA' ? e : { code: e.code, problems: [] } } }
  const only = (e, runId, re) => !!e && e.problems.length === 1 && e.problems[0].runId === runId && re.test(e.problems[0].reason)
  // ---- check A: trainer_rows = matched + wrong_event + missed ----
  let e = fails([run({ id: 'x', ok: 3 })])
  ok('A fires: reviewer events 4 but matched 3 + wrong 0 + missed 2 = 5; it names the run and the check and shows the sum', only(e, 'x', /check A failed/) && /\(3 \+ 0 \+ 2 = 5\)/.test(e.problems[0].reason) && /check A/.test(e.message) && /x \(row 2/.test(e.message), e?.message)
  ok('A includes wrong_event: 5 matched + 3 missed + 1 wrong = 9 against 10 fires, 6 matched passes', only(fails([run({ id: 'w', trainer: 10, ok: 5, missed: 3, wrong: 1 })]), 'w', /check A failed/) && fails([run({ id: 'w', trainer: 10, ok: 6, missed: 3, wrong: 1 })]) === null)
  ok('A fires the other way too (fewer accounted for than reviewer events)', only(fails([run({ id: 'x', trainer: 5, ok: 1, missed: 2 })]), 'x', /check A failed/))
  ok('A is checked on a run with a blank score as well (3 reviewer events, none accounted for)', only(fails([run({ id: 'b', trainer: 3, ok: 0, missed: 0, score: '' })]), 'b', /check A failed/))
  ok('a blank-score run with nothing to compare passes both checks (0 = 0 + 0 + 0, no score to check)', fails([run({ id: 'b', trainer: 0, ok: 0, missed: 0, extra: 3, score: '' })]) === null)
  // ---- check B: stored score vs the formula, tolerance 0.1 ----
  e = fails([run({ id: 'x', trainer: 20, ok: 12, missed: 8, extra: 3, score: '55' })])
  ok('B fires on your 1450008 case: 8 missed + 3 collector-only over 20 is 45.0%, stored 55', only(e, 'x', /check B failed/) && /stored score 55%/.test(e.problems[0].reason) && /give 45\.0%/.test(e.problems[0].reason), e?.message)
  ok('...and the corrected score 45 passes', fails([run({ id: 'x', trainer: 20, ok: 12, missed: 8, extra: 3, score: '45' })]) === null)
  ok('A fires on your 1450007 case: 25 reviewer events, 25 correct + 1 missed = 26', only(fails([run({ id: 'x', trainer: 25, ok: 25, missed: 1, score: '96' })]), 'x', /check A failed/) && /25 \+ 0 \+ 1 = 26/.test(fails([run({ id: 'x', trainer: 25, ok: 25, missed: 1, score: '96' })]).problems[0].reason))
  ok('...and the corrected run (24 correct + 1 missed, 96.0%) passes', fails([run({ id: 'x', trainer: 25, ok: 24, missed: 1, score: '96' })]) === null)
  ok('B fires on your 1450003 case: 7 correct of 9 is 77.8%, stored 78.0 is 0.2 away', only(fails([run({ id: 'x', trainer: 9, ok: 7, missed: 2, score: '78' })]), 'x', /check B failed/))
  ok('...and 77.8 passes', fails([run({ id: 'x', trainer: 9, ok: 7, missed: 2, score: '77.8' })]) === null)
  ok('tolerance edges: 0.1 away passes (50.1, 49.9); 0.2 away fails (50.2, 49.8)', fails([run({ id: 'x', score: '50.1' })]) === null && fails([run({ id: 'x', score: '49.9' })]) === null && !!fails([run({ id: 'x', score: '50.2' })]) && !!fails([run({ id: 'x', score: '49.8' })]))
  ok('rounding the app does (7 / 13 -> 7.7 for 7.692) passes', fails([run({ id: 'x', trainer: 13, ok: 2, missed: 11, extra: 1, score: '7.7' })]) === null)
  ok('collector-only extras count in the formula: 9 of 10 right with 3 extras is 60.0%, so a stored 90 fails and 60 passes', !!fails([run({ id: 'x', trainer: 10, ok: 9, missed: 1, extra: 3, score: '90' })]) && fails([run({ id: 'x', trainer: 10, ok: 9, missed: 1, extra: 3, score: '60' })]) === null)
  ok('wrong_event counts in the formula too: 10 events, 5 matched, 2 missed, 3 wrong is 50.0%', fails([run({ id: 'x', trainer: 10, ok: 5, missed: 2, wrong: 3, score: '50' })]) === null && !!fails([run({ id: 'x', trainer: 10, ok: 5, missed: 2, wrong: 3, score: '70' })]))
  ok('the floor at 0: errors above the reviewer events give 0, so a stored 0 passes and a stored 5 fails', fails([run({ id: 'x', trainer: 2, ok: 0, missed: 2, extra: 20, score: '0' })]) === null && only(fails([run({ id: 'x', trainer: 2, ok: 0, missed: 2, extra: 20, score: '5' })]), 'x', /check B failed/))
  ok('a stored 0 that the counts do NOT justify fails (0 is a real score, not a pass-everything value)', only(fails([run({ id: 'x', trainer: 4, ok: 2, missed: 2, score: '0' })]), 'x', /check B failed/))
  ok('a perfect run: 100 passes', fails([run({ id: 'x', trainer: 6, ok: 6, missed: 0, score: '100' })]) === null)
  // ---- reporting ----
  e = fails([run({ id: 'x', trainer: 20, ok: 11, missed: 8, extra: 3, score: '55' })])
  ok('a run that fails BOTH is two problems for one run, each saying which check', !!e && e.problems.length === 2 && e.problems.map(p => p.reason.slice(0, 7)).sort().join() === 'check A,check B' && /2 problem/.test(e.message), e?.message)
  ok('a 25-row run that fails is ONE problem per check, not 25', (() => { const x = fails([run({ id: 'x', trainer: 25, ok: 3, missed: 1 })]); return x.problems.length === 1 && x.problems[0].moreRows === 0 })())
  ok('no scores are shown when any run fails: it is an error, not a partial result', e.code === 'BAD_DATA')
  ok('an ignored later duplicate is still checked (a corrupt row is corrupt wherever it sits)', only(fails([run({ id: 'first' }), run({ id: 'later', at: '2026-10-25T10:00:00.000Z', ok: 3 })]), 'later', /check A failed/))
  ok('legacy 17-column runs (no wrong_event) are checked with wrong_event = 0 and pass when consistent', processValues([SELF_REVIEW_HEADER_LEGACY, ...run({ id: 'l', wide: false })], all).reviews.length === 1)
  ok('scope: a collector\'s OWN inconsistent run is an error for them', !!fails([run({ id: 'x', hr: 'T-001', ok: 3 })], own('T-001')))
  ok('scope: ANOTHER collector\'s inconsistent run does not block or leak into a collector\'s view', fails([run({ id: 'mine', hr: 'T-001' }), run({ id: 'theirs', hr: 'T-002', match: '2', ok: 3 })], own('T-001')) === null)
  ok('...but the all-collectors view does fail on it', only(fails([run({ id: 'mine', hr: 'T-001' }), run({ id: 'theirs', hr: 'T-002', match: '2', ok: 3 })]), 'theirs', /check A failed/))
}

console.log('scope: a collector only ever receives their own rows')
{
  const data = sheet(run({ id: 'a', hr: 'T-001', match: '1', half: '1H' }), run({ id: 'b', hr: 'T-002', match: '2', half: '1H' }),
    run({ id: 'c', hr: 'T-003', match: '3', half: '2H', score: '', trainer: 0, ok: 0, missed: 0, extra: 2 }), run({ id: 'd', hr: 'T-001', match: '1', half: '1H', at: '2026-10-25T10:00:00.000Z' }))
  const mine = processValues(data, own('T-001'))
  ok('own scope: only T-001 comes back (verified on the returned rows, not on the screen)', mine.reviews.length === 1 && mine.reviews.every(x => x.hr === 'T-001'), J(mine.reviews.map(x => x.hr)))
  ok('own scope: the lists offered to the filters hold only own values', J(mine.collectors) === '["T-001"]' && J(mine.matches) === '["1"]')
  ok('own scope: counts are own only (1 later duplicate, T-003\'s blank run is not counted against T-001)', mine.duplicates === 1 && mine.noComparison === 0 && mine.rowsRead === 8, J({ d: mine.duplicates, n: mine.noComparison, r: mine.rowsRead }))
  ok('own scope matches the HR-code regardless of case and spaces', processValues(data, own('  t-001 ')).reviews.length === 1)
  ok('asking for another collector is impossible: the scope only knows the caller\'s own code', processValues(data, own('T-002')).reviews.every(x => x.hr === 'T-002'))
  const everyone = processValues(data, all)
  ok('all scope: every collector is returned', J(everyone.collectors) === '["T-001","T-002"]' && everyone.noComparison === 1 && everyone.duplicates === 1)
  ok('own scope with no HR-code returns nothing and says why', (() => { const r = processValues(data, own('')); return r.reviews.length === 0 && r.reason === 'NO_HR_CODE' })())
  ok('an unknown scope is refused, never treated as "all"', throwsCode(() => processValues(data, { scope: 'everything', hrCode: 'T-001' }), 'BAD_SCOPE') && throwsCode(() => processValues(data, undefined), 'BAD_SCOPE'))
  const poisoned = sheet(run({ id: 'a', hr: 'T-001' }), run({ id: 'x', hr: 'T-009', match: '9' }).map(r => { r[1] = 'garbage'; return r }))
  ok('a broken row belonging to ANOTHER collector cannot be reported to (or break the view of) a collector', processValues(poisoned, own('T-001')).reviews.length === 1)
  ok('...but the all-collectors view does fail on it', throwsCode(() => processValues(poisoned, all), 'BAD_DATA'))
}

console.log('one review per half: the earliest run')
{
  const early = run({ id: 'early', score: '25', trainer: 4, ok: 1, missed: 3, at: '2026-10-20T10:00:00.000Z' })
  const late = run({ id: 'late', score: '100', trainer: 4, ok: 4, missed: 0, at: '2026-10-22T10:00:00.000Z' })
  const r = processValues(sheet(late, early), all)
  ok('the earliest run is the review, even when a later one scored better; the order in the sheet does not matter', r.reviews.length === 1 && r.reviews[0].runId === 'early' && r.reviews[0].score === 25)
  ok('later runs are counted as duplicates', r.duplicates === 1)
  ok('the same saved_at: the smaller run_id wins, deterministically', processValues(sheet(run({ id: 'b2', at: '2026-10-20T10:00:00.000Z' }), run({ id: 'a1', at: '2026-10-20T10:00:00.000Z' })), all).reviews[0].runId === 'a1')
  const blankFirst = processValues(sheet(run({ id: 'first', score: '', trainer: 0, ok: 0, missed: 0, extra: 2, at: '2026-10-20T10:00:00.000Z' }), run({ id: 'second', at: '2026-10-22T10:00:00.000Z' })), all)
  ok('a blank-score EARLIEST run is excluded and a later valid run does NOT replace it (same as Self-Review)', blankFirst.reviews.length === 0 && blankFirst.noComparison === 1 && blankFirst.duplicates === 1, J({ n: blankFirst.noComparison, d: blankFirst.duplicates }))
  ok('different halves of one match are separate reviews', processValues(sheet(run({ id: 'a', half: '1H' }), run({ id: 'b', half: '2H' })), all).reviews.length === 2)
  ok('different collectors of one match/half are separate reviews', processValues(sheet(run({ id: 'a', hr: 'T-001' }), run({ id: 'b', hr: 'T-002' })), all).reviews.length === 2)
}

console.log('filter option lists come from the data')
{
  const r = processValues(sheet(run({ id: 'a', half: 'ET1', match: '10' }), run({ id: 'b', half: '2H', match: '9' }), run({ id: 'c', half: '1H', match: '100' }), run({ id: 'd', half: 'ET2', match: '1' })), all)
  ok('halves are the ones present, in 1H, 2H, ET1, ET2 order (extra time included)', J(r.halves) === '["1H","2H","ET1","ET2"]', J(r.halves))
  ok('match ids sort as numbers, not text', J(r.matches) === '["1","9","10","100"]', J(r.matches))
  ok('a half that is not in the data is not offered', J(processValues(sheet(run({ id: 'a', half: '1H' })), all).halves) === '["1H"]')
}

console.log('the loader (Sheets call mocked)')
{
  const good = { ok: true, status: 200, json: async () => ({ values: sheet(run({ id: 'a' })) }) }
  let calls = []
  const mk = res => ({ getToken: async () => 'tok', fetch: async (u, o) => { calls.push({ u, o }); if (res instanceof Error) throw res; return res } })
  const r = await loadDashboardData(all, mk(good))
  ok('a good read returns the processed reviews', r.reviews.length === 1)
  const u = calls[0].u
  ok('it reads the config spreadsheet id and tab, whole columns A:S, unformatted values', u.includes(`/${SELF_REVIEW_RESULTS_SPREADSHEET_ID}/`) && u.includes(encodeURIComponent(`'${SELF_REVIEW_RESULTS_TAB}'!A:S`)) && u.includes('valueRenderOption=UNFORMATTED_VALUE'), u)
  ok('it authenticates with the service-account Bearer token, never an API key', calls[0].o.headers.Authorization === 'Bearer tok' && !/[?&]key=/.test(u))
  ok('there is no row cap in the range (the 50,000-row limit does not apply to the dashboard)', !/50000/.test(u))
  const errCode = async res => { try { await loadDashboardData(all, mk(res)); return null } catch (e) { return e.code } }
  ok('a missing tab (HTTP 400 "Unable to parse range") is TAB_MISSING', await errCode({ ok: false, status: 400, json: async () => ({ error: { message: 'Unable to parse range: Collector Self Review!A:S' } }) }) === 'TAB_MISSING')
  ok('HTTP 404 is SHEET_MISSING', await errCode({ ok: false, status: 404, json: async () => ({}) }) === 'SHEET_MISSING')
  ok('HTTP 403 is NO_ACCESS', await errCode({ ok: false, status: 403, json: async () => ({ error: { message: 'x' } }) }) === 'NO_ACCESS')
  ok('HTTP 500 is READ_FAILED, with its message', await errCode({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }) === 'READ_FAILED')
  ok('a network failure is NETWORK', await errCode(new Error('offline')) === 'NETWORK')
  ok('an empty tab (no values) is TAB_EMPTY', await errCode({ ok: true, status: 200, json: async () => ({}) }) === 'TAB_EMPTY')
  ok('a response that is not JSON does not crash', await errCode({ ok: false, status: 502, json: async () => { throw new Error('html') } }) === 'READ_FAILED')
  calls = []
  const none = await loadDashboardData(own(''), mk(good))
  ok('own scope with no HR-code does not even call Google', calls.length === 0 && none.reason === 'NO_HR_CODE')
  ok('no token is a clear NO_TOKEN', await (async () => { try { await loadDashboardData(all, { getToken: async () => '', fetch: async () => good }); return null } catch (e) { return e.code } })() === 'NO_TOKEN')
}

console.log('single source of truth')
{
  const src = fs.readFileSync('src/utils/selfReviewDashData.js', 'utf8')
  ok('the data layer holds no spreadsheet id and no tab-name literal of its own', !/1l3tYwre|1XGVp4o7|'Collector Self Review'/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
