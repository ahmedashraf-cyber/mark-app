/**
 * drillAnalytics.js — aggregation for the dashboards
 * ============================================================================
 * DRILL only. Pure functions over rows already in the sheet — no new storage,
 * no writes, no network. Everything here is derived from quiz_sessions,
 * quiz_answers_given, quiz_assignments, quiz_clips and quizzes.
 *
 * quiz_answers_given has no quiz_id column, so its rows can only be reached by
 * result_id. Callers read quiz_sessions first, then filter. That is why these
 * functions take pre-filtered arrays rather than doing their own lookups — one
 * read per dashboard, aggregated in memory, instead of a read per view.
 */
import { DRILL_ATTR_COLUMNS } from '../config/drillConfig'

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null }
const isTrue = v => String(v) === '1' || String(v).toLowerCase() === 'true'
const norm = c => String(c || '').replace(/\s+/g, '').trim().toUpperCase()

/** Real attempts only — creator test runs never count toward anyone's record. */
export function realSessions(sessions, quizId) {
  return (sessions || []).filter(s =>
    (!quizId || s.quiz_id === quizId) && !isTrue(s.is_test_run))
}

export function median(list) {
  const a = (list || []).filter(n => n != null).sort((x, y) => x - y)
  if (!a.length) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2)
}
export function mean(list) {
  const a = (list || []).filter(n => n != null)
  if (!a.length) return null
  return Math.round((a.reduce((s, n) => s + n, 0) / a.length) * 10) / 10
}

/**
 * One row per assigned trainee for a quiz.
 * Assignments drive the list, not sessions — someone assigned who never
 * started must still appear, as "not started".
 */
export function traineeRows({ assignments, sessions, quizId }) {
  const mine = realSessions(sessions, quizId)
  const byTrainee = {}
  mine.forEach(s => {
    const k = norm(s.trainee_hr_code)
    ;(byTrainee[k] = byTrainee[k] || []).push(s)
  })

  return (assignments || []).filter(a => a.quiz_id === quizId).map(a => {
    const hr = norm(a.trainee_hr_code)
    const att = (byTrainee[hr] || []).slice().sort((x, y) =>
      (num(x.attempt_number) || 0) - (num(y.attempt_number) || 0))

    const finished = att.filter(s => s.status === 'completed' || s.status === 'timed_out')
    const scores = finished.map(s => num(s.score_percent)).filter(n => n != null)
    const latest = finished[finished.length - 1] || null
    const best = finished.reduce((b, s) =>
      (num(s.score_percent) ?? -1) > (num(b?.score_percent) ?? -1) ? s : b, null)
    const passed = att.some(s => isTrue(s.passed))

    return {
      hrCode: hr,
      name: a.trainee_name || '',
      email: latest?.trainee_email || '',
      attempts: att.length,
      status: passed ? 'completed-passed'
        : finished.length ? 'completed-failed'
        : att.some(s => s.status === 'in_progress') ? 'in progress'
        : 'not started',
      passed,
      latestScore: latest ? num(latest.score_percent) : null,
      latestDate:  latest?.finished_at || '',
      latestTimeMs: latest ? num(latest.total_time_taken_ms) : null,
      bestScore: best ? num(best.score_percent) : null,
      bestDate:  best?.finished_at || '',
      firstAttemptPassed: att.length ? isTrue(att[0].passed) : null,
      avgScore: mean(scores),
      sessions: att,
    }
  }).sort((a, b) => a.hrCode.localeCompare(b.hrCode))
}

/** Headline numbers for one quiz. */
export function quizSummary({ assignments, sessions, quizId }) {
  const rows = traineeRows({ assignments, sessions, quizId })
  const mine = realSessions(sessions, quizId)
  const finished = mine.filter(s => s.status === 'completed' || s.status === 'timed_out')
  const passedAttempts = finished.filter(s => isTrue(s.passed))

  const allScores    = finished.map(s => num(s.score_percent)).filter(n => n != null)
  const latestScores = rows.map(r => r.latestScore).filter(n => n != null)
  const times        = finished.map(s => num(s.total_time_taken_ms)).filter(n => n != null)
  const firstTries   = rows.filter(r => r.firstAttemptPassed !== null)

  return {
    assigned: rows.length,
    started: rows.filter(r => r.status !== 'not started').length,
    completedAttempts: finished.length,
    passedAttempts: passedAttempts.length,
    failedAttempts: finished.length - passedAttempts.length,
    traineesPassed: rows.filter(r => r.passed).length,
    // pass rate over ATTEMPTS, and over PEOPLE — they differ whenever anyone
    // retakes, and quoting only one of them is misleading
    passRateAttempts: finished.length ? Math.round((passedAttempts.length / finished.length) * 1000) / 10 : null,
    passRateTrainees: rows.length ? Math.round((rows.filter(r => r.passed).length / rows.length) * 1000) / 10 : null,
    avgScoreAllAttempts: mean(allScores),
    avgScoreLatestOnly:  mean(latestScores),
    avgTimeMs: mean(times),
    medianTimeMs: median(times),
    firstAttemptPassRate: firstTries.length
      ? Math.round((firstTries.filter(r => r.firstAttemptPassed).length / firstTries.length) * 1000) / 10
      : null,
  }
}

