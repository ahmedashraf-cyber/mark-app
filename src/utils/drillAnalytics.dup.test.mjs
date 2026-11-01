import { duplicateAttemptNumbers, traineeRows } from './drillAnalytics.js'
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 160) + ']' : ''}`) }
const a = (hr, n, o = {}) => ({ quiz_id: 'q', trainee_hr_code: hr, attempt_number: n, score_percent: '50', passed: '0', is_test_run: '0', status: 'completed', ...o })
ok('no attempts: none', duplicateAttemptNumbers([]).length === 0 && duplicateAttemptNumbers(undefined).length === 0)
ok('numbers 1, 2, 3: none', duplicateAttemptNumbers([a('C-1', '1'), a('C-1', '2'), a('C-1', '3')]).length === 0)
ok('two attempts numbered 2: [2]', JSON.stringify(duplicateAttemptNumbers([a('C-1', '1'), a('C-1', '2'), a('C-1', '2')])) === '[2]')
ok('three numbered 2 and two numbered 3: [2, 3]', JSON.stringify(duplicateAttemptNumbers([a('C-1', 2), a('C-1', 2), a('C-1', 2), a('C-1', 3), a('C-1', 3)])) === '[2,3]')
ok('"2" and 2 are the same number', JSON.stringify(duplicateAttemptNumbers([a('C-1', '2'), a('C-1', 2)])) === '[2]')
ok('blank or non-numeric numbers are ignored (unknown, not duplicate)', duplicateAttemptNumbers([a('C-1', ''), a('C-1', ''), a('C-1', 'x'), a('C-1', 'x')]).length === 0)
const rowsFor = sessions => traineeRows({ assignments: [{ quiz_id: 'q', trainee_hr_code: 'C-1', trainee_name: 'Cal' }, { quiz_id: 'q', trainee_hr_code: 'C-2', trainee_name: 'Dee' }], sessions, quizId: 'q' })
const clean = rowsFor([a('C-1', 1), a('C-1', 2, { passed: '1', score_percent: '90' }), a('C-2', 1)])
const dup = rowsFor([a('C-1', 1), a('C-1', 2), a('C-1', 2, { score_percent: '70' }), a('C-2', 1)])
ok('flagged only for the trainee who has a repeated number', dup.find(r => r.hrCode === 'C-1').duplicateAttempts.join() === '2' && dup.find(r => r.hrCode === 'C-2').duplicateAttempts.length === 0 && clean.every(r => r.duplicateAttempts.length === 0))
ok('a trainer\'s test run with a repeated number is not counted', rowsFor([a('C-1', 1), a('C-1', 1, { is_test_run: '1' })]).find(r => r.hrCode === 'C-1').duplicateAttempts.length === 0)
ok('another trainee\'s attempt with the same number is not a duplicate', rowsFor([a('C-1', 2), a('C-2', 2)]).every(r => r.duplicateAttempts.length === 0))
// scoring and history untouched: every OTHER field is exactly what it was without the detector
const strip = r => { const { duplicateAttempts, ...rest } = r; return rest }
ok('the detector changes no score, count or history on the row', JSON.stringify(strip(dup.find(r => r.hrCode === 'C-1'))) === JSON.stringify(strip(rowsFor([a('C-1', 1), a('C-1', 2), a('C-1', 2, { score_percent: '70' }), a('C-2', 1)]).find(r => r.hrCode === 'C-1'))) && dup.find(r => r.hrCode === 'C-1').attempts === 3 && dup.find(r => r.hrCode === 'C-1').sessions.length === 3)
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
