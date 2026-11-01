import { canonHr, sameHr, canOpenAttempt, visibleAttempts, visibleAnswerRows, visibleAssignments, REVIEW_REFUSAL } from './drillAccess.js'
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 200) + ']' : ''}`) }
const s = (id, hr, o = {}) => ({ result_id: id, quiz_id: 'q', trainee_hr_code: hr, ...o })
const A = { hrCode: 'C-1', canSeeAll: false }, TR = { hrCode: 'T-9', canSeeAll: true }
const all = [s('a1', 'C-1'), s('a2', 'C-1'), s('b1', 'C-2'), s('b2', 'C-2'), s('c1', 'C-3'), ...Array.from({ length: 30 }, (_, i) => s('x' + i, 'C-' + (100 + i)))]

console.log('the HR-code rule')
ok('case and surrounding spaces: " c-1 " is C-1', sameHr(' c-1 ', 'C-1') && sameHr('C-1\n', 'c-1'))
ok('spaces inside a code are ignored, as in the rest of MARK', sameHr('C - 1', 'C-1'))
ok('en dash, em dash, non-breaking hyphen (and the other typographic dashes) are a hyphen', ['\u2013', '\u2014', '\u2011', '\u2010', '\u2012', '\u2015', '\u2212'].every(d => sameHr(`C${d}1`, 'C-1')))
ok('C1 (no hyphen) is NOT C-1, and C-10 is not C-1', !sameHr('C1', 'C-1') && !sameHr('C-10', 'C-1') && !sameHr('C-1', 'C-11'))
ok('no Unicode folding: a full-width "Ｃ－1" is not C-1', !sameHr('\uFF23\uFF0D1', 'C-1'))
ok('an empty code matches nothing, not even another empty one', !sameHr('', '') && !sameHr(' ', null) && !sameHr('C-1', ''))

console.log('trainee A sees only A\'s attempts (35 in the sheet, 2 are A\'s)')
const mine = visibleAttempts(all, A)
ok('exactly A\'s two attempts, nobody else\'s', mine.map(x => x.result_id).join() === 'a1,a2', mine.map(x => x.result_id).join())
ok('B\'s attempts are not visible to A', !visibleAttempts(all, A).some(x => x.trainee_hr_code === 'C-2'))
console.log('A cannot open B\'s attempt by id')
ok('canOpenAttempt: own yes, B\'s no, a stranger\'s no', canOpenAttempt(all[0], A) && !canOpenAttempt(all[2], A) && !canOpenAttempt(all[10], A))
ok('looking an attempt up by its result id gives the same answer', ['b1', 'b2', 'c1', 'x7'].every(id => !canOpenAttempt(all.find(x => x.result_id === id), A)) && ['a1', 'a2'].every(id => canOpenAttempt(all.find(x => x.result_id === id), A)))
ok('an attempt that does not exist cannot be opened', !canOpenAttempt(undefined, A) && !canOpenAttempt(null, TR))
console.log('a trainer sees all')
ok('a trainer sees every attempt, 35 of 35', visibleAttempts(all, TR).length === all.length)
ok('a trainer can open anyone\'s attempt', all.every(x => canOpenAttempt(x, TR)))
ok('canSeeAll must be exactly true (a string or 1 does not count)', !canOpenAttempt(all[2], { hrCode: 'C-1', canSeeAll: 'true' }) && !canOpenAttempt(all[2], { hrCode: 'C-1', canSeeAll: 1 }))
console.log('an HR-code with different case or a dash variant still matches its owner')
const odd = [s('o1', 'c-1'), s('o2', ' C-1 '), s('o3', 'C\u20131'), s('o4', 'c\u20111'), s('o5', 'C 1'), s('o6', 'C1'), s('o7', 'C-2'), s('o8', '')]
ok('lower case, spaces, en dash and non-breaking hyphen all reach their owner (o1 to o4)', visibleAttempts(odd, A).map(x => x.result_id).join() === 'o1,o2,o3,o4', visibleAttempts(odd, A).map(x => x.result_id).join())
ok('"C 1" and "C1" (no hyphen: could be someone else), C-2 and a blank code do not', !visibleAttempts(odd, A).some(x => ['o5', 'o6', 'o7', 'o8'].includes(x.result_id)))
console.log('it fails CLOSED')
ok('no viewer: nothing', visibleAttempts(all, undefined).length === 0 && !canOpenAttempt(all[0], undefined) && !canOpenAttempt(all[0], {}))
ok('a viewer whose own HR-code is unknown sees nothing (not everything)', visibleAttempts(all, { hrCode: '', canSeeAll: false }).length === 0 && visibleAttempts(all, { hrCode: undefined }).length === 0)
ok('a blank-code row is not "owned" by a viewer with a blank code', visibleAttempts([s('z', '')], { hrCode: '' }).length === 0)
console.log('the answers and assignments are cut down where they are read')
const ans = [...all.map(x => ({ result_id: x.result_id, clip_index: '1', verdict: 'correct' })), { result_id: 'orphan', clip_index: '1' }]
const myAns = visibleAnswerRows(ans, all, A)
ok('A gets only the answer rows of A\'s two attempts (an orphan row is dropped too)', myAns.map(r => r.result_id).join() === 'a1,a2', myAns.map(r => r.result_id).join())
ok('a trainer gets every answer row, as before', visibleAnswerRows(ans, all, TR).length === ans.length)
ok('no sessions read means no answers, never all of them', visibleAnswerRows(ans, undefined, A).length === 0 && visibleAnswerRows(ans, [], A).length === 0)
const asg = [{ trainee_hr_code: 'C-1' }, { trainee_hr_code: 'C-2' }, { trainee_hr_code: 'c\u20131' }]
ok('assignments: A keeps their own two (one with a dash variant), a trainer keeps all', visibleAssignments(asg, A).length === 2 && visibleAssignments(asg, TR).length === 3)
ok('the refusal wording', REVIEW_REFUSAL === 'You can only review your own attempts.')
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
