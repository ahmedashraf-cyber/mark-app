import { describe, it, expect } from 'vitest'
import { scoreClip, scoreAttempt } from './drillScoring'
import { DRILL_TOLERANCE_MS } from '../config/drillConfig'

// This number gates someone's onboarding (the module says so itself), so the rules written in its
// header are pinned here one by one.
const key = (code, ms, team = 'home', extra = {}) => ({ answer_event_code: code, answer_team: team, answer_video_time_ms: ms, ...extra })
const tag = (code, ms, team = 'home', attrs = {}) => ({ event_code: code, team, video_time_ms: ms, attrs })
const verdicts = r => r.rows.map(x => x.verdict).sort()

describe('scoreClip — matching', () => {
  it('a clip with no key events and no tags is a correct "nothing happens" answer', () => {
    expect(verdicts(scoreClip(1, [], []))).toEqual(['correct'])
  })
  it('same event, same team, inside the tolerance → correct', () => {
    expect(verdicts(scoreClip(1, [key('pass', 5000)], [tag('pass', 5000 + DRILL_TOLERANCE_MS - 1)]))).toEqual(['correct'])
  })
  it('right event but beyond the tolerance → wrong_timestamp, not a miss plus an extra', () => {
    expect(verdicts(scoreClip(1, [key('pass', 5000)], [tag('pass', 5000 + DRILL_TOLERANCE_MS + 500)]))).toEqual(['wrong_timestamp'])
  })
  it('wrong team on the right event → wrong_team', () => {
    expect(verdicts(scoreClip(1, [key('pass', 5000, 'home')], [tag('pass', 5000, 'away')]))).toEqual(['wrong_team'])
  })
  it('the trainee tagged a different event at that moment → wrong_event (pass 2), not missed + not_needed', () => {
    expect(verdicts(scoreClip(1, [key('tackle', 5000)], [tag('block', 5200)]))).toEqual(['wrong_event'])
  })
  it('an untagged key event is missed; a surplus tag is not_needed_event', () => {
    expect(verdicts(scoreClip(1, [key('pass', 1000), key('shot', 9000)], [tag('pass', 1000)]))).toEqual(['correct', 'missed'])
    expect(verdicts(scoreClip(1, [key('pass', 1000)], [tag('pass', 1000), tag('pass', 30000)]))).toEqual(['correct', 'not_needed_event'])
  })
  it('two events of one code are paired optimally (closest first), not in input order', () => {
    const r = scoreClip(1, [key('pass', 1000), key('pass', 3000)], [tag('pass', 3100), tag('pass', 1100)])
    expect(verdicts(r)).toEqual(['correct', 'correct'])
  })
})

describe('scoreClip — attributes are an EXACT match', () => {
  const k = key('pass', 1000, 'home', { answer_attr_height: 'ground' })
  it('the same attribute value → correct', () => {
    expect(verdicts(scoreClip(1, [k], [tag('pass', 1000, 'home', { attr_height: 'ground' })]))).toEqual(['correct'])
  })
  it('a different value → wrong_extra', () => {
    expect(verdicts(scoreClip(1, [k], [tag('pass', 1000, 'home', { attr_height: 'air' })]))).toEqual(['wrong_extra'])
  })
  it('volunteering a value the trainer left empty is wrong too (overrides the original brief)', () => {
    const empty = key('pass', 1000)
    expect(verdicts(scoreClip(1, [empty], [tag('pass', 1000, 'home', { attr_height: 'ground' })]))).toEqual(['wrong_extra'])
  })
  it('multi-select order does not matter', () => {
    const km = key('pass', 1000, 'home', { answer_attr_extras: 'a|b' })
    expect(verdicts(scoreClip(1, [km], [tag('pass', 1000, 'home', { attr_extras: 'b|a' })]))).toEqual(['correct'])
  })
})

describe('scoreAttempt — the number', () => {
  const clips = [{ clip_index: 1 }, { clip_index: 2 }]
  const keyByClip = { 1: [key('pass', 1000)], 2: [key('shot', 2000), key('tackle', 6000)] }
  const perfect = { 1: [tag('pass', 1000)], 2: [tag('shot', 2000), tag('tackle', 6000)] }

  it('a perfect attempt is 100 and passes', () => {
    const r = scoreAttempt({ clips, keyByClip, tagByClip: perfect, passMarkPercent: 80 })
    expect(r.scorePercent).toBe(100); expect(r.passed).toBe(true); expect(r.expectedEvents).toBe(3)
  })
  it('scoring is per EVENT: one miss in three is 66.7', () => {
    const r = scoreAttempt({ clips, keyByClip, tagByClip: { 1: perfect[1], 2: [tag('shot', 2000)] }, passMarkPercent: 80 })
    expect(r.scorePercent).toBe(66.7); expect(r.passed).toBe(false)
  })
  it('the denominator does not move: surplus tags are errors and cannot dilute themselves', () => {
    const r = scoreAttempt({ clips, keyByClip, tagByClip: { 1: [tag('pass', 1000), tag('pass', 30000)], 2: perfect[2] }, passMarkPercent: 0 })
    expect(r.expectedEvents).toBe(3); expect(r.scorePercent).toBe(66.7)
  })
  it('a clip the trainee never reached is missed, never a free correct "no event"', () => {
    const r = scoreAttempt({ clips, keyByClip: { 1: [key('pass', 1000)], 2: [] }, tagByClip: { 1: perfect[1] }, passMarkPercent: 0 })
    // clip 2 has no key events and was not answered: it must not be credited as correct
    const row = r.rows.find(x => x.clip_index === 2)
    expect(row.verdict).toBe('missed'); expect(row.unreached).toBe(true)
    expect(r.scorePercent).toBeLessThan(100)
  })
  it('the pass mark is inclusive', () => {
    const r = scoreAttempt({ clips, keyByClip, tagByClip: { 1: perfect[1], 2: [tag('shot', 2000)] }, passMarkPercent: 66.7 })
    expect(r.passed).toBe(true)
  })
  it('a quiz made only of trap clips (no key events) still has a denominator', () => {
    const r = scoreAttempt({ clips: [{ clip_index: 1 }], keyByClip: { 1: [] }, tagByClip: { 1: [] }, passMarkPercent: 50 })
    expect(r.expectedEvents).toBe(1); expect(r.scorePercent).toBe(100)
  })
})
