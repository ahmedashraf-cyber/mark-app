import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { uploadExportToDrive, retryDriveExport, MASTER_FOLDER_ID } from './driveExport'
import { makeWorld, err, NET, QUOTA } from '../test/googleWorld'

// Exports run as the REVIEWER, so a file's owner (and the storage it uses) is the reviewer. These pin
// the rules that matter when it goes wrong: where files go, what a failure says, and that Retry never
// starts over.
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a) => globalThis.__invoke(...a) }))

const spec = (n = 5) => ({
  folderName: 'Match 1 1H',
  sheet: { filePath: 'C:\\x.xlsx', fileName: 'x.xlsx', command: 'upload_xlsx_as_sheet' },
  clips: Array.from({ length: n }, (_, i) => ({ fileName: `clip${i + 1}.mp4`, localPath: `C:\\d\\clip${i + 1}.mp4` })),
})
const attempt = async f => { try { return { v: await f() } } catch (e) { return { e } } }

beforeEach(() => { localStorage.clear(); localStorage.setItem('mark_g_refresh', 'REFRESH') })
afterEach(() => { vi.unstubAllGlobals(); delete globalThis.__invoke })

describe('where the files go', () => {
  it('shared folder accepted: the reviewer token does everything, mark-reporter only READS', async () => {
    const w = makeWorld()
    const r = await uploadExportToDrive({ spec: spec(), invoke: w.invoke })
    expect(r.path).toBe('folder'); expect(r.folderUrl).toMatch(/\/SUB1$/)
    const folder = w.calls('drive_create_export_folder')[0].args
    expect(folder).toMatchObject({ accessToken: 'REVIEWER', parentId: MASTER_FOLDER_ID })
    const uploads = [...w.calls('upload_xlsx_as_sheet'), ...w.calls('drive_upload_file')]
    expect(uploads).toHaveLength(6)
    expect(uploads.every(c => c.args.token === 'REVIEWER' && c.args.parentFolderId === 'SUB1')).toBe(true)
    expect(w.log.some(c => c.args && c.args.token === 'SA')).toBe(false)
    expect(w.calls('SA-READ')).toHaveLength(1)
    expect(w.calls('drive_share_folder')).toHaveLength(0)         // nothing shared per file or per export
  })

  it('shared folder refused: uses the MARK Reviews folder, shares it ONCE with mark-reporter + hudl.com, never "anyone"', async () => {
    const w = makeWorld({ drive_create_export_folder: () => ({ id: 'SUB2', path: 'app_root', root_id: 'ROOT9', fallback_reason: 'HTTP 404' }) })
    const r = await uploadExportToDrive({ spec: spec(2), invoke: w.invoke })
    expect(r.path).toBe('app_root')
    expect(localStorage.getItem('mark_reviews_root_rev@hudl.com')).toBe('ROOT9')
    const share = w.calls('drive_share_folder')
    expect(share).toHaveLength(1)
    expect(share[0].args).toMatchObject({ folderId: 'ROOT9', audienceType: 'domain', audienceValue: 'hudl.com' })
    expect(JSON.stringify(w.log)).not.toContain('anyone')
  })

  it('a second export reuses the remembered folder and does not share again', async () => {
    const first = makeWorld({ drive_create_export_folder: () => ({ id: 'SUB2', path: 'app_root', root_id: 'ROOT9' }) })
    await uploadExportToDrive({ spec: spec(1), invoke: first.invoke })
    const w = makeWorld({ drive_create_export_folder: () => ({ id: 'SUB3', path: 'app_root', root_id: 'ROOT9' }) })
    await uploadExportToDrive({ spec: spec(1), invoke: w.invoke })
    expect(w.calls('drive_create_export_folder')[0].args.rootId).toBe('ROOT9')
    expect(w.calls('drive_share_folder')).toHaveLength(0)
  })

  it('another Google account never reuses this account\'s folder', async () => {
    localStorage.setItem('mark_reviews_root_someone-else@hudl.com', 'THEIRS')
    const w = makeWorld()
    await uploadExportToDrive({ spec: spec(0), invoke: w.invoke })
    expect(w.calls('drive_create_export_folder')[0].args.rootId).toBeNull()
  })
})

