import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { exportScoutSession, retryScoutExport } from './exportScoutSession'
import { makeWorld, NET } from '../test/googleWorld'

// Scout "Done". Two promises: (1) the local files exist before Google is touched, so a Drive problem can
// never cost the reviewer their work; (2) a failure is reported as a failure, and Retry finishes only
// what is left.
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a) => globalThis.__invoke(...a) }))

const SESSION = { matchId: '1420569', half: '1H', matchName: 'Aston Villa vs BSC Young Boys', sessionId: 's1', reviewerName: 'R', matchDate: '2026-09-01' }
const TAGS = Array.from({ length: 4 }, (_, i) => ({ id: 't' + i, triggeredEventId: 'pass', triggeredEventLabel: 'Pass', triggeredKey: 'E', videoTimeSec: 60 + i * 30, team: 'home', extras: [] }))
const params = { session: SESSION, tags: TAGS, quality: 90, tagCount: 4, total: 40, dtScores: null, pressureScore: null, pressureReviewed: 0, pressureErrors: 0 }
const attempt = async f => { try { return { v: await f() } } catch (e) { return { e } } }

beforeEach(() => { localStorage.clear(); localStorage.setItem('mark_g_refresh', 'REFRESH'); localStorage.setItem('mark_video_path_1420569', 'C:\\v\\match.mp4') })
afterEach(() => { vi.unstubAllGlobals(); delete globalThis.__invoke })

describe('exportScoutSession', () => {
  it('saves the spreadsheet and cuts the clips locally BEFORE any Google call', async () => {
    const w = makeWorld()
    await exportScoutSession(params)
    const order = w.log.map(c => c.cmd)
    const firstGoogle = order.indexOf('google_oauth_refresh')
    expect(order.indexOf('save_binary_file')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('save_binary_file')).toBeLessThan(firstGoogle)
    expect(order.indexOf('cut_clips')).toBeLessThan(firstGoogle)
  })

  it('one clip failing is reported as a failure (not "all uploaded"), carrying what Retry needs', async () => {
    let n = 0
    makeWorld({ drive_upload_file: () => (++n === 4 ? NET : undefined) })
    const { e } = await attempt(() => exportScoutSession(params))
    expect(e.kind).toBe('partial'); expect(e.message).toMatch(/1 of 4 clips could not be uploaded/)
    expect(e.spec).toBeTruthy(); expect(e.localFolder).toMatch(/Downloads/); expect(e.resume).toBeTruthy()
  })

  it('Retry uploads only the clip that failed — no new cut, no new folder', async () => {
    let n = 0
    makeWorld({ drive_upload_file: () => (++n === 4 ? NET : undefined) })
    const { e } = await attempt(() => exportScoutSession(params))
    const w = makeWorld()
    const r = await retryScoutExport({ error: e })
    expect(r.driveLink).toBeTruthy()
    expect(w.calls('drive_upload_file')).toHaveLength(1)
    expect(w.calls('cut_clips')).toHaveLength(0); expect(w.calls('drive_create_export_folder')).toHaveLength(0)
  })
})
