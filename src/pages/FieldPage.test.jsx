import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { FS } from '../test/fakeFirestore'
import { FIELD_LS_KEY } from '../config/fieldConfig'
import FieldPage from './FieldPage'

// Tag mode — the page that writes collectors' events to Firestore. These tests drive the REAL page with
// the keyboard and the sidebar, against a fake Firestore that can be slow, offline or refuse writes.
// They exist because this is where a real defect once lived: a held key made 41 copies of one event
// (the answer key stayed live until the slow write returned). Each test names the behaviour it protects.
vi.mock('../firebase/config', () => ({ db: {}, auth: {} }))
vi.mock('firebase/firestore', async () => await import('../test/fakeFirestore'))
vi.mock('../hooks/useAuth.jsx', () => ({
  useAuth: () => ({ profile: { uid: 'u1', email: 'a@hudl.com', displayName: 'A' }, role: 'Batch Coordinator', caps: { scout: true }, roleInfo: { code: 'A-1' } }),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd) => (cmd === 'pick_video_file' ? '/v/match.mp4' : cmd === 'get_video_url' ? 'http://127.0.0.1:1/video' : cmd === 'get_file_size' ? '1' : null),
}))
vi.mock('../utils/comparisonSource', () => ({ createSource: () => ({ findSession: async () => null }) }))
vi.mock('../utils/importModelAnswers', () => ({ importModelAnswers: async () => ({ skipped: true }), isModelImportDone: () => true }))
vi.mock('../utils/fieldSheetSync', async (orig) => ({ ...(await orig()), syncSessionToSheet: vi.fn(async () => ({})), downloadFieldCsv: vi.fn(async () => null) }))

// ── helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, what, ms = 10000) {
  const t0 = Date.now()
  for (;;) {
    let v; try { v = fn() } catch { v = false }
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for: ' + what)
    await sleep(10)
  }
}
const press = (key, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: !!o.repeat, bubbles: true, cancelable: true }))
const keys = async (...ks) => { for (const k of ks) { press(k); await sleep(50) } }
// An event appears in the bar the moment it is accepted, but is still "saving" until Firestore answers; during that
// time the app deliberately ignores event keys and disables Clear all. Tests that chain one event into the next
// action must wait for the save to settle first (this used to be a race that only lost on a slower machine).
const settled = () => waitFor(() => !document.querySelector('[data-testid="save-chip"]') && !document.querySelector('[data-status="pending"]'), 'the save to finish')
const click = (el, detail = 1) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))
const byText = (sel, re) => [...document.querySelectorAll(sel)].find(e => re.test(e.textContent))
const body = () => document.body.textContent
const panelText = () => { const b = byText('button', /ESC Cancel/); return b ? b.parentElement.parentElement.textContent : '' }
const sideItem = label => [...document.querySelectorAll('.event-card')].find(e => e.textContent.startsWith(label))
const card = id => document.querySelector(`[data-event-id="${id}"]`)
const endItem = () => document.querySelector('[data-testid="end-stoppage"]')
const collected = () => { const m = /(\d+)\s*collected/.exec(body()); return m ? +m[1] : -1 }
const mine = () => [...FS.col('mark_collected_events').values()].filter(d => d.sessionId === 'S1' && !String(d.id).startsWith('seed')).sort((a, b) => a.event_seq - b.event_seq)
const of = id => mine().filter(d => d.eventId === id).pop()
const video = () => document.querySelector('video')
const TEAMQ = /Team — 1 Home · 2 Away/

const ev = (i, eventId, team, t, o = {}) => ({
  id: 'seed' + i, sessionId: 'S1', videoTimeSec: t, video_time_ms: Math.round(t * 1000), event_seq: i, eventId,
  eventLabel: o.label || eventId, groups: [], extras: [], team, teamSource: team ? 'manual' : null,
  type: o.type || null, typeSource: o.type ? 'manual' : null, pair_id: null, pair_status: null, closesEventId: null, passEnd: '', source: 'field', mode: 'field',
})
const KICKOFF = { code: 'TYPE_KICK_OFF', label: 'Kick off', toggleKey: 'K' }
// Half start by home, a pass, a reception → the chain is in "carry" and "mine" = home
const carry = () => [ev(1, 'half_start', 'home', 1, { label: 'Half start' }), ev(2, 'pass', 'home', 2, { label: 'Pass', type: KICKOFF }), ev(3, 'reception', 'home', 3, { label: 'Reception' })]

