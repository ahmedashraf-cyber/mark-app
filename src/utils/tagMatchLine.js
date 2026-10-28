/**
 * tagMatchLine.js — the line the Tag start screen shows before Continue.
 *
 *   Match 1366067 - Arsenal vs Chelsea - 1st half
 *
 * It is built from what the collector TYPED (Match ID, Part) and what the model-answer lookup RETURNED (the teams),
 * so a wrong Match ID or a wrong Part is visible as a wrong team or a wrong half before anything is collected.
 * Pure, so it can be unit-tested.
 */
export const PART_LABELS = { 1: '1st half', 2: '2nd half', 3: 'Extra time 1', 4: 'Extra time 2', 5: 'Penalties' }
export const partLabel = part => PART_LABELS[Number(part)] || ''

/** '' when there is not enough to show (no Match ID or no Part yet). */
export function matchSummaryLine({ matchId, home, away, part }) {
  const id = String(matchId ?? '').trim()
  const p = partLabel(part)
  if (!id || !p) return ''
  const h = String(home ?? '').trim(), a = String(away ?? '').trim()
  // Some older or imported model answers carry no team names: say so rather than show a half-empty "vs".
  const teams = h && a ? `${h} vs ${a}` : 'teams not recorded'
  return `Match ${id} - ${teams} - ${p}`
}