describe('failures say what really happened', () => {
  it('storage full: names the account, stops at once, and keeps a record so Retry can continue', async () => {
    const w = makeWorld({ drive_upload_file: a => (a.fileName === 'clip2.mp4' ? QUOTA('rev@hudl.com') : undefined) })
    const { e } = await attempt(() => uploadExportToDrive({ spec: spec(), invoke: w.invoke }))
    expect(e.kind).toBe('quota')
    expect(e.message).toBe("Google storage is full for rev@hudl.com, so the review couldn't be exported. Your review is safe in MARK — tell Fady.")
    expect(w.calls('drive_upload_file').map(c => c.args.fileName)).toEqual(['clip1.mp4', 'clip2.mp4'])   // 3-5 never attempted
    expect(e.resume.clips[0].done).toBe(true)
  })

  it('a real permission refusal gives the exact "tell Fady" text and uploads nothing', async () => {
    const w = makeWorld({ drive_create_export_folder: () => err({ kind: 'permission', status: 403, reason: 'domainPolicy', message: 'blocked', account: 'rev@hudl.com' }) })
    const { e } = await attempt(() => uploadExportToDrive({ spec: spec(3), invoke: w.invoke }))
    expect(e.message).toBe("Google didn't allow this export (domainPolicy). Tell Fady.")
    expect(w.calls('upload_xlsx_as_sheet')).toHaveLength(0)
  })

  it('three network failures in a row stop the loop; no message ever says "give you access" for a non-permission error', async () => {
    const w = makeWorld({ drive_upload_file: () => NET })
    const { e } = await attempt(() => uploadExportToDrive({ spec: spec(8), invoke: w.invoke }))
    expect(e.kind).toBe('partial'); expect(w.calls('drive_upload_file')).toHaveLength(3)
    expect(e.message).not.toMatch(/give you access/i)
  })
})

describe('Retry continues, it never starts over', () => {
  it('uploads ONLY the clip that failed, in the same folder, then re-checks readability', async () => {
    let n = 0
    const w1 = makeWorld({ drive_upload_file: a => (a.fileName === 'clip3.mp4' && ++n === 1 ? NET : undefined) })
    const { e } = await attempt(() => uploadExportToDrive({ spec: spec(5), invoke: w1.invoke }))
    expect(e.kind).toBe('partial'); expect(e.message).toMatch(/^1 of 5 clips could not be uploaded/)
    expect(e.resume.clips.filter(c => c.done)).toHaveLength(4)

    const w2 = makeWorld()
    const r = await retryDriveExport({ error: e, spec: spec(5), invoke: w2.invoke })
    expect(r.folderUrl).toMatch(/\/SUB1$/)
    expect(w2.calls('drive_upload_file').map(c => c.args.fileName)).toEqual(['clip3.mp4'])
    expect(w2.calls('drive_create_export_folder')).toHaveLength(0)
    expect(w2.calls('upload_xlsx_as_sheet')).toHaveLength(0)
    expect(w2.calls('SA-READ')).toHaveLength(1)
  })

  it('sheet uploaded but mark-reporter cannot read it → "unreadable"; Retry re-shares and re-checks, uploads nothing, and keeps the record if still unreadable', async () => {
    const w1 = makeWorld({ drive_create_export_folder: () => ({ id: 'SUB6', path: 'app_root', root_id: 'ROOT6' }), sa: [404, 404, 404] })
    const { e } = await attempt(() => uploadExportToDrive({ spec: spec(2), invoke: w1.invoke }))
    expect(e.kind).toBe('unreadable')
    expect(e.message).toBe("Your review was saved in Google Sheets, but MARK can't read it yet, so collectors can't self-review this half.")

    const w2 = makeWorld({ sa: [200] })
    await retryDriveExport({ error: e, spec: spec(2), invoke: w2.invoke })
    expect(w2.calls('drive_share_folder')).toHaveLength(1)
    expect(['drive_upload_file', 'upload_xlsx_as_sheet', 'drive_create_export_folder'].flatMap(c => w2.calls(c))).toHaveLength(0)

    const w3 = makeWorld({ sa: [404, 404, 404] })
    const again = await attempt(() => retryDriveExport({ error: e, spec: spec(2), invoke: w3.invoke }))
    expect(again.e.kind).toBe('unreadable'); expect(again.e.resume).toBeTruthy()
  }, 20000)
})
