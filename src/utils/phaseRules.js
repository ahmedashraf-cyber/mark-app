/**
 * phaseRules.js — the Mark Chain rules, VERBATIM
 * ============================================================================
 * Copied character-for-character from the "Mark Chain" document. Do not edit
 * these strings to make a rule work: translation into MARK's vocabulary happens
 * in phaseVocabulary.js, so this file stays a faithful copy that can be diffed
 * against the document.
 *
 * Used ONLY by the "All events" collection method. "Not all events" never
 * reads this file.
 *
 * Each phase has:
 *   rules      — conditions on the event JUST tagged that move the chain INTO
 *                this phase
 *   postRules  — the events that are VALID while the chain is IN this phase
 */

export const rules = {
  preHalf: {
    rules: [],
    postRules: ['half-start'],
  },

  newHalf: {
    rules: ['half-start part is not 5'],
    postRules: [
      'pass field type is kick-off and field pass-end does not have incomplete and part is not 5',
      'shot field type is kick-off and part is not 5',
    ],
  },

  flightO: {
    rules: ['pass team is mine'],
    postRules: [
      'reception',
      'block field side is offense and field outcome does have deflection and field pass-end does not have incomplete',
      'block field side is offense and field outcome does not have deflection and field pass-end does have incomplete',
      'pass field type is first-time, and field pass-end does not have incomplete',
      'shot field type is first-time',
      'miscontrol field kind is first-time',
      'out field type does have pass',
      'foul-committed field type is one of regular handball dangerous-play dive offside and field phase is uncontrolled',
    ],
  },

  flightD: {
    rules: ['pass team is opponent'],
    postRules: [
      'goal-keeper field pass-end does have incomplete',
      'clearance field pass-end does have incomplete',
      'interception field pass-end does have incomplete',
      'ball-recovery field pass-end does have incomplete',
      'block field side is defense and field outcome does have deflection and field pass-end does not have incomplete',
      'block field side is defense and field outcome does not have deflection and field pass-end does have incomplete',
      'pass field type is one of interception recovery and field pass-end does have incomplete',
      'foul-committed field type is one of regular handball dangerous-play dive and field phase is uncontrolled',
    ],
  },

  shotFlightO: {
    rules: ['shot team is mine'],
    postRules: [
      'shot field type is redirect and part is not 5',
      'block field side is offense and field pass-end does not have incomplete and part is not 5',
      'end-shot',
      'foul-committed field phase is uncontrolled',
    ],
  },

  shotFlightD: {
    rules: ['shot team is opponent'],
    postRules: [
      'block field side is defense and field pass-end does not have incomplete and part is not 5',
      'goal-keeper field type is one of save-attempt conceded-no-save and field pass-end does not have incomplete',
      'foul-committed field phase is uncontrolled',
    ],
  },

  carry: {
    rules: [
      'tackle field outcome is won and team is mine',
      'fifty-fifty field outcome is won and team is mine',
      'ball-recovery field outcome is complete and team is mine',
      'reception field outcome is complete and team is mine',
      'interception field outcome is won and team is mine',
      'dribble field type does not have overrun and team is mine',
      'goal-keeper field type is collected, field outcome is one of success second-effort and team is mine',
      'goal-keeper field type is smother, field outcome is won and team is mine',
      'goal-keeper field type is keeper-sweeper, field outcome is claim and team is mine',
      'goal-keeper field type is one of save save-attempt, field outcome is one of won second-effort and team is mine',
    ],
    postRules: [
      'pass field type is open-play and field pass-end does not have incomplete',
      'shot field type is one of first-time open-play',
      'miscontrol field kind does not have first-time',
      'dribble',
      'foul-committed field type is not foul-out and field phase is carry',
    ],
  },

  defense: {
    rules: [
      'tackle field outcome is won and team is opponent',
      'ball-recovery field outcome is complete and team is opponent',
      'reception field outcome is offside and team is mine',
      'reception field outcome is complete and team is opponent',
      'interception field outcome is won and team is opponent',
      'dribble field type does not have overrun and team is opponent',
      'fifty-fifty field outcome is won and team is opponent',
      'goal-keeper field type is collected, field outcome is one of success second-effort and team is opponent',
      'goal-keeper field type is smother, field outcome is won and team is opponent',
      'goal-keeper field type is keeper-sweeper, field outcome is claim and team is opponent',
      'goal-keeper field type is one of save save-attempt, field outcome is one of won second-effort and team is opponent and part is not 5',
    ],
    postRules: [
      'tackle',
      'goal-keeper field type is smother and field pass-end does not have incomplete',
      'foul-committed field type is one of regular handball dangerous-play dive and field phase is defense',
    ],
  },

  looseO: {
    rules: [
      'block field outcome does not have deflection and team is mine',
      'clearance team is mine',
      'miscontrol team is mine',
      'ball-recovery field outcome is fail and team is mine',
      'interception field outcome is success and team is mine',
      'tackle field outcome is success and team is mine',
      'fifty-fifty field outcome is success and team is mine',
      'goal-keeper field type is collected and field outcome is fail and team is mine',
      'goal-keeper field type is smother and field outcome is success and team is mine',
      'goal-keeper field type is keeper-sweeper and field outcome is clear and team is mine',
      'goal-keeper field type is punch and team is mine',
      'goal-keeper field type is one of save save-attempt, field outcome is success and part is not 5 and team is mine',
      'end-shot field outcome is one of post wayward and part is not 5 and team is mine',
      'referee-ball-drop team is mine',
      'dribble field type does have overrun and team is mine',
    ],
    postRules: [
      'ball-recovery field pass-end does not have incomplete',
      'clearance field pass-end does not have incomplete',
      'goal-keeper field type is one of save collected punch keeper-sweeper and field pass-end does not have incomplete',
      'pass field type is recovery and field pass-end does not have incomplete',
      'block field side is offense and field pass-end does not have incomplete',
      'fifty-fifty',
      'out field type does not have pass',
      'foul-committed field type is one of regular handball dangerous-play dive backpass-pick offside and field phase is uncontrolled',
    ],
  },

  looseD: {
    rules: [
      'block field outcome does not have deflection and team is opponent',
      'clearance team is opponent',
      'miscontrol team is opponent',
      'ball-recovery field outcome is fail and team is opponent',
      'interception field outcome is success and team is opponent',
      'tackle field outcome is success and team is opponent',
      'fifty-fifty field outcome is success and team is opponent',
      'goal-keeper field type is collected and field outcome is fail and team is opponent',
      'goal-keeper field type is smother and field outcome is success and team is opponent',
      'goal-keeper field type is keeper-sweeper and field outcome is clear and team is opponent',
      'goal-keeper field type is punch and team is opponent',
      'goal-keeper field type is one of save save-attempt, field outcome is success and part is not 5 and team is opponent',
      'end-shot field outcome is one of post wayward and part is not 5 and team is opponent',
      'referee-ball-drop team is opponent',
      'dribble field type does have overrun and team is opponent',
    ],
    postRules: [
      'ball-recovery field pass-end does not have incomplete',
      'clearance field pass-end does not have incomplete',
      'goal-keeper field type is one of save collected punch keeper-sweeper and field pass-end does not have incomplete',
      'pass field type is recovery and field pass-end does not have incomplete',
      'block field side is defense and field pass-end does not have incomplete',
      'fifty-fifty',
      'out field type does not have pass',
      'foul-committed field type is one of regular handball dangerous-play dive backpass-pick offside and field phase is uncontrolled',
    ],
  },

  shooterPenalty: {
    rules: [
      'half-start part is 5',
      'out part is 5',
      'end-shot part is 5',
      'goal-keeper field type is one of save-attempt conceded-no-save and part is 5',
      'own-goal-against part is 5',
    ],
    postRules: ['shot field type is penalty and part is 5'],
  },

  keeper: {
    rules: ['shot team is opponent and part is 5'],
    postRules: [
      'goal-keeper field type is one of conceded-no-save save-attempt and field pass-end does not have incomplete',
      'foul-committed field phase is uncontrolled',
    ],
  },

  restartThrow: {
    rules: ['out field location is sideline and team is opponent'],
    postRules: [
      'pass field type is throw-in and field pass-end does not have incomplete',
      'foul-committed field type is foul-out and field phase is uncontrolled',
    ],
  },

  restartGkCorner: {
    rules: [
      'out field location is endline and team is opponent',
      'end-shot field outcome is out-endline and team is opponent',
    ],
    postRules: [
      'pass field type is one of goal-kick corner and field pass-end does not have incomplete',
      'shot field type is one of goal-kick corner',
      'foul-committed field phase is uncontrolled',
    ],
  },

  restartEightSeconds: {
    rules: ['foul-committed field type is eight-seconds and team is opponent'],
    postRules: [
      'pass field type is corner and field pass-end does not have incomplete and team is mine',
      'shot field type is corner and team is mine',
      'foul-committed field phase is uncontrolled',
    ],
  },

  restartFoul: {
    rules: [
      'foul-committed field outcome does not have advantage and field type is not foul-out and team is opponent',
    ],
    postRules: [
      'foul-committed field type is dive and field phase is uncontrolled',
      'pass field type is free-kick and field pass-end does not have incomplete',
      'shot field type is one of free-kick penalty',
    ],
  },

  restartFoulOut: {
    rules: ['foul-committed field type is foul-out and team is opponent'],
    postRules: [
      'pass field type is throw-in and field pass-end does not have incomplete',
      'foul-committed field type is foul-out and field phase is uncontrolled',
    ],
  },

  restartKickoff: {
    rules: [
      'own-goal-against team is mine and part is not 5',
      'goal-keeper field type is conceded-no-save and team is mine and part is not 5',
      'goal-keeper field type is one of save save-attempt, field outcome is fail and team is mine and part is not 5',
    ],
    postRules: [
      'pass field type is kick-off and field pass-end does not have incomplete',
      'shot field type is kick-off',
    ],
  },

  restart: {
    rules: ['end-stoppage'],
    postRules: [
      'shot field type is not one of first-time open-play redirect',
      'pass field type is not one of open-play interception recovery first-time and field pass-end does not have incomplete',
      'referee-ball-drop',
    ],
  },

  stoppage: {
    rules: ['stoppage'],
    postRules: ['end-stoppage'],
  },

  idle: {
    rules: [
      'out field location is sideline and team is mine',
      'out field location is endline and team is mine',
      'end-shot field outcome is out-endline and team is mine',
      'foul-committed field outcome does not have advantage and field type is one of regular handball dangerous-play dive six-seconds backpass-pick offside and team is mine',
      'foul-committed field type is foul-out and team is mine',
      'foul-committed field type is eight-seconds and team is mine',
      'own-goal-against team is opponent and part is not 5',
      'goal-keeper field type is conceded-no-save and team is opponent and part is not 5',
      'goal-keeper field type is one of save save-attempt, field outcome is fail and team is opponent and part is not 5',
    ],
    postRules: [],
  },

  halfEnd: {
    rules: ['half-end', 'match-status'],
    postRules: ['match-status'],
  },
}

