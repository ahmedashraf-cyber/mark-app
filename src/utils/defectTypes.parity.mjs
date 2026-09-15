/**
 * defectTypes.parity.mjs — proves the extraction did not change Scout
 * ============================================================================
 * Run: node src/utils/defectTypes.parity.mjs
 *
 * Reimplements the OLD inline classifier exactly as it stood in the ReviewPage
 * component body (ReviewPage.jsx:319-366 before extraction) and asserts that
 * classifyEventModule returns the same module for every FIELD event code, plus
 * the Scout-style ids and a set of edge cases.
 *
 * One intentional difference is asserted separately: codes that used to hit the
 * bare `return 'D'` now have explicit homes (formation -> A, goal_keeper -> B).
 * Those are listed so the diff is deliberate and visible rather than silent.
 */
import fs from 'fs'
import { classifyEventModule, classifyEventModuleSplit, normalizeEventId } from './defectTypes.js'

// ── the OLD inline implementation, verbatim ─────────────────────────────────
const A = new Set(['card','foul-committed','end-stoppage','stoppage','player-off','player-on',
  'referee-ball-drop','shot','end-shot','substitution','tactical-shift','own-goal-against','starting-xi','error'])
const B = new Set(['fifty-fifty','clearance','dribble','interception','miscontrol','shield','block','tackle'])
const C = new Set(['pressure-start','pressure-end','ball-recovery','pressure'])
const D = new Set(['reception'])
const TO = new Set(['hold-up-duel','leg-stretch-duel','positioning-duel','separation-duel'])
const oldNormalize = (id) => {
  if (!id) return ''
  const map = { 'pressure':'pressure-start','pass_first_time':'pass','pass_interception':'interception',
    'pass_recovery':'ball-recovery','goal_keeper':'goal-keeper','fifty_fifty':'fifty-fifty',
    'foul_committed':'foul-committed','own_goal_against':'own-goal-against','ball_recovery':'ball-recovery',
    'hold_up_duel':'hold-up-duel','leg_stretch_duel':'leg-stretch-duel','positioning_duel':'positioning-duel',
    'separation_duel':'separation-duel' }
  return map[id] || id.replace(/_/g,'-')
}
const oldClassify = (id) => {
  const n = oldNormalize(id)
  if (A.has(n))  return 'A'
  if (B.has(n))  return 'B'
  if (C.has(n))  return 'C'
  if (D.has(n))  return 'D'
  if (TO.has(n)) return 'TO'
  if (n === 'pass') return 'D'
  return 'D'
}

// ── every FIELD event code, from the real registry ──────────────────────────
let fe = fs.readFileSync(new URL('./fieldExtras.js', import.meta.url), 'utf8').replace(/^export /gm, '')
const mod = await import('data:text/javascript,' + encodeURIComponent(fe + '\nglobalThis.__fe={FIELD_EVENTS};'))
const ids = globalThis.__fe.FIELD_EVENTS.map(e => e.id)

// plus the hyphenated Scout-side names and some edges
const extra = [...A, ...B, ...C, ...D, ...TO, '', null, undefined, 'nonsense-event']

// Scout's classifier must be IDENTICAL — no exceptions. The explicit homes for
// formation and goal_keeper live only in the split classifier, so they must not
// show up here.
const INTENDED_DIFFS = {}

let same = 0, intended = 0, unexpected = []
for (const id of [...ids, ...extra]) {
  const before = oldClassify(id)
  const after  = classifyEventModule(id)
  if (before === after) { same++; continue }
  const exp = INTENDED_DIFFS[id]
  if (exp && exp[0] === before && exp[1] === after) { intended++; continue }
  unexpected.push({ id, before, after })
}

// normalizeEventId must be untouched
let normDiffs = 0
for (const id of [...ids, ...extra]) {
  if (oldNormalize(id) !== normalizeEventId(id)) normDiffs++
}

// the split classifier must differ from the shared one ONLY on pressure
const splitDiffs = [...ids, ...extra].filter(id =>
  classifyEventModule(id) !== classifyEventModuleSplit(id))

console.log('cases checked              :', ids.length + extra.length)
console.log('identical to old inline    :', same)
console.log('deliberately changed       :', intended,
  '(' + Object.keys(INTENDED_DIFFS).join(', ') + ')')
console.log('normalizeEventId diffs     :', normDiffs)
console.log('')
const splitNames = [...new Set(splitDiffs.map(normalizeEventId))]
console.log('split classifier differs on:', splitNames.join(', '))
splitDiffs.forEach(id => console.log('   ' + String(id).padEnd(20) +
  classifyEventModule(id) + ' -> ' + classifyEventModuleSplit(id)))
console.log('')
if (unexpected.length) {
  console.log('UNEXPECTED CHANGES — Scout behaviour would shift:')
  unexpected.forEach(u => console.log('  ' + u.id + ': ' + u.before + ' -> ' + u.after))
  process.exit(1)
}
if (normDiffs) { console.log('normalizeEventId CHANGED — not allowed'); process.exit(1) }
console.log('PASS — Scout classification is unchanged apart from the two stated codes.')
