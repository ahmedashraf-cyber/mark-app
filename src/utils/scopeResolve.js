/**
 * scopeResolve.js: what a model's scope_event_ids VALUE means. Pure; Comparison only.
 * ============================================================================
 * The column is NOT always a list of event codes. In the real sheet it holds:
 *   "pressure_start"            an event code (Scout models)
 *   "Pressure start"            an event LABEL (one collector session)
 *   "Duels"                     a collection MODE (8 models, 92 collectors): its models contain 18 different event types,
 *                               not the four duel codes. defectTypes.js lists those four as the TO scoring module, which is a
 *                               way of scoring events, not a collection scope; no list of event types stands behind "Duels"
 *   "All Events"                everything
 *   "TagOnce"                   a collection mode (no event list either)
 *   ""                          everything
 * Treating any non-blank value as a list of codes made "Duels" match no event at all: every collector event "out of scope",
 * every model event missing, a score of 0%. So a value is only ever used to FILTER when every part of it is a real event code
 * or label. Anything else means NO FILTER, and the page says so; it is never silent and never a zero.
 *
 * resolveScope(raw) -> { mode, codes, warning, unresolved }
 *   mode 'all'        nothing to filter (blank, or "All Events")
 *   mode 'codes'      filter by `codes` (every part resolved to an event code)
 *   mode 'unresolved' something could not be resolved: NO filter, and `warning` says what and why
 */
import { EVENT_REGISTRY } from '../config/fieldConfig'

/** "Pressure start", "pressure_start", "PRESSURE-START" are one key. */
const key = v => String(v ?? '').trim().toLowerCase().replace(/[\s_\-]+/g, ' ')

const BY_KEY = new Map()
EVENT_REGISTRY.forEach(e => { BY_KEY.set(key(e.code), e.code); BY_KEY.set(key(e.label), e.code) })

/** Values that mean "everything". */
const ALL_KEYS = new Set(['all events', 'all event', 'all', 'everything'])

/**
 * Names of groups of events that have an EXACT list in the spec. Deliberately EMPTY: no such list exists today.
 * "Duels" is not here because no spec defines it (see above); add a group here, with its codes, only when the spec does.
 */
export const SCOPE_GROUPS = {}

/** Collection modes seen in the sheet that are known NOT to be event lists, so the warning can say so exactly. */
const MODE_KEYS = new Set(['duels', 'tagonce', 'tag once'])

export function resolveScope(raw) {
  const parts = String(raw ?? '').split(/[|,;]/).map(x => x.trim()).filter(Boolean)
  if (!parts.length) return { mode: 'all', codes: [], warning: '', unresolved: [] }
  if (parts.some(p => ALL_KEYS.has(key(p)))) return { mode: 'all', codes: [], warning: '', unresolved: [] }

  const codes = [], unresolved = [], modes = []
  parts.forEach(p => {
    const k = key(p)
    if (BY_KEY.has(k)) { codes.push(BY_KEY.get(k)); return }
    if (Object.prototype.hasOwnProperty.call(SCOPE_GROUPS, k)) { codes.push(...SCOPE_GROUPS[k]); return }
    unresolved.push(p)
    if (MODE_KEYS.has(k)) modes.push(p)
  })
  if (!unresolved.length) return { mode: 'codes', codes: [...new Set(codes)], warning: '', unresolved: [] }

  const names = unresolved.map(u => `"${u}"`).join(', ')
  const warning = modes.length === unresolved.length
    ? `This model's scope is ${names}: a collection mode, not a list of event types. The scope was NOT applied, so every collector event was compared. Events the model never tags will show as extra.`
    : `This model's scope (${names}) is not an event type or a group the app knows. The scope was NOT applied, so every collector event was compared. Events the model never tags will show as extra.`
  return { mode: 'unresolved', codes: [], warning, unresolved }
}
