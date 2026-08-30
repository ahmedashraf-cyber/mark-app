/**
 * fieldExtras.js — FIELD mode complete data layer
 * ============================================================================
 * Built directly from the authoritative spec (App_Shortcuts_-_Sheet1.csv).
 * This file is read ONLY by FieldPage.jsx and exportFieldSession.js.
 * Scout mode, Audit mode, TagPanel.jsx, and tagging_scenarios.js are untouched.
 *
 * DESIGN:
 *   optionCode  — globally stable stored value (e.g. 'BODY_RIGHT_FOOT')
 *   label       — display text (can be renamed without touching stored data)
 *   toggleKey   — the keypress shown to the collector, per-event, from spec verbatim
 *
 * Groups have selectType: 'single' | 'multi'
 * Groups have required: true | false (false = has Skip/Enter in spec)
 *
 * Multi-block events (Pass, Shot, Goal keeper) use a variants array:
 *   discriminatorGroupId — which group's selection drives branching
 *   variants[].when      — option codes that select this branch
 *   variants[].groups    — ordered group chain for this branch
 *
 * SCOPE RULES:
 *   - Never import from TagPanel, tagging_scenarios, or Scout-related files
 *   - All option labels trimmed of whitespace (spec had "Wronb ", "Low " etc.)
 *   - "Lunch" is a known typo for "Launch"; new records use LAUNCH_LAUNCH;
 *     old "Lunch" records are passed through as-is by export (see exportFieldSession.js)
 */

// ─── Option registry ──────────────────────────────────────────────────────────
// Every distinct option. code is the stored value — never rename.
// label is display text. toggleKey is per-group (set on the group option, not here).

