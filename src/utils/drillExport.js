/**
 * drillExport.js — CSV downloads
 * ============================================================================
 * DRILL only. Builds CSV text from rows already read for the dashboards; no
 * extra reads, no writes.
 *
 * Session metadata is repeated on every row, per your choice — that is what
 * makes the file usable as a pivot-table source. A header block reads more
 * nicely but every pivot then needs the metadata copied down by hand.
 */
import { DRILL_ATTR_COLUMNS } from '../config/drillConfig'
import { showToast } from './toast'

/** RFC-4180 quoting, and a BOM so Excel opens UTF-8 correctly. */
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v)
  // A leading =, +, - or @ makes Excel evaluate the cell as a formula. Prefix
  // with a quote so an event code like "-none" cannot execute.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}
function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')]
  rows.forEach(r => lines.push(headers.map(h => csvCell(r[h])).join(',')))
  return '\ufeff' + lines.join('\r\n')
}

/**
 * Save through the native dialog, and tell the user where it went.
 *
 * This was an <a download> anchor, which is a NO-OP inside the Tauri webview —
 * the click did nothing at all, no file was written anywhere. exportSession.js
 * documents the same trap; I should have read it before writing this.
 *
 * Returns the chosen path, or null if the user cancelled.
 */
export async function download(filename, text) {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const savedPath = await invoke('save_text_file_dialog', {
      name: filename, content: text,
    })
    // null means the dialog was dismissed — not a failure, so stay quiet
    if (savedPath) showToast(`Saved to ${savedPath}`)
    return savedPath || null
  } catch (e) {
    const msg = e?.message || String(e)
    showToast(`Download failed: ${msg}`, 'error')
    throw e
  }
}

const safeName = s => String(s || 'export').replace(/[^\w.-]+/g, '_').slice(0, 60)
const clipLink = id => id ? `https://drive.google.com/file/d/${id}/view` : ''

/**
 * Per-attempt detail — one row per clip.
 * The most useful of the three: it is what you read when a score looks wrong.
 */
export function attemptCsv({ quiz, session, answersGiven, clips }) {
  const clipByIndex = {}
  ;(clips || []).filter(c => c.quiz_id === quiz.quiz_id).forEach(c => {
    clipByIndex[String(c.clip_index)] = c
  })

  const meta = {
    quiz_name:        quiz.quiz_name || '',
    trainee_hr_code:  session.trainee_hr_code || '',
    trainee_name:     session.trainee_name || '',
    attempt_number:   session.attempt_number || '',
    score_percent:    session.score_percent ?? '',
    passed:           String(session.passed) === '1' ? 'YES' : 'NO',
    total_time:       session.total_time_taken_readable || '',
    date:             session.finished_at || '',
  }

  const rows = (answersGiven || [])
    .filter(r => r.result_id === session.result_id)
    .sort((a, b) => (Number(a.clip_index) - Number(b.clip_index))
                 || (Number(a.event_index) - Number(b.event_index)))
    .map(r => {
      const c = clipByIndex[String(r.clip_index)]
      const row = {
        ...meta,
        clip_index:     r.clip_index,
        video_filename: c?.video_filename || '(clip removed from quiz)',
        clip_link:      clipLink(c?.drive_file_id),
        instruction:    c?.instruction || '',
        clip_type:      c ? (String(c.is_no_event) === '1' ? 'no_event' : 'event') : 'unknown',
        trainee_event_code:  r.trainee_event_code || '',
        trainee_team:        r.trainee_team || '',
        trainee_video_time:  r.trainee_video_time_readable || '',
        correct_event_code:  r.correct_event_code || '',
        correct_team:        r.correct_team || '',
        correct_video_time:  r.correct_video_time_readable || '',
        verdict:        r.verdict || '',
        delta_ms:       r.delta_ms ?? '',
        attrs_differed: r.attrs_differed || '',
        clip_time_taken: r.clip_time_taken_readable || '',
        // a single scannable column, so you can filter the sheet without
        // remembering all seven verdict names
        correct_or_wrong: r.verdict === 'correct' ? 'CORRECT' : 'WRONG',
      }
      DRILL_ATTR_COLUMNS.forEach(a => {
        row['trainee_' + a] = r['trainee_' + a] || ''
        row['correct_' + a] = r['correct_' + a] || ''
      })
      return row
    })

  const headers = [
    ...Object.keys(meta),
    'clip_index', 'video_filename', 'clip_link', 'instruction', 'clip_type',
    'trainee_event_code', 'trainee_team', 'trainee_video_time',
    ...DRILL_ATTR_COLUMNS.map(a => 'trainee_' + a),
    'correct_event_code', 'correct_team', 'correct_video_time',
    ...DRILL_ATTR_COLUMNS.map(a => 'correct_' + a),
    'verdict', 'delta_ms', 'attrs_differed', 'clip_time_taken', 'correct_or_wrong',
  ]
  return {
    filename: `drill_${safeName(quiz.quiz_name)}_${safeName(session.trainee_hr_code)}_attempt${session.attempt_number}.csv`,
    text: toCsv(headers, rows),
    rowCount: rows.length,
  }
}

