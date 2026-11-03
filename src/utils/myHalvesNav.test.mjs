import { myHalvesOpener } from './myHalvesNav.js'
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + d + ']' : ''}`) }
console.log("the one rule for Tag's \"See its errors in My halves\" button")
let calls = 0; const open = () => { calls++ }
const on = myHalvesOpener({ viewOwnHalves: true }, open)
ok('permission ON: Tag gets a handler', typeof on === 'function')
on(); ok('...and calling it runs the opener once, and only that', calls === 1)
ok('permission OFF: no handler, so Tag shows no button', myHalvesOpener({ viewOwnHalves: false }, open) === undefined)
ok('permission missing from the caps: no handler', myHalvesOpener({}, open) === undefined)
ok('no caps at all (not signed in yet): no handler, no crash', myHalvesOpener(undefined, open) === undefined && myHalvesOpener(null, open) === undefined)
ok('"view ANY halves" alone is not enough: this button is about the collector\'s OWN halves', myHalvesOpener({ viewAnyHalves: true, viewOwnHalves: false }, open) === undefined)
ok('permission on but nothing to call (the page does not exist in this build): no handler', myHalvesOpener({ viewOwnHalves: true }, undefined) === undefined && myHalvesOpener({ viewOwnHalves: true }, 'x') === undefined)
ok('both permissions on: a handler', typeof myHalvesOpener({ viewOwnHalves: true, viewAnyHalves: true }, open) === 'function')
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
