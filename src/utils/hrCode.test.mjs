import { canonHr, sameHr } from './hrCode.js'
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + d + ']' : ''}`) }
ok('case: a-1650 is A-1650 (and A-1453)', sameHr('a-1650', 'A-1650') && sameHr('A-1453', 'a-1453'))
ok('spaces, tabs and newlines are ignored', sameHr(' A-1650 ', 'A-1650') && sameHr('A - 1650', 'A-1650') && sameHr('A-1650\n', 'A-1650') && sameHr('A\t-1650', 'a-1650'))
ok('non-breaking space and zero-width characters are ignored', sameHr('A-1650\u00A0', 'A-1650') && sameHr('A\u200B-1650', 'A-1650') && sameHr('\uFEFFA-1650', 'A-1650'))
ok('typographic dashes count as a hyphen (en, em, minus, non-breaking, full-width)', ['\u2013', '\u2014', '\u2212', '\u2011', '\uFF0D', '\u2010'].every(d => sameHr(`A${d}1650`, 'A-1650')))
ok('A1650 (no hyphen) is NOT A-1650: it could be someone else', !sameHr('A1650', 'A-1650'))
ok('different numbers or letters are different people', !sameHr('A-1650', 'A-1651') && !sameHr('A-1650', 'B-1650'))
ok('an empty code matches nothing, not even another empty one', !sameHr('', '') && !sameHr(' ', '') && !sameHr(null, undefined) && !sameHr('A-1', ''))
ok('numbers and non-strings do not crash', canonHr(1650) === '1650' && canonHr(null) === '' && canonHr(undefined) === '')
ok('canonical form is upper-case, hyphenated, no blanks', canonHr(' a\u2013 1650 ') === 'A-1650')
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