/** All trainees on one quiz — latest attempt each. */
export function quizSummaryCsv({ quiz, traineeRows }) {
  const headers = ['quiz_name', 'trainee_hr_code', 'trainee_name', 'attempts',
    'latest_score', 'best_score', 'passed', 'status', 'latest_date', 'latest_time_taken']
  const rows = (traineeRows || []).map(t => ({
    quiz_name: quiz.quiz_name || '',
    trainee_hr_code: t.hrCode,
    trainee_name: t.name,
    attempts: t.attempts,
    latest_score: t.latestScore ?? '',
    best_score: t.bestScore ?? '',
    passed: t.passed ? 'YES' : 'NO',
    status: t.status,
    latest_date: t.latestDate,
    latest_time_taken: t.latestTimeMs != null ? msToClock(t.latestTimeMs) : '',
  }))
  return {
    filename: `drill_${safeName(quiz.quiz_name)}_summary.csv`,
    text: toCsv(headers, rows), rowCount: rows.length,
  }
}

/** One trainee across every quiz. */
export function traineeSummaryCsv({ summary }) {
  const headers = ['trainee_hr_code', 'trainee_name', 'quiz_name', 'scope',
    'attempts', 'latest_score', 'best_score', 'passed', 'latest_date', 'latest_time_taken']
  const rows = (summary.perQuiz || []).map(p => ({
    trainee_hr_code: summary.hrCode,
    trainee_name: summary.name,
    quiz_name: p.quizName,
    scope: p.scope,
    attempts: p.attempts,
    latest_score: p.latestScore ?? '',
    best_score: p.bestScore ?? '',
    passed: p.passed ? 'YES' : 'NO',
    latest_date: p.latestDate,
    latest_time_taken: p.latestTimeMs != null ? msToClock(p.latestTimeMs) : '',
  }))
  return {
    filename: `drill_trainee_${safeName(summary.hrCode)}.csv`,
    text: toCsv(headers, rows), rowCount: rows.length,
  }
}

/** Per-clip analysis, including the consensus columns. */
export function clipAnalysisCsv({ quiz, analysis }) {
  const headers = ['quiz_name', 'clip_index', 'video_filename', 'clip_link', 'clip_type',
    'instruction', 'attempts', 'trainees', 'correct', 'wrong', 'error_rate_pct',
    'consensus_answer', 'consensus_count', 'consensus_share_pct', 'likely_key_problem',
    'avg_time', 'median_time',
    'v_correct', 'v_missed', 'v_not_needed_event', 'v_wrong_event',
    'v_wrong_team', 'v_wrong_timestamp', 'v_wrong_extra']
  const rows = (analysis || []).map(c => ({
    quiz_name: quiz.quiz_name || '',
    clip_index: c.clipIndex,
    video_filename: c.videoFilename,
    clip_link: clipLink(c.driveFileId),
    clip_type: c.clipType,
    instruction: c.instruction,
    attempts: c.attempts, trainees: c.trainees,
    correct: c.correct, wrong: c.wrong,
    error_rate_pct: c.errorRate ?? '',
    consensus_answer: c.consensusAnswer,
    consensus_count: c.consensusCount,
    consensus_share_pct: c.consensusShare ?? '',
    likely_key_problem: c.likelyKeyProblem ? 'YES' : '',
    avg_time: c.avgTimeMs != null ? msToClock(c.avgTimeMs) : '',
    median_time: c.medianTimeMs != null ? msToClock(c.medianTimeMs) : '',
    v_correct: c.verdicts.correct || 0,
    v_missed: c.verdicts.missed || 0,
    v_not_needed_event: c.verdicts.not_needed_event || 0,
    v_wrong_event: c.verdicts.wrong_event || 0,
    v_wrong_team: c.verdicts.wrong_team || 0,
    v_wrong_timestamp: c.verdicts.wrong_timestamp || 0,
    v_wrong_extra: c.verdicts.wrong_extra || 0,
  }))
  return {
    filename: `drill_${safeName(quiz.quiz_name)}_clips.csv`,
    text: toCsv(headers, rows), rowCount: rows.length,
  }
}

// local copy of the clock formatter for ms values that arrive as numbers
function msToClock(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return ''
  const t = Math.floor(n / 1000)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