export const OPTIONS = {
  // Body part
  BODY_RIGHT_FOOT:    { code:'BODY_RIGHT_FOOT',    label:'Right foot'    },
  BODY_LEFT_FOOT:     { code:'BODY_LEFT_FOOT',     label:'Left foot'     },
  BODY_HEAD:          { code:'BODY_HEAD',           label:'Head'          },
  BODY_OTHER:         { code:'BODY_OTHER',          label:'Other'         },
  BODY_BOTH_HANDS:    { code:'BODY_BOTH_HANDS',     label:'Both hands'    },
  BODY_RIGHT_HAND:    { code:'BODY_RIGHT_HAND',     label:'Right hand'    },
  BODY_LEFT_HAND:     { code:'BODY_LEFT_HAND',      label:'Left hand'     },
  BODY_CHEST:         { code:'BODY_CHEST',          label:'Chest'         },
  BODY_KEEPER_ARM:    { code:'BODY_KEEPER_ARM',     label:'Keeper arm'    },
  BODY_DROP_KICK:     { code:'BODY_DROP_KICK',      label:'Drop kick'     },
  BODY_NO_TOUCH:      { code:'BODY_NO_TOUCH',       label:'No touch'      },

  // Height
  HEIGHT_GROUND:      { code:'HEIGHT_GROUND',       label:'Ground'        },
  HEIGHT_LOW:         { code:'HEIGHT_LOW',           label:'Low'           },  // was "Wronb " in spec — corrected
  HEIGHT_HIGH:        { code:'HEIGHT_HIGH',          label:'High'          },

  // Technique — foot
  TECH_NORMAL:        { code:'TECH_NORMAL',          label:'Normal'        },
  TECH_VOLLEY:        { code:'TECH_VOLLEY',          label:'Volley'        },
  TECH_HALF_VOLLEY:   { code:'TECH_HALF_VOLLEY',     label:'Half volley'   },
  TECH_OVERHEAD_KICK: { code:'TECH_OVERHEAD_KICK',   label:'Overhead kick' },
  TECH_LOB:           { code:'TECH_LOB',             label:'Lob'           },
  TECH_BACKHEEL:      { code:'TECH_BACKHEEL',        label:'Backheel'      },
  TECH_DIVING_HEADER: { code:'TECH_DIVING_HEADER',   label:'Diving header' },
  // Corner technique
  TECH_INSWINGING:    { code:'TECH_INSWINGING',      label:'Inswinging'    },
  TECH_OUTSWINGING:   { code:'TECH_OUTSWINGING',     label:'Outswinging'   },
  TECH_STRAIGHT:      { code:'TECH_STRAIGHT',        label:'Straight'      },
  // GK technique
  TECH_CLEAR:         { code:'TECH_CLEAR',           label:'Clear'         },
  TECH_CLAIM:         { code:'TECH_CLAIM',           label:'Claim'         },

  // Extras (multi-select additions on pass/shot/etc.)
  EXTRA_THROUGH_BALL:      { code:'EXTRA_THROUGH_BALL',       label:'Through ball'       },
  EXTRA_BACKHEEL:          { code:'EXTRA_BACKHEEL',           label:'Backheel'           },
  EXTRA_INJURY_CLEARANCE:  { code:'EXTRA_INJURY_CLEARANCE',   label:'Injury clearance'   },
  EXTRA_AERIAL_WON:        { code:'EXTRA_AERIAL_WON',         label:'Aerial won'         },
  EXTRA_DEFLECTION:        { code:'EXTRA_DEFLECTION',         label:'Deflection'         },
  EXTRA_SAVE:              { code:'EXTRA_SAVE',               label:'Save'               },
  EXTRA_MISCOMMUNICATION:  { code:'EXTRA_MISCOMMUNICATION',   label:'Miscommunication'   },
  EXTRA_STEP_IN:           { code:'EXTRA_STEP_IN',            label:'Step in'            },
  EXTRA_OFF_TARGET:        { code:'EXTRA_OFF_TARGET',         label:'Off target'         },
  EXTRA_TO_POST:           { code:'EXTRA_TO_POST',            label:'To post'            },
  EXTRA_SLIDING_PRIMARY:   { code:'EXTRA_SLIDING_PRIMARY',    label:'Sliding primary player' },
  EXTRA_SLIDING_SECONDARY: { code:'EXTRA_SLIDING_SECONDARY',  label:'Sliding secondary player' },
  EXTRA_NO_TOUCH:          { code:'EXTRA_NO_TOUCH',           label:'No touch'           },
  EXTRA_NUTMEG:            { code:'EXTRA_NUTMEG',             label:'Nutmeg'             },
  EXTRA_SLIDING:           { code:'EXTRA_SLIDING',            label:'Sliding'            },
  EXTRA_OVERRUN:           { code:'EXTRA_OVERRUN',            label:'Overrun'            },
  EXTRA_GOAL_KICK:         { code:'EXTRA_GOAL_KICK',          label:'Goal kick'          },

  // GK body state
  GK_BODY_DIVING:     { code:'GK_BODY_DIVING',       label:'Diving'        },
  GK_BODY_STANDING:   { code:'GK_BODY_STANDING',     label:'Standing'      },

  // GK stance
  GK_STANCE_SET:      { code:'GK_STANCE_SET',         label:'Set'           },
  GK_STANCE_PRONE:    { code:'GK_STANCE_PRONE',       label:'Prone'         },
  GK_STANCE_MOVING:   { code:'GK_STANCE_MOVING',      label:'Moving'        },

  // Outcome / result
  OUTCOME_WON:            { code:'OUTCOME_WON',            label:'Won'              },
  OUTCOME_SUCCESS:        { code:'OUTCOME_SUCCESS',        label:'Success'          },
  OUTCOME_FAIL:           { code:'OUTCOME_FAIL',           label:'Fail'             },
  OUTCOME_SECOND_EFFORT:  { code:'OUTCOME_SECOND_EFFORT',  label:'Second effort'    },
  OUTCOME_COMPLETE:       { code:'OUTCOME_COMPLETE',       label:'Complete'         },
  OUTCOME_INCOMPLETE:     { code:'OUTCOME_INCOMPLETE',     label:'Fail'             },
  OUTCOME_OPEN_PLAY:      { code:'OUTCOME_OPEN_PLAY',      label:'Open play'        },
  OUTCOME_FIRST_TIME:     { code:'OUTCOME_FIRST_TIME',     label:'First time'       },
  OUTCOME_DRIBBLE_ATT:    { code:'OUTCOME_DRIBBLE_ATT',    label:'Dribble attempted'},

  // Foul outcome
  FOUL_ADVANTAGE:     { code:'FOUL_ADVANTAGE',       label:'Advantage'     },
  FOUL_PENALTY:       { code:'FOUL_PENALTY',         label:'Penalty'       },
  FOUL_REGULAR:       { code:'FOUL_REGULAR',         label:'Regular'       },
  FOUL_HANDBALL:      { code:'FOUL_HANDBALL',        label:'Handball'      },
  FOUL_SIX_SEC:       { code:'FOUL_SIX_SEC',         label:'Six seconds'   },
  FOUL_BACKPASS:      { code:'FOUL_BACKPASS',         label:'Backpass pick' },
  FOUL_DANGEROUS:     { code:'FOUL_DANGEROUS',        label:'Dangerous play'},
  FOUL_DIVE:          { code:'FOUL_DIVE',             label:'Dive'          },
  FOUL_OFFSIDE:       { code:'FOUL_OFFSIDE',          label:'Offside'       },
  FOUL_EIGHT_SEC:     { code:'FOUL_EIGHT_SEC',        label:'Eight seconds' },

  // Card
  CARD_NO_CARD:       { code:'CARD_NO_CARD',          label:'No card'       },
  CARD_YELLOW:        { code:'CARD_YELLOW',            label:'Yellow card'   },
  CARD_SECOND_YELLOW: { code:'CARD_SECOND_YELLOW',     label:'Second yellow' },
  CARD_RED:           { code:'CARD_RED',               label:'Red card'      },

  // Pass type (inferred)
  TYPE_KICK_OFF:      { code:'TYPE_KICK_OFF',          label:'Kick off'      },
  TYPE_THROW_IN:      { code:'TYPE_THROW_IN',          label:'Throw in'      },
  TYPE_FREE_KICK:     { code:'TYPE_FREE_KICK',         label:'Free kick'     },
  TYPE_CORNER:        { code:'TYPE_CORNER',            label:'Corner'        },
  TYPE_GOAL_KICK:     { code:'TYPE_GOAL_KICK',         label:'Goal kick'     },
  TYPE_OPEN_PLAY:     { code:'TYPE_OPEN_PLAY',         label:'Open play'     },
  TYPE_GK_DIST:       { code:'TYPE_GK_DIST',           label:'GK distribution'},

  // Side / direction
  SIDE_RIGHT:         { code:'SIDE_RIGHT',             label:'Right'         },
  SIDE_LEFT:          { code:'SIDE_LEFT',              label:'Left'          },
  SIDE_RIGHT_TAKE_ON: { code:'SIDE_RIGHT_TAKE_ON',     label:'Right take on' },
  SIDE_LEFT_TAKE_ON:  { code:'SIDE_LEFT_TAKE_ON',      label:'Left take on'  },
  SIDE_NONE:          { code:'SIDE_NONE',              label:'None'          },

  // Location (Out event)
  LOC_SIDELINE:       { code:'LOC_SIDELINE',           label:'Sideline'      },
  LOC_ENDLINE:        { code:'LOC_ENDLINE',            label:'Endline'       },

  // Launch (GK distribution)
  LAUNCH_LAUNCH:      { code:'LAUNCH_LAUNCH',           label:'Launch'        },

  // End shot
  END_SHOT_POST:      { code:'END_SHOT_POST',           label:'Post'          },
  END_SHOT_WAYWARD:   { code:'END_SHOT_WAYWARD',        label:'Wayward'       },
  END_SHOT_OUT_ENDLINE:{ code:'END_SHOT_OUT_ENDLINE',   label:'Out endline'   },
  END_SHOT_REDIRECT:  { code:'END_SHOT_REDIRECT',       label:'Redirect'      },

  // Stoppage type
  STOP_INJURY:        { code:'STOP_INJURY',             label:'Injury'        },
  STOP_REVIEW:        { code:'STOP_REVIEW',             label:'Review'        },
  STOP_OTHER:         { code:'STOP_OTHER',              label:'Other'         },
  STOP_ABANDONED:     { code:'STOP_ABANDONED',          label:'Abandoned'     },

  // Stoppage paused
  PAUSED_YES:         { code:'PAUSED_YES',              label:'Yes'           },
  PAUSED_NO:          { code:'PAUSED_NO',               label:'No'            },

  // Miscontrol type
  MISC_REGULAR:       { code:'MISC_REGULAR',            label:'Regular'       },
  MISC_AERIAL_WON:    { code:'MISC_AERIAL_WON',         label:'Aerial won'    },

  // Half start attacking direction
  ATK_LEFT_TO_RIGHT:  { code:'ATK_LEFT_TO_RIGHT',       label:'Left to right' },
  ATK_RIGHT_TO_LEFT:  { code:'ATK_RIGHT_TO_LEFT',       label:'Right to left' },

  // Half start video
  VIDEO_LATE_START:   { code:'VIDEO_LATE_START',        label:'Late video start'},
  VIDEO_SKIP:         { code:'VIDEO_SKIP',              label:'Skip'           },
}

const O = OPTIONS  // shorthand

// ─── Group factory ────────────────────────────────────────────────────────────
// Each option in a group has toggleKey (per spec, verbatim) + the option definition.
function grp(id, label, selectType, required, opts) {
  return { id, label, selectType, required, options: opts }
}
function opt(option, toggleKey) {
  return { ...option, toggleKey }
}

// ─── Reusable group definitions ───────────────────────────────────────────────

const BODY_PART_SHOT = grp('body_part', 'Body part', 'single', true, [
  opt(O.BODY_OTHER,         '1'),
  opt(O.BODY_RIGHT_FOOT,    '2'),
  opt(O.BODY_LEFT_FOOT,     '3'),
  opt(O.BODY_HEAD,          '4'),
])

const BODY_PART_PASS = grp('body_part', 'Body part', 'single', true, [
  opt(O.BODY_RIGHT_FOOT,    '2'),
  opt(O.BODY_LEFT_FOOT,     '3'),
  opt(O.BODY_HEAD,          '4'),
  opt(O.BODY_KEEPER_ARM,    '5'),
  opt(O.BODY_DROP_KICK,     '6'),
  opt(O.BODY_OTHER,         '1'),
  opt(O.BODY_NO_TOUCH,      '7'),
])