let root = null
async function mount({ method = 'all', seed = carry(), latency = 0 } = {}) {
  FS.reset(); localStorage.clear(); document.body.innerHTML = '<div id="root"></div>'
  const session = { sessionId: 'S1', videoPath: '/v/match.mp4', videoName: 'match.mp4', status: 'in_progress', collectionMethod: method, part: 1, matchId: '1454815', totalEvents: seed.length, accumulatedMs: 0 }
  localStorage.setItem(FIELD_LS_KEY, JSON.stringify([session]))
  FS.seed('mark_collected_events', seed)
  root = createRoot(document.getElementById('root'))
  root.render(<FieldPage session={session} onDone={() => {}} onBack={() => {}} />)
  const drop = await waitFor(() => [...document.querySelectorAll('div')].filter(e => /click to browse/.test(e.textContent)).pop(), 'the video drop zone')
  click(drop)
  await waitFor(() => collected() >= 0 && !/click to browse/.test(body()), 'the capture screen')
  await waitFor(() => collected() === seed.length, 'the saved events to load')
  // React attaches the key handler for a render in an effect that runs a moment AFTER that render. A real
  // person cannot press a key in that gap; a test can, and would hit the previous render's handler.
  await sleep(80)
  FS.latency = latency
}
afterEach(async () => {
  // a slow write still in flight must not land in the NEXT test's fake store
  await sleep((FS.latency || 0) + 80)
  if (root) root.unmount()
  root = null; document.body.innerHTML = ''
})

// ── 1. no duplicates ─────────────────────────────────────────────────────────
describe('a slow network can never create duplicate events', () => {
  it('HOLDING a key that needs no answer makes exactly one event', async () => {
    await mount({ latency: 300 })
    press('U')                                                   // Leg stretch duel: inferred team, no questions
    for (let i = 0; i < 12; i++) { await sleep(25); press('U', { repeat: true }) }
    await waitFor(() => FS.log.filter(l => l.kind === 'setDoc').length >= 1, 'the write to start')
    await sleep(500)
    expect(mine()).toHaveLength(1); expect(collected()).toBe(4)
  })

  it('tapping Enter again while the Pass is still being saved makes exactly one event', async () => {
    await mount({ latency: 300 })
    await keys('E', '1', '2')                                    // pass → height, body part
    for (let i = 0; i < 7; i++) { press('Enter'); await sleep(25) }
    await sleep(500)
    expect(mine().filter(d => d.eventId === 'pass')).toHaveLength(1)
  })

  it('two answers arriving in the SAME tick (the stale-closure window) still make one event', async () => {
    await mount({ latency: 300 })
    press('J'); await sleep(30)                                  // Separation duel: one required question
    press('1'); press('1'); press('1')
    await sleep(600)
    expect(mine().filter(d => d.eventId === 'separation_duel')).toHaveLength(1)
  })

  it('a key pressed while saving is refused out loud, not swallowed', async () => {
    await mount({ latency: 400 })
    press('U'); await sleep(40); press('H'); await sleep(40)
    expect(body()).toMatch(/key was ignored/)
    expect(collected()).toBe(4)                                  // only the first event is in the bar (pending)
    await waitFor(() => mine().length === 1, 'the slow write to land')
  })
})

// ── 2. a failed write never looks saved ──────────────────────────────────────
describe('an event that was not saved never looks saved', () => {
  it('shows it as FAILED, releases the key lock, and Retry saves it', async () => {
    await mount()
    FS.failAll = true
    press('U')
    await waitFor(() => document.querySelectorAll('[data-status="failed"]').length === 1, 'the failed card')
    expect(body()).toMatch(/not saved/)
    press('H')                                                  // lock must not be stuck
    await waitFor(() => collected() === 5, 'a second event to be accepted')
    // "accepted" only means it is in the bar; wait until BOTH have actually failed before the network
    // "recovers", or Retry is (correctly) asked to retry only the one that had failed by then.
    await waitFor(() => document.querySelectorAll('[data-status="failed"]').length === 2, 'both events to be marked failed')
    FS.failAll = false
    click(document.querySelector('[data-testid="unsaved-chip"]'))
    await waitFor(() => !document.querySelector('[data-status]') && mine().length === 2, 'both to be saved')
  })
})

// ── 3. Clear all ─────────────────────────────────────────────────────────────
describe('Clear all', () => {
  async function withTwoNewEvents() { await mount(); press('U'); await waitFor(() => collected() === 4, 'event 1'); await settled(); press('H'); await waitFor(() => collected() === 5, 'event 2'); await settled() }
  it('Enter, Space and a keyboard-made click can NEVER confirm the wipe; Esc closes it', async () => {
    await withTwoNewEvents()
    click(document.querySelector('[data-testid="clear-all"]'))
    await waitFor(() => /Delete all 5 events from this session\? This cannot be undone\./.test(body()), 'the dialog')
    press('Enter'); await sleep(40); press(' '); await sleep(40)
    const confirm = document.querySelector('[data-testid="clear-confirm"]')
    click(confirm, 0)                                           // detail 0 = a click synthesised by Enter/Space
    await sleep(120)
    expect(collected()).toBe(5); expect(FS.count('mark_collected_events')).toBe(5)
    press('Escape'); await waitFor(() => !document.querySelector('[data-testid="clear-modal"]'), 'the dialog to close')
    expect(collected()).toBe(5)
  })
  it('a real mouse click deletes the session\'s events and nothing else', async () => {
    await withTwoNewEvents()
    click(document.querySelector('[data-testid="clear-all"]'))
    await waitFor(() => document.querySelector('[data-testid="clear-confirm"]'), 'the dialog')
    click(document.querySelector('[data-testid="clear-confirm"]'), 1)
    await waitFor(() => collected() === 0 && FS.count('mark_collected_events') === 0, 'everything to be deleted')
    expect(document.querySelector('[data-testid="clear-all"]').disabled).toBe(true)
  })
})

