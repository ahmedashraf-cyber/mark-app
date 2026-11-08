import { findOwnHalfIn } from './fieldSheetSync.js'
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + d + ']' : ''}`) }
const HEAD = ['schema_version', 'session_id', 'match_id', 'half', 'collector_hr_code']
const row = (sid, m, h, hr) => ['3', sid, m, h, hr]
const F = findOwnHalfIn
const rows = [HEAD, row('s1', '1366067', '1H', 'C-77'), row('s2', '1366067', '2H', 'C-77'), row('s3', '1366067', '1H', 'C-12')]
console.log('sheet rows')
ok('same collector, same match, same half -> found, with the session id from column B (not the schema version)', F({ rows, matchId: '1366067', half: '1H', hrCode: 'C-77' })?.sessionId === 's1')
ok('same match, OTHER half -> not found', F({ rows, matchId: '1366067', half: 'ET1', hrCode: 'C-77' }) === null)
ok('same match and half but ANOTHER collector -> not found (someone else saved it)', F({ rows: [HEAD, row('s3', '1366067', '1H', 'C-12')], matchId: '1366067', half: '1H', hrCode: 'C-77' }) === null)
ok('different match -> not found', F({ rows, matchId: '1366068', half: '1H', hrCode: 'C-77' }) === null)
ok('the header row can never match', F({ rows: [['schema_version', 'session_id', '1366067', '1H', 'C-77']], matchId: '1366067', half: '1H', hrCode: 'C-77' }) === null)
ok('HR code compared ignoring case and spaces', F({ rows, matchId: '1366067', half: '1H', hrCode: ' c-77 ' })?.sessionId === 's1')
ok('an old doubled half (1HH) still counts as 1H', F({ rows: [HEAD, row('s9', '1366067', '1HH', 'C-77')], matchId: '1366067', half: '1H', hrCode: 'C-77' })?.sessionId === 's9')
ok('a legacy half written as "1" counts as 1H', F({ rows: [HEAD, row('s8', '1366067', '1', 'C-77')], matchId: '1366067', half: '1H', hrCode: 'C-77' })?.sessionId === 's8')
ok('match id from the sheet with stray spaces still matches', F({ rows: [HEAD, row('s7', ' 1366067 ', '1H', 'C-77')], matchId: '1366067', half: '1H', hrCode: 'C-77' })?.sessionId === 's7')
console.log('this PC\'s own list')
const loc = (o) => ({ sessionId: 'L1', matchId: '1366067', half: '1H', collectorHrCode: 'C-77', status: 'completed', ...o })
ok('saved locally, not yet in the sheet (upload pending) -> found', F({ rows: [HEAD], local: [loc({ status: 'pending_sheet_upload' })], matchId: '1366067', half: '1H', hrCode: 'C-77' })?.source === 'local')
ok('a completed local session -> found', F({ rows: [], local: [loc()], matchId: '1366067', half: '1H', hrCode: 'C-77' })?.sessionId === 'L1')
ok('an unfinished (in progress) local session does NOT count', F({ rows: [], local: [loc({ status: 'in_progress' })], matchId: '1366067', half: '1H', hrCode: 'C-77' }) === null)
ok('a discarded local session does NOT count', F({ rows: [], local: [loc({ status: 'discarded' })], matchId: '1366067', half: '1H', hrCode: 'C-77' }) === null)
ok("another collector's local session on a shared PC does NOT count", F({ rows: [], local: [loc({ collectorHrCode: 'C-12' })], matchId: '1366067', half: '1H', hrCode: 'C-77' }) === null)
console.log('missing input')
ok('no HR code -> cannot say, returns null (never blocks)', F({ rows, matchId: '1366067', half: '1H', hrCode: '' }) === null)
ok('no half / no match id -> null', F({ rows, matchId: '', half: '1H', hrCode: 'C-77' }) === null && F({ rows, matchId: '1366067', half: '', hrCode: 'C-77' }) === null)
ok('nothing read at all does not throw', F({ matchId: '1366067', half: '1H', hrCode: 'C-77' }) === null)
console.log('email first (rows read as A:F: column F is collector_email)')
const HEAD6 = [...HEAD, 'collector_email'], row6 = (sid, m, h, hr, em) => ['3', sid, m, h, hr, em]
const rows6 = [HEAD6, row6('e1', '1366067', '1H', 'C-1', 'ali@x.com'), row6('e2', '1366067', '2H', 'C-77', 'bob@x.com'), row6('e3', '1366067', '1H', 'C-5', '')]
ok('my email matches although the row\'s code is different: found, matchedBy email', (() => { const r = F({ rows: rows6, matchId: '1366067', half: '1H', identity: { email: 'Ali@x.com', hrCode: 'C-77' } }); return r?.sessionId === 'e1' && r.matchedBy === 'email' && r.source === 'sheet' })())
ok('a row with SOMEONE ELSE\'S email is not mine even though its code is mine (e2 carries C-77 and bob\'s email)', F({ rows: rows6, matchId: '1366067', half: '2H', identity: { email: 'ali@x.com', hrCode: 'C-77' } }) === null)
ok('a row with no email falls back to the HR-code: matchedBy hr', (() => { const r = F({ rows: rows6, matchId: '1366067', half: '1H', identity: { email: 'new@x.com', hrCode: 'c-5' } }); return r?.sessionId === 'e3' && r.matchedBy === 'hr' })())
ok('an account with only an email (the full-access / no-code case) is checked by email and never skipped', F({ rows: rows6, matchId: '1366067', half: '1H', identity: { email: 'ali@x.com', hrCode: '' } })?.sessionId === 'e1')
ok('...and does not match a no-email row (no code to compare)', F({ rows: [HEAD6, row6('e3', '1366067', '1H', 'C-5', '')], matchId: '1366067', half: '1H', identity: { email: 'boss@x.com', hrCode: '' } }) === null)
ok('separate email + hrCode arguments work the same as an identity', F({ rows: rows6, matchId: '1366067', half: '1H', email: 'ali@x.com', hrCode: 'C-77' })?.sessionId === 'e1')
ok('no email and no code: null, never a guess', F({ rows: rows6, matchId: '1366067', half: '1H', identity: { email: '', hrCode: '' } }) === null)
const loc2 = o => ({ sessionId: 'L2', matchId: '1366067', half: '1H', status: 'completed', collectorHrCode: 'C-12', collectorEmail: 'ali@x.com', ...o })
ok('a session saved on THIS PC under my email but a mistyped code is found, matchedBy email', (() => { const r = F({ rows: [], local: [loc2()], matchId: '1366067', half: '1H', identity: { email: 'ali@x.com', hrCode: 'C-77' } }); return r?.sessionId === 'L2' && r.source === 'local' && r.matchedBy === 'email' })())
ok('a local session carrying my code but ANOTHER email on a shared PC does not count', F({ rows: [], local: [loc2({ collectorHrCode: 'C-77', collectorEmail: 'bob@x.com' })], matchId: '1366067', half: '1H', identity: { email: 'ali@x.com', hrCode: 'C-77' } }) === null)
ok('an older local session with no email still matches by code', F({ rows: [], local: [loc2({ collectorEmail: undefined, collectorHrCode: 'C-77' })], matchId: '1366067', half: '1H', identity: { email: 'ali@x.com', hrCode: 'C-77' } })?.matchedBy === 'hr')
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
