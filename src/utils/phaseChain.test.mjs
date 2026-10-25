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

// ── 7. type questions (item E): what the phase allows ──
console.log('\n7. validTypes — pass and shot types per phase')
const PASS_CODES = ['TYPE_KICK_OFF','TYPE_THROW_IN','TYPE_FREE_KICK','TYPE_CORNER','TYPE_GOAL_KICK','TYPE_GK_DIST','TYPE_OPEN_PLAY']
const SHOT_CODES = ['OUTCOME_OPEN_PLAY','OUTCOME_FIRST_TIME','SHOT_TYPE_CORNER','SHOT_TYPE_FREE_KICK','SHOT_TYPE_GOAL_KICK','SHOT_TYPE_KICK_OFF','SHOT_TYPE_PENALTY','SHOT_TYPE_REDIRECT']
const vt = (ph, ev, team, part, codes) => P.validTypes(ph, ev, team, part, codes)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const T = (name, got, want) => { ok(same(got, want), `${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); console.log('   ' + (same(got, want) ? '✓ ' : '✗ ') + name + ' → ' + JSON.stringify(got)) }
T('pass newHalf (Half start)',        vt('newHalf','pass','mine',1,PASS_CODES).codes, ['TYPE_KICK_OFF'])
T('pass restartThrow (Out sideline)',  vt('restartThrow','pass','mine',1,PASS_CODES).codes, ['TYPE_THROW_IN'])
T('pass restartGkCorner (Out endline)',vt('restartGkCorner','pass','mine',1,PASS_CODES).codes, ['TYPE_CORNER','TYPE_GOAL_KICK'])
T('pass restartEightSeconds mine',     vt('restartEightSeconds','pass','mine',1,PASS_CODES).codes, ['TYPE_CORNER'])
T('pass restartEightSeconds opponent', vt('restartEightSeconds','pass','opponent',1,PASS_CODES).codes, [])
T('pass restartFoul (regular foul)',   vt('restartFoul','pass','mine',1,PASS_CODES).codes, ['TYPE_FREE_KICK'])
T('pass restartFoulOut',               vt('restartFoulOut','pass','mine',1,PASS_CODES).codes, ['TYPE_THROW_IN'])
T('pass restartKickoff (after goal)',  vt('restartKickoff','pass','mine',1,PASS_CODES).codes, ['TYPE_KICK_OFF'])
T('pass restart (after stoppage) = 6, no open play', vt('restart','pass','mine',1,PASS_CODES).codes, ['TYPE_KICK_OFF','TYPE_THROW_IN','TYPE_FREE_KICK','TYPE_CORNER','TYPE_GOAL_KICK','TYPE_GK_DIST'])
T('pass carry',                        vt('carry','pass','mine',1,PASS_CODES).codes, ['TYPE_OPEN_PLAY'])
ok(vt('idle','pass','opponent',1,PASS_CODES).restricted === false, 'idle is unrestricted')
console.log('   ' + (vt('idle','pass','opponent',1,PASS_CODES).restricted === false ? '✓ ' : '✗ ') + 'pass idle → unrestricted (ask all, as before)')
ok(vt('newHalf','pass',null,1,PASS_CODES).restricted === false, 'unknown team never restricts')
console.log('   ✓ unknown team ("mine" not known yet) → never restricts')
T('pass flightO (not a plain pass here)', vt('flightO','pass','mine',1,PASS_CODES).codes, [])
T('shot newHalf',                      vt('newHalf','shot','mine',1,SHOT_CODES).codes, ['SHOT_TYPE_KICK_OFF'])
T('shot flightO',                      vt('flightO','shot','mine',1,SHOT_CODES).codes, ['OUTCOME_FIRST_TIME'])
T('shot shotFlightO',                  vt('shotFlightO','shot','mine',1,SHOT_CODES).codes, ['SHOT_TYPE_REDIRECT'])
T('shot carry = 2, so ask',            vt('carry','shot','mine',1,SHOT_CODES).codes, ['OUTCOME_OPEN_PLAY','OUTCOME_FIRST_TIME'])
T('shot restartFoul = 2, so ask',      vt('restartFoul','shot','mine',1,SHOT_CODES).codes, ['SHOT_TYPE_FREE_KICK','SHOT_TYPE_PENALTY'])
T('shot restartKickoff',               vt('restartKickoff','shot','mine',1,SHOT_CODES).codes, ['SHOT_TYPE_KICK_OFF'])
T('shot shooterPenalty, part 5',       vt('shooterPenalty','shot','mine',5,SHOT_CODES).codes, ['SHOT_TYPE_PENALTY'])
T('shot shooterPenalty, part 1',       vt('shooterPenalty','shot','mine',1,SHOT_CODES).codes, [])

// ── 8. reception fallback (item B) ──
console.log('\n8. inheritedReceptionTeam — strict fallback')
const SE = (eventId, team, passEnd='') => ({ eventId, team, passEnd })
const RC = (name, evs, want) => { const got = P.inheritedReceptionTeam(evs); ok(got === want, `${name}: got ${got} want ${want}`); console.log('   ' + (got === want ? '✓ ' : '✗ ') + name.padEnd(52) + '→ ' + got) }
RC('pass (home) immediately before',                      [SE('pass','home')], 'home')
RC('pass_first_time (away) immediately before',           [SE('pass_first_time','away')], 'away')
RC('pass_recovery (away), stored passEnd empty',          [SE('pass_recovery','away')], 'away')
RC('camera off between pass and reception',               [SE('pass','home'), SE('camera_off',null)], null)
RC('pressure start between pass and reception',           [SE('pass','home'), SE('pressure_start','away')], null)
RC('card between pass and reception',                     [SE('pass','home'), SE('card','away')], null)
RC('pass flagged incomplete (an interception pass)',      [SE('pass_interception','away','incomplete')], null)
RC('pass that ended the other team\'s pass (incomplete)', [SE('pass','home','incomplete')], null)
RC('pass with no team',                                   [SE('pass',null)], null)
RC('previous event is not a pass',                        [SE('tackle','home')], null)
RC('no events at all',                                    [], null)

console.log('\n' + (fails === 0 ? 'ALL CHECKS PASS' : fails + ' FAILURE(S)'))