/**
 * Per-clip analysis — the defect detector.
 *
 * An error rate alone cannot tell a hard moment from a wrong answer key, so
 * each clip also reports CONSENSUS: the most common answer among trainees who
 * got it wrong, and what share of them gave it. Many trainees converging on
 * the same wrong answer points at the key; scattered answers point at the clip.
 */
export function clipAnalysis({ answersGiven, sessions, clips, quizId }) {
  const mine = realSessions(sessions, quizId)
  const resultIds = new Set(mine.map(s => s.result_id))
  const hrByResult = Object.fromEntries(mine.map(s => [s.result_id, norm(s.trainee_hr_code)]))

  const rows = (answersGiven || []).filter(r => resultIds.has(r.result_id))
  const clipMeta = {}
  ;(clips || []).filter(c => c.quiz_id === quizId).forEach(c => {
    clipMeta[String(c.clip_index)] = c
  })

  const byClip = {}
  rows.forEach(r => {
    const ci = String(r.clip_index)
    const b = byClip[ci] = byClip[ci] || {
      clipIndex: num(r.clip_index), verdicts: {}, wrongBy: {}, answers: {},
      times: [], trainees: new Set(), wrongTrainees: [],
    }
    b.verdicts[r.verdict] = (b.verdicts[r.verdict] || 0) + 1
    b.trainees.add(hrByResult[r.result_id])
    const t = num(r.clip_time_taken_ms)
    if (t != null) b.times.push(t)

    if (r.verdict !== 'correct') {
      // what they actually tagged, for the consensus view
      const answer = r.trainee_event_code
        ? [r.trainee_event_code, r.trainee_team].filter(Boolean).join(' / ')
        : '(tagged nothing)'
      b.answers[answer] = (b.answers[answer] || 0) + 1
      b.wrongTrainees.push({
        hrCode: hrByResult[r.result_id],
        verdict: r.verdict,
        tagged: answer,
        expected: r.correct_event_code
          ? [r.correct_event_code, r.correct_team].filter(Boolean).join(' / ')
          : '(no event expected)',
        deltaMs: num(r.delta_ms),
        attrsDiffered: r.attrs_differed || '',
      })
    }
  })

  return Object.values(byClip).map(b => {
    const total = Object.values(b.verdicts).reduce((s, n) => s + n, 0)
    const correct = b.verdicts.correct || 0
    const wrong = total - correct
    const meta = clipMeta[String(b.clipIndex)]
    const consensus = Object.entries(b.answers).sort((x, y) => y[1] - x[1])[0] || null

    return {
      clipIndex: b.clipIndex,
      // a clip deleted from the quiz leaves historical rows unclassifiable
      videoFilename: meta?.video_filename || '(clip removed from quiz)',
      driveFileId: meta?.drive_file_id || '',
      instruction: meta?.instruction || '',
      clipType: meta ? (isTrue(meta.is_no_event) ? 'no_event' : 'event') : 'unknown',
      attempts: total,
      trainees: b.trainees.size,
      correct, wrong,
      errorRate: total ? Math.round((wrong / total) * 1000) / 10 : null,
      verdicts: b.verdicts,
      avgTimeMs: mean(b.times),
      medianTimeMs: median(b.times),
      consensusAnswer: consensus ? consensus[0] : '',
      consensusCount:  consensus ? consensus[1] : 0,
      consensusShare:  consensus && wrong ? Math.round((consensus[1] / wrong) * 1000) / 10 : null,
      // Most of the wrong answers agreeing points at the answer key rather than
      // the clip. 60% is a judgement, shown as a hint not a verdict.
      likelyKeyProblem: !!(consensus && wrong >= 3 && (consensus[1] / wrong) >= 0.6),
      wrongTrainees: b.wrongTrainees,
    }
  }).sort((a, b) => (b.errorRate ?? -1) - (a.errorRate ?? -1))
}

