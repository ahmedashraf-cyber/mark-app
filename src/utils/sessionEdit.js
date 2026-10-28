/**
 * sessionEdit.js — pure logic for the Admin "Edit session" action (Batch Manager only).
 *
 * Changes match_id and half on ONE session row in the field_sessions tab. No I/O here, so every rule is unit-tested
 * (sessionEdit.test.mjs). The sheet work is in adminSheet.js: editFieldSession().
 *
 * `part` (1 2 3 4 5) is stored next to `half` (1H 2H ET1 ET2 PEN) on the same row and says the same thing, so when the
 * half changes the part is changed with it. Left alone, the row would say "2H" and "part 1", and Tag, which writes
 * both together, never produces that.
 */
import { validateMatchId } from '../config/fieldConfig'
import { toSheetHalf } from './fieldSheetSync'

export const HALF_CHOICES = [['1H', '1st half'], ['2H', '2nd half'], ['ET1', 'Extra time 1'], ['ET2', 'Extra time 2'], ['PEN', 'Penalties']]
export const PART_OF_HALF = { '1H': '1', '2H': '2', ET1: '3', ET2: '4', PEN: '5' }

/** Where every edit is recorded: one row per field changed, in the same spreadsheet as field_sessions. */
export const EDIT_LOG_TAB = 'session_edits'
export const EDIT_LOG_HEADER = [
  'timestamp_iso', 'changed_by', 'session_id', 'collector_hr_code',
  'field', 'old_value', 'new_value', 'scores_rows_for_session', 'status', 'note',
]

const norm = v => String(v ?? '').trim()

/** → { ok, errors: { matchId?, half? } } */
export function validateSessionEdit({ matchId, half }) {
  const errors = {}
  const m = validateMatchId(norm(matchId))
  if (m) errors.matchId = m
  if (!HALF_CHOICES.some(([code]) => code === norm(half))) errors.half = 'Choose a half'
  return { ok: Object.keys(errors).length === 0, errors }
}

/**
 * What would change. `current` is the row as it is in the sheet {match_id, half, part}.
 * → [{ field, from, to }], empty when nothing differs. Halves are compared normalised, so a row holding an old
 * "1HH" or "1" is not reported as changed when "1H" is chosen (the repair tool owns that clean-up).
 */
export function planSessionEdit(current, { matchId, half }) {
  const changes = []
  const newMatch = norm(matchId), newHalf = norm(half)
  if (newMatch !== norm(current.match_id)) changes.push({ field: 'match_id', from: norm(current.match_id), to: newMatch })
  const halfChanged = toSheetHalf(newHalf) !== toSheetHalf(current.half)
  if (halfChanged) {
    changes.push({ field: 'half', from: norm(current.half), to: newHalf })
    const newPart = PART_OF_HALF[newHalf]
    if (newPart && newPart !== norm(current.part)) changes.push({ field: 'part', from: norm(current.part), to: newPart })
  }
  return changes
}

/** Search box: matches match id, session id, collector HR code, email or video file name, case-insensitively. */
export function matchesQuery(row, q) {
  const needle = norm(q).toLowerCase()
  if (!needle) return false
  return ['match_id', 'session_id', 'collector_hr_code', 'collector_email', 'video_filename']
    .some(k => norm(row[k]).toLowerCase().includes(needle))
}

/** One log row per changed field. `status` is 'applied' or 'NOT APPLIED'. */
export function buildEditLogRows({ at, changedBy, session, changes, scoresCount, status, note = '' }) {
  return changes.map(c => [
    at, norm(changedBy), norm(session.session_id), norm(session.collector_hr_code),
    c.field, c.from, c.to, String(scoresCount ?? 0), status, note,
  ])
}

/** The warning shown before an edit when the session already has rows in `scores`. '' when it has none. */
export function scoresWarning(scoresRows) {
  const n = scoresRows?.length || 0
  if (!n) return ''
  const latest = scoresRows.map(r => r.run_timestamp_iso).filter(Boolean).sort().pop()
  return `This session already has ${n} row${n === 1 ? '' : 's'} in the scores tab${latest ? ` (latest run ${latest})` : ''}. `
    + 'Those rows keep the OLD match and half, and this edit does not change them. The comparison must be run again. '
    + 'Note that Comparison matches by the two session ids and the tolerance and algorithm versions, so it will show the '
    + 'earlier run as "no changes detected" and write nothing until those old rows are removed. This screen does not remove them.'
}
