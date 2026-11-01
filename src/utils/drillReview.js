/**
 * drillReview.js — who may see the answers, and when a failed trainee may start another attempt.
 * ============================================================================
 * PURE: no sheets, no Firestore, no browser. Every rule is here and unit-tested (drillReview.test.mjs).
 * drillRetakes.js gathers the inputs (fresh, at the moment a trainee starts) and calls decideStart().
 *
 * REVIEW ACCESS (can the trainee see the answers of their finished attempts?). Any of:
 *   - they passed (an attempt passes, or passes on the quiz's current, possibly lowered, mark)
 *   - the quiz has allow_review_on_fail = 1
 *   - their assignment has review_allowed = 1
 * A trainee with no finished attempt has nothing to review, so the two flags give them nothing yet.
 *
 * THE LOCK. Review access means no new attempt. Seeing the key and then retaking is memorisation, not retaking.
 *   - a FIRST attempt is never blocked: allow_review_on_fail cannot lock a quiz nobody has taken
 *   - a passed quiz is closed for good (already so, kept)
 *   - a trainer GRANT (a retake approved after a request, or Reassign: both are an approved record) wins over the
 *     lock for exactly one attempt. While that grant is unused, or its attempt is in progress, review access from the
 *     two flags is SUSPENDED (so the trainee does not see the key during the attempt they were just given), and it
 *     returns when that attempt is submitted
 *   - an attempt already in progress when access is granted is not stopped: resuming is not a "start". Once it is
 *     submitted, the lock applies
 *   - removing access (flag back to 0) puts the trainee back where the ordinary retake rules leave them: a retake
 *     only if a trainer has approved one that has not been used. The lock never grants an attempt and never deletes history
 * attempts_granted is NOT consulted: it is written as 1 for everyone and nothing reads it. The right to another
 * attempt is "approved retake records >= attempts made", as it always was.
 */
import { effectivePassed } from '../config/drillConfig'

export const REVIEW_LOCK_MESSAGE = 'Retake is closed because you can see the answers'

const norm = c => String(c ?? '').replace(/\s+/g, '').trim().toUpperCase()
/** '1' or 'true' (any case) is on; blank, missing or anything else is off. */
export const flag = v => { const t = String(v ?? '').trim().toLowerCase(); return t === '1' || t === 'true' }

const isPassed = (s, mark) => effectivePassed(s, mark) || String(s?.passed ?? '').toLowerCase() === 'true'

/** The trainee's real attempts on one quiz (a trainer's test runs do not count). */
export function attemptsOf(sessions, quizId, hrCode) {
  return (sessions || []).filter(s =>
    s.quiz_id === quizId && norm(s.trainee_hr_code) === norm(hrCode) && String(s.is_test_run) !== '1')
}

/** Approved retake records for this trainee and quiz (Reassign writes one too). */
export const approvedCount = requests => (requests || []).filter(r => r.status === 'approved').length

/** A trainer has granted another attempt that has not been used yet. Needs a finished attempt to be "another". */
export const hasUnusedGrant = (attempts, approved) => attempts.length >= 1 && approved >= attempts.length

/**
 * @returns { access, why, passed, suspended, quizFlag, traineeFlag, granted }
 *   access     may the trainee open the review of their attempts right now
 *   why        'passed' | 'trainee' | 'quiz' | null
 *   suspended  a flag is on but a trainer grant (unused or in progress) is holding it back
 */
export function reviewAccess({ quiz, assignment, attempts, approved = 0, inProgress = false }) {
  const quizFlag = flag(quiz?.allow_review_on_fail)
  const traineeFlag = flag(assignment?.review_allowed)
  const passed = attempts.some(s => isPassed(s, quiz?.pass_mark_percent))
  if (passed) return { access: true, why: 'passed', passed: true, suspended: false, quizFlag, traineeFlag, granted: false }

  const granted = hasUnusedGrant(attempts, approved)
  const wants = quizFlag || traineeFlag
  const suspended = wants && attempts.length >= 1 && (granted || inProgress)
  const access = wants && attempts.length >= 1 && !suspended
  return { access, why: access ? (traineeFlag ? 'trainee' : 'quiz') : null, passed: false, suspended, quizFlag, traineeFlag, granted }
}

/**
 * May this trainee start an attempt now?
 *   attempts   the trainee's real attempts on this quiz (attemptsOf)
 *   requests   their retake records for this quiz { status, reason, created_at }
 * → { allowed, reason, attemptNumber, message?, requestStatus?, rejectionReason?, review }
 *   reason when not allowed: 'passed' | 'review_lock' | 'pending' | 'rejected' | 'needs_request'
 */
export function decideStart({ quiz, assignment, attempts, requests = [], inProgress = false }) {
  const mark = quiz?.pass_mark_percent
  if (attempts.some(s => isPassed(s, mark))) return { allowed: false, reason: 'passed', attemptNumber: attempts.length }
  if (!attempts.length) return { allowed: true, attemptNumber: 1 }              // a first attempt is never blocked

  const approved = approvedCount(requests)
  const review = reviewAccess({ quiz, assignment, attempts, approved, inProgress })
  if (review.access) {
    return { allowed: false, reason: 'review_lock', message: REVIEW_LOCK_MESSAGE, attemptNumber: attempts.length, review }
  }
  if (hasUnusedGrant(attempts, approved)) return { allowed: true, attemptNumber: attempts.length + 1, review }

  const latest = [...requests].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0]
  return {
    allowed: false,
    reason: latest?.status === 'pending' ? 'pending' : latest?.status === 'rejected' ? 'rejected' : 'needs_request',
    requestStatus: latest?.status || null,
    rejectionReason: latest?.reason || '',
    attemptNumber: attempts.length,
    review,
  }
}

/** The line the trainee reads when a start is refused. */
export function startRefusal(gate) {
  switch (gate?.reason) {
    case 'passed':        return 'You have already passed this quiz.'
    case 'review_lock':   return REVIEW_LOCK_MESSAGE
    case 'pending':       return 'Your retake request is waiting for a trainer.'
    case 'rejected':      return `Retake refused: ${gate.rejectionReason}`
    default:              return 'You need a trainer to approve a retake before trying again.'
  }
}
