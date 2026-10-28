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
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
