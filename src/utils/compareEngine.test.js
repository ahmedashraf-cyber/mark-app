import { describe, it, expect } from 'vitest'
import { compare } from './compareEngine'

// The engine scores collectors against the approved model answer. These pin its documented contract
// (direction is an argument; alignment is by time; team is an attribute, not an alignment key).
const S = id => ({ session_id: id, match_id: '1', half: '1H' })
const E = (code, ms, team = 'home', extra = {}) => ({ event_code: code, video_time_ms: ms, time_from_half_start_ms: ms, team, ...extra })
const run = (model, collector) => compare(S('M'), model, S('C'), collector, { modelSessionId: 'M', runId: 'r' })
const MODEL = [E('pass', 1000), E('tackle', 5000, 'away'), E('shot', 9000)]

describe('compare(model, collector)', () => {
  it('identical sessions score 100 with every event correct', () => {
    const r = run(MODEL, MODEL.map(e => ({ ...e })))
    expect(r.score).toBe(100); expect(r.verdictCounts.correct).toBe(3)
  })
  it('an event the collector did not tag is missing_event', () => {
    const r = run(MODEL, [MODEL[0], MODEL[2]])
    expect(r.verdictCounts.missing_event).toBe(1); expect(r.score).toBe(66.7)
  })
  it('an event the model does not have is extra_event, and it costs score', () => {
    const r = run(MODEL, [...MODEL, E('pass', 20000)])
    expect(r.verdictCounts.extra_event).toBe(1); expect(r.score).toBe(66.7)
  })
  it('an empty collector session scores 0', () => {
    const r = run(MODEL, [])
    expect(r.verdictCounts.missing_event).toBe(3); expect(r.score).toBe(0)
  })
  it('beyond the 2 s alignment tolerance the event is missing AND extra, not a timing error', () => {
    const r = run(MODEL, [E('pass', 3500), MODEL[1], MODEL[2]])
    expect(r.verdictCounts.missing_event).toBe(1); expect(r.verdictCounts.extra_event).toBe(1)
  })
  it('a wrong team is wrong_side and is NOT scored (weight 0)', () => {
    const r = run(MODEL, [MODEL[0], E('tackle', 5000, 'home'), MODEL[2]])
    expect(r.verdictCounts.wrong_side).toBe(1); expect(r.score).toBe(100)
  })
  it('a different event at the same moment is wrong_event and costs score', () => {
    const r = run(MODEL, [MODEL[0], E('block', 5000, 'away'), MODEL[2]])
    expect(r.verdictCounts.wrong_event).toBe(1); expect(r.score).toBe(66.7)
  })
  // Characterisation (records current behaviour; not necessarily the intended rule): an event 1.5 s
  // off is paired but reported wrong_timestamp and scored, even though it is inside the 2 s alignment window.
  it('CHARACTERISATION: 1.5 s off is paired but scored as wrong_timestamp', () => {
    const r = run(MODEL, [E('pass', 2500), MODEL[1], MODEL[2]])
    expect(r.verdictCounts.wrong_timestamp).toBe(1); expect(r.score).toBe(66.7)
  })
  it('direction is an argument: swapping which session is passed first gives the same verdicts', () => {
    const a = run(MODEL, [MODEL[0], MODEL[2]])
    const b = compare(S('C'), [MODEL[0], MODEL[2]], S('M'), MODEL, { modelSessionId: 'M', runId: 'r' })
    expect(b.verdictCounts).toEqual(a.verdictCounts); expect(b.score).toBe(a.score)
  })
  it('refuses to guess when the model session id matches neither session', () => {
    expect(() => compare(S('M'), MODEL, S('C'), MODEL, { modelSessionId: 'Z' })).toThrow(/matches neither/)
    expect(() => compare(S('M'), MODEL, S('C'), MODEL, {})).toThrow(/modelSessionId is required/)
  })
})
