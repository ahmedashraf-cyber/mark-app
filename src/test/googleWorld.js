// A fake Google + Tauri for the export tests: records every command, serves canned answers, and lets a
// test make one command fail with exactly the JSON error string the Rust side produces.
import { vi } from 'vitest'

export const err = o => new Error(JSON.stringify(o))      // a rejection carrying Rust's structured error
export const NET = err({ kind: 'network', status: 0, reason: '', message: 'upload failed: connection reset' })
export const QUOTA = account => err({ kind: 'quota', status: 403, reason: 'storageQuotaExceeded', message: 'q', account })

export function makeWorld(rules = {}) {
  const log = []
  let saReads = 0
  const sa = rules.sa || [200]
  const invoke = async (cmd, args) => {
    log.push({ cmd, args })
    const hook = rules[cmd]
    if (hook) { const r = hook(args, log); if (r instanceof Error) throw r.message; if (r !== undefined) return r }
    switch (cmd) {
      case 'google_oauth_refresh': return { access_token: 'REVIEWER' }
      case 'get_google_access_token_cmd': return 'SA'
      case 'drive_create_export_folder': return { id: 'SUB1', path: 'folder' }
      case 'drive_create_sheet': return { id: 'F1', webViewLink: 'https://docs.google.com/spreadsheets/d/F1', path: 'folder' }
      case 'upload_xlsx_as_sheet': case 'upload_csv_as_sheet': return 'https://docs.google.com/spreadsheets/d/SHEET1/edit?usp=drivesdk'
      case 'drive_upload_file': return 'https://drive.google.com/file/d/x/view'
      case 'drive_share_folder': return { sa_shared: true, audience_shared: true, errors: [] }
      case 'drive_share_sheet': return {}
      case 'pick_video_file': return 'C:\\v\\match.mp4'
      case 'get_userprofile': return 'C:\\Users\\rev'
      case 'save_binary_file': case 'save_xlsx_file': case 'save_text_file': return null
      case 'cut_clips': return args.clips.map(c => c.name)
      default: throw new Error('unexpected invoke ' + cmd)
    }
  }
  globalThis.__invoke = invoke
  vi.stubGlobal('fetch', vi.fn(async (url, o) => {
    if (String(url).includes('oauth2/v3/userinfo')) return { json: async () => ({ email: 'rev@hudl.com' }) }
    const status = sa[Math.min(saReads++, sa.length - 1)]
    log.push({ cmd: 'SA-READ', url: String(url), auth: o.headers.Authorization, status })
    return { status, text: async () => 'detail' }
  }))
  const calls = c => log.filter(x => x.cmd === c)
  return { log, calls, invoke }
}
