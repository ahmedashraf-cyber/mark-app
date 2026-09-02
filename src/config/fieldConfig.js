/**
 * fieldConfig.js — FIELD mode configuration
 * ============================================================================
 * Single source of truth for schema, event registry, and column definitions.
 * Read by: FieldPage.jsx, fieldSheetSync.js, fieldExtras.js (for numeric IDs).
 * Never imported by Scout or Audit.
 *
 * SCHEMA VERSION: bump when any column is added, removed, or reordered.
 * EVENT REGISTRY: numeric IDs are permanent. Never renumber, never reuse.
 */

// ── Google Sheet ───────────────────────────────────────────────────────────────
export const FIELD_SHEET_ID      = '1l3tYwre5ik0nMbBS562tge0Ch4MHKcuXTuNdPaEoTec'
export const FIELD_TAB_SESSIONS  = 'field_sessions'
export const FIELD_TAB_EVENTS    = 'field_events'

// ── Schema version ─────────────────────────────────────────────────────────────
export const FIELD_SCHEMA_VERSION = '3'

// ── localStorage key ───────────────────────────────────────────────────────────
export const FIELD_LS_KEY = 'mark_field_sessions'

// ── Match ID validation ────────────────────────────────────────────────────────
export function validateMatchId(val) {
  if (!val) return 'Match ID is required'
  if (!/^\d+$/.test(val)) return 'Match ID must contain digits only'
  if (val.length < 6 || val.length > 8) return 'Match ID must be 6–8 digits'
  return null
}

// ── Event numeric ID registry ──────────────────────────────────────────────────
// Bands: 1000-1999 Offense | 2000-2999 Defense | 3000-3999 Close | 9000-9999 Admin
// Gaps of 10 within each band for future insertions.
// IDs are PERMANENT — never renumber, never reuse a retired ID.
// The comparison tool reads this registry directly.
export const EVENT_REGISTRY = [
  // Offense
  { numericId: 1010, code: 'pass',             label: 'Pass'              },
  { numericId: 1020, code: 'pass_first_time',  label: 'Pass (First time)' },
  { numericId: 1030, code: 'pass_recovery',    label: 'Pass recovery'     },
  { numericId: 1040, code: 'shot',             label: 'Shot'              },
  { numericId: 1050, code: 'foul_committed',   label: 'Foul committed'    },
  { numericId: 1060, code: 'reception',        label: 'Reception'         },
  { numericId: 1070, code: 'miscontrol',       label: 'Miscontrol'        },
  { numericId: 1080, code: 'out',              label: 'Out'               },
  { numericId: 1090, code: 'dribble',          label: 'Dribble'           },
  { numericId: 1100, code: 'shield',           label: 'Shield'            },
  { numericId: 1110, code: 'fifty_fifty',      label: 'Fifty fifty'       },
  { numericId: 1120, code: 'error',            label: 'Error'             },
  { numericId: 1130, code: 'own_goal_against', label: 'Own goal against'  },
  // Defense
  { numericId: 2010, code: 'block',            label: 'Block'             },
  { numericId: 2020, code: 'interception',     label: 'Interception'      },
  { numericId: 2030, code: 'tackle',           label: 'Tackle'            },
  { numericId: 2040, code: 'ball_recovery',    label: 'Ball recovery'     },
  { numericId: 2050, code: 'clearance',        label: 'Clearance'         },
  { numericId: 2060, code: 'hold_up_duel',     label: 'Hold up duel'      },
  { numericId: 2070, code: 'positioning_duel', label: 'Positioning duel'  },
  { numericId: 2080, code: 'separation_duel',  label: 'Separation duel'   },
  { numericId: 2090, code: 'leg_stretch_duel', label: 'Leg stretch duel'  },
  { numericId: 2100, code: 'goal_keeper',      label: 'Goal Keeper'       },
  { numericId: 2110, code: 'pressure_start',   label: 'Pressure start'    },
  { numericId: 2120, code: 'pass_interception',label: 'Pass interception' },
  { numericId: 2130, code: 'unknown_pass_end', label: 'Unknown pass end'  },
  // Close/end events
  { numericId: 3010, code: 'end_shot',         label: 'End shot'          },
  { numericId: 3020, code: 'end_stoppage',     label: 'End stoppage'      },
  { numericId: 3030, code: 'pressure_end',     label: 'Pressure end'      },
  // Admin
  { numericId: 9010, code: 'half_start',       label: 'Half start'        },
  { numericId: 9020, code: 'half_end',         label: 'Half end'          },
  { numericId: 9030, code: 'card',             label: 'Card'              },
  { numericId: 9040, code: 'substitution',     label: 'Substitution'      },
  { numericId: 9050, code: 'tactical_shift',   label: 'Tactical shift'    },
  { numericId: 9060, code: 'formation',        label: 'Formation'         },
  { numericId: 9070, code: 'camera_off',       label: 'Camera off'        },
  { numericId: 9080, code: 'camera_on',        label: 'Camera on'         },
  { numericId: 9090, code: 'stoppage',         label: 'Stoppage'          },
]

