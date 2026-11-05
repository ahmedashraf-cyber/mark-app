// The Self-Review write path now targets the "Collector Self Review" tab of the Mark Field Collected Data spreadsheet.
// Tauri's invoke and fetch are faked; every URL the module calls is recorded and inspected.
import {
  loadCollectorHalves, loadSavedReviews, verifySaveHeader, appendSaveRows, savedRowsForRunId, readHalfState, SAVE_HEADER,
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

console.log('the STRICT full read a lock takeover depends on (readHalfState)')
{
  const real = globalThis.fetch
  const SHORT = `${NEW_ID.slice(0, 6)}…${NEW_ID.slice(-4)}`
  const rowFor = (run, hr, match, half, at = '2026-10-20T10:00:00.000Z') => [run, at, hr, match, half, '50', '4', '2', '2', '0', 'missed', 'Pass', '1:00', '', '', '', '', 0, '']
  const reply = (status, body, extra = {}) => async (url, opts) => { calls.push({ url: String(url), signal: opts?.signal }); return { ok: status >= 200 && status < 300, status, statusText: extra.statusText || '', text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) } }
  const run = async (fetchImpl, o) => { globalThis.fetch = fetchImpl; calls = []; try { return { v: await readHalfState('t-001', 1000001, '1h', o) } } catch (e) { return { e } } finally { globalThis.fetch = real } }
  let r = await run(reply(200, { values: [SELF_REVIEW_HEADER, rowFor('R1', 'T-001', '1000001', '1H'), rowFor('R1', 'T-001', '1000001', '1H'), rowFor('R2', 'T-001', '1000001', '2H'), rowFor('R3', 'T-002', '1000001', '1H'), rowFor('R4', 'T-001', '999', '1H')] }))
  ok('a clean read returns the runs saved for THIS collector, match and half only (case, spaces and a numeric match id are normalised)', r.v && r.v.runs.length === 1 && r.v.runs[0].runId === 'R1' && r.v.rowsRead === 5, J(r))
  ok('it reads the WHOLE columns A:S of the results tab (no row limit), unformatted, with the Bearer token', calls[0].url.includes(`/${NEW_ID}/values/${encodeURIComponent(`'${TAB}'!A:S`)}`) && !/50000/.test(calls[0].url) && /UNFORMATTED_VALUE/.test(calls[0].url) && !calls[0].url.includes(OLD_ID))
  ok('the 17-column legacy header is accepted (read only: nothing is written)', (await run(reply(200, { values: [SELF_REVIEW_HEADER_LEGACY, rowFor('R1', 'T-001', '1000001', '1H')] }))).v?.runs.length === 1)
  ok('a header with trailing blank cells is accepted', (await run(reply(200, { values: [[...SELF_REVIEW_HEADER, '', ''], rowFor('R1', 'T-001', '1000001', '1H')] }))).v?.runs.length === 1)
  const big = [SELF_REVIEW_HEADER, ...Array.from({ length: 60000 }, (_, i) => rowFor(`X${i}`, 'T-009', String(i), '1H')), rowFor('LATE', 'T-001', '1000001', '1H')]
  ok('NO ROW LIMIT: a run at row 60,002 is found (the old reads stopped at 50,000)', (await run(reply(200, { values: big }))).v?.runs[0]?.runId === 'LATE')
  ok('runs come back oldest first', (await run(reply(200, { values: [SELF_REVIEW_HEADER, rowFor('NEW', 'T-001', '1000001', '1H', '2026-10-25T00:00:00.000Z'), rowFor('OLD', 'T-001', '1000001', '1H', '2026-10-20T00:00:00.000Z')] }))).v.runs.map(x => x.runId).join() === 'OLD,NEW')
  ok('a half with no rows returns no runs (that is an answer, not an error)', (await run(reply(200, { values: [SELF_REVIEW_HEADER] }))).v?.runs.length === 0)

  // ---- every way it can fail throws, and says what happened ----
  r = await run(reply(200, { values: [SELF_REVIEW_HEADER.map((h, i) => (i === 4 ? 'half_x' : h))] }))
  ok('HEADER MISMATCH throws and names the tab', /header row is not the one Self-Review writes/.test(r.e?.message) && /Collector Self Review/.test(r.e.message), r.e?.message)
  r = await run(reply(200, { values: [] })); ok('an empty tab throws', /is empty/.test(r.e?.message))
  r = await run(reply(200, {})); ok('no "values" at all throws', /is empty/.test(r.e?.message))
  r = await run(reply(403, { error: { message: 'The caller does not have permission' } }, { statusText: 'Forbidden' }))
  ok('HTTP 403 throws with the status, the action, the tab, the short spreadsheet id and Google\'s own message', /HTTP 403 Forbidden/.test(r.e?.message) && /reading the "Collector Self Review" tab of spreadsheet/.test(r.e.message) && r.e.message.includes(SHORT) && /does not have permission/.test(r.e.message), r.e?.message)
  r = await run(reply(206, { values: [SELF_REVIEW_HEADER] }))
  ok('anything but exactly HTTP 200 is refused, even a "successful" 206', /HTTP 206/.test(r.e?.message), r.e?.message)
  r = await run(reply(502, '<html><head><style>x{}</style></head><body><h1>Bad Gateway</h1><p>The proxy server received an invalid response.</p></body></html>', { statusText: 'Bad Gateway' }))
  ok('an HTML error page (the old "Unexpected token <"): status, tab, spreadsheet, and the readable words of the page, no tags', /HTTP 502 Bad Gateway/.test(r.e?.message) && /Collector Self Review/.test(r.e.message) && r.e.message.includes(SHORT) && /Bad Gateway The proxy server received an invalid response/.test(r.e.message) && !/<h1>|<html>/.test(r.e.message), r.e?.message)
  r = await run(reply(200, '<html>Please sign in</html>'))
  ok('HTTP 200 with a non-JSON body: refused, and says the reply was not JSON', /HTTP 200/.test(r.e?.message) && /not JSON/.test(r.e.message) && /Please sign in/.test(r.e.message), r.e?.message)
  r = await run(reply(200, ''))
  ok('HTTP 200 with an EMPTY body: refused, "(empty reply)"', /not JSON/.test(r.e?.message) && /\(empty reply\)/.test(r.e.message), r.e?.message)
  r = await run(async () => { throw new TypeError('Failed to fetch') })
  ok('a network failure says it could not reach Google Sheets, with the action, the tab and the spreadsheet', /Could not reach Google Sheets while reading the "Collector Self Review" tab of spreadsheet/.test(r.e?.message) && /Failed to fetch/.test(r.e.message), r.e?.message)
  r = await run(async (url, opts) => { calls.push({ url: String(url) }); return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) }, { timeoutMs: 40 })
  ok('NO ANSWER within the timeout: the request is aborted and the error says so (here 0.04 s)', /did not answer within 0\.04 s/.test(r.e?.message) && /reading the "Collector Self Review" tab/.test(r.e.message), r.e?.message)
  r = await run(async (url, opts) => ({ ok: true, status: 200, statusText: '', text: () => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted')))) }), { timeoutMs: 40 })
  ok('headers arrived but the BODY never finishes: also a timeout error, not a hang', /did not answer within|cut off/.test(r.e?.message), r.e?.message)
  const noSend = []; globalThis.fetch = async () => { noSend.push(1); return { ok: true, status: 200, text: async () => JSON.stringify({ values: [SELF_REVIEW_HEADER] }) } }
  await readHalfState('t-001', '1', '1H'); globalThis.fetch = real
  ok('a read sends exactly one request', noSend.length === 1)
}

console.log('the other save-path calls explain themselves too')
{
  const real = globalThis.fetch
  const html = status => async (url) => ({ ok: false, status, statusText: 'Service Unavailable', text: async () => '<!DOCTYPE html><html><body>Service unavailable</body></html>' })
  const msg = async fn => { try { await fn(); return '' } catch (e) { return e.message } }
  globalThis.fetch = html(503)
  let m = await msg(() => verifySaveHeader())
  ok('verifySaveHeader on an HTML error page: status, "reading", the tab and the spreadsheet; no JSON parse error', /HTTP 503 Service Unavailable while reading the "Collector Self Review" tab of spreadsheet/.test(m) && /Service unavailable/.test(m) && !/Unexpected token|JSON/.test(m), m)
  m = await msg(() => appendSaveRows([['x']]))
  ok('appendSaveRows on an HTML error page says "appending to" the tab', /while appending to the "Collector Self Review" tab of spreadsheet/.test(m) && /HTTP 503/.test(m), m)
  m = await msg(() => savedRowsForRunId('R1'))
  ok('savedRowsForRunId explains itself too', /HTTP 503/.test(m) && /Collector Self Review/.test(m), m)
  globalThis.fetch = async () => ({ ok: false, status: 403, statusText: 'Forbidden', json: async () => ({ error: { message: 'The caller does not have permission' } }) })
  m = await msg(() => appendSaveRows([['x']]))
  ok('a JSON error keeps Google\'s message and adds the context (a json()-only reply works too)', /HTTP 403 Forbidden while appending to/.test(m) && /does not have permission/.test(m), m)
  globalThis.fetch = async () => { throw new Error('socket hang up') }
  m = await msg(() => appendSaveRows([['x']]))
  ok('a network failure on append says so, with the target', /Could not reach Google Sheets while appending to the "Collector Self Review" tab/.test(m) && /socket hang up/.test(m), m)
  globalThis.fetch = async (url) => { calls.push({ url: String(url) }); return { ok: true, status: 200, json: async () => ({ values: [['run_id'], ['abc']] }) } }
  calls = []; await savedRowsForRunId('abc')
  ok('the run-id check reads the WHOLE column A (no 50,000-row cap)', /%27!A%3AA|!A%3AA/.test(calls[0].url) && !/50000/.test(calls[0].url), calls[0].url)
  globalThis.fetch = real
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