const BODY_PART_GK = grp('body_part', 'Body part', 'single', true, [
  opt(O.BODY_BOTH_HANDS,    '1'),
  opt(O.BODY_RIGHT_FOOT,    '2'),
  opt(O.BODY_LEFT_FOOT,     '3'),
  opt(O.BODY_HEAD,          '4'),
  opt(O.BODY_RIGHT_HAND,    '5'),
  opt(O.BODY_LEFT_HAND,     '6'),
  opt(O.BODY_CHEST,         '7'),
])

const HEIGHT_PASS = grp('height', 'Height', 'single', true, [
  opt(O.HEIGHT_GROUND,      '1'),
  opt(O.HEIGHT_LOW,         '2'),
  opt(O.HEIGHT_HIGH,        '3'),
])

const HEIGHT_THROW_IN = grp('height', 'Height', 'single', true, [
  opt(O.HEIGHT_LOW,         '1'),
  opt(O.HEIGHT_HIGH,        '2'),
])

const EXTRAS_PASS = grp('extras', 'Extras', 'multi', false, [
  opt(O.EXTRA_THROUGH_BALL,     '1'),
  opt(O.EXTRA_BACKHEEL,         '2'),
  opt(O.EXTRA_INJURY_CLEARANCE, '3'),
])

const EXTRAS_PASS_NOTOUCHTOO = grp('extras', 'Extras', 'multi', false, [
  opt(O.EXTRA_THROUGH_BALL,     '1'),
  opt(O.EXTRA_BACKHEEL,         '2'),
  opt(O.EXTRA_INJURY_CLEARANCE, '3'),
  opt(O.BODY_NO_TOUCH,          '7'),
])

const TECH_FOOT = grp('technique', 'Technique', 'single', true, [
  opt(O.TECH_NORMAL,        '1'),
  opt(O.TECH_VOLLEY,        '2'),
  opt(O.TECH_HALF_VOLLEY,   '3'),
  opt(O.TECH_OVERHEAD_KICK, '4'),
  opt(O.TECH_LOB,           '5'),
  opt(O.TECH_BACKHEEL,      '6'),
])

const TECH_HEAD = grp('technique', 'Technique', 'single', true, [
  opt(O.TECH_NORMAL,        '1'),
  opt(O.TECH_DIVING_HEADER, '2'),
  opt(O.TECH_LOB,           '3'),
])

const TECH_OTHER_SHOT = grp('technique', 'Technique', 'single', true, [
  opt(O.TECH_NORMAL,        '1'),
  opt(O.TECH_OVERHEAD_KICK, '2'),
  opt(O.TECH_LOB,           '3'),
])

const GK_BODY_STATE = grp('gk_body_state', 'GK body state', 'single', false, [
  opt(O.GK_BODY_DIVING,     '1'),
  opt(O.GK_BODY_STANDING,   '2'),
])

const GK_STANCE = grp('gk_stance', 'GK stance', 'single', true, [
  opt(O.GK_STANCE_SET,      '1'),
  opt(O.GK_STANCE_PRONE,    '2'),
  opt(O.GK_STANCE_MOVING,   '3'),
])

const OUTCOME_SHOT = grp('outcome', 'Outcome', 'single', true, [
  opt(O.OUTCOME_OPEN_PLAY,  '1'),
  opt(O.OUTCOME_FIRST_TIME, '2'),
])

const EXTRAS_SHOT_HEAD = grp('extras', 'Extras', 'multi', false, [
  opt(O.EXTRA_AERIAL_WON,   '1'),
])

const MISCOMMUNICATION = grp('miscommunication', 'Miscommunication', 'multi', false, [
  opt(O.EXTRA_MISCOMMUNICATION, '1'),
])

const SIDE_DUEL = grp('side', 'Side', 'single', true, [
  opt(O.SIDE_RIGHT,         '1'),
  opt(O.SIDE_LEFT,          '2'),
  opt(O.SIDE_RIGHT_TAKE_ON, '3'),
  opt(O.SIDE_LEFT_TAKE_ON,  '4'),
  opt(O.SIDE_NONE,          '5'),
])

const ACTION_SMOOTHER = grp('action', 'Action', 'single', false, [
  opt(O.OUTCOME_DRIBBLE_ATT, '1'),
])

const EXTRAS_SMOOTHER = grp('extras', 'Extras', 'multi', false, [
  opt(O.EXTRA_NO_TOUCH,  '1'),
  opt(O.EXTRA_NUTMEG,    '2'),
  opt(O.EXTRA_SLIDING,   '3'),
])

// ─── Event schema ─────────────────────────────────────────────────────────────
// Each event: { id, label, hotkey, mouseOnly, groups | variants }
// variants: { discriminatorGroupId, variants: [{ when:['OPTION_CODE',...], groups:[...] }] }
// Team side is always added last by FieldPage — not in groups here.