// ── 4. Stoppage / End stoppage / Half end ────────────────────────────────────
describe('Stoppage, End stoppage and Half end', () => {
  it('every former "no team" event asks Home/Away and is stored as a manual team', async () => {
    await mount()
    click(sideItem('Camera Off'))
    await waitFor(() => TEAMQ.test(panelText()), 'the team question')
    await keys('2')
    await waitFor(() => of('camera_off'), 'camera_off to be saved')
    expect(of('camera_off')).toMatchObject({ team: 'away', teamSource: 'manual' })
  })
  it('End stoppage closes the open Stoppage: same pair, duration set, team INHERITED, and a second Stoppage is refused', async () => {
    await mount()
    expect(endItem().getAttribute('data-open')).toBe('0'); expect(endItem().textContent).toMatch(/No open stoppage/)
    video().currentTime = 10
    click(sideItem('Stoppage')); await waitFor(() => TEAMQ.test(panelText()), 'the team question')
    await keys('2', '1', '1')                                    // team, type, paused
    await waitFor(() => of('stoppage'), 'the stoppage'); await waitFor(() => endItem().getAttribute('data-open') === '1', 'End stoppage to enable'); await settled()
    click(sideItem('Stoppage'))
    await waitFor(() => /Close the open stoppage first/.test(body()), 'the refusal')
    expect(mine().filter(d => d.eventId === 'stoppage')).toHaveLength(1)
    video().currentTime = 25
    click(endItem()); await sleep(60)
    expect(TEAMQ.test(panelText())).toBe(false)                  // no question: it inherits
    await waitFor(() => of('end_stoppage'), 'end_stoppage to be saved')
    const s = of('stoppage'), e = of('end_stoppage')
    expect(e).toMatchObject({ team: s.team, teamSource: 'inherited', pair_id: s.pair_id, pair_status: 'complete', duration_ms: 15000 })
  })
  it('Esc at the Half end question closes NOTHING; confirming it closes the open states first, then saves itself', async () => {
    await mount()
    video().currentTime = 10
    click(sideItem('Stoppage')); await waitFor(() => TEAMQ.test(panelText()), 'team'); await keys('1', '1', '1')
    await waitFor(() => of('stoppage'), 'the stoppage'); await settled()
    const before = FS.count('mark_collected_events')
    video().currentTime = 60
    click(sideItem('Half end')); await waitFor(() => TEAMQ.test(panelText()), 'the Half end question')
    press('Escape'); await sleep(120)
    expect(FS.count('mark_collected_events')).toBe(before); expect(endItem().getAttribute('data-open')).toBe('1')
    click(sideItem('Half end')); await waitFor(() => TEAMQ.test(panelText()), 'the question again'); press('2')
    await waitFor(() => of('half_end'), 'half_end to be saved')
    const es = of('end_stoppage'), he = of('half_end')
    expect(es.event_seq).toBeLessThan(he.event_seq)
    expect(es).toMatchObject({ teamSource: 'manual', pair_status: 'incomplete' })   // forced closes keep their old teamSource
  })
})

// ── 5. Edit never loses the original ────────────────────────────────────────
describe('Edit', () => {
  it('Esc during an Edit puts the original event back — a saved event cannot be lost by cancelling', async () => {
    await mount()
    click(card('seed2')); await waitFor(() => byText('button', /^Edit$/), 'the Edit button')
    click(byText('button', /^Edit$/))
    await waitFor(() => !card('seed2') && /Pass type/.test(panelText()), 'the replay to start')
    expect(FS.col('mark_collected_events').has('seed2')).toBe(true)     // never deleted while the replay runs
    press('Escape')
    await waitFor(() => !!card('seed2') && collected() === 3, 'the original to return')
  })
})

// ── 6. team keys ─────────────────────────────────────────────────────────────
describe('team keys', () => {
  it.each(['partial', 'all'])('%s: only 1 and 2 choose a team — H and A (event hotkeys) are ignored at the prompt', async (method) => {
    await mount({ method, seed: [] })           // no Half start yet, so All events asks too
    press('J'); await waitFor(() => TEAMQ.test(panelText()), 'the team question')
    await keys('h', 'H', 'a', 'A')
    expect(TEAMQ.test(panelText())).toBe(true); expect(mine()).toHaveLength(0)
    press('2'); await waitFor(() => /Direction/.test(panelText()), 'the next question')
    press('1'); await waitFor(() => of('separation_duel'), 'the event to be saved')
    expect(of('separation_duel')).toMatchObject({ team: 'away', teamSource: 'manual' })
  })
})
