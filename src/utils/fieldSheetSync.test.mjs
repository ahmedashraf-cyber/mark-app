// Tests of syncSessionToSheet's re-save path (the hotfix): tab ids by NAME, and the sessions delete by column B.
// Runs the REAL function against a small in-memory fake of the Google Sheets API that enforces the rules that matter:
//   - a deleteDimension on a tab id that does not exist rejects the WHOLE batch (HTTP 400, nothing applied)
//   - a deleteDimension on an id that exists deletes rows in THAT tab, whatever its name is
//   - a range like 'A:A' returns only that column, like the real API
globalThis.window = { __TAURI_INTERNALS__: { invoke: async () => 'test-token' } }      // what @tauri-apps/api's invoke() calls
const { SESSION_COLUMNS, EVENT_COLUMNS, FIELD_SHEET_ID } = await import('../config/fieldConfig.js')
const { syncSessionToSheet } = await import('./fieldSheetSync.js')

let pass = 0, fail = 0, limits = []
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 220) + ']' : ''}`) }
const limit = (n, d) => { console.log(`  ⚠ KNOWN LIMIT ${n}   [${d}]`); limits.push(n) }

// ── the fake ──────────────────────────────────────────────────────────────────────────────────────────────────
const MY_GIDS = { field_sessions: 368480369, field_events: 712488463 }          // the real ids of the owner's spreadsheet
function makeSheet({ extra = {} } = {}) {
  const S = { tabs: { field_sessions: [SESSION_COLUMNS.slice()], field_events: [EVENT_COLUMNS.slice()] }, gids: { ...MY_GIDS }, calls: [], failAppendTab: null, hideTab: null }
  for (const [name, { gid, rows }] of Object.entries(extra)) { S.tabs[name] = rows.map(r => r.slice()); S.gids[name] = gid }
  const colIdx = l => l.toUpperCase().split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url), method = (init.method || 'GET').toUpperCase(), body = init.body ? JSON.parse(init.body) : null
    S.calls.push({ method, path: u.pathname + u.search, body })
    const j = (status, o) => ({ ok: status < 300, status, json: async () => o, text: async () => JSON.stringify(o) })
    if (!u.pathname.includes(FIELD_SHEET_ID)) return j(404, {})
    if (method === 'GET' && !u.pathname.includes('/values/'))                                               // tab list
      return j(200, { sheets: Object.keys(S.tabs).filter(t => t !== S.hideTab).map(t => ({ properties: { sheetId: S.gids[t], title: t } })) })
    if (method === 'GET') {                                                                                   // read a range
      const [tab, r] = decodeURIComponent(u.pathname.split('/values/')[1]).split('!'), rows = S.tabs[tab]
      if (!rows) return j(400, { error: { message: 'Unable to parse range: ' + tab } })
      if (r === '1:1') return j(200, { values: rows.slice(0, 1) })
      const m = /^([A-Z]+):([A-Z]+)$/.exec(r); if (!m) return j(200, { values: rows })
      return j(200, { values: rows.map(x => x.slice(colIdx(m[1]), colIdx(m[2]) + 1)) })
    }
    if (method === 'POST' && u.pathname.includes(':append')) {                                                // append rows
      const tab = decodeURIComponent(u.pathname.split('/values/')[1].split(':append')[0]).split('!')[0]
      if (S.failAppendTab === tab) return j(500, { error: { message: 'network' } })
      S.tabs[tab].push(...body.values.map(r => r.slice())); return j(200, { updates: { updatedRows: body.values.length } })
    }
    if (method === 'POST' && u.pathname.endsWith(':batchUpdate')) {                                           // delete rows
      const byGid = Object.fromEntries(Object.entries(S.gids).map(([t, g]) => [g, t]))
      for (let i = 0; i < body.requests.length; i++) { const id = body.requests[i].deleteDimension.range.sheetId; if (!(id in byGid)) return j(400, { error: { message: `Invalid requests[${i}].deleteDimension: No grid with id: ${id}` } }) }
      for (const r of body.requests) { const g = r.deleteDimension.range; S.tabs[byGid[g.sheetId]].splice(g.startIndex, g.endIndex - g.startIndex) }
      return j(200, {})
    }
    return j(404, {})
  }
  return S
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────
const ev = (sid, seq, code = 'pass') => ({ id: `${sid}_e${seq}`, sessionId: sid, videoTimeSec: seq * 10, video_time_ms: seq * 10000, event_seq: seq, eventId: code, eventLabel: code, groups: [], team: 'home', teamSource: 'user', pair_id: null, pair_status: null, duration_ms: null, closesEventId: null, collectorEmail: 'c@x.com', timestamp: 1700000000000 + seq })
const session = (sid, o = {}) => ({ sessionId: sid, matchId: '1454815', half: '1H', part: 1, collectorHrCode: 'C-77', collectorEmail: 'c@x.com', videoName: 'm.mp4', homeTeamName: 'Arsenal', awayTeamName: 'Chelsea', collectionMethod: 'all', totalEvents: 3, accumulatedMs: 60000, status: 'completed', ...o })
const evs = (sid, n = 3) => Array.from({ length: n }, (_, i) => ev(sid, i + 1))
const rowsOf = (S, tab, sid, col) => S.tabs[tab].slice(1).filter(r => r[col] === sid).length
const sessRows = (S, sid) => rowsOf(S, 'field_sessions', sid, 1), evRows = (S, sid) => rowsOf(S, 'field_events', sid, 0)
const deletes = S => S.calls.filter(c => c.method === 'POST' && c.path.endsWith(':batchUpdate')).flatMap(c => c.body.requests.map(r => r.deleteDimension.range.sheetId))
const attempt = async (S, sid, n = 3) => { try { return { ok: true, r: await syncSessionToSheet(session(sid), evs(sid, n)) } } catch (e) { return { ok: false, err: e.message } } }

console.log('TAB IDS BY NAME (the 3 tests for the tab-id lookup)')
{ // 1. the ids used are the sheet's own
  const S = makeSheet(); const a = await attempt(S, 'S1'); const b = await attempt(S, 'S1')
  ok('1. the owner\'s real tab ids (368480369 / 712488463) are looked up by name and used: a re-save SUCCEEDS', a.ok && b.ok, b.err)
  ok('   ...the delete requests carry exactly those two ids and no literal 0 or 1', [...new Set(deletes(S))].sort().join() === [368480369, 712488463].sort().join(), JSON.stringify([...new Set(deletes(S))]))
  ok('   ...and the half is replaced, not duplicated (1 session row, 3 event rows)', sessRows(S, 'S1') === 1 && evRows(S, 'S1') === 3, `${sessRows(S, 'S1')} / ${evRows(S, 'S1')}`)
}
{ // 2. a missing tab
  const S = makeSheet(); await attempt(S, 'S1'); const before = JSON.stringify(S.tabs); S.calls.length = 0; S.hideTab = 'field_events'
  const b = await attempt(S, 'S1')
  ok('2. a tab that is not in the spreadsheet: a CLEAR error naming the tab, "Nothing was deleted or written"', !b.ok && /Tab "field_events" was not found/.test(b.err) && /Nothing was deleted or written/.test(b.err), b.err)
  ok('   ...and it was caught BEFORE any delete or append (no batchUpdate, no append sent) and the sheet is unchanged', !S.calls.some(c => c.method === 'POST') && JSON.stringify(S.tabs) === before)
}
{ // 3. other tabs that own the numbers 0 and 1
  const S = makeSheet({ extra: { Sheet1: { gid: 0, rows: [['a'], ...Array.from({ length: 10 }, (_, i) => ['keep-' + i])] }, Notes: { gid: 1, rows: [['a'], ...Array.from({ length: 10 }, (_, i) => ['note-' + i])] } } })
  const keep = JSON.stringify([S.tabs.Sheet1, S.tabs.Notes]); await attempt(S, 'S1'); const b = await attempt(S, 'S1')
  ok('3. a spreadsheet that ALSO has tabs with ids 0 and 1 holding data: a re-save never touches them', b.ok && JSON.stringify([S.tabs.Sheet1, S.tabs.Notes]) === keep, b.err)
  ok('   ...and the half is still replaced exactly (1 session row, 3 event rows)', sessRows(S, 'S1') === 1 && evRows(S, 'S1') === 3)
}

console.log('THE SESSIONS DELETE READS COLUMN B')
{ const S = makeSheet(); S.failAppendTab = 'field_events'; const a = await attempt(S, 'S1'); S.failAppendTab = null; const b = await attempt(S, 'S1')
  ok('4. a save whose events write failed, then Retry: ONE session row (it used to leave two)', !a.ok && b.ok && sessRows(S, 'S1') === 1, `${sessRows(S, 'S1')} session rows`)
  ok('   ...and the events are all there, once', evRows(S, 'S1') === 3) }
{ const S = makeSheet(); await attempt(S, 'S1'); const b = await attempt(S, 'S1'); await attempt(S, 'S1')
  ok('5. a half saved three times in a row: still 1 session row, 3 event rows', b.ok && sessRows(S, 'S1') === 1 && evRows(S, 'S1') === 3) }

console.log('REGRESSIONS (what must not change)')
{ const S = makeSheet(); const a = await attempt(S, 'S1')
  ok('6. a FIRST save sends no delete request at all', a.ok && !S.calls.some(c => c.path.endsWith(':batchUpdate')) && sessRows(S, 'S1') === 1 && evRows(S, 'S1') === 3) }
{ const S = makeSheet(); await attempt(S, 'S1', 4); await attempt(S, 'S2', 2); await attempt(S, 'S1b', 3)
  // interleave: put S2's rows between S1's, so S1 is stored in several blocks (scattered)
  const s1 = S.tabs.field_events.filter((r, i) => i > 0 && r[0] === 'S1'), others = S.tabs.field_events.filter((r, i) => i > 0 && r[0] !== 'S1')
  S.tabs.field_events = [EVENT_COLUMNS.slice(), s1[0], others[0], s1[1], s1[2], others[1], others[2], others[3], others[4], s1[3]]
  const b = await attempt(S, 'S1', 2)
  ok('7. a half stored in SEVERAL blocks is replaced exactly: its 2 new rows, every other session untouched', b.ok && evRows(S, 'S1') === 2 && evRows(S, 'S2') === 2 && evRows(S, 'S1b') === 3, `${evRows(S, 'S1')}/${evRows(S, 'S2')}/${evRows(S, 'S1b')}`)
  ok('   ...and the other sessions\' session rows are untouched', sessRows(S, 'S2') === 1 && sessRows(S, 'S1b') === 1) }
{ const S = makeSheet(); await attempt(S, 'S1'); S.calls.length = 0; await attempt(S, 'S1')
  ok('8. the validation of the headers still happens first (the header read is the first request)', /values\/field_sessions!1%3A1|values\/field_sessions!1:1/.test(decodeURIComponent(S.calls[0].path)) || /1:1/.test(decodeURIComponent(S.calls[0].path)), S.calls[0].path) }

console.log('WHAT THIS HOTFIX DOES NOT CHANGE (stated, not hidden)')
{ const S = makeSheet(); await attempt(S, 'S1'); S.failAppendTab = 'field_events'; const b = await attempt(S, 'S1')
  if (!b.ok && evRows(S, 'S1') === 0) limit('the re-save is still delete-then-append in separate requests: if the events write fails after the delete, the OLD event rows are already gone from the sheet', 'the new atomic save path for reopened halves does not have this limit') }

console.log(`\n${pass} passed, ${fail} failed${limits.length ? `, ${limits.length} KNOWN LIMIT` : ''}`); process.exit(fail ? 1 : 0)
