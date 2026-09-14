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
import { FS_REQUESTS, REQUEST_STATUS } from '../config/drillConfig'

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

/**
 * Can this trainee start this quiz?
 * Passing closes a quiz for good. A failure locks THAT quiz only — other
 * assigned quizzes stay open — until a trainer approves a retake.
 *
 * → { allowed, reason, attemptNumber, requestStatus, rejectionReason }
 */
export async function canStart({ quiz, trainee, sessions }) {
  const mine = (sessions || []).filter(s =>
    s.quiz_id === quiz.quiz_id &&
    String(s.trainee_hr_code || '').toUpperCase() === String(trainee?.hrCode || '').toUpperCase() &&
    String(s.is_test_run) !== '1')

  if (mine.some(s => String(s.passed) === '1' || String(s.passed).toLowerCase() === 'true'))
    return { allowed: false, reason: 'passed', attemptNumber: mine.length }

  if (!mine.length) return { allowed: true, attemptNumber: 1 }

  // failed at least once — needs an approved, unused request
  const snap = await getDocs(query(
    collection(db, FS_REQUESTS),
    where('trainee_hr_code', '==', trainee?.hrCode || ''),
    where('quiz_id', '==', quiz.quiz_id),
  ))
  const reqs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  const latest = reqs[0]

  // an approval covers exactly one further attempt
  const approvedCount = reqs.filter(r => r.status === REQUEST_STATUS.APPROVED).length
  if (approvedCount >= mine.length)
    return { allowed: true, attemptNumber: mine.length + 1 }

  return {
    allowed: false,
    reason: latest?.status === REQUEST_STATUS.PENDING ? 'pending'
          : latest?.status === REQUEST_STATUS.REJECTED ? 'rejected'
          : 'needs_request',
    requestStatus: latest?.status || null,
    rejectionReason: latest?.reason || '',
    attemptNumber: mine.length,
  }
}
