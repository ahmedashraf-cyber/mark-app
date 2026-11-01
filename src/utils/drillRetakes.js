/**
 * drillRetakes.js — retake requests and the trainer's notifications
 * ============================================================================
 * DRILL only. Lives in FIRESTORE, not the spreadsheet, deliberately: a request
 * is short-lived mutable state that two people act on within minutes, and it
 * needs a live listener so a trainer sees it appear without reloading. Sheets
 * can do neither.
 *
 * Flow: trainee fails -> requests a retake, choosing a trainer -> that trainer
 * sees a badge -> approves, or rejects WITH A REASON the trainee then reads ->
 * on approval the trainee can retake.
 */
import { db } from '../firebase/config'
import {
  collection, doc, addDoc, updateDoc, query, where,
  onSnapshot, getDocs, orderBy,
} from 'firebase/firestore'
import {
  FS_REQUESTS, REQUEST_STATUS, TAB_QUIZZES, TAB_ASSIGNMENTS, TAB_SESSIONS,
} from '../config/drillConfig'
import { readTabs } from './drillSheet'
import { loadSession } from './drillSession'
import { decideStart, attemptsOf } from './drillReview'

export async function requestRetake({ quiz, trainee, trainerEmail, attemptNumber, scorePercent }) {
  if (!trainerEmail) throw new Error('Choose a trainer to send this to.')
  const ref = await addDoc(collection(db, FS_REQUESTS), {
    quiz_id: quiz.quiz_id,
    quiz_name: quiz.quiz_name,
    trainee_hr_code: trainee?.hrCode || '',
    trainee_email: trainee?.email || '',
    trainee_name: trainee?.name || '',
    trainer_email: String(trainerEmail).toLowerCase(),
    attempt_number: attemptNumber,
    score_percent: scorePercent,
    status: REQUEST_STATUS.PENDING,
    reason: '',
    created_at: Date.now(),
    decided_at: null,
  })
  return ref.id
}

/** Live listener for one trainer's pending requests. Returns unsubscribe. */
export function watchRequestsFor(trainerEmail, cb) {
  if (!trainerEmail) return () => {}
  const q = query(
    collection(db, FS_REQUESTS),
    where('trainer_email', '==', String(trainerEmail).toLowerCase()),
    where('status', '==', REQUEST_STATUS.PENDING),
  )
  return onSnapshot(q,
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.warn('[DRILL] request listener:', err.message); cb([]) })
}

/** Live listener for one trainee's own requests, so they can see the outcome. */
export function watchMyRequests(traineeHrCode, cb) {
  if (!traineeHrCode) return () => {}
  const q = query(
    collection(db, FS_REQUESTS),
    where('trainee_hr_code', '==', traineeHrCode),
  )
  return onSnapshot(q,
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))),
    err => { console.warn('[DRILL] my-requests listener:', err.message); cb([]) })
}

export async function decideRequest(requestId, approve, reason) {
  if (!approve && !String(reason || '').trim())
    throw new Error('Give a reason — the trainee will see it.')
  await updateDoc(doc(db, FS_REQUESTS, requestId), {
    status: approve ? REQUEST_STATUS.APPROVED : REQUEST_STATUS.REJECTED,
    reason: String(reason || '').trim(),
    decided_at: Date.now(),
  })
}

const normCode = c => String(c ?? '').replace(/\s+/g, '').trim().toUpperCase()

/** This trainee's retake records for one quiz, from Firestore (the only place they live). */
async function readRequests(hrCode, quizId) {
  const snap = await getDocs(query(
    collection(db, FS_REQUESTS),
    where('trainee_hr_code', '==', hrCode || ''),
    where('quiz_id', '==', quizId),
  ))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

/**
 * Can this trainee start this quiz? (the rules are in drillReview.decideStart)
 *
 * Passing closes a quiz for good. A failure locks THAT quiz only, until a trainer approves a retake. Seeing the
 * answers (the quiz's allow_review_on_fail, or the trainee's review_allowed) locks it too, unless a trainer grants
 * another attempt. A first attempt is never blocked.
 *
 * Takes the data it is GIVEN: callers that must not trust a cached list use canStartFresh below.
 * → { allowed, reason, attemptNumber, message?, requestStatus?, rejectionReason?, review }
 */
export async function canStart({ quiz, trainee, sessions, assignment = null, inProgress = false }) {
  const attempts = attemptsOf(sessions, quiz.quiz_id, trainee?.hrCode)
  // a first attempt, or a passed quiz, needs no retake records at all
  const requests = attempts.length ? await readRequests(trainee?.hrCode, quiz.quiz_id) : []
  return decideStart({ quiz, assignment, attempts, requests, inProgress })
}

/**
 * The same decision, on data read NOW: the quiz row, the trainee's assignment row, their attempts and their retake
 * records. Called when a trainee presses Start, so a setting changed since the list loaded (access granted, the
 * quiz-wide flag switched on, a reassign) is honoured immediately.
 *
 * CLIENT-SIDE ONLY. MARK reads and writes the sheet with its own service account, and there is no server in between,
 * so this is a check the app makes about itself. A modified client could skip it. It stops the honest mistake and the
 * stale screen, not a determined person. If a read fails this throws instead of guessing: a lock that fails open is
 * no lock.
 */
export async function canStartFresh({ quizId, trainee }) {
  const d = await readTabs([TAB_QUIZZES, TAB_ASSIGNMENTS, TAB_SESSIONS])
  const quiz = (d[TAB_QUIZZES] || []).find(q => q.quiz_id === quizId)
  if (!quiz) throw new Error('This quiz is no longer available.')
  const hr = normCode(trainee?.hrCode)
  const assignment = (d[TAB_ASSIGNMENTS] || []).find(a => a.quiz_id === quizId && normCode(a.trainee_hr_code) === hr) || null
  const attempts = attemptsOf(d[TAB_SESSIONS], quizId, trainee?.hrCode)
  const requests = attempts.length ? await readRequests(trainee?.hrCode, quizId) : []
  // an attempt already begun on this device (resuming it is not a start, but it suspends a granted attempt's review)
  const found = loadSession()
  const inProgress = !!(found?.session && found.session.quiz_id === quizId && normCode(found.session.trainee_hr_code) === hr)
  return { ...decideStart({ quiz, assignment, attempts, requests, inProgress }), quiz, assignment, fresh: true }
}
