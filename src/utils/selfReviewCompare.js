/**
 * selfReviewCompare.js — pure comparison logic for Collector Self-Review.
 * ============================================================================
 * No I/O, no React. Imported by CollectorSelfReviewPage.jsx only.
 * Every function is independently testable with Node or Jest.
 *
 * Event codes: snake_case (pressure_start, pass, etc.) as stored in fieldConfig.
 * Labels are resolved via EVENT_REGISTRY from fieldConfig.js.
 */

import { EVENT_REGISTRY } from '../config/fieldConfig'

// ── Event registry lookups ────────────────────────────────────────────────────
const BY_CODE  = Object.fromEntries(EVENT_REGISTRY.map(e => [e.code,             e]))
const BY_LABEL = Object.fromEntries(EVENT_REGISTRY.map(e => [e.label.toLowerCase(), e]))

// Trainer sheets may use slightly different label casing or known aliases.
// IMPORTANT: use exact-match before substring — the original bug mapped
// "Pressure" to pressure_end via substring. Aliases are prefix-free.
const TRAINER_ALIASES = {
  'pressure':          'pressure_start',  // trainer shorthand → FIELD open event
  'goalkeeper':        'goal_keeper',
  'pass first time':   'pass_first_time',
  'hold up duel':      'hold_up_duel',
  'fifty fifty':       'fifty_fifty',
  'foul committed':    'foul_committed',
  'own goal against':  'own_goal_against',
  'ball recovery':     'ball_recovery',
  'pass recovery':     'pass_recovery',
  'pass interception': 'pass_interception',
  'unknown pass end':  'unknown_pass_end',
  'leg stretch duel':  'leg_stretch_duel',
  'positioning duel':  'positioning_duel',
  'separation duel':   'separation_duel',
  'pressure start':    'pressure_start',
  'pressure end':      'pressure_end',
  'end shot':          'end_shot',
  'end stoppage':      'end_stoppage',
  'half start':        'half_start',
  'half end':          'half_end',
  'goal keeper':       'goal_keeper',
}

