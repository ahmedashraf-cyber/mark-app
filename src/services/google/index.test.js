import { describe, it, expect, vi, afterEach } from 'vitest'
import { googleFetch, getServiceToken, SHEETS_API, DRIVE_API, USERINFO_API } from './index'

// The point of this module is that moving a call site onto it changes NOTHING about the request.
describe('services/google', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('googleFetch sends exactly what the hand-written call sites sent', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    await googleFetch('https://x/y', { token: 'T' })
    expect(fetchSpy).toHaveBeenCalledWith('https://x/y', { headers: { Authorization: 'Bearer T' } })
  })

  it('keeps method, body and extra headers, and adds the bearer header', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    await googleFetch('u', { token: 'T', method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } })
    expect(fetchSpy).toHaveBeenCalledWith('u', {
      method: 'POST', body: '{"a":1}',
      headers: { Authorization: 'Bearer T', 'Content-Type': 'application/json' },
    })
  })

  it('does not leak the token into the RequestInit', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    await googleFetch('u', { token: 'SECRET', method: 'PUT' })
    expect(Object.keys(fetchSpy.mock.calls[0][1])).not.toContain('token')
  })

  it('getServiceToken asks Rust for the service-account token, and accepts an injected invoke', async () => {
    const inv = vi.fn(async () => 'tok')
    await expect(getServiceToken(inv)).resolves.toBe('tok')
    expect(inv).toHaveBeenCalledWith('get_google_access_token_cmd')
  })

  it('exposes the API hosts in one place', () => {
    expect(SHEETS_API).toBe('https://sheets.googleapis.com/v4/spreadsheets')
    expect(DRIVE_API).toBe('https://www.googleapis.com/drive/v3/files')
    expect(USERINFO_API).toBe('https://www.googleapis.com/oauth2/v3/userinfo')
  })
})