export const FIELD_EVENTS = [

  // ── Half start ─────────────────────────────────────────────────────────────
  {
    id: 'half_start', label: 'Half start', hotkey: null, mouseOnly: false, key: 'S',
    panel: 'Offense',
    groups: [
      grp('attacking_direction', 'Attacking direction', 'single', true, [
        opt(O.ATK_LEFT_TO_RIGHT, '1'),
        opt(O.ATK_RIGHT_TO_LEFT, '2'),
      ]),
      grp('video', 'Video', 'single', false, [
        opt(O.VIDEO_LATE_START, '1'),
        opt(O.VIDEO_SKIP,       'Enter'),
      ]),
    ],
  },

  // ── Pass ──────────────────────────────────────────────────────────────────
  // Single event with type inferred then confirmed before attribute prompts.
  // All type variants share team-side; attribute groups differ by type.
  {
    id: 'pass', label: 'Pass', hotkey: 'E', mouseOnly: false, panel: 'Offense',
    typeInferred: true,
    variants: {
      discriminatorGroupId: 'type',  // synthetic group added by FieldPage from inference
      variants: [
        {
          when: ['TYPE_KICK_OFF'],
          groups: [HEIGHT_PASS, BODY_PART_PASS, EXTRAS_PASS],
        },
        {
          when: ['TYPE_THROW_IN'],
          groups: [HEIGHT_THROW_IN, EXTRAS_PASS],
        },
        {
          when: ['TYPE_FREE_KICK'],
          groups: [HEIGHT_PASS, BODY_PART_PASS, EXTRAS_PASS],
        },
        {
          when: ['TYPE_CORNER'],
          groups: [
            HEIGHT_PASS, BODY_PART_PASS, EXTRAS_PASS,
            grp('technique', 'Technique', 'single', true, [
              opt(O.TECH_INSWINGING,  '1'),
              opt(O.TECH_OUTSWINGING, '2'),
              opt(O.TECH_STRAIGHT,    '3'),
            ]),
          ],
        },
        {
          when: ['TYPE_GOAL_KICK'],
          groups: [HEIGHT_PASS, BODY_PART_PASS, EXTRAS_PASS],
        },
        {
          when: ['TYPE_GK_DIST'],
          groups: [
            BODY_PART_PASS,
            EXTRAS_PASS,
            grp('launch', 'Launch', 'single', false, [
              opt(O.LAUNCH_LAUNCH, '1'),
            ]),
          ],
        },
        {
          when: ['TYPE_OPEN_PLAY'],
          groups: [HEIGHT_PASS, BODY_PART_PASS, EXTRAS_PASS_NOTOUCHTOO],
        },
      ],
    },
  },

  // ── Shot ──────────────────────────────────────────────────────────────────
  {
    id: 'shot', label: 'Shot', hotkey: 'S', mouseOnly: false, panel: 'Offense',
    openState: true,  // opens end_shot
    variants: {
      discriminatorGroupId: 'body_part',
      variants: [
        {
          when: ['BODY_RIGHT_FOOT', 'BODY_LEFT_FOOT'],
          groups: [BODY_PART_SHOT, TECH_FOOT, GK_BODY_STATE, OUTCOME_SHOT],
        },
        {
          when: ['BODY_HEAD'],
          groups: [BODY_PART_SHOT, EXTRAS_SHOT_HEAD, TECH_HEAD, GK_BODY_STATE, OUTCOME_SHOT],
        },
        {
          when: ['BODY_OTHER'],
          groups: [BODY_PART_SHOT, TECH_OTHER_SHOT, GK_BODY_STATE, OUTCOME_SHOT],
        },
      ],
    },
  },

  // ── Foul committed ────────────────────────────────────────────────────────
  {
    id: 'foul_committed', label: 'Foul committed', hotkey: 'X', mouseOnly: false, panel: 'Offense',
    groups: [
      grp('outcome', 'Outcome', 'single', false, [
        opt(O.FOUL_ADVANTAGE,  '1'),
        opt(O.FOUL_PENALTY,    '2'),
      ]),
      grp('type', 'Type', 'single', true, [
        opt(O.FOUL_REGULAR,    '1'),
        opt(O.FOUL_HANDBALL,   '2'),
        opt(O.FOUL_SIX_SEC,    '3'),
        opt(O.FOUL_BACKPASS,   '4'),
        opt(O.FOUL_DANGEROUS,  '5'),
        opt(O.FOUL_DIVE,       '6'),
        opt(O.FOUL_OFFSIDE,    '7'),
        opt(O.FOUL_EIGHT_SEC,  '8'),
      ]),
      grp('kind', 'Card', 'single', true, [
        opt(O.CARD_NO_CARD,       '1'),
        opt(O.CARD_YELLOW,        '2'),
        opt(O.CARD_SECOND_YELLOW, '3'),
        opt(O.CARD_RED,           '4'),
      ]),
    ],
  },

  // ── Reception ─────────────────────────────────────────────────────────────
  {
    id: 'reception', label: 'Reception', hotkey: 'W', mouseOnly: false, panel: 'Offense',
    groups: [],
  },

  // ── Miscontrol ────────────────────────────────────────────────────────────
  {
    id: 'miscontrol', label: 'Miscontrol', hotkey: 'T', mouseOnly: false, panel: 'Offense',
    groups: [
      grp('type', 'Type', 'single', true, [
        opt(O.MISC_REGULAR,    '1'),
        opt(O.MISC_AERIAL_WON, '2'),
      ]),
      grp('kind', 'Kind', 'single', true, [
        opt(O.OUTCOME_FIRST_TIME, '1'),
        opt(O.OUTCOME_OPEN_PLAY,  '2'),
      ]),
    ],
  },

  // ── Out ───────────────────────────────────────────────────────────────────
  {
    id: 'out', label: 'Out', hotkey: 'O', mouseOnly: false, panel: 'Offense',
    groups: [
      grp('location', 'Location', 'single', true, [
        opt(O.LOC_SIDELINE, '1'),
        opt(O.LOC_ENDLINE,  '2'),
      ]),
    ],
  },

  // ── Pass (First time) — same key E, label used in inference ───────────────
  // Treated as a pass variant with forced TYPE_KICK_OFF extras tree in practice;
  // but in FIELD it is a separate palette entry with its own attribute set.
  {
    id: 'pass_first_time', label: 'Pass (First time)', hotkey: 'Q', mouseOnly: false, panel: 'Offense',
    typeInferred: false,
    groups: [
      HEIGHT_PASS,
      grp('body_part', 'Body part', 'single', true, [
        opt(O.BODY_RIGHT_FOOT,    '2'),
        opt(O.BODY_LEFT_FOOT,     '3'),
        opt(O.BODY_HEAD,          '4'),  // not in spec block but code 4 is globally consistent for Head
        opt(O.BODY_NO_TOUCH,      '7'),
      ]),
      EXTRAS_PASS,
    ],
  },

  // ── Pass recovery ─────────────────────────────────────────────────────────
  {
    id: 'pass_recovery', label: 'Pass recovery', hotkey: 'P', mouseOnly: false, panel: 'Offense',
    groups: [
      HEIGHT_PASS,
      grp('body_part', 'Body part', 'single', true, [
        opt(O.BODY_RIGHT_FOOT,    '2'),
        opt(O.BODY_LEFT_FOOT,     '3'),
        opt(O.BODY_HEAD,          '4'),
        opt(O.BODY_OTHER,         '1'),
        opt(O.BODY_NO_TOUCH,      '7'),
      ]),
      EXTRAS_PASS,
      MISCOMMUNICATION,
      grp('launch', 'Launch', 'single', false, [
        opt(O.LAUNCH_LAUNCH, '1'),
      ]),
    ],
  },

  // ── Dribble ───────────────────────────────────────────────────────────────
  {
    id: 'dribble', label: 'Dribble', hotkey: 'D', mouseOnly: false, panel: 'Offense',
    groups: [
      grp('extras', 'Extras', 'multi', false, [
        opt(O.EXTRA_NO_TOUCH,  '1'),
        opt(O.EXTRA_NUTMEG,    '2'),
        opt(O.EXTRA_SLIDING,   '3'),
      ]),
      grp('outcome', 'Outcome', 'single', false, [
        opt(O.EXTRA_OVERRUN,   '1'),
      ]),
      SIDE_DUEL,
    ],
  },

  // ── Shield ────────────────────────────────────────────────────────────────
  {
    id: 'shield', label: 'Shield', hotkey: 'C', mouseOnly: false, panel: 'Offense',
    groups: [],
  },

  // ── Mouse-only Offense events ─────────────────────────────────────────────
  {
    id: 'card', label: 'Card', hotkey: null, mouseOnly: true, panel: 'Offense',
    groups: [
      grp('kind', 'Card', 'single', true, [
        opt(O.CARD_YELLOW,        '1'),
        opt(O.CARD_SECOND_YELLOW, '2'),
        opt(O.CARD_RED,           '3'),
      ]),
    ],
  },
  { id: 'error',            label: 'Error',            hotkey: null, mouseOnly: true, panel: 'Offense', groups: [] },
  { id: 'own_goal_against', label: 'Own goal against', hotkey: null, mouseOnly: true, panel: 'Offense', groups: [] },
  {
    id: 'stoppage', label: 'Stoppage', hotkey: null, mouseOnly: true, panel: 'Offense',
    openState: true,  // opens end_stoppage
    groups: [
      grp('type', 'Type', 'single', true, [
        opt(O.STOP_INJURY,    '1'),
        opt(O.STOP_REVIEW,    '2'),
        opt(O.STOP_OTHER,     '3'),
        opt(O.STOP_ABANDONED, '4'),
      ]),
      grp('paused', 'Paused', 'single', true, [
        opt(O.PAUSED_YES, '1'),
        opt(O.PAUSED_NO,  '2'),
      ]),
    ],
  },
  { id: 'substitution',   label: 'Substitution',   hotkey: null, mouseOnly: true, panel: 'Offense', groups: [] },
  { id: 'tactical_shift', label: 'Tactical shift',  hotkey: null, mouseOnly: true, panel: 'Offense', groups: [] },
  { id: 'formation',      label: 'Formation',       hotkey: null, mouseOnly: true, panel: 'Offense', groups: [] },
  { id: 'camera_off',     label: 'Camera off',      hotkey: null, mouseOnly: true, panel: 'Offense', groups: [] },
  { id: 'camera_on',      label: 'Camera on',       hotkey: null, mouseOnly: true, panel: 'Offense', groups: [] },
  { id: 'half_end',  label: 'Half end',  hotkey: null, mouseOnly: true, panel: 'Offense', groups: [], forceClosesAll: true },
  { id: 'fifty_fifty', label: 'Fifty fifty', hotkey: null, mouseOnly: true, panel: 'Offense',
    groups: [
      grp('extras', 'Extras', 'multi', false, [
        opt(O.EXTRA_SLIDING_PRIMARY,   '1'),
        opt(O.EXTRA_SLIDING_SECONDARY, '2'),
      ]),
      grp('outcome', 'Outcome', 'single', true, [
        opt(O.OUTCOME_WON,     '1'),
        opt(O.OUTCOME_SUCCESS, '2'),
      ]),
    ],
  },

  // ── Close events (synthetic — triggered by open-state engine) ─────────────
  {
    id: 'end_shot', label: 'End shot', hotkey: 'S', mouseOnly: false, panel: '_close',
    closesEventId: 'shot',
    groups: [
      grp('outcome', 'Outcome', 'single', true, [
        opt(O.END_SHOT_POST,        '1'),
        opt(O.END_SHOT_WAYWARD,     '2'),
        opt(O.END_SHOT_OUT_ENDLINE, '3'),
        opt(O.END_SHOT_REDIRECT,    '4'),
      ]),
    ],
  },
  {
    id: 'end_stoppage', label: 'End stoppage', hotkey: null, mouseOnly: true, panel: '_close',
    closesEventId: 'stoppage',
    groups: [],
  },
  {
    id: 'pressure_end', label: 'Pressure end', hotkey: 'G', mouseOnly: false, panel: '_close',
    closesEventId: 'pressure_start',
    teamInherited: true,
    groups: [],
  },

  // ── Defense events ─────────────────────────────────────────────────────────

  {
    id: 'block', label: 'Block', hotkey: 'B', mouseOnly: false, panel: 'Defense',
    groups: [
      grp('extras', 'Extras', 'multi', false, [
        opt(O.EXTRA_DEFLECTION,      '1'),
        opt(O.EXTRA_SAVE,            '2'),
        opt(O.EXTRA_MISCOMMUNICATION,'3'),
      ]),
    ],
  },

  {
    id: 'interception', label: 'Interception', hotkey: 'V', mouseOnly: false, panel: 'Defense',
    groups: [
      grp('extras', 'Extras', 'multi', false, [
        opt(O.EXTRA_STEP_IN, '1'),
      ]),
      grp('outcome', 'Outcome', 'single', true, [
        opt(O.OUTCOME_WON,     '1'),
        opt(O.OUTCOME_SUCCESS, '2'),
      ]),
      MISCOMMUNICATION,
    ],
  },

  {
    id: 'tackle', label: 'Tackle', hotkey: 'A', mouseOnly: false, panel: 'Defense',
    groups: [
      grp('extras', 'Extras', 'multi', false, [
        opt(O.EXTRA_NO_TOUCH,  '1'),
        opt(O.EXTRA_NUTMEG,    '2'),
        opt(O.EXTRA_SLIDING,   '3'),
      ]),
      grp('outcome', 'Outcome', 'single', true, [
        opt(O.OUTCOME_WON,     '1'),
        opt(O.OUTCOME_SUCCESS, '2'),
      ]),
      grp('action', 'Action', 'single', false, [
        opt(O.OUTCOME_DRIBBLE_ATT, '1'),
      ]),
      // Side only appears if Action = Dribble attempted was selected (not skipped)
      { ...SIDE_DUEL, conditionalOn: { groupId: 'action', minSelections: 1 } },
    ],
  },

  {
    id: 'ball_recovery', label: 'Ball recovery', hotkey: 'R', mouseOnly: false, panel: 'Defense',
    groups: [
      grp('outcome', 'Outcome', 'single', true, [
        opt(O.OUTCOME_COMPLETE,   '1'),
        opt(O.OUTCOME_INCOMPLETE, '2'),
      ]),
      MISCOMMUNICATION,
    ],
  },

  {
    id: 'clearance', label: 'Clearance', hotkey: 'F', mouseOnly: false, panel: 'Defense',
    groups: [
      HEIGHT_PASS,
      grp('body_part', 'Body part', 'single', true, [
        opt(O.BODY_RIGHT_FOOT, '2'),
        opt(O.BODY_LEFT_FOOT,  '3'),
        opt(O.BODY_HEAD,       '4'),
        opt(O.BODY_OTHER,      '9'),
      ]),
      grp('type', 'Type', 'single', true, [
        opt(O.MISC_REGULAR,    '1'),
        opt(O.EXTRA_AERIAL_WON,'2'),
      ]),
      MISCOMMUNICATION,
    ],
  },

  {
    id: 'hold_up_duel', label: 'Hold up duel', hotkey: 'H', mouseOnly: false, panel: 'Defense',
    groups: [],
  },

  {
    id: 'positioning_duel', label: 'Positioning duel', hotkey: 'Y', mouseOnly: false, panel: 'Defense',
    groups: [],
  },

  {
    id: 'separation_duel', label: 'Separation duel', hotkey: 'J', mouseOnly: false, panel: 'Defense',
    groups: [
      grp('direction', 'Direction', 'single', true, [
        opt(O.DIRECTION_RIGHT ?? O.SIDE_RIGHT, '1'),
        opt(O.DIRECTION_LEFT  ?? O.SIDE_LEFT,  '2'),
      ]),
    ],
  },

  {
    id: 'leg_stretch_duel', label: 'Leg stretch duel', hotkey: 'U', mouseOnly: false, panel: 'Defense',
    groups: [],
  },

  {
    id: 'goal_keeper', label: 'Goal Keeper', hotkey: 'K', mouseOnly: false, panel: 'Defense',
    variants: {
      discriminatorGroupId: 'type',
      variants: [
        {
          when: ['GK_TYPE_COLLECTED'],
          label: 'Collected',
          groups: [
            grp('outcome', 'Outcome', 'single', true, [
              opt(O.OUTCOME_SUCCESS,       '3'),
              opt(O.OUTCOME_FAIL,          '4'),
              opt(O.OUTCOME_SECOND_EFFORT, '5'),
            ]),
            MISCOMMUNICATION,
          ],
        },
        {
          when: ['GK_TYPE_PUNCH'],
          label: 'Punch',
          groups: [
            grp('outcome', 'Outcome', 'single', true, [
              opt(O.OUTCOME_SUCCESS,       '3'),
              opt(O.OUTCOME_FAIL,          '4'),
            ]),
            MISCOMMUNICATION,
          ],
        },
        {
          when: ['GK_TYPE_KEEPER_SWEEPER'],
          label: 'Keeper sweeper',
          groups: [
            BODY_PART_GK,
            grp('technique', 'Technique', 'single', true, [
              opt(O.TECH_CLEAR, '7'),
              opt(O.TECH_CLAIM, '8'),
            ]),
            MISCOMMUNICATION,
          ],
        },
        {
          when: ['GK_TYPE_SAVE_WON'],
          label: 'Save (Won)',
          groups: [
            BODY_PART_GK,
            grp('extras', 'Extras', 'multi', false, [
              opt(O.EXTRA_OFF_TARGET, '1'),
            ]),
            GK_BODY_STATE,
            GK_STANCE,
            grp('outcome', 'Outcome', 'single', true, [
              opt(O.OUTCOME_WON,           '1'),
              opt(O.OUTCOME_SUCCESS,       '3'),
              opt(O.OUTCOME_SECOND_EFFORT, '5'),
            ]),
            MISCOMMUNICATION,
          ],
        },
        {
          when: ['GK_TYPE_SAVE_SUCCESS'],
          label: 'Save (Success / SE)',
          groups: [
            BODY_PART_GK,
            grp('extras', 'Extras', 'multi', false, [
              opt(O.EXTRA_TO_POST,    '1'),
              opt(O.EXTRA_OFF_TARGET, '2'),
            ]),
            GK_BODY_STATE,
            GK_STANCE,
            grp('outcome', 'Outcome', 'single', true, [
              opt(O.OUTCOME_WON,           '1'),
              opt(O.OUTCOME_SUCCESS,       '3'),
              opt(O.OUTCOME_SECOND_EFFORT, '5'),
            ]),
            MISCOMMUNICATION,
          ],
        },
        {
          // Smother: GK closes down and smothers ball at attacker's feet (duel, not save)
          // Spec: "Goal keeper (Smoother)" — Extras + Direction + Kind (Dribble attempted)
          // No Body part, no GK body state, no Technique — genuinely different from all other GK blocks
          when: ['GK_TYPE_SMOTHER'],
          label: 'Smother',
          groups: [
            grp('extras', 'Extras', 'multi', false, [
              opt(O.EXTRA_NO_TOUCH, '1'),
              opt(O.EXTRA_NUTMEG,   '2'),
            ]),
            grp('action', 'Action', 'single', false, [
              opt(O.OUTCOME_DRIBBLE_ATT, '1'),
            ]),
            // Direction: conditionalOn action (same pattern as Tackle's Side)
            { ...SIDE_DUEL, label: 'Direction', conditionalOn: { groupId: 'action', minSelections: 1 } },
          ],
        },
      ],
    },
    // Type discriminator group (shown first)
    typeGroup: grp('type', 'GK type', 'single', true, [
      opt({ code:'GK_TYPE_COLLECTED',      label:'Collected'           }, '1'),
      opt({ code:'GK_TYPE_PUNCH',          label:'Punch'               }, '2'),
      opt({ code:'GK_TYPE_KEEPER_SWEEPER', label:'Keeper sweeper'      }, '3'),
      opt({ code:'GK_TYPE_SAVE_WON',       label:'Save (Won)'          }, '4'),
      opt({ code:'GK_TYPE_SAVE_SUCCESS',   label:'Save (Success / SE)' }, '5'),
      opt({ code:'GK_TYPE_SMOTHER',        label:'Smother'             }, '6'),
    ]),
  },

  // goal_keeper_smoother removed — folded into goal_keeper as GK_TYPE_SMOTHER (Type 6)

  {
    id: 'pressure_start', label: 'Pressure start', hotkey: 'G', mouseOnly: false, panel: 'Defense',
    openState: true,
    groups: [],  // Team Side asked by FieldPage (as on all events)
  },

  {
    id: 'pass_interception', label: 'Pass interception', hotkey: 'I', mouseOnly: false, panel: 'Defense',
    groups: [
      HEIGHT_PASS,
      grp('body_part', 'Body part', 'single', true, [
        opt(O.BODY_RIGHT_FOOT, '2'),
        opt(O.BODY_LEFT_FOOT,  '3'),
        opt(O.BODY_HEAD,       '4'),
        opt(O.BODY_OTHER,      '1'),
        opt(O.BODY_NO_TOUCH,   '7'),
      ]),
      grp('extras', 'Extras', 'multi', false, [
        opt(O.EXTRA_THROUGH_BALL,     '1'),
        opt(O.EXTRA_BACKHEEL,         '2'),
        opt(O.EXTRA_INJURY_CLEARANCE, '3'),
        opt(O.EXTRA_STEP_IN,          '4'),
      ]),
      MISCOMMUNICATION,
      grp('launch', 'Launch', 'single', false, [
        opt(O.LAUNCH_LAUNCH, '1'),
      ]),
    ],
  },

  // ── Defense panel — click-only utility events ─────────────────────────────
  {
    // Unknown pass end: data-quality marker. Team not meaningful (unknown who ended it).
    // Possession marked uncertain — no flip, no team stored.
    id: 'unknown_pass_end', label: 'Unknown pass end', hotkey: null, mouseOnly: true, panel: 'Defense',
    groups: [ MISCOMMUNICATION ],
  },
]

