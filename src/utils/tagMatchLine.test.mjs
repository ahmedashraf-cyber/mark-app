import { matchSummaryLine, partLabel } from './tagMatchLine.js'
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + d + ']' : ''}`) }
const L = matchSummaryLine
ok('the exact format from the brief', L({ matchId: '1366067', home: 'Arsenal', away: 'Chelsea', part: 1 }) === 'Match 1366067 - Arsenal vs Chelsea - 1st half', L({ matchId: '1366067', home: 'Arsenal', away: 'Chelsea', part: 1 }))
ok('every Part has its label', [1, 2, 3, 4, 5].map(partLabel).join('|') === '1st half|2nd half|Extra time 1|Extra time 2|Penalties')
ok('part given as the string the start screen stores', L({ matchId: '1454815', home: 'A', away: 'B', part: '2' }) === 'Match 1454815 - A vs B - 2nd half')
ok('surrounding spaces are trimmed', L({ matchId: ' 1454815 ', home: ' A ', away: ' B ', part: 5 }) === 'Match 1454815 - A vs B - Penalties')
ok('no team names recorded: says so', L({ matchId: '1454815', home: '', away: '', part: 1 }) === 'Match 1454815 - teams not recorded - 1st half')
ok('only one team recorded: does not print a half-empty "vs"', L({ matchId: '1454815', home: 'A', away: '', part: 1 }) === 'Match 1454815 - teams not recorded - 1st half')
ok('no Match ID yet -> nothing', L({ matchId: '', home: 'A', away: 'B', part: 1 }) === '')
ok('no Part yet -> nothing', L({ matchId: '1454815', home: 'A', away: 'B', part: null }) === '')
ok('an unknown part -> nothing', L({ matchId: '1454815', home: 'A', away: 'B', part: 9 }) === '')
ok('missing fields do not throw', L({}) === '' && L({ matchId: 1454815, part: 1 }) === 'Match 1454815 - teams not recorded - 1st half')
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
