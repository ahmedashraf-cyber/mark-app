import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Who is allowed in, and as what. resolveRole decides this from the roster sheet; the rules below are
// the ones written into its own comments and reasons. Google is replaced by a fake sheet; nothing
// here talks to the network.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => 'SA_TOKEN') }))

import { resolveRole, isBelowMinimum, cachedRole } from './sheetRole'

// Roster columns: code, name, role, mail, pass, status
const PEOPLE = [
  ['Code', 'Name', 'Role', 'Mail', 'Pass', 'Status'],
  ['A-1', 'Ana Collector', 'Offline Data Collector', 'ana@hudl.com', 'x', 'Active'],
  ['A-2', 'Bob Manager',   'Batch Manager',          'bob@hudl.com', 'x', ''],            // blank status = active
  ['A-3', 'Cy Gone',       'Offline Data Collector', 'cy@hudl.com',  'x', 'Inactive'],
  ['A-4', 'Di Reviewer',   'Offline Quality Reviewer', 'di@hudl.com', 'x', 'Active'],
]

function fakeSheet({ down = false } = {}) {
  return vi.fn(async (url) => {
    if (down) throw new TypeError('network down')
    const u = decodeURIComponent(String(url))
    const values = /role_access|config/.test(u) ? [] : PEOPLE
    return { ok: true, status: 200, json: async () => ({ values }), text: async () => '' }
  })
}

describe('resolveRole', () => {
  beforeEach(() => { localStorage.clear(); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => vi.unstubAllGlobals())

  it('asks for an identifier when given none', async () => {
    vi.stubGlobal('fetch', fakeSheet())
    expect(await resolveRole({})).toMatchObject({ role: null, reason: 'no identifier supplied' })
  })

  it('an active person is found by e-mail, case-insensitively, with their role', async () => {
    vi.stubGlobal('fetch', fakeSheet())
    const r = await resolveRole({ email: 'ANA@Hudl.com' })
    expect(r.role).toBe('Offline Data Collector'); expect(r.code).toBe('A-1')
  })

  it('a blank status cell means active', async () => {
    vi.stubGlobal('fetch', fakeSheet())
    expect((await resolveRole({ email: 'bob@hudl.com' })).role).toBe('Batch Manager')
  })

  it('someone not on the roster gets no role and is told to contact their Batch Manager', async () => {
    vi.stubGlobal('fetch', fakeSheet())
    const r = await resolveRole({ email: 'stranger@hudl.com' })
    expect(r.role).toBeNull(); expect(r.reason).toMatch(/not registered/)
  })

  it('an inactive person is refused, even though they are on the roster', async () => {
    vi.stubGlobal('fetch', fakeSheet())
    const r = await resolveRole({ email: 'cy@hudl.com' })
    expect(r.role).toBeNull(); expect(r.reason).toMatch(/access has been removed/)
  })

  it('HR-code sign-in works for a collector', async () => {
    vi.stubGlobal('fetch', fakeSheet())
    expect((await resolveRole({ hrCode: ' a-1 ' })).role).toBe('Offline Data Collector')
  })

  it('HR-code sign-in is REFUSED for non-collector roles (they must use e-mail)', async () => {
    vi.stubGlobal('fetch', fakeSheet())
    for (const hr of ['A-2', 'A-4']) {
      const r = await resolveRole({ hrCode: hr })
      expect(r.role).toBeNull(); expect(r.reason).toMatch(/sign in with your email/)
    }
  })

  describe('when the sheet cannot be reached', () => {
    it('uses the last known role, flagged as cached and offline', async () => {
      vi.stubGlobal('fetch', fakeSheet())
      await resolveRole({ email: 'bob@hudl.com' })                 // online first: fills the cache
      expect(cachedRole('bob@hudl.com')).toBeTruthy()
      vi.stubGlobal('fetch', fakeSheet({ down: true }))
      const r = await resolveRole({ email: 'bob@hudl.com' })
      expect(r).toMatchObject({ role: 'Batch Manager', source: 'cache', offline: true })
    })
    it('an HR-code user with no cache gets collector access ONLY', async () => {
      vi.stubGlobal('fetch', fakeSheet({ down: true }))
      const r = await resolveRole({ hrCode: 'A-9' })
      expect(r).toMatchObject({ role: 'Offline Data Collector', source: 'fallback', offline: true })
    })
    it('an e-mail user with no cache gets NO role (never a guessed one)', async () => {
      vi.stubGlobal('fetch', fakeSheet({ down: true }))
      const r = await resolveRole({ email: 'bob@hudl.com' })
      expect(r.role).toBeNull(); expect(r.offline).toBe(true)
    })
  })
})

describe('isBelowMinimum (forces old app versions to update)', () => {
  it.each([
    ['7.12.20', '7.12.21', true],
    ['7.12.21', '7.12.21', false],
    ['7.13.0',  '7.12.99', false],
    ['v7.9.0',  '7.12.0',  true],      // numeric, not string, comparison; leading v ignored
    ['7.12',    '7.12.0',  false],     // missing parts count as 0
  ])('%s vs minimum %s → %s', (v, min, expected) => expect(isBelowMinimum(v, min)).toBe(expected))
  it('never blocks when either value is missing or unparseable', () => {
    expect(isBelowMinimum('', '7.0.0')).toBe(false)
    expect(isBelowMinimum('7.0.0', '')).toBe(false)
    expect(isBelowMinimum('banana', '7.0.0')).toBe(false)
  })
})
