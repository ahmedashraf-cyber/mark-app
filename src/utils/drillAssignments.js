/**
 * drillAssignments.js — who a quiz is assigned to, and their status
 * ============================================================================
 * DRILL only.
 *
 * WHY A TAB AND NOT A CELL
 * Assignments used to live in one pipe-joined cell, quizzes.assigned_hr_codes.
 * That cannot record when somebody was assigned, by whom, or how many attempts
 * they hold — and two trainers assigning at the same moment would each rewrite
 * the same cell, so one would silently lose their change. One row per trainee
 * per quiz fixes all of that, and appends never collide.
 *
 * The old column is migrated across on first read and then ignored.
 *
 * REASSIGNMENT reuses the retake machinery rather than inventing a parallel
 * one. canStart() already allows an attempt when approvals >= attempts already
 * made, so a trainer reassigning is simply an approval that nobody requested.
 */
import { db } from '../firebase/config'
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore'
import { readTabs, appendRows } from './drillSheet'
import {
  TAB_ASSIGNMENTS, TAB_QUIZZES, TAB_SESSIONS,
  ASSIGNMENTS_COLUMNS, FS_REQUESTS, REQUEST_STATUS,
} from '../config/drillConfig'

const norm = c => String(c || '').replace(/\s+/g, '').trim().toUpperCase()

/**
 * Assignment rows for a quiz, migrating the legacy column if this quiz has
 * none yet. Returns [{ quiz_id, trainee_hr_code, trainee_name, assigned_at,
 * assigned_by, attempts_granted, status }].
 */
export async function loadAssignments(quizId, { quizRow, assignedBy } = {}) {
  const { [TAB_ASSIGNMENTS]: rows } = await readTabs([TAB_ASSIGNMENTS])
  const mine = rows.filter(r => r.quiz_id === quizId)
  if (mine.length) return mine

  // one-time migration off the pipe-joined cell
  const legacy = String(quizRow?.assigned_hr_codes || '')
    .split('|').map(norm).filter(Boolean)
  if (!legacy.length) return []

  const migrated = legacy.map(hr => ({
    quiz_id: quizId,
    trainee_hr_code: hr,
    trainee_name: '',
    assigned_at: quizRow?.created_at || new Date().toISOString(),
    assigned_by: quizRow?.created_by || assignedBy || '',
    attempts_granted: 1,
    status: 'migrated',
  }))
  try {
    await appendRows(TAB_ASSIGNMENTS, migrated, ASSIGNMENTS_COLUMNS)
  } catch (e) {
    console.warn('[DRILL] assignment migration failed, using legacy column:', e.message)
  }
  return migrated
}

/** Every quiz_id this trainee is assigned to, from rows OR the legacy column. */
export async function quizIdsForTrainee(hrCode) {
  const target = norm(hrCode)
  if (!target) return new Set()
  const { [TAB_ASSIGNMENTS]: rows, [TAB_QUIZZES]: quizzes } =
    await readTabs([TAB_ASSIGNMENTS, TAB_QUIZZES])

  const out = new Set(rows
    .filter(r => norm(r.trainee_hr_code) === target)
    .map(r => r.quiz_id))

  // quizzes not yet migrated still answer from the old column
  const migratedQuizIds = new Set(rows.map(r => r.quiz_id))
  quizzes.forEach(q => {
    if (migratedQuizIds.has(q.quiz_id)) return
    const legacy = String(q.assigned_hr_codes || '').split('|').map(norm)
    if (legacy.includes(target)) out.add(q.quiz_id)
  })
  return out
}

/**
 * Add trainees. Purely additive — existing assignments and completed results
 * are untouched. Already-assigned codes are reported back rather than
 * duplicated, because a second row would grant a silent extra attempt.
 */