// ─── Lookup maps ──────────────────────────────────────────────────────────────
export const EVENT_BY_ID  = Object.fromEntries(FIELD_EVENTS.map(e => [e.id, e]))
export const EVENT_BY_KEY = (() => {
  const m = {}
  FIELD_EVENTS.forEach(e => {
    if (e.hotkey && !e.closesEventId) {
      if (!m[e.hotkey]) m[e.hotkey] = []
      m[e.hotkey].push(e)
    }
  })
  return m
})()

// ─── Startup key validation ───────────────────────────────────────────────────
// Runs once at module load. Logs any unintended key collisions.
// Intentional duplicates (open/close pairs and GK cycle) are whitelisted.
const INTENTIONAL_DUPLICATES = new Set(['G','S','K'])  // G=pressure toggle, S=shot/end_shot, K=GK cycle
;(() => {
  const seen = {}
  FIELD_EVENTS.forEach(e => {
    if (!e.hotkey || e.closesEventId) return  // skip close events — they share by design
    if (!seen[e.hotkey]) seen[e.hotkey] = []
    seen[e.hotkey].push(e.id)
  })
  Object.entries(seen).forEach(([key, ids]) => {
    if (ids.length > 1 && !INTENTIONAL_DUPLICATES.has(key)) {
      console.error(`[MARK fieldExtras] UNINTENDED key collision on '${key}': ${ids.join(', ')}`)
    }
  })
  // Confirm digit 0 is never a hotkey (reserved for possession flip in FieldPage)
  if (seen['0']) {
    console.error(`[MARK fieldExtras] Key '0' (digit) is reserved for possession flip but is also bound to: ${seen['0'].join(', ')}`)
  }
})();

