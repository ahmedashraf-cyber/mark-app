import { canonHr, sameHr } from './hrCode.js'
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + d + ']' : ''}`) }
ok('case: a-1650 is A-1650 (and A-1453)', sameHr('a-1650', 'A-1650') && sameHr('A-1453', 'a-1453'))
ok('trimmed: leading and trailing spaces, tabs and newlines', sameHr(' A-1650 ', 'A-1650') && sameHr('A-1650\n', 'A-1650') && sameHr('\tA-1650', 'a-1650'))
ok('spaces inside a code are ignored, as in the rest of MARK', sameHr('A - 1650', 'A-1650') && sameHr('A\t-1650', 'a-1650'))
ok('a non-breaking space (it is whitespace) is ignored', sameHr('A-1650\u00A0', 'A-1650'))
ok('en dash, em dash and non-breaking hyphen (the three you named) count as a hyphen', ['\u2013', '\u2014', '\u2011'].every(d => sameHr(`A${d}1650`, 'A-1650')))
ok('the other typographic dashes too: hyphen, figure dash, horizontal bar, minus sign', ['\u2010', '\u2012', '\u2015', '\u2212'].every(d => sameHr(`A${d}1650`, 'A-1650')))
ok('A1650 (no hyphen) is NOT A-1650: it could be someone else', !sameHr('A1650', 'A-1650') && !sameHr('A-1650', 'A1650'))
ok('different numbers or letters are different people', !sameHr('A-1650', 'A-1651') && !sameHr('A-1650', 'B-1650') && !sameHr('A-1650', 'A-16500'))
ok('an empty code matches nothing, not even another empty one', !sameHr('', '') && !sameHr(' ', '') && !sameHr(null, undefined) && !sameHr('A-1', ''))
ok('numbers and non-strings do not crash', canonHr(1650) === '1650' && canonHr(null) === '' && canonHr(undefined) === '')
ok('canonical form is upper-case, hyphenated, no blanks', canonHr(' a\u2013 1650 ') === 'A-1650')
// the Unicode folding was DROPPED: these used to match and now do not (they fail SAFE: a person sees no halves, never someone else's)
ok('NO Unicode folding: a full-width "Ａ－1650" is not A-1650', !sameHr('\uFF21\uFF0D1650', 'A-1650') && !sameHr('A-\uFF11\uFF16\uFF15\uFF10', 'A-1650'))
ok('NO invisible-character stripping: a zero-width space inside a code is not ignored', !sameHr('A\u200B-1650', 'A-1650'))
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