export const pressureRoomRules = {
  preHalf:        { rules: [],                              postRules: ['half-start'] },
  startPressure:  { rules: ['half-start part is not 5'],    postRules: ['pressure-start'] },
  activePressure: { rules: ['pressure-start team is mine'], postRules: ['pressure-start', 'pressure-end'] },
  addPressure:    { rules: ['pressure-end'],                postRules: ['pressure-start', 'pressure-end'] },
  idlePressure:   { rules: ['pressure-start team is opponent'], postRules: [] },
  halfEnd:        { rules: ['half-end', 'match-status'],    postRules: ['match-status'] },
}

export const transparent = [
  'foul-committed field outcome does have advantage',
  'block field outcome does have deflection',
  'card',
  'pressure-start',
  'pressure-end',
  'shield',
  'error',
  'camera-off',
  'camera-on',
]

export const always = [
  'stoppage',
  'card',
  'own-goal-against',
  'half-end',
  'shield',
  'error',
]

// verbatim, including the duplicated 'out' at the end of the document's list
export const pressureRoomTransparent = [
  'foul-committed', 'block', 'card', 'shield', 'fifty-fifty', 'pass', 'shot',
  'goal-keeper', 'clearance', 'interception', 'ball-recovery', 'reception',
  'tackle', 'dribble', 'miscontrol', 'out', 'end-shot', 'referee-ball-drop',
  'error', 'camera-off', 'camera-on', 'end-stoppage', 'stoppage',
  'match-status', 'own-goal-against', 'out',
]