// ─── Open-state registry ──────────────────────────────────────────────────────
export const OPEN_STATE_PAIRS = [
  { openId: 'shot',        closeId: 'end_shot',      closeKey: 'S', teamInherited: false, mandatory: true  },
  { openId: 'stoppage',    closeId: 'end_stoppage',  closeKey: null, teamInherited: false, mandatory: false },
  { openId: 'pressure_start', closeId: 'pressure_end', closeKey: 'G', teamInherited: true,  mandatory: false },
]

// ─── Transparent events (don't break look-back inference chain) ───────────────
export const TRANSPARENT_EVENT_IDS = new Set([
  'card', 'substitution', 'tactical_shift', 'formation',
  'camera_off', 'camera_on', 'stoppage', 'end_stoppage', 'unknown_pass_end',
])

// ─── Pass type inference ──────────────────────────────────────────────────────
// Returns { type: OPTIONS.TYPE_*, defaulted: boolean }
// recentEvents: array of stored field events, newest-last
// currentPossession: { team: 'home'|'away'|null, certain: boolean } — current possession state
export function inferPassType(recentEvents, currentPossession) {
  if (!recentEvents || recentEvents.length === 0)
    return { type: OPTIONS.TYPE_KICK_OFF, defaulted: true }

  // Walk backwards, skipping transparent events
  for (let i = recentEvents.length - 1; i >= 0; i--) {
    const ev = recentEvents[i]
    if (TRANSPARENT_EVENT_IDS.has(ev.eventId)) continue

    // Half start or own goal → Kick off
    if (ev.eventId === 'half_start' || ev.eventId === 'own_goal_against')
      return { type: OPTIONS.TYPE_KICK_OFF, defaulted: false }

    // Out event
    if (ev.eventId === 'out') {
      const locGroup = ev.groups?.find(g => g.groupId === 'location')
      const locCode  = locGroup?.selections?.[0]?.code
      if (locCode === 'LOC_SIDELINE')
        return { type: OPTIONS.TYPE_THROW_IN, defaulted: false }
      if (locCode === 'LOC_ENDLINE') {
        // ev.team = team that last touched the ball (put it out)
        // Attacking team last touch → Goal kick (defending GK restarts)
        // Defending team last touch → Corner (attacking team restarts)
        //
        // "Attacking" = the team currently in possession (or was in possession before Out)
        // ev.team was resolved from possession at Out commit time
        const outTeam     = ev.team  // team that put ball out
        const passingTeam = currentPossession?.team  // team about to take the restart

        if (outTeam && passingTeam) {
          if (outTeam === passingTeam) {
            // Same team put it out AND is taking the restart → Corner
            // (attacking team put it out → defending team/GK restarts; but here passingTeam===outTeam
            //  means we're the attacking team restarting → Corner)
            // Actually: outTeam = attacking → Goal kick (GK restarts for defending)
            //           outTeam = defending → Corner (attacking restarts)
            // passingTeam is about to restart; if passingTeam === outTeam then same team → Goal kick
            // if passingTeam !== outTeam then opposite → Corner
            return { type: OPTIONS.TYPE_GOAL_KICK, defaulted: false }
          } else {
            return { type: OPTIONS.TYPE_CORNER, defaulted: false }
          }
        }
        // Possession unknown — default Corner, mark as defaulted
        return { type: OPTIONS.TYPE_CORNER, defaulted: true }
      }
    }

    // Foul committed (not Penalty, not Advantage) → Free kick
    if (ev.eventId === 'foul_committed') {
      const outGroup = ev.groups?.find(g => g.groupId === 'outcome')
      const outCode  = outGroup?.selections?.[0]?.code
      if (outCode !== 'FOUL_PENALTY' && outCode !== 'FOUL_ADVANTAGE')
        return { type: OPTIONS.TYPE_FREE_KICK, defaulted: false }
    }

    // Goal keeper (Collected/Claim/Save) → GK distribution
    if (ev.eventId === 'goal_keeper') {
      const typeGroup = ev.groups?.find(g => g.groupId === 'type')
      const typeCode  = typeGroup?.selections?.[0]?.code
      if (['GK_TYPE_COLLECTED','GK_TYPE_SAVE_WON','GK_TYPE_SAVE_SUCCESS'].includes(typeCode))
        return { type: OPTIONS.TYPE_GK_DIST, defaulted: false }
    }

    // Any other non-transparent event → Open play
    return { type: OPTIONS.TYPE_OPEN_PLAY, defaulted: false }
  }

  // No non-transparent events found → default Kick off
  return { type: OPTIONS.TYPE_KICK_OFF, defaulted: true }
}

