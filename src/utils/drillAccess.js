/**
 * drillAccess.js — whose Drill attempts may a person see?
 * ============================================================================
 * PURE. A trainee may open only THEIR OWN attempts; a trainer (the DRILL "creator" role, which includes a Batch Manager)
 * may open everyone's. The filter is applied where the data is READ (DrillPage keeps only the trainee's own rows in its
 * state, so no other person's attempt is ever held by a trainee's screen) AND again where it is SHOWN (DrillReviewPage),
 * so an attempt cannot be opened by clicking a card or by its result id.
 *
 * HR-codes are compared with canonHr: trim, spaces inside ignored, typographic dashes (U+2010 to U+2015 and the minus
 * sign) as '-', upper-case. No Unicode folding. An empty code matches nothing, so a trainee whose own code cannot be
 * resolved sees NOTHING (fail closed), never everything. (The same rule as src/utils/hrCode.js on the My halves branch.)
 *
 * CLIENT-SIDE ONLY. MARK reads the sheet with its own service account; a modified copy of the app could read every row.
 * This stops the honest screen from showing other people's results, not a determined person.
 */
const DASHES = /[\u2010-\u2015\u2212]/g

export const canonHr = v => String(v ?? '').trim().replace(DASHES, '-').replace(/\s+/g, '').toUpperCase()

/** Same, non-empty code. */
export const sameHr = (a, b) => { const x = canonHr(a); return x !== '' && x === canonHr(b) }

export const REVIEW_REFUSAL = 'You can only review your own attempts.'

/**
 * viewer: { hrCode, canSeeAll }.  canSeeAll is true for a trainer.
 * May this viewer open this attempt (its clip-by-clip answers, its CSV)?
 */
export const canOpenAttempt = (session, viewer) =>
  !!session && (viewer?.canSeeAll === true || sameHr(session.trainee_hr_code, viewer?.hrCode))

/** The attempts this viewer may see. */
export const visibleAttempts = (sessions, viewer) => (sessions || []).filter(s => canOpenAttempt(s, viewer))

/** The answers-given rows that belong to the attempts this viewer may see (by result_id). */
export function visibleAnswerRows(answersGiven, sessions, viewer) {
  if (viewer?.canSeeAll === true) return answersGiven || []
  const ids = new Set(visibleAttempts(sessions, viewer).map(s => s.result_id))
  return (answersGiven || []).filter(r => ids.has(r.result_id))
}

/** The assignment rows that belong to this viewer (a trainee needs only their own). */
export const visibleAssignments = (assignments, viewer) =>
  viewer?.canSeeAll === true ? (assignments || []) : (assignments || []).filter(a => sameHr(a.trainee_hr_code, viewer?.hrCode))