export async function assignTrainees({ quizId, quizRow, hrCodes, trainees, assignedBy }) {
  const existing = await loadAssignments(quizId, { quizRow, assignedBy })
  const have = new Set(existing.map(r => norm(r.trainee_hr_code)))

  const byCode = new Map((trainees || []).map(t => [norm(t.hrCode), t]))
  const added = [], already = [], unknown = []

  ;[...new Set((hrCodes || []).map(norm))].filter(Boolean).forEach(hr => {
    if (have.has(hr)) { already.push(hr); return }
    const person = byCode.get(hr)
    if (!person) { unknown.push(hr); return }
    added.push({
      quiz_id: quizId,
      trainee_hr_code: hr,
      trainee_name: person.name || '',
      assigned_at: new Date().toISOString(),
      assigned_by: assignedBy || '',
      attempts_granted: 1,
      status: 'assigned',
    })
  })

  if (added.length) await appendRows(TAB_ASSIGNMENTS, added, ASSIGNMENTS_COLUMNS)
  return { added, already, unknown }
}

/**
 * Let a trainee retake a quiz they already finished.
 *
 * Nothing is deleted: the earlier result keeps its own result_id, timestamp and
 * quiz_version in quiz_sessions and trainee_sessions. The retake is a new
 * session with attempt_number + 1, scored against the CURRENT quiz_version — so
 * if the answer key moved on, each attempt is judged by the key it actually
 * faced, and both remain in history.
 *
 * Implemented as a pre-approved retake record, which is what canStart() already
 * reads. No second gate to keep in step with the first.
 */
export async function reassign({ quiz, trainee, attemptsMade, scorePercent, approvedBy }) {
  await addDoc(collection(db, FS_REQUESTS), {
    quiz_id: quiz.quiz_id,
    quiz_name: quiz.quiz_name,
    trainee_hr_code: norm(trainee.hrCode || trainee.trainee_hr_code),
    trainee_email: trainee.email || '',
    trainee_name: trainee.name || trainee.trainee_name || '',
    trainer_email: approvedBy || '',
    attempt_number: (attemptsMade || 0) + 1,
    score_percent: scorePercent ?? null,
    status: REQUEST_STATUS.APPROVED,   // granted outright, never requested
    reason: 'Reassigned by trainer',
    created_at: Date.now(),
    decided_at: Date.now(),
    trainer_initiated: true,
  })
}

/**
 * Roster for the assign panel: every assigned trainee with their real status.
 * → [{ hrCode, name, status, attempts, bestScore, lastScore, passed, canReassign }]
 */
export async function assignmentStatus({ quizId, quizRow, assignedBy }) {
  const [assignments, { [TAB_SESSIONS]: sessions }] = await Promise.all([
    loadAssignments(quizId, { quizRow, assignedBy }),
    readTabs([TAB_SESSIONS]),
  ])

  // approvals already granted, so a trainee is not offered Reassign twice
  let grants = {}
  try {
    const snap = await getDocs(query(
      collection(db, FS_REQUESTS),
      where('quiz_id', '==', quizId),
      where('status', '==', REQUEST_STATUS.APPROVED),
    ))
    snap.docs.forEach(d => {
      const hr = norm(d.data().trainee_hr_code)
      grants[hr] = (grants[hr] || 0) + 1
    })
  } catch (e) {
    console.warn('[DRILL] could not read grants:', e.message)
  }

  return assignments.map(a => {
    const hr = norm(a.trainee_hr_code)
    const mine = sessions.filter(s =>
      s.quiz_id === quizId &&
      norm(s.trainee_hr_code) === hr &&
      String(s.is_test_run) !== '1')

    const finished = mine.filter(s => s.status === 'completed' || s.status === 'timed_out')
    const inProgress = mine.some(s => s.status === 'in_progress')
    const passed = mine.some(s => String(s.passed) === '1')
    const scores = finished.map(s => Number(s.score_percent || 0))

    const status = passed ? 'passed'
      : finished.length ? 'completed'
      : inProgress ? 'in_progress'
      : 'not_started'

    return {
      hrCode: hr,
      name: a.trainee_name || '',
      assignedAt: a.assigned_at,
      status,
      attempts: mine.length,
      bestScore: scores.length ? Math.max(...scores) : null,
      lastScore: scores.length ? scores[scores.length - 1] : null,
      passed,
      // only offer a reassignment when they have actually finished and are not
      // already holding an unused grant
      canReassign: finished.length > 0 && (grants[hr] || 0) <= mine.length - 1,
      grantsHeld: grants[hr] || 0,
    }
  }).sort((a, b) => a.hrCode.localeCompare(b.hrCode))
}