// Startup assertion — duplicate numeric IDs are impossible to ship
;(() => {
  const seen = new Set()
  EVENT_REGISTRY.forEach(e => {
    if (seen.has(e.numericId))
      throw new Error(`[fieldConfig] Duplicate numeric event ID: ${e.numericId} (${e.code})`)
    seen.add(e.numericId)
  })
})()

// Fast lookups
export const EVENT_BY_CODE      = Object.fromEntries(EVENT_REGISTRY.map(e => [e.code,      e]))
export const EVENT_BY_NUMERIC   = Object.fromEntries(EVENT_REGISTRY.map(e => [e.numericId, e]))

// ── field_sessions columns (one row per session) ───────────────────────────────
export const SESSION_COLUMNS = [
  'schema_version',
  'session_id',
  'match_id',
  'half',                       // "1H" / "2H"
  'collector_hr_code',
  'collector_email',
  'video_filename',
  'video_size_bytes',           // file size for video identity
  'video_duration_ms',          // from player onLoadedMetadata * 1000
  'home_team_name',
  'away_team_name',
  'is_model',                   // 0 = collector session, 1 = model answer
  'model_version',              // blank unless is_model=1
  'model_status',               // draft / approved — blank unless is_model=1
  'scope_event_ids',            // pipe-separated event_codes this session covers
  'mark_version',
  'export_date',                // YYYY-MM-DD only
  'collection_start_wall_iso',
  'collection_end_wall_iso',
  'collection_elapsed_raw_ms',
  'collection_events_per_min',
  'collection_incomplete',      // 0 / 1
]

// ── field_events columns (one row per event) ───────────────────────────────────
// attr_* columns: one per spec attribute group, pipe-separated optionCodes for multi-select
export const EVENT_COLUMNS = [
  'session_id',                 // join key
  'event_seq',                  // monotonic per session, starts at 1
  'event_id',                   // numeric e.g. 1040
  'event_code',                 // stable slug e.g. shot
  'event_label',                // display name
  'video_time_ms',              // integer milliseconds
  'video_time_readable',        // M:SS.mmm
  'time_from_half_start_ms',    // ms after half_start; empty for events before half_start
  'team',                       // home / away
  'team_source',                // inferred / manual / inherited / explicit
  'inferred_type',              // optionCode e.g. TYPE_OPEN_PLAY; empty if not applicable
  'type_source',                // inferred / inferred_default / manual
  'pair_id',                    // links open+close events; format: {sessionId8}_{openEventSeq}
  'pair_status',                // complete / incomplete (force-closed); empty if not a paired event
  'duration_ms',                // integer ms between open and close video_time_ms; empty if incomplete
  'possession_certain',         // 1 / 0
  'miscommunication_team',      // opponent / empty
  // Named attribute columns — one per spec group, sparse, optionCodes only
  // Multi-select: pipe-separated. Empty = group not asked or skipped.
  'attr_team_side',
  'attr_attacking_direction',
  'attr_video',
  'attr_height',
  'attr_body_part',
  'attr_extras',
  'attr_technique',
  'attr_gk_body_state',
  'attr_outcome',
  'attr_type',
  'attr_miscommunication',
  'attr_action',
  'attr_location',
  'attr_launch',
  'attr_side',
  'attr_direction',
  'attr_kind',
  'attr_paused',
]

// ── Group id → attr_ column name mapping ──────────────────────────────────────
// Used by the serialiser to place each collected group into the correct column.
export const GROUP_TO_ATTR_COL = {
  team_side:           'attr_team_side',
  attacking_direction: 'attr_attacking_direction',
  video:               'attr_video',
  height:              'attr_height',
  body_part:           'attr_body_part',
  extras:              'attr_extras',
  technique:           'attr_technique',
  gk_body_state:       'attr_gk_body_state',
  gk_stance:           'attr_gk_body_state',   // GK stance maps to same column as GK body state
  outcome:             'attr_outcome',
  type:                'attr_type',
  miscommunication:    'attr_miscommunication',
  action:              'attr_action',
  location:            'attr_location',
  launch:              'attr_launch',
  side:                'attr_side',
  direction:           'attr_direction',
  kind:                'attr_kind',
  paused:              'attr_paused',
}
