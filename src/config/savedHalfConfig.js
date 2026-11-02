/**
 * Tuning for the saved-half feature (Tag). Each value is named once, here.
 */
/**
 * May a collector start a NEW session for a half that has already been compared? No. A compared half is closed: a second
 * session would be a second answer to the same half and would sit beside the compared one. Flip to true to allow it.
 */
export const ALLOW_NEW_SESSION_AFTER_COMPARE = false

/** While a saved half is open for editing, how often (ms) to look for a comparison, plus up to JITTER on top. */
export const COMPARE_POLL_MS = 120000
export const COMPARE_POLL_JITTER_MS = 30000

/** The wording the collector reads. One place, so tests and screens cannot drift apart. */
export const MSG = {
  VIEW_ONLY_TIP: 'View only. This half has been compared.',
  VIEW_BANNER: 'View only. This half has been compared.',
  SWITCHED: 'A reviewer compared this half. It is now view only. Your unsaved changes are kept locally.',
  EDIT_BANNER: 'Editing a saved half. Changes are saved over the earlier version.',
  COMPARED_WHILE_EDITING: 'A reviewer compared this half while you were editing. It is now locked. Your changes were not saved.',
  COMPARED_LINE: 'This half has been compared, so it can\'t be edited. See its errors in My halves.',
  NEW_CONFIRM: 'This creates a second session for this half. Your saved one stays.',
}
