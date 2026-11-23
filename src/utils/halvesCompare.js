/**
 * halvesCompare.js: the Halves page's "Compare" / "Recompare" button. Pure; Halves page and Comparison hand-off only.
 * ============================================================================
 * The button opens Comparison pre-filled with ONE collector session and ONE model session and runs it in memory. It never writes:
 * the user reviews the result and presses "Write Results to Sheet" themselves. The duplicate rule is Comparison's own and is
 * unchanged (same model + collector + tolerance version + algorithm version = already in the sheet).
 *
 * Who sees it: caps.halvesCompare AND caps.comparison (the button opens Comparison). No role is named here: the roles come from
 * the role_access tab, so a label can change without this code noticing.
 */
import { ALGORITHM_VERSION, TOLERANCE_CONFIG_VERSION } from '../config/comparisonConfig'

const norm = v => String(v ?? '').trim()

export const canCompareHalves = caps => !!(caps && caps.halvesCompare && caps.comparison)

/** The exact words shown when the button is off, so the page, the tooltip and the tests agree. */
export const MSG = {
  noModel: 'No approved model answer for this half',
  unknown: 'The scores could not be read, so I cannot tell whether this half was compared',
  noIds: 'This half has no match id or half recorded, so it cannot be compared',
  noScout: 'Comparison is not available for your account (it needs Scout access)',
  badPreset: 'This comparison could not be opened: the collector or the model session is missing.',
}

/** What the last run says about itself, for the tooltip and for Comparison's banner. null when the half has no run. */
export function describeRun(row, current = { algorithm: ALGORITHM_VERSION, tolerance: TOLERANCE_CONFIG_VERSION }) {
  const r = row && row.run
  if (!r) return null
  const algorithm = norm(r.algorithmVersion)
  return {
    algorithm: algorithm || '', score: r.overall, runId: r.runId, at: r.at, modelSessionId: r.modelSessionId, tolerance: norm(r.toleranceVersion),
    recorded: algorithm !== '', current: algorithm !== '' && algorithm === current.algorithm, stale: row.state === 'stale', currentAlgorithm: current.algorithm,
  }
}

/** One sentence about what pressing the button would lead to. */
function hintFor(row, existing, candidates, current) {
  if (!existing) return 'Compare this half with its model answer. Nothing is written until you press "Write Results to Sheet".'
  const bits = []
  if (!existing.recorded) bits.push(`The last run did not record its algorithm; the current one is ${current.algorithm}, so a new run can be written.`)
  else if (!existing.current) bits.push(`The last run used algorithm ${existing.algorithm}; the current one is ${current.algorithm}, so a new run can be written.`)
  else if (candidates.length === 1 && existing.modelSessionId && existing.modelSessionId !== candidates[0].sessionId) bits.push(`The last run already used algorithm ${existing.algorithm}, but against a different model answer, so a new run can be written.`)
  else bits.push(`The last run already used the current algorithm (${existing.algorithm}): comparing again shows the same result and nothing new would be written.`)
  if (existing.stale) bits.push('The match or half was edited after that run.')
  return bits.join(' ')
}

/**
 * What the button looks like for one row.
 *   { show:false }                                  nothing at all (a Model answer row, or a role without the permission)
 *   { show:true, label, disabled, reason, hint, candidates, existing }
 * `reason` is only set when disabled; `hint` is the tooltip when enabled.
 */
export function compareAction(row, caps, current = { algorithm: ALGORITHM_VERSION, tolerance: TOLERANCE_CONFIG_VERSION }) {
  if (!canCompareHalves(caps) || !row || row.isModel || row.state === 'model') return { show: false }
  const candidates = Array.isArray(row.modelCandidates) ? row.modelCandidates : []
  const existing = describeRun(row, current)
  const base = { show: true, label: (row.runCount || 0) > 0 ? 'Recompare' : 'Compare', disabled: false, reason: '', hint: '', candidates, existing }
  if (!norm(row.session_id) || !norm(row.match_id) || !norm(row.half)) return { ...base, disabled: true, reason: MSG.noIds }
  if (row.state === 'unknown') return { ...base, label: 'Compare', disabled: true, reason: MSG.unknown }
  if (!caps.scout) return { ...base, disabled: true, reason: MSG.noScout }          // Comparison's route is guarded by scout access
  if (!candidates.length) return { ...base, disabled: true, reason: MSG.noModel }
  return { ...base, hint: hintFor(row, existing, candidates, current) }
}

/** The hand-off to Comparison. Exact session ids, never a lookup by match and HR-code (which takes the FIRST model row, whatever its status). */
export function makePreset(row, model, current = { algorithm: ALGORITHM_VERSION }) {
  return {
    collectorSessionId: norm(row?.session_id), modelSessionId: norm(model?.sessionId),
    matchId: norm(row?.match_id), half: norm(row?.half), collectorCode: norm(row?.collector_hr_code), collectorName: norm(row?.collectorName),
    modelVersion: norm(model?.modelVersion), stored: describeRun(row, { algorithm: current.algorithm, tolerance: '' }), fromHalves: true,
  }
}

/** A preset Comparison can run. Anything else gets a readable message there instead of a lookup that returns nothing. */
export const isValidPreset = p => !!(p && norm(p.collectorSessionId) && norm(p.modelSessionId) && norm(p.collectorSessionId) !== norm(p.modelSessionId))

/** Where Halves reopens after Comparison: filtered to that match, with that half's row in view. */
export const returnFocus = p => (p && norm(p.matchId) ? { matchId: norm(p.matchId), key: norm(p.collectorSessionId) } : null)

/** One line for a candidate in the picker. */
export function candidateLabel(c) {
  const id = norm(c?.sessionId)
  return [`…${id.slice(-10)}`, c?.modelVersion ? `version ${c.modelVersion}` : 'version not recorded', c?.source ? c.source : null, c?.savedAt ? `saved ${c.savedAt}` : null].filter(Boolean).join(' · ')
}
