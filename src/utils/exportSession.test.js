import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { exportSessionToUserDrive, shareAndVerify, explainDriveError } from './exportSession'
import { makeWorld, err, QUOTA } from '../test/googleWorld'

// Session History → the "MARK Review" sheet. Created by the REVIEWER so they own it; mark-reporter must
// be able to read it before the export is called done.
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a) => globalThis.__invoke(...a) }))

const Q = {
  session: { matchId: '1420569', half: '1H', matchName: 'Aston Villa vs BSC Young Boys', sessionId: 's1' },
  tags: [{ videoTimeSec: 100, triggeredEventLabel: 'Pass', team: 'home', extras: [] }],
  quality: 90, tagCount: 1, total: 10,
}
const attempt = async f => { try { return { v: await f() } } catch (e) { return { e } } }

beforeEach(() => { localStorage.clear(); localStorage.setItem('mark_g_refresh', 'REFRESH'); localStorage.removeItem('mark_video_path_1420569') })
afterEach(() => { vi.unstubAllGlobals(); delete globalThis.__invoke })

describe('exportSessionToUserDrive', () => {
  it('creates the sheet with the reviewer token in the shared folder, shares it with mark-reporter, then confirms mark-reporter can read A1:Z5', async () => {
    const w = makeWorld()
    const r = await exportSessionToUserDrive(Q)
    expect(r).toMatchObject({ id: 'F1', path: 'folder' })
    const create = w.calls('drive_create_sheet')[0].args
    expect(create.accessToken).toBe('REVIEWER'); expect(create.folderId).toBe('18lGrKFiZwgg3IRJUA59ryBh3TJVWWyn8')
    expect(w.calls('drive_share_sheet')[0].args.accessToken).toBe('REVIEWER')
    expect(w.calls('SA-READ')[0]).toMatchObject({ auth: 'Bearer SA', status: 200 })
    expect(w.calls('SA-READ')[0].url).toMatch(/\/values\/A1:Z5$/)
    expect(JSON.stringify(w.log)).not.toContain('anyone')                       // no "anyone with the link"
  })

  it('folder refused → the sheet lands in the MARK Reviews folder, which is shared (not the file)', async () => {
    const w = makeWorld({ drive_create_sheet: () => ({ id: 'F2', path: 'app_root', root_id: 'R2' }) })
    const r = await exportSessionToUserDrive(Q)
    expect(r.path).toBe('app_root')
    expect(w.calls('drive_share_folder').some(c => c.args.folderId === 'R2')).toBe(true)
    expect(w.calls('drive_share_sheet')).toHaveLength(0)
  })

  it('each failure names its real cause', async () => {
    makeWorld({ drive_create_sheet: () => QUOTA('ahmed@hudl.com') })
    expect((await attempt(() => exportSessionToUserDrive(Q))).e.message).toBe("Google storage is full for ahmed@hudl.com, so the review couldn't be exported. Your review is safe in MARK — tell Fady.")
    makeWorld({ drive_create_sheet: () => err({ kind: 'permission', status: 403, reason: 'domainPolicy', message: 'x' }) })
    expect((await attempt(() => exportSessionToUserDrive(Q))).e.message).toBe("Google didn't allow this export (domainPolicy). Tell Fady.")
    makeWorld({ drive_create_sheet: () => err({ kind: 'other', status: 500, reason: 'backendError', message: 'Backend Error' }) })
    const other = (await attempt(() => exportSessionToUserDrive(Q))).e
    expect(other.message).toMatch(/Backend Error/); expect(other.message).not.toMatch(/give you access/i)
  })

  it('a share that fails AND an unreadable sheet → "unreadable"; Retry re-shares the SAME sheet and never creates another', async () => {
    makeWorld({ drive_share_sheet: () => err({ kind: 'permission', status: 403, reason: 'x', message: 'no' }), sa: [404, 404, 404] })
    const { e } = await attempt(() => exportSessionToUserDrive(Q))
    expect(e.kind).toBe('unreadable'); expect(e.fileId).toBe('F1')
    const w2 = makeWorld({ sa: [200] })
    await expect(shareAndVerify({ fileId: e.fileId, url: e.url, path: e.path, rootId: e.rootId, invoke: w2.invoke })).resolves.toMatchObject({ ok: true })
    expect(w2.calls('drive_create_sheet')).toHaveLength(0)
  }, 20000)

  it('explainDriveError turns a plain (non-JSON) failure into a safe message', () => {
    expect(explainDriveError('boom').message).toBe('The export failed: boom. Your review is safe in MARK.')
  })
})
