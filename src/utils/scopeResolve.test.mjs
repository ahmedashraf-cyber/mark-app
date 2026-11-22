// scopeResolve.js: what a model's scope_event_ids VALUE means. The values below are the real ones found in the field_sessions sheet.
import { resolveScope, SCOPE_GROUPS } from './scopeResolve.js'
import { EVENT_REGISTRY } from '../config/fieldConfig.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 240) + ']' : ''}`) }
const J = JSON.stringify
const r = v => resolveScope(v)

console.log('the real values in the sheet')
ok('"pressure_start" (a code: models 1454815, 1420569, 1398404) -> filter by that code, no warning', J(r('pressure_start')) === J({ mode: 'codes', codes: ['pressure_start'], warning: '', unresolved: [] }), J(r('pressure_start')))
ok('"Pressure start" (a LABEL, on one collector session) -> normalised to the code pressure_start, no warning', r('Pressure start').mode === 'codes' && J(r('Pressure start').codes) === J(['pressure_start']) && r('Pressure start').warning === '')
ok('"Duels" (8 models, 92 collectors) -> NO filter, a visible warning, and it is NOT expanded to the four TO duel codes', r('Duels').mode === 'unresolved' && r('Duels').codes.length === 0 && /Duels/.test(r('Duels').warning) && /collection mode/.test(r('Duels').warning) && /NOT applied/.test(r('Duels').warning), J(r('Duels')))
ok('"TagOnce" (987654) -> NO filter, a visible warning', r('TagOnce').mode === 'unresolved' && r('TagOnce').codes.length === 0 && /TagOnce/.test(r('TagOnce').warning))
ok('"All Events" (1366067) -> no filter and NO warning (it is a real answer, not a failure)', r('All Events').mode === 'all' && r('All Events').warning === '' && r('All Events').codes.length === 0)
ok('"" (1486342, 1481777, 1506906) -> no filter and NO warning', r('').mode === 'all' && r('').warning === '')
ok('null, undefined and spaces are blank too', [null, undefined, '   ', '|', ' ; , '].every(v => r(v).mode === 'all' && r(v).warning === ''))

console.log('\nspellings and lists')
ok('"all events" in any case, with underscores, hyphens or spaces, is "everything"', ['ALL EVENTS', 'all_events', 'All-Events', ' all events ', 'all'].every(v => r(v).mode === 'all'))
ok('a comma list of codes filters by all of them', J(r('pressure_start,hold_up_duel').codes) === J(['pressure_start', 'hold_up_duel']) && r('pressure_start,hold_up_duel').mode === 'codes')
ok('pipe and semicolon lists work too, with spaces', J(r(' pass | shot ; tackle').codes) === J(['pass', 'shot', 'tackle']))
ok('labels in a list are normalised each by itself ("Pressure start|Hold up duel")', J(r('Pressure start|Hold up duel').codes) === J(['pressure_start', 'hold_up_duel']))
ok('a code and its label together collapse to one code', J(r('pass,Pass').codes) === J(['pass']))
ok('the label of a multi-word code resolves ("Pass first time", "pass-first-time")', r('Pass first time').codes[0] === 'pass_first_time' && r('pass-first-time').codes[0] === 'pass_first_time')

ok('the one REAL label that differs from its code resolves: "Pass (First time)" -> pass_first_time', J(r('Pass (First time)').codes) === J(['pass_first_time']) && r('Pass (First time)').mode === 'codes')
ok('EVERY event label in the spec resolves to its own event code, and every code to itself (' + EVENT_REGISTRY.length + ' events)', EVENT_REGISTRY.every(e => J(r(e.label).codes) === J([e.code]) && J(r(e.code).codes) === J([e.code])), J(EVENT_REGISTRY.filter(e => J(r(e.label).codes) !== J([e.code])).map(e => e.label)))

console.log('\nanything that cannot be resolved means NO filter and a warning, never a partial filter')
ok('one unknown part spoils the whole list: "pass|banana" -> no filter at all (it must NOT silently keep only "pass")', r('pass|banana').mode === 'unresolved' && r('pass|banana').codes.length === 0 && J(r('pass|banana').unresolved) === J(['banana']))
ok('the warning names what it could not read, and does not call an unknown word a collection mode', /"banana"/.test(r('pass|banana').warning) && !/collection mode/.test(r('pass|banana').warning) && /NOT applied/.test(r('pass|banana').warning), r('pass|banana').warning)
ok('"Duels|pass": the mode spoils the list too (no filter), and the warning names Duels', r('Duels|pass').mode === 'unresolved' && r('Duels|pass').codes.length === 0 && /Duels/.test(r('Duels|pass').warning))
ok('"All Events|pass" is "everything" (an explicit all wins), no warning', r('All Events|pass').mode === 'all' && r('All Events|pass').warning === '')
ok('every unresolved answer has a warning, and no answer in any mode carries codes together with a warning', ['Duels', 'TagOnce', 'x', 'pass|x', 'Duels|TagOnce'].every(v => r(v).mode === 'unresolved' && r(v).warning.length > 20 && r(v).codes.length === 0))
ok('"Duels|TagOnce" (two modes) gets the collection-mode wording; "x" (unknown) the general wording', /collection mode/.test(r('Duels|TagOnce').warning) && /not an event type or a group the app knows/.test(r('x').warning))

console.log('\nthe spec: no list of event types stands behind "Duels"')
ok('SCOPE_GROUPS is empty: no group with an exact event list exists in the spec today (add one only when the spec defines it)', Object.keys(SCOPE_GROUPS).length === 0)
ok('the four TO duel codes are real event codes (they are a SCORING module, not a collection scope)', ['hold_up_duel', 'leg_stretch_duel', 'positioning_duel', 'separation_duel'].every(c => EVENT_REGISTRY.some(e => e.code === c)))
ok('...and "Duels" is not any event code or label', !EVENT_REGISTRY.some(e => e.code.toLowerCase() === 'duels' || e.label.toLowerCase() === 'duels'))
ok('a group, once defined, DOES expand (the mechanism works): a temporary group resolves to its codes', (() => { SCOPE_GROUPS.testgroup = ['pass', 'shot']; const x = r('TestGroup'); delete SCOPE_GROUPS.testgroup; return x.mode === 'codes' && J(x.codes) === J(['pass', 'shot']) })())
ok('...and is gone again afterwards', r('TestGroup').mode === 'unresolved')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
