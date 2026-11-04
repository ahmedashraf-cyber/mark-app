// The Self-Review write path now targets the "Collector Self Review" tab of the Mark Field Collected Data spreadsheet.
// Tauri's invoke and fetch are faked; every URL the module calls is recorded and inspected.
import {
  loadCollectorHalves, loadSavedReviews, verifySaveHeader, appendSaveRows, savedRowsForRunId, SAVE_HEADER,
} from './selfReviewSheet.js'
import {
  SELF_REVIEW_RESULTS_SPREADSHEET_ID as NEW_ID, SELF_REVIEW_RESULTS_TAB as TAB, SELF_REVIEW_HEADER, SELF_REVIEW_HEADER_LEGACY,
} from '../config/selfReviewDashboardConfig.js'
import { FIELD_SHEET_ID } from '../config/fieldConfig.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + d + ']' : ''}`) }
const OLD_ID = '1XGVp4o7xu8mwPkhEamz-d1aiWYCkkhR-ffTlVQCcsrM'          // the Sampled Halves spreadsheet (and the old save tab)
const encTab = encodeURIComponent(`'${TAB}'`)

globalThis.window = { __TAURI_INTERNALS__: { invoke: async cmd => (cmd === 'get_google_access_token_cmd' ? 'tok' : null) } }
let calls = []
let reply = () => ({})
globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body }); return { ok: true, status: 200, json: async () => reply(String(url), opts) } }
const reset = r => { calls = []; reply = r || (() => ({})) }

console.log('where results live')
ok('the results spreadsheet is the Mark Field Collected Data spreadsheet (FIELD_SHEET_ID)', NEW_ID === FIELD_SHEET_ID)
ok('the tab is "Collector Self Review"', TAB === 'Collector Self Review')
ok('the save header Self-Review writes IS the config header, one definition', SAVE_HEADER === SELF_REVIEW_HEADER)

console.log('reading saved reviews')
{
  const row = (run, at, hr, match, half) => [run, at, hr, match, half, '50', '2', '1', '1', '0', 'matched', 'Pass', '1:00', '1:01', '1', '', '']
  reset(() => ({ values: [SELF_REVIEW_HEADER_LEGACY, row('late', '2026-10-22T10:00:00Z', 'T-001', '5', '1H'), row('early', '2026-10-20T10:00:00Z', 'T-001', '5', '1H'), row('other', '2026-10-20T10:00:00Z', 'T-002', '5', '1H')] }))
  const m = await loadSavedReviews('t-001')
  ok('loadSavedReviews reads the NEW spreadsheet and tab', calls[0].url.includes(`/${NEW_ID}/values/${encTab}`) && !calls[0].url.includes(OLD_ID), calls[0].url)
  ok('...and still keeps the earliest run of a half, own HR-code only (unchanged behaviour)', m.size === 1 && m.get('5_1H')[0][0] === 'early')
}

console.log('the header check and its 17 -> 19 migration')
{
  reset(() => ({ values: [SELF_REVIEW_HEADER] }))
  await verifySaveHeader()
  ok('a 19-column header passes with one read of the NEW spreadsheet and no write', calls.length === 1 && calls[0].method === 'GET' && calls[0].url.includes(`/${NEW_ID}/values/${encTab}`) && !calls.some(c => c.url.includes(OLD_ID)))
  reset(() => ({ values: [SELF_REVIEW_HEADER_LEGACY] }))
  await verifySaveHeader()
  const post = calls.find(c => c.method === 'POST')
  ok('the legacy 17-column header is migrated by writing R1:S1 on the NEW spreadsheet', calls.length === 2 && post && post.url.includes(`/${NEW_ID}/values/${encodeURIComponent(`'${TAB}'!R1:S1`)}`) && JSON.parse(post.body).values[0].join() === 'wrong_event,collector_event', J(calls))
  reset(() => ({ values: [SELF_REVIEW_HEADER.map((h, i) => (i === 4 ? 'half_x' : h))] }))
  let msg = ''; try { await verifySaveHeader() } catch (e) { msg = e.message }
  ok('any other header still fails loudly and nothing is written', /header mismatch/i.test(msg) && !calls.some(c => c.method === 'POST'), msg)
}
function J(x) { return JSON.stringify(x).slice(0, 300) }

console.log('saving and the duplicate check')
{
  reset(() => ({}))
  await appendSaveRows([['r', 'x']])
  ok('appendSaveRows appends to the NEW spreadsheet and tab', calls[0].method === 'POST' && calls[0].url.includes(`/${NEW_ID}/values/${encodeURIComponent(`'${TAB}'!A1`)}:append`) && !calls[0].url.includes(OLD_ID), calls[0].url)
  ok('...with RAW values, inserting rows (unchanged)', /valueInputOption=RAW/.test(calls[0].url) && /insertDataOption=INSERT_ROWS/.test(calls[0].url))
  reset(() => ({ values: [['run_id'], ['abc'], ['def']] }))
  const has = await savedRowsForRunId('def'), not = await savedRowsForRunId('zzz')
  ok('savedRowsForRunId reads the NEW spreadsheet and still answers yes / no', has === true && not === false && calls.every(c => c.url.includes(`/${NEW_ID}/`)) && !calls.some(c => c.url.includes(OLD_ID)))
}

console.log('what did NOT move')
{
  const cell = v => ({ values: [{ formattedValue: v }] })
  reset(() => ({ sheets: [{ data: [{ rowData: [cell('T-001')] }, { rowData: [cell('1')] }, { rowData: [cell('1234567')] }, { rowData: [cell('https://docs.google.com/spreadsheets/d/TRAINERSHEET123/edit')] }] }] }))
  const halves = await loadCollectorHalves('T-001')
  ok('loadCollectorHalves (the Sampled Halves read) still uses the OLD spreadsheet, as before', calls[0].url.includes(`/${OLD_ID}?`) && !calls[0].url.includes(NEW_ID), calls[0].url)
  ok('...and still resolves the trainer sheet from the link', halves.length === 1 && halves[0].half === '1H' && halves[0].sheetId === 'TRAINERSHEET123')
}

console.log('one definition, no scattered literals')
{
  const src = (await import('node:fs')).readFileSync('src/utils/selfReviewSheet.js', 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  ok('the module has no literal tab name and no copy of the 19-column header', !/'Collector Self Review'/.test(code) && !/'run_id','saved_at_iso'/.test(code))
  ok('the old spreadsheet id appears exactly once (the Sampled Halves constant)', (code.match(new RegExp(OLD_ID, 'g')) || []).length === 1)
  ok('no save-tab call is built from the Sampled Halves constant', !/SAMPLED_SHEET_ID\}\/values\/\$\{encodeURIComponent\(`'\$\{SAVE_TAB\}'/.test(code))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