// ── Label → code ──────────────────────────────────────────────────────────────
// Exact match first, then alias table, then safe fallback.
// Never uses substring/partial matching.
export function labelToCode(rawLabel) {
  if (!rawLabel) return ''
  const l = String(rawLabel).trim().toLowerCase().replace(/\s+/g, ' ')
  // Alias table (catches trainer-sheet shorthand like "Pressure")
  if (TRAINER_ALIASES[l]) return TRAINER_ALIASES[l]
  // Exact label match against registry
  if (BY_LABEL[l]) return BY_LABEL[l].code
  // If it already looks like a code (snake_case, exists in registry), return as-is
  if (BY_CODE[rawLabel.trim()]) return rawLabel.trim()
  // Unknown: log it, return a safe slug so the row is kept (never silently dropped)
  console.warn(`[MARK SelfReview] Unmapped event label: "${rawLabel}"`)
  return rawLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

export function codeToLabel(code) {
  return BY_CODE[code]?.label || code
}

export function codeKnown(code) {
  return !!BY_CODE[code]
}

// ── Time parsing ──────────────────────────────────────────────────────────────
// Trainer: "M:SS.mmm" or "M:SS" — truncate ms (whole seconds only).
export function trainerTsToSec(ts) {
  const m = String(ts || '').trim().match(/^(\d{1,3}):(\d{1,2})(?:[.:]\d+)?$/)
  return m ? (+m[1]) * 60 + (+m[2]) : null
}

// Collector: {min, sec} inputs (integers from the form).
export function collectorTsToSec(min, sec) {
  if (min === '' && sec === '') return null
  return (+min || 0) * 60 + (+sec || 0)
}

export function fmtSec(s) {
  if (s == null) return ''
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── Normalise error-type display label ───────────────────────────────────────
// Sheets may store codes (missing_event) or labels (Missing event).
// Converts either to the canonical display label from ERROR_TYPES.
const ERROR_TYPES = [
  'Missing event','Extra event','Wrong event','Wrong timestamp','Wrong side',
  'Wrong player','Wrong location','Missing extra','Wrong extra',
  'Not needed extra','Missing Pressure','Extra Pressure',
]
const ERR_BY_KEY = Object.fromEntries(
  ERROR_TYPES.map(t => [t.toLowerCase(), t])
    .concat(ERROR_TYPES.map(t => [t.toLowerCase().replace(/\s+/g, '_'), t]))
)
export function normaliseErrorType(raw) {
  if (!raw) return ''
  const k = String(raw).trim().toLowerCase().replace(/\s+/g, '_')
  return ERR_BY_KEY[k] || ERR_BY_KEY[String(raw).trim().toLowerCase()] || String(raw).trim()
}

export { ERROR_TYPES }

// ── Compare ───────────────────────────────────────────────────────────────────
// collectorEntries: [{eventCode, min, sec, errorType}]
// trainerRows:      [{eventLabel, timestamp, errorType, team}]
//                   (already filtered to the selected scope before calling)
// tolerance:        seconds (default 2)
//
// Returns { results, summary }
//   results: [{status, code, collectorCode, tSec, cSec, delta, tErr, cErr, unmapped}]
//   summary: {trainerTotal, matched, wrongEvent, missed, collectorOnly, score}
//
// Two-pass algorithm:
//   Pass 1: same event_code, |Δ| ≤ tolerance → matched (exactly as before)
//   Pass 2: among remaining rows, any (trainer, collector) pair with |Δ| ≤ tolerance,
//           sorted by |Δ| ascending, greedily taken → wrong_event
//   Remainder: trainer → missed, collector → collector_only
export function compare(collectorEntries, trainerRows, toleranceSec = 2) {
  const trainer = trainerRows.map(r => ({
    code:      labelToCode(r.eventLabel),
    rawLabel:  r.eventLabel,
    sec:       trainerTsToSec(r.timestamp),
    errorType: normaliseErrorType(r.errorType),
    unmapped:  !codeKnown(labelToCode(r.eventLabel)),
    used:      false,
  }))

  const coll = collectorEntries.map(r => ({
    code:      r.eventCode,
    sec:       collectorTsToSec(r.min, r.sec),
    errorType: normaliseErrorType(r.errorType),
    used:      false,
  }))

  const results = []

  // ── Pass 1: same event_code, |Δ| ≤ tolerance ────────────────────────────
  for (const t of trainer) {
    let best = null, bestDelta = Infinity
    if (t.sec != null) {
      for (const c of coll) {
        if (c.used || c.code !== t.code) continue
        const d = Math.abs(c.sec - t.sec)
        if (d <= toleranceSec && d < bestDelta) { best = c; bestDelta = d }
      }
    }
    if (best) {
      best.used = true
      t.used = true
      results.push({
        status: 'matched',
        code:   t.code, collectorCode: t.code, rawLabel: t.rawLabel,
        tSec:   t.sec,  cSec: best.sec,
        delta:  best.sec - t.sec,
        tErr:   t.errorType, cErr: best.errorType,
        unmapped: t.unmapped,
      })
    }
  }

  // ── Pass 2: cross-event pairs within tolerance → wrong_event ─────────────
  // Build all (unused trainer, unused collector) pairs with |Δ| ≤ tolerance,
  // different event codes. Sort by |Δ| ascending; greedily take each pair.
  const pairs = []
  for (const t of trainer) {
    if (t.used || t.sec == null) continue
    for (const c of coll) {
      if (c.used || c.sec == null || c.code === t.code) continue
      const d = Math.abs(c.sec - t.sec)
      if (d <= toleranceSec) pairs.push({ t, c, d })
    }
  }
  pairs.sort((a, b) => a.d - b.d)
  for (const { t, c, d } of pairs) {
    if (t.used || c.used) continue
    t.used = true
    c.used = true
    results.push({
      status: 'wrong_event',
      code:   t.code, collectorCode: c.code, rawLabel: t.rawLabel,
      tSec:   t.sec,  cSec: c.sec,
      delta:  c.sec - t.sec,
      tErr:   t.errorType, cErr: c.errorType,
      unmapped: t.unmapped,
    })
  }

  // ── Remainders ───────────────────────────────────────────────────────────
  trainer.filter(t => !t.used).forEach(t =>
    results.push({
      status: 'missed',
      code:   t.code, collectorCode: '', rawLabel: t.rawLabel,
      tSec:   t.sec,  cSec: null, delta: null,
      tErr:   t.errorType, cErr: '',
      unmapped: t.unmapped,
    })
  )
  coll.filter(c => !c.used).forEach(c =>
    results.push({
      status: 'collector_only',
      code:   c.code, collectorCode: c.code, rawLabel: '',
      tSec:   null,   cSec: c.sec, delta: null,
      tErr:   '',     cErr: c.errorType,
      unmapped: false,
    })
  )

  // Sort: trainer time first, then collector time for collector_only rows.
  results.sort((a, b) => (a.tSec ?? a.cSec ?? 1e9) - (b.tSec ?? b.cSec ?? 1e9))

  const trainerTotal  = trainer.length
  const matched       = results.filter(r => r.status === 'matched').length
  const wrongEvent    = results.filter(r => r.status === 'wrong_event').length
  const missed        = results.filter(r => r.status === 'missed').length
  const collectorOnly = results.filter(r => r.status === 'collector_only').length

  // score = max(0, 100 − (missed + wrongEvent + collectorOnly) / trainerTotal × 100), 1 decimal.
  // wrong_event counts as ONE error (the trainer row), not two.
  // If trainerTotal = 0 → score is null (shown as "—").
  const score = trainerTotal
    ? Math.max(0, Math.round((1 - (missed + wrongEvent + collectorOnly) / trainerTotal) * 1000) / 10)
    : null

  return { results, summary: { trainerTotal, matched, wrongEvent, missed, collectorOnly, score } }
}

// ── Event groups (Offense / Defense / Close) derived from fieldConfig numeric IDs ─
// 1xxx = Offense, 2xxx = Defense, 3xxx = Close, 9xxx = Admin → show in Offense group
export const EVENT_GROUPS = (() => {
  const offense = [], defense = [], close = []
  for (const e of EVENT_REGISTRY) {
    const n = e.numericId
    if (n >= 3000 && n < 9000) close.push(e)
    else if (n >= 2000 && n < 3000) defense.push(e)
    else offense.push(e) // 1xxx + 9xxx (admin) both in Offense group
  }
  return { Offense: offense, Defense: defense, Close: close }
})()