// ─── All pass type options for confirmation step ───────────────────────────────
export const PASS_TYPE_OPTIONS = [
  opt(O.TYPE_KICK_OFF,   'K'),
  opt(O.TYPE_THROW_IN,   'T'),
  opt(O.TYPE_FREE_KICK,  'F'),
  opt(O.TYPE_CORNER,     'C'),
  opt(O.TYPE_GOAL_KICK,  'G'),
  opt(O.TYPE_GK_DIST,    'D'),
  opt(O.TYPE_OPEN_PLAY,  'O'),
]

// ─── Possession rules per event ───────────────────────────────────────────────
//
// performedBy: 'possessing' | 'non-possessing' | 'explicit'
//   possessing     → team field = current possessing team (no prompt)
//   non-possessing → team field = the OTHER team (no prompt)
//   explicit       → still show team prompt for this event (player-based, not possession-based)
//
// flip: 'never' | 'always' | 'on_outcome' | 'uncertain' | 'deferred' | 'resets'
//   never         → possession stays with possessing team after this event
//   always        → possession flips to the other team
//   on_outcome    → flip only when certain Outcome codes are selected
//   uncertain     → ball destination unknown; mark possessionCertain=false, don't flip
//   deferred      → Out event: flip handled by next pass type inference
//   resets        → Half end: clears possession state entirely
//   explicit      → flip depends on a prompt answer (Fifty Fifty winner)
//
// flipOutcomes: outcome codes that trigger a flip (only used when flip='on_outcome')
// miscommunicationTeam: 'opponent' when Miscommunication belongs to the OTHER team
//
// Events with no possession rule default to { performedBy:'possessing', flip:'never' }

