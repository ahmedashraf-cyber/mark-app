import { describe, it, expect } from 'vitest'
import { findAtTime, lowerBound, pastCountAt, EVENT_HIGHLIGHT_TOLERANCE_S as TOL } from './eventHighlight'

const ev = [1, 2, 2.3, 2.4, 5, 9.9, 10, 10.4, 30].map((s, i) => ({ id: 'e' + i, videoTimeSec: s }))

describe('eventHighlight (which events sit under the playhead)', () => {
  it('the tolerance is a named 0.5 s', () => expect(TOL).toBe(0.5))
  it('highlights EVERY event within ±tolerance, and names the nearest', () => {
    const r = findAtTime(ev, 2.3)
    expect(r.ids).toEqual(['e1', 'e2', 'e3']); expect(r.nearestId).toBe('e2')
  })
  it('nothing in the window → nothing highlighted', () => expect(findAtTime(ev, 4)).toEqual({ ids: [], nearestId: null }))
  it('the window edge is inclusive', () => expect(findAtTime(ev, 5.5).ids).toEqual(['e4']))
  it('is safe on empty input and past the end', () => {
    expect(findAtTime([], 3).ids).toEqual([]); expect(findAtTime(ev, 100).ids).toEqual([])
  })
  it('lowerBound / pastCountAt', () => {
    expect(lowerBound(ev, 2.3)).toBe(2); expect(lowerBound(ev, 999)).toBe(ev.length)
    expect(pastCountAt(ev, 2.3)).toBe(3); expect(pastCountAt(ev, 0.5)).toBe(0); expect(pastCountAt(ev, 999)).toBe(9)
  })
  it('agrees with a brute-force scan on a large list', () => {
    const big = Array.from({ length: 3000 }, (_, i) => ({ id: 'b' + i, videoTimeSec: i * 0.7 }))
    for (let k = 0; k < 500; k++) {
      const x = (k * 4.137) % 2100
      expect(findAtTime(big, x).ids).toEqual(big.filter(e => Math.abs(e.videoTimeSec - x) <= TOL).map(e => e.id))
    }
  })
})