/** Score split by clip type — real events versus trap clips. */
export function scoreByClipType({ answersGiven, sessions, clips, quizId, hrCode }) {
  const mine = realSessions(sessions, quizId)
    .filter(s => !hrCode || norm(s.trainee_hr_code) === norm(hrCode))
  const resultIds = new Set(mine.map(s => s.result_id))
  const noEvent = new Set((clips || [])
    .filter(c => c.quiz_id === quizId && isTrue(c.is_no_event))
    .map(c => String(c.clip_index)))

  const out = { event: { correct: 0, total: 0 }, no_event: { correct: 0, total: 0 }, unknown: { correct: 0, total: 0 } }
  ;(answersGiven || []).filter(r => resultIds.has(r.result_id)).forEach(r => {
    const known = (clips || []).some(c => c.quiz_id === quizId && String(c.clip_index) === String(r.clip_index))
    const k = !known ? 'unknown' : noEvent.has(String(r.clip_index)) ? 'no_event' : 'event'
    out[k].total++
    if (r.verdict === 'correct') out[k].correct++
  })
  Object.values(out).forEach(o => {
    o.score = o.total ? Math.round((o.correct / o.total) * 1000) / 10 : null
  })
  return out
}

/** One trainee across every quiz. */
export function traineeSummary({ sessions, quizzes, assignments, hrCode }) {
  const hr = norm(hrCode)
  const mine = (sessions || []).filter(s =>
    norm(s.trainee_hr_code) === hr && !isTrue(s.is_test_run))
  const quizById = Object.fromEntries((quizzes || []).map(q => [q.quiz_id, q]))
  const assigned = (assignments || []).filter(a => norm(a.trainee_hr_code) === hr)

  const byQuiz = {}
  mine.forEach(s => { (byQuiz[s.quiz_id] = byQuiz[s.quiz_id] || []).push(s) })

  const perQuiz = assigned.map(a => {
    const q = quizById[a.quiz_id]
    const att = (byQuiz[a.quiz_id] || []).slice().sort((x, y) =>
      (num(x.attempt_number) || 0) - (num(y.attempt_number) || 0))
    const finished = att.filter(s => s.status === 'completed' || s.status === 'timed_out')
    const latest = finished[finished.length - 1] || null
    const scores = finished.map(s => num(s.score_percent)).filter(n => n != null)
    return {
      quizId: a.quiz_id,
      quizName: q?.quiz_name || '(quiz removed)',
      scope: q?.scope_event_ids || '',
      attempts: att.length,
      latestScore: latest ? num(latest.score_percent) : null,
      bestScore: scores.length ? Math.max(...scores) : null,
      passed: att.some(s => isTrue(s.passed)),
      latestDate: latest?.finished_at || '',
      latestTimeMs: latest ? num(latest.total_time_taken_ms) : null,
    }
  }).sort((a, b) => a.quizName.localeCompare(b.quizName))

  const allScores = mine
    .filter(s => s.status === 'completed' || s.status === 'timed_out')
    .map(s => num(s.score_percent)).filter(n => n != null)

  return {
    hrCode: hr,
    name: assigned.find(a => a.trainee_name)?.trainee_name || '',
    email: mine.find(s => s.trainee_email)?.trainee_email || '',
    assigned: assigned.length,
    completed: perQuiz.filter(p => p.attempts > 0).length,
    passed: perQuiz.filter(p => p.passed).length,
    passRate: perQuiz.length
      ? Math.round((perQuiz.filter(p => p.passed).length / perQuiz.length) * 1000) / 10 : null,
    avgScore: mean(allScores),
    perQuiz,
    // one point per attempt, oldest first — the trend
    trend: mine
      .filter(s => s.finished_at && num(s.score_percent) != null)
      .map(s => ({
        date: s.finished_at,
        score: num(s.score_percent),
        quizName: quizById[s.quiz_id]?.quiz_name || '',
        attempt: num(s.attempt_number),
        passed: isTrue(s.passed),
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date))),
  }
}

/** Leaderboard across all quizzes. */
export function leaderboard({ sessions, assignments, quizzes, scopeFilter }) {
  const quizById = Object.fromEntries((quizzes || []).map(q => [q.quiz_id, q]))
  const inScope = qid => !scopeFilter ||
    String(quizById[qid]?.scope_event_ids || '').includes(scopeFilter)

  const hrs = [...new Set((assignments || []).map(a => norm(a.trainee_hr_code)))]
  return hrs.map(hr => {
    const s = traineeSummary({ sessions, quizzes, assignments, hrCode: hr })
    s.perQuiz = s.perQuiz.filter(p => inScope(p.quizId))
    const scores = s.perQuiz.map(p => p.latestScore).filter(n => n != null)
    return {
      hrCode: hr, name: s.name,
      quizzes: s.perQuiz.length,
      passed: s.perQuiz.filter(p => p.passed).length,
      avgScore: mean(scores),
      bestScore: scores.length ? Math.max(...scores) : null,
    }
  })
    // Only rank people who actually attempted something. Filtering on assigned
    // quizzes instead let a never-started trainee onto the board with a null
    // average, which reads as a score of nothing rather than no data.
    .filter(r => r.quizzes > 0 && r.avgScore != null)
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1))
}

export { DRILL_ATTR_COLUMNS }