export const POSSESSION_RULES = {
  half_start:          { performedBy:'explicit',        flip:'never'      },  // sets initial state via Team Side prompt
  pass:                { performedBy:'possessing',       flip:'never'      },
  pass_first_time:     { performedBy:'possessing',       flip:'never'      },
  pass_recovery:       { performedBy:'non-possessing',   flip:'always',    miscommunicationTeam:'opponent' },
  pass_interception:   { performedBy:'non-possessing',   flip:'always',    miscommunicationTeam:'opponent' },
  shot:                { performedBy:'possessing',       flip:'never'      },
  end_shot:            { performedBy:'possessing',       flip:'uncertain'  },  // ball gone, destination unknown
  foul_committed:      { performedBy:'possessing',       flip:'on_outcome',
                         flipOutcomes:['FOUL_REGULAR','FOUL_HANDBALL','FOUL_SIX_SEC','FOUL_BACKPASS',
                                       'FOUL_DANGEROUS','FOUL_DIVE','FOUL_OFFSIDE','FOUL_EIGHT_SEC'],
                         flipUncertain:['FOUL_ADVANTAGE'],
                         flipExplicit: ['FOUL_PENALTY'],  // prompt for penalty restart team
                       },
  reception:           { performedBy:'possessing',       flip:'never'      },
  miscontrol:          { performedBy:'possessing',       flip:'uncertain'  },  // ball loose
  out:                 { performedBy:'possessing',       flip:'deferred'   },  // handled by pass type inference
  dribble:             { performedBy:'possessing',       flip:'never'      },
  shield:              { performedBy:'possessing',       flip:'never'      },
  block:               { performedBy:'non-possessing',   flip:'uncertain'  },  // deflection destination unknown
  interception:        { performedBy:'non-possessing',   flip:'on_outcome',
                         flipOutcomes:['OUTCOME_WON','OUTCOME_SUCCESS'],
                         miscommunicationTeam:'opponent' },
  ball_recovery:       { performedBy:'non-possessing',   flip:'on_outcome',
                         flipOutcomes:['OUTCOME_COMPLETE'],
                         miscommunicationTeam:'opponent' },
  clearance:           { performedBy:'non-possessing',   flip:'uncertain'  },
  tackle:              { performedBy:'non-possessing',   flip:'on_outcome',
                         flipOutcomes:['OUTCOME_WON','OUTCOME_SUCCESS'] },
  hold_up_duel:        { performedBy:'possessing',       flip:'never'      },
  positioning_duel:    { performedBy:'possessing',       flip:'never'      },
  separation_duel:     { performedBy:'possessing',       flip:'never'      },
  leg_stretch_duel:    { performedBy:'possessing',       flip:'never'      },
  goal_keeper:         { performedBy:'possessing',       flip:'on_outcome',
                         flipByGkType: {
                           GK_TYPE_COLLECTED:    'never',
                           GK_TYPE_PUNCH:        'uncertain',
                           GK_TYPE_KEEPER_SWEEPER: 'by_technique',  // Clear=uncertain, Claim=never
                           GK_TYPE_SAVE_WON:     'never',
                           GK_TYPE_SAVE_SUCCESS: 'never',
                           GK_TYPE_SMOTHER:      'uncertain',  // no Outcome group — destination unknown
                         },
                       },
  // goal_keeper_smoother removed — was separate event, now GK_TYPE_SMOTHER variant
  pressure_start:      { performedBy:'non-possessing',   flip:'never'      },
  pressure_end:        { performedBy:'non-possessing',   flip:'never'      },
  card:                { performedBy:'explicit',         flip:'never'      },
  substitution:        { performedBy:'explicit',         flip:'never'      },
  tactical_shift:      { performedBy:'explicit',         flip:'never'      },
  formation:           { performedBy:'explicit',         flip:'never'      },
  fifty_fifty:         { performedBy:'explicit',         flip:'explicit'   },
  own_goal_against:    { performedBy:'non-possessing',   flip:'never'      },
  error:               { performedBy:'possessing',       flip:'uncertain'  },
  stoppage:            { performedBy:null,               flip:'never'      },
  end_stoppage:        { performedBy:null,               flip:'never'      },
  camera_off:          { performedBy:null,               flip:'never'      },
  camera_on:           { performedBy:null,               flip:'never'      },
  half_end:            { performedBy:null,               flip:'resets'     },
  // unknown_pass_end: team not meaningful (we don't know who ended the pass),
  // possession marked uncertain — don't flip, don't assign a team
  unknown_pass_end:    { performedBy:null,               flip:'uncertain'  },
}

// ─── Possession engine ────────────────────────────────────────────────────────
//
// possessionState: { team: 'home'|'away'|null, certain: boolean }
//
// resolveTeam(eventId, possessionState) → team for this event ('home'|'away'|null)
export function resolveTeam(eventId, possessionState) {
  const rule = POSSESSION_RULES[eventId]
  if (!rule || rule.performedBy === null) return null  // team not meaningful
  if (rule.performedBy === 'explicit') return null     // will be prompted
  if (!possessionState?.team) return null              // possession unknown
  if (rule.performedBy === 'possessing')     return possessionState.team
  if (rule.performedBy === 'non-possessing') return possessionState.team === 'home' ? 'away' : 'home'
  return null
}

// applyFlip(eventId, committedEvent, possessionState) → new possessionState
// committedEvent: the event just saved (with groups, team, etc.)
export function applyFlip(eventId, committedEvent, possessionState) {
  const rule = POSSESSION_RULES[eventId]
  if (!rule || !possessionState) return possessionState

  if (rule.flip === 'resets') return { team: null, certain: false }
  if (rule.flip === 'never')  return possessionState
  if (rule.flip === 'deferred') return possessionState  // handled by pass type inference

  if (rule.flip === 'always') {
    const flipped = possessionState.team === 'home' ? 'away' : 'home'
    return { team: flipped, certain: true }
  }

  if (rule.flip === 'uncertain') {
    return { team: possessionState.team, certain: false }
  }

  if (rule.flip === 'on_outcome') {
    // Find outcome code from committedEvent.groups
    const outcomeGroup = committedEvent.groups?.find(g =>
      g.groupId === 'outcome' || g.groupId === 'type'
    )
    const selectedCode = outcomeGroup?.selections?.[0]?.code

    // GK special handling
    if (rule.flipByGkType && eventId === 'goal_keeper') {
      const typeGroup = committedEvent.groups?.find(g => g.groupId === 'type')
      const gkType    = typeGroup?.selections?.[0]?.code
      const gkFlip    = rule.flipByGkType?.[gkType] || 'uncertain'
      if (gkFlip === 'never')    return possessionState
      if (gkFlip === 'uncertain') return { team: possessionState.team, certain: false }
      if (gkFlip === 'by_technique') {
        const techGroup = committedEvent.groups?.find(g => g.groupId === 'technique')
        const techCode  = techGroup?.selections?.[0]?.code
        if (techCode === 'TECH_CLAIM') return possessionState
        return { team: possessionState.team, certain: false }  // Clear or unknown
      }
    }

    // Foul committed special handling
    if (eventId === 'foul_committed') {
      if (rule.flipUncertain?.includes(selectedCode))
        return { team: possessionState.team, certain: false }
      if (rule.flipExplicit?.includes(selectedCode))
        return { team: possessionState.team, certain: false }  // Penalty: explicit prompt resolves this
      if (rule.flipOutcomes?.includes(selectedCode)) {
        const flipped = possessionState.team === 'home' ? 'away' : 'home'
        return { team: flipped, certain: true }
      }
      return possessionState
    }

    // Standard on_outcome
    if (rule.flipOutcomes?.includes(selectedCode)) {
      const flipped = possessionState.team === 'home' ? 'away' : 'home'
      return { team: flipped, certain: true }
    }
    return possessionState
  }

  return possessionState
}

// needsExplicitTeam(eventId) → true if this event keeps the team prompt
export function needsExplicitTeam(eventId) {
  const rule = POSSESSION_RULES[eventId]
  return rule?.performedBy === 'explicit' || rule?.flip === 'explicit'
}

// teamNotMeaningful(eventId) → true if team is N/A for this event
export function teamNotMeaningful(eventId) {
  const rule = POSSESSION_RULES[eventId]
  return rule?.performedBy === null
}

// getMiscommunicationTeam(eventId) → 'opponent' | null
// When 'opponent', the Miscommunication extra belongs to the OTHER team
export function getMiscommunicationTeam(eventId) {
  return POSSESSION_RULES[eventId]?.miscommunicationTeam || null
}
