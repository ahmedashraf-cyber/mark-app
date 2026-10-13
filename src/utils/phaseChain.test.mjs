const P = await import('./phaseChain.js')
const R = await import('./phaseRules.js')
let fails = 0
const ok = (cond, msg) => { if (!cond) { fails++; console.log('   ✗ ' + msg) } }

// ── 1. every rule compiles ──
let compiled = 0
const all = [...Object.values(R.rules).flatMap(p=>[...p.rules,...p.postRules]),
  ...Object.values(R.pressureRoomRules).flatMap(p=>[...p.rules,...p.postRules]),
  ...R.transparent, ...R.always]
all.forEach(r => { try { P.compile(r); compiled++ } catch(e) { fails++; console.log('   ✗ compile:', e.message) } })
console.log('1. rules compiled:', compiled, '/', all.length)

// helpers
const g = (groupId, ...codes) => ({ groupId, selections: codes.map(code => ({ code })) })
const E = (code, team, opts={}) => ({ code, team, groups: opts.groups||[], passType: opts.passType })

// ── 2. a realistic sequence ──
const seq = [
  E('half_start', 'mine'),
  E('pass', 'mine', { passType:'TYPE_KICK_OFF' }),
  E('reception', 'mine'),
  E('dribble', 'mine'),
  E('pass', 'mine', { passType:'TYPE_OPEN_PLAY' }),
  E('foul_committed', 'opponent', { groups:[g('type','FOUL_REGULAR')] }),
  E('pass', 'mine', { passType:'TYPE_FREE_KICK' }),
  E('reception', 'mine'),
  E('card', 'opponent'),
  E('pass', 'mine', { passType:'TYPE_OPEN_PLAY' }),
  E('out', 'mine', { groups:[g('location','LOC_SIDELINE')] }),
  E('pass', 'opponent', { passType:'TYPE_THROW_IN' }),
]
const want = ['newHalf','flightO','carry','carry','flightO','restartFoul','flightO','carry','carry','flightO','idle','flightD']
const run = P.runChain(seq, { part:1 })
console.log('\n2. match sequence')
run.forEach((r,i) => {
  const good = r.phaseAfter === want[i]
  console.log('   ' + (good?'✓':'✗') + ' ' + String(i).padStart(2) + ' ' + seq[i].code.padEnd(16) +
    seq[i].team.padEnd(9) + r.phaseBefore.padEnd(12) + '→ ' + r.phaseAfter.padEnd(12) +
    (r.valid ? 'valid' : 'INVALID') + (good ? '' : '   (want ' + want[i] + ')'))
  ok(good, 'phase at ' + i)
  ok(r.valid, 'event ' + i + ' should be valid')
})

// ── 3. derived fields ──
console.log('\n3. derived fields')
const foul = run[5].docEvent.fields
console.log('   foul after a pass in the air → phase:', [...(foul.phase||[])], '| pass-end:', [...(foul['pass-end']||[])])
ok(foul.phase?.has('uncontrolled'), 'foul in flightO is uncontrolled')
ok(foul['pass-end']?.has('incomplete'), 'a foul ends a pass incomplete')
const rec = run[2].docEvent.fields
ok(rec['pass-end']?.has('complete'), 'teammate reception → complete')
console.log('   teammate reception → pass-end:', [...(rec['pass-end']||[])])
ok(run[8].phaseAfter === 'carry', 'a card is transparent')
console.log('   card does not move the phase:', run[8].phaseBefore, '→', run[8].phaseAfter)

// offside: the PASSER's own team commits it, yet the pass is incomplete
const off = P.runChain([E('half_start','mine'), E('pass','mine',{passType:'TYPE_KICK_OFF'}),
  E('foul_committed','mine',{groups:[g('type','FOUL_OFFSIDE')]})], { part:1 })
const offPE = off[2].docEvent.fields['pass-end']
console.log('   OFFSIDE by the passer\'s own team → pass-end:', [...(offPE||[])])
ok(offPE?.has('incomplete'), 'offside is incomplete even though it is the same team')

// ── 4. the key gate ──
console.log('\n4. key gate')
const gate = [['carry','tackle',false],['carry','dribble',true],['defense','tackle',true],
  ['preHalf','pass',false],['preHalf','half_start',true],['carry','card',true],['idle','pass',true]]
gate.forEach(([ph,ev,w]) => { const a = P.keyAllowed(ph, ev); ok(a===w, `${ev} in ${ph}`)
  console.log('   ' + (a===w?'✓':'✗') + ' ' + ev.padEnd(12) + 'in ' + ph.padEnd(9) + '→ ' + (a?'allowed':'BLOCKED')) })

// ── 5. inference ──
console.log('\n5. team inference')
;[['carry','pass','mine'],['carry','dribble','mine'],['defense','tackle','mine'],['carry','foul_committed','ask'],
  ['idle','pass','opponent'],['looseO','ball_recovery','ask'],['carry','pressure_start','opponent'],
  ['defense','pressure_start','mine'],['carry','stoppage','none']].forEach(([ph,ev,w]) => {
  const d = P.teamDecision(ph, ev); ok(d===w, `${ev} in ${ph}`)
  console.log('   ' + (d===w?'✓':'✗') + ' ' + ev.padEnd(15) + 'in ' + ph.padEnd(8) + '→ ' + d) })

// ── 6. penalties and pressure ──
console.log('\n6. penalties and pressure')
const pen = P.runChain([E('half_start','mine')], { part:5 })
ok(pen[0].phaseAfter === 'shooterPenalty', 'part 5 half start → shooterPenalty')
console.log('   half start, part 5 →', pen[0].phaseAfter)
const pr = P.runChain([E('half_start','mine'), E('pressure_start','mine')], { part:1 })
ok(pr[1].pressureAfter === 'activePressure', 'pressure start mine → activePressure')
ok(pr[1].phaseAfter === pr[1].phaseBefore, 'pressure is transparent in the main chain')
console.log('   pressure start (mine): pressure', pr[1].pressureBefore, '→', pr[1].pressureAfter,
  '| main chain unchanged:', pr[1].phaseBefore, '→', pr[1].phaseAfter)

console.log('\n' + (fails === 0 ? 'ALL CHECKS PASS' : fails + ' FAILURE(S)'))
