import { rebuildFromEvents, inCommitOrder } from './tagRebuild.js'
import { EVENT_BY_ID, FIELD_EVENTS } from './fieldExtras.js'
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 200) + ']' : ''}`) }
const SID = 'field_abcdefghijk_zz_1'
const E = (seq, eventId, t, o = {}) => ({ id: `e${seq}`, sessionId: SID, event_seq: seq, eventId, videoTimeSec: t, video_time_ms: t * 1000, team: 'home', pair_id: null, pair_status: null, ...o })
const openers = FIELD_EVENTS.filter(d => d.openState), closers = FIELD_EVENTS.filter(d => d.closesEventId)
console.log('the registry: openers =', openers.map(d => d.id).join(', '), '| closers =', closers.map(d => `${d.id}->${d.closesEventId}`).join(', '))

console.log('event_seq counter')
ok('no events: the counter is 0', rebuildFromEvents([]).nextSeq === 0)
ok('the counter is the HIGHEST saved event_seq (events given out of order, with a gap)', rebuildFromEvents([E(7, 'pass', 70), E(2, 'pass', 20), E(9, 'pass', 90)]).nextSeq === 9)
ok('events with no event_seq (old data) do not break it', rebuildFromEvents([{ id: 'x', eventId: 'pass', videoTimeSec: 5 }, E(4, 'pass', 40)]).nextSeq === 4)

console.log('open pairs are found from the events, not from pair_status')
const open1 = E(3, 'shot', 30, { pair_id: SID.slice(0, 8) + '_3', pair_status: 'incomplete' })
let r = rebuildFromEvents([E(1, 'pass', 10), open1])
ok('a shot with no end shot is OPEN, with its pair_id, time and seq', r.openPairs.shot && r.openPairs.shot.pairId === SID.slice(0, 8) + '_3' && r.openPairs.shot.openVideoTimeMs === 30000 && r.openPairs.shot.eventSeq === 3 && r.openPairs.shot.docId === 'e3', JSON.stringify(r.openPairs))
ok('...and openStates carries its team and time (the open badge and the team the closer inherits)', r.openStates.shot.team === 'home' && r.openStates.shot.videoTimeSec === 30, JSON.stringify(r.openStates))
const closed = [E(3, 'shot', 30, { pair_id: 'p_3', pair_status: 'incomplete' }), E(4, 'end_shot', 36, { pair_id: 'p_3', pair_status: 'complete', closesEventId: 'shot' })]
r = rebuildFromEvents(closed)
ok('a shot WITH its end shot is closed, even though the stored pair_status of the opener still says "incomplete" (the best-effort update failed)', !r.openPairs.shot && !r.openStates.shot, JSON.stringify(r.openPairs))
r = rebuildFromEvents([E(5, 'pressure_start', 50), E(6, 'stoppage', 60), E(7, 'end_stoppage', 65)])
ok('several kinds at once: pressure stays open, the closed stoppage does not', !!r.openPairs.pressure_start && !r.openPairs.stoppage && Object.keys(r.openPairs).length === 1, Object.keys(r.openPairs).join())
r = rebuildFromEvents([E(1, 'shot', 10), E(2, 'shot', 20)])
ok('two openers of one kind and no closer: the newest one is open (as in a live session)', r.openPairs.shot.eventSeq === 2)
r = rebuildFromEvents([E(1, 'shot', 10), E(2, 'end_shot', 12), E(3, 'shot', 20)])
ok('opened, closed, opened again: the second is open', r.openPairs.shot.eventSeq === 3)
ok('a closer with no opener (a forced close) opens nothing and breaks nothing', Object.keys(rebuildFromEvents([E(1, 'end_shot', 5)]).openPairs).length === 0)
ok('the order the events arrive in does not matter', JSON.stringify(rebuildFromEvents([...closed].reverse()).openPairs) === JSON.stringify(rebuildFromEvents(closed).openPairs) && inCommitOrder([E(2, 'pass', 2), E(1, 'pass', 1)])[0].event_seq === 1)
ok('a pair_id missing on the opener is rebuilt the way a live commit builds it: sessionId[0..8]_eventSeq', rebuildFromEvents([E(8, 'shot', 80)]).openPairs.shot.pairId === 'field_ab_8' || rebuildFromEvents([E(8, 'shot', 80)]).openPairs.shot.pairId === SID.slice(0, 8) + '_8')

console.log('possession is replayed through applyFlip, in event_seq order')
const calls = []
r = rebuildFromEvents([E(2, 'pass', 20), E(1, 'half_start', 5), E(3, 'pass', 30)], { applyFlip: (id, ev, st) => { calls.push(id); return { team: 'away', certain: true } } })
ok('applyFlip is called once per event, in commit order', calls.join() === 'half_start,pass,pass', calls.join())
ok('half_start with a team resets possession (as commitEvent does), later events set it', r.possession.team === 'away' && r.possession.certain === true)
ok('with the real applyFlip (a no-op today) the possession is the empty state', JSON.stringify(rebuildFromEvents([E(1, 'pass', 1), E(2, 'tackle', 2)]).possession) === JSON.stringify({ team: null, certain: false }))
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
