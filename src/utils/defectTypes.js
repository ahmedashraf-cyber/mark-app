/**
 * defectTypes.js — event → module classification, in one place
 * ============================================================================
 * Extracted verbatim from the local consts inside the ReviewPage component
 * (previously ReviewPage.jsx:319-373), which could not be imported because
 * they were declared inside the component body. Scout's behaviour must not
 * change, so `classifyEventModule` is byte-for-byte equivalent to the old
 * `classifyScoutEvent` — see defectTypes.parity.mjs, which asserts identical
 * output for every FIELD event code.
 *
 * TWO CLASSIFIERS, DELIBERATELY
 *
 *   classifyEventModule          A B C D TO, pressure inside C.
 *                                Scout and Audit use this. Unchanged.
 *
 *   classifyEventModuleSplit     A B C D TO PRESSURE, pressure lifted out of C.
 *                                Comparison uses this.
 *
 * They disagree on pressure_start / pressure_end by design: Comparison needs
 * Pressure as its own card, and changing the shared one would silently move
 * Scout's and Audit's C scores.
 */

// ── Event name sets (hyphenated, as MARK Audit names them) ───────────────────
export const DT_A_EVENTS  = new Set(['card','foul-committed','end-stoppage','stoppage','player-off','player-on',
  'referee-ball-drop','shot','end-shot','substitution','tactical-shift','own-goal-against','starting-xi','error'])
export const DT_B_EVENTS  = new Set(['fifty-fifty','clearance','dribble','interception','miscontrol','shield','block','tackle'])
export const DT_C_EVENTS  = new Set(['pressure-start','pressure-end','ball-recovery','pressure'])
export const DT_D_EVENTS  = new Set(['reception'])
export const DT_TO_EVENTS = new Set(['hold-up-duel','leg-stretch-duel','positioning-duel','separation-duel'])

// Attribute-level sets, used when an error is on an extra rather than the event
export const DT_EXTRA_A   = new Set(['free-kick','kick-off','corner','through-ball','save','offside','conceded-no-save','save-attempt'])
export const DT_EXTRA_B   = new Set(['interception','keeper-sweeper','smother','collected','punch','recovery'])
export const DT_EXTRA_C   = new Set(['aerial-won'])
export const DT_PASS_D    = new Set(['open-play','first-time'])
export const DT_EXTRA_TO  = new Set(['launch','step-in','right-take-on','left-take-on','sliding','right','left','none'])

export const DT_SEV = { 'TO':0,'A':1,'B':2,'C':3,'D':4 }

// Pressure events — the only difference between the two classifiers
export const PRESSURE_EVENTS = new Set(['pressure-start','pressure-end','pressure'])

/**
 * FIELD/Scout underscore ids → the hyphenated names the sets use.
 * 22 of the 38 FIELD event codes need this; the special cases below are not
 * mechanical (pass_recovery is a ball-recovery, pass_interception is an
 * interception) so they are mapped explicitly.
 */
export function normalizeEventId(id) {
  if (!id) return ''
  const map = {
    'pressure':         'pressure-start',
    'pass_first_time':  'pass',
    'pass_interception':'interception',
    'pass_recovery':    'ball-recovery',
    'goal_keeper':      'goal-keeper',
    'fifty_fifty':      'fifty-fifty',
    'foul_committed':   'foul-committed',
    'own_goal_against': 'own-goal-against',
    'ball_recovery':    'ball-recovery',
    'hold_up_duel':     'hold-up-duel',
    'leg_stretch_duel': 'leg-stretch-duel',
    'positioning_duel': 'positioning-duel',
    'separation_duel':  'separation-duel',
  }
  return map[id] || id.replace(/_/g, '-')
}

/**
 * Explicit homes for the codes that used to hit the bare `return 'D'`.
 * D is Receptions with one real member, so letting camera-on and half-start
 * fall into it was quietly distorting the D score. Every code now has a stated
 * module — nothing is excluded from scoring.
 */
const FALLTHROUGH_MODULE = {
  'pass':              'D',
  'out':               'D',
  'half-start':        'D',
  'half-end':          'D',
  'camera-on':         'D',
  'camera-off':        'D',
  'unknown-pass-end':  'D',
  'formation':         'A',
  'goal-keeper':       'B',   // its sub-actions are already in DT_EXTRA_B
}

/**
 * A B C D TO — pressure inside C, and the bare `return 'D'` default kept.
 *
 * This is byte-equivalent to the old inline classifyScoutEvent. Scout and Audit
 * use it and their numbers do not move. The explicit homes for formation and
 * goal_keeper live in the SPLIT classifier only: applying them here would
 * silently shift Scout's A and B scores, which was not the intent.
 */
export function classifyEventModule(eventId) {
  const name = normalizeEventId(eventId)
  if (DT_A_EVENTS.has(name))  return 'A'
  if (DT_B_EVENTS.has(name))  return 'B'
  if (DT_C_EVENTS.has(name))  return 'C'
  if (DT_D_EVENTS.has(name))  return 'D'
  if (DT_TO_EVENTS.has(name)) return 'TO'
  return 'D'
}

/**
 * A B C D TO PRESSURE — Comparison's classifier.
 *
 * Two deliberate departures from the shared one:
 *   pressure lifted out of C into its own module
 *   every code that used to hit the bare default gets a stated home, so
 *   camera-on and half-start no longer distort D (which has one real member)
 */
export function classifyEventModuleSplit(eventId) {
  const name = normalizeEventId(eventId)
  if (PRESSURE_EVENTS.has(name)) return 'PRESSURE'
  if (DT_A_EVENTS.has(name))  return 'A'
  if (DT_B_EVENTS.has(name))  return 'B'
  if (DT_C_EVENTS.has(name))  return 'C'
  if (DT_D_EVENTS.has(name))  return 'D'
  if (DT_TO_EVENTS.has(name)) return 'TO'
  return FALLTHROUGH_MODULE[name] || 'D'
}

/** Module order for display. */
export const MODULES_SPLIT = ['A','B','C','D','TO','PRESSURE']
export const MODULE_LABELS = {
  A:'A', B:'B', C:'C', D:'D', TO:'TO', PRESSURE:'Pressure',
}

/** Least-severe-wins merge, as ReviewPage used it. */
export function mergeModules(c1, c2) {
  if (!c1) return c2 || 'D'
  if (!c2) return c1 || 'D'
  if (c1 === 'TO' || c2 === 'TO') return 'TO'
  return DT_SEV[c1] <= DT_SEV[c2] ? c1 : c2
}
