// Tests of savedHalfSheet.js against an in-memory Google Sheets. Real code under test; the fake enforces the API's rules:
//   a batchUpdate is APPLIED ENTIRELY OR NOT AT ALL (validated first), a missing tab id rejects the whole batch,
//   values come back as strings, a range like 'A:A' returns only that column.
globalThis.window = { __TAURI_INTERNALS__: { invoke: async () => 'test-token' } }
const { SESSION_COLUMNS, EVENT_COLUMNS, FIELD_SHEET_ID } = await import('../config/fieldConfig.js')
const { SCORES_COLUMNS } = await import('../config/comparisonConfig.js')
const { EDIT_LOG_HEADER, EDIT_LOG_TAB } = await import('./sessionEdit.js')
const { syncSessionToSheet, buildEventRows } = await import('./fieldSheetSync.js')
const H = await import('./savedHalfSheet.js')
const G = await import('./writeGuard.js')
const SS = await import('./sessionScores.js')

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 240) + ']' : ''}`) }
const J = JSON.stringify
const colIdx = l => l.toUpperCase().split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
const MY = { field_sessions: 368480369, field_events: 712488463, scores: 991, session_edits: 992 }

function makeSheet({ noEditLog = false, extra = {} } = {}) {
  const S = { tabs: { field_sessions: [SESSION_COLUMNS.slice()], field_events: [EVENT_COLUMNS.slice()], scores: [SCORES_COLUMNS.slice()] }, gids: { field_sessions: MY.field_sessions, field_events: MY.field_events, scores: MY.scores },
    calls: [], failScores: 0, failBatch: 0, loseResponse: 0, beforeBatch: null, hide: null, nextGid: 5000 }
  if (!noEditLog) { S.tabs[EDIT_LOG_TAB] = [EDIT_LOG_HEADER.slice()]; S.gids[EDIT_LOG_TAB] = MY.session_edits }
  for (const [name, { gid, rows }] of Object.entries(extra)) { S.tabs[name] = rows.map(r => r.slice()); S.gids[name] = gid }
  const str = v => v == null || v === '' ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v)
  const cellVal = c => !c || !c.userEnteredValue ? '' : 'stringValue' in c.userEnteredValue ? c.userEnteredValue.stringValue : 'numberValue' in c.userEnteredValue ? c.userEnteredValue.numberValue : c.userEnteredValue.boolValue
  const readRange = (tab, r) => {
    const rows = S.tabs[tab]; if (!rows) throw Object.assign(new Error('Unable to parse range: ' + tab), { code: 400 })
    if (r === '1:1') return rows.slice(0, 1).map(x => x.map(str))
    const m = /^([A-Z]+):([A-Z]+)$/.exec(r); if (!m) return rows.map(x => x.map(str))
    return rows.map(x => [str(x[colIdx(m[1])])].concat(m[2] === m[1] ? [] : x.slice(colIdx(m[1]) + 1, colIdx(m[2]) + 1).map(str))).map((x, i) => m[1] === m[2] ? [str(rows[i][colIdx(m[1])])] : x)
  }
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url), method = (init.method || 'GET').toUpperCase(), body = init.body ? JSON.parse(init.body) : null
    const rec = { method, path: decodeURIComponent(u.pathname + u.search), body }; S.calls.push(rec)
    const j = (status, o) => ({ ok: status < 300, status, json: async () => o, text: async () => JSON.stringify(o) })
    if (!u.pathname.includes(FIELD_SHEET_ID)) return j(404, {})
    try {
      if (method === 'GET' && !u.pathname.includes('/values')) return j(200, { sheets: Object.keys(S.tabs).filter(t => t !== S.hide).map(t => ({ properties: { sheetId: S.gids[t], title: t } })) })
      if (method === 'GET' && u.pathname.includes('/values:batchGet')) {
        const ranges = u.searchParams.getAll('ranges')
        if (S.failScores && ranges.some(r => r.startsWith('scores!'))) { S.failScores--; return j(429, { error: { message: 'Quota exceeded for quota metric Read requests' } }) }
        return j(200, { valueRanges: ranges.map(r => { const [t, rg] = r.split('!'); return { values: readRange(t, rg) } }) })
      }
      if (method === 'GET') { const [t, rg] = decodeURIComponent(u.pathname.split('/values/')[1]).split('!'); return j(200, { values: readRange(t, rg) }) }
      if (method === 'PUT') { const [t] = decodeURIComponent(u.pathname.split('/values/')[1]).split('!'); S.tabs[t] = body.values.map(r => r.slice()); return j(200, {}) }
      if (method === 'POST' && u.pathname.includes(':append')) { const t = decodeURIComponent(u.pathname.split('/values/')[1].split(':append')[0]).split('!')[0]; S.tabs[t].push(...body.values.map(r => r.slice())); return j(200, { updates: { updatedRows: body.values.length } }) }
      if (method === 'POST' && u.pathname.endsWith(':batchUpdate')) {
        if (S.beforeBatch) { const f = S.beforeBatch; S.beforeBatch = null; f(S) }
        if (S.failBatch) { S.failBatch--; return j(500, { error: { message: 'Internal error' } }) }
        const byGid = Object.fromEntries(Object.entries(S.gids).map(([t, g]) => [g, t]))
        // VALIDATE EVERYTHING FIRST: one bad request rejects the whole batch and nothing is applied
        for (let i = 0; i < body.requests.length; i++) {
          const r = body.requests[i], id = (r.deleteDimension?.range || r.appendCells || r.updateCells?.start || {}).sheetId
          if (!r.addSheet && !(id in byGid)) return j(400, { error: { message: `Invalid requests[${i}]: No grid with id: ${id}` } })
        }
        for (const r of body.requests) {
          if (r.addSheet) { const t = r.addSheet.properties.title; S.tabs[t] = []; S.gids[t] = S.nextGid++ }
          else if (r.deleteDimension) { const g = r.deleteDimension.range; S.tabs[byGid[g.sheetId]].splice(g.startIndex, g.endIndex - g.startIndex) }
          else if (r.appendCells) S.tabs[byGid[r.appendCells.sheetId]].push(...r.appendCells.rows.map(row => row.values.map(cellVal)))
          else if (r.updateCells) { const st = r.updateCells.start, row = S.tabs[byGid[st.sheetId]][st.rowIndex]; r.updateCells.rows[0].values.forEach((c, k) => { row[st.columnIndex + k] = cellVal(c) }) }
        }
        if (S.loseResponse) { S.loseResponse--; throw new TypeError('network connection lost') }       // APPLIED, but the answer never arrives
        return j(200, {})
      }
    } catch (e) { if (e instanceof TypeError) throw e; return j(e.code || 500, { error: { message: e.message } }) }
    return j(404, {})
  }
  return S
}

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────
const SID = 'field_u1_abc_1700000000000'
const ev = (sid, seq, code = 'pass', t) => ({ id: `${sid}_e${seq}`, sessionId: sid, videoTimeSec: t ?? seq * 10, video_time_ms: (t ?? seq * 10) * 1000, event_seq: seq, eventId: code, eventLabel: code, groups: [], team: seq % 2 ? 'home' : 'away', teamSource: 'user', pair_id: null, pair_status: null, duration_ms: null, closesEventId: null, collectorEmail: 'c@x.com', timestamp: 1700000000000 + seq })
const sess = (sid = SID, o = {}) => ({ sessionId: sid, matchId: '1454815', half: '1H', part: 1, collectorHrCode: 'C-77', collectorEmail: 'c@x.com', videoName: 'm.mp4', videoSizeBytes: 1000, videoDurationMs: 2700000, homeTeamName: 'Arsenal', awayTeamName: 'Chelsea', collectionMethod: 'all', totalEvents: 3, accumulatedMs: 60000, collectionStartWallMs: 1700000000000, collectionEndWallMs: 1700000060000, eventsPerMinute: '3.00', status: 'completed', ...o })
const evs = (sid = SID, n = 3) => Array.from({ length: n }, (_, i) => ev(sid, i + 1))
const col = (S, tab, name, cols) => S.tabs[tab].slice(1).map(r => r[cols.indexOf(name)])
const evIds = (S, sid) => S.tabs.field_events.slice(1).filter(r => r[0] === sid).map(r => r[EVENT_COLUMNS.indexOf('event_seq')]).map(String)
const sessRows = (S, sid) => S.tabs.field_sessions.slice(1).filter(r => r[1] === sid)
const snap = S => J([S.tabs, S.gids])
async function saved(S, sid = SID, n = 3) { await syncSessionToSheet(sess(sid), evs(sid, n)) }
async function open(S, sid = SID) { return { fingerprint: await H.readFingerprint(sid) } }
const edited = (sid = SID) => [ev(sid, 1), { ...ev(sid, 2), eventId: 'tackle', eventLabel: 'tackle' }, ev(sid, 4, 'pass', 44)]          // 1 same, 2 changed, 3 deleted, 4 added
const trySave = async (args) => { try { return { ok: true, r: await H.saveEditedHalf(args) } } catch (e) { return { ok: false, e } } }
const SAVE = (opened, extra = {}) => ({ session: sess(SID, { accumulatedMs: 90000, collectionEndWallMs: 1700000090000, totalEvents: 3 }), events: edited(), opened, editorEmail: 'c@x.com', saveToken: 'tok-1', ...extra })

console.log('rangesBottomUp (pure)')
ok('consecutive rows merge, last range first', J(H.rangesBottomUp([2, 3, 4, 9, 10, 15])) === J([[15, 15], [9, 10], [2, 4]]))
ok('unsorted and duplicate rows are handled (9 and 10 are consecutive, so they merge)', J(H.rangesBottomUp([10, 2, 3, 3, 9])) === J([[9, 10], [2, 3]]))

console.log('THE LOCK: isHalfCompared(sessionId)')
{ const S = makeSheet(); await saved(S)
  ok('no score row for the session: not compared', (await H.isHalfCompared(SID)) === false)
  const row = SCORES_COLUMNS.map(() => ''); row[SCORES_COLUMNS.indexOf('run_id')] = 'r1'; row[SCORES_COLUMNS.indexOf('run_timestamp_iso')] = '2026-10-30T10:00:00.000Z'; row[SCORES_COLUMNS.indexOf('collector_session_id')] = SID
  S.tabs.scores.push(row)
  ok('one score row whose collector_session_id equals the session id: COMPARED', (await H.isHalfCompared(SID)) === true)
  const info = await H.readComparedInfo(SID); ok('...and the date of the comparison is read for the banner', info.compared && info.comparedAtIso === '2026-10-30T10:00:00.000Z', J(info))
  ok('a score row for ANOTHER session does not count', (await H.isHalfCompared('some_other_session')) === false)
  ok('matching is by session_id only, never by match or HR-code (same match and HR, different session id: not compared)', (await H.isHalfCompared(SID + 'x')) === false)
  ok('the read is FRESH every time: a run added after the last call is seen at once', await (async () => { const s2 = makeSheet(); await saved(s2); const a = await H.isHalfCompared(SID); const r2 = SCORES_COLUMNS.map(() => ''); r2[SCORES_COLUMNS.indexOf('collector_session_id')] = SID; s2.tabs.scores.push(r2); return a === false && (await H.isHalfCompared(SID)) === true })())
  ok('only the collector_session_id column (and the run time) is read, never the whole scores tab', S.calls.filter(c => c.path.includes('scores')).every(c => /scores!(I:I|B:B)/.test(c.path)) && !S.calls.some(c => /scores!A:ZZ|scores!A:/.test(c.path)))
}
{ const S = makeSheet(); await saved(S)
  // 10. a STALE run still counts: the match id was edited after the run, so Admin calls the score stale; the half stays locked
  const row = SCORES_COLUMNS.map(() => ''); row[SCORES_COLUMNS.indexOf('run_id')] = 'r1'; row[SCORES_COLUMNS.indexOf('run_timestamp_iso')] = '2026-10-30T10:00:00.000Z'; row[SCORES_COLUMNS.indexOf('collector_session_id')] = SID; S.tabs.scores.push(row)
  S.tabs[EDIT_LOG_TAB].push(['2026-10-31T09:00:00.000Z', 'admin@x.com', SID, 'C-77', 'match_id', '1454815', '1454816', 1, 'APPLIED', 'fixed typo'])
  const runIndex = SS.buildRunIndex(S.tabs.scores.map(r => r.map(String))), editIdx = SS.buildEditIndex(S.tabs[EDIT_LOG_TAB].map(r => r.map(String)))
  const stale = SS.isRunStale(runIndex.get(SID)[0], editIdx.get(SID))
  ok('10. the Admin code itself calls this score STALE (a match_id edit after the run)...', stale === true)
  ok('    ...and the half is STILL compared, so editing the match id can never unlock it', (await H.isHalfCompared(SID)) === true)
}
console.log('the lock FAILS CLOSED')
{ const S = makeSheet(); await saved(S); S.failScores = 1
  let e; try { await H.isHalfCompared(SID) } catch (x) { e = x }
  ok('11. the scores read fails (quota): it THROWS with the real reason, it does not answer "not compared"', e instanceof H.SavedHalfError && e.kind === 'unreadable' && /429/.test(e.message) && /Quota exceeded/.test(e.message), e?.message)
  const S2 = makeSheet(); S2.tabs.scores[0][SCORES_COLUMNS.indexOf('collector_session_id')] = 'something_else'
  let e2; try { await H.isHalfCompared(SID) } catch (x) { e2 = x }
  ok('    a scores tab whose column I is not collector_session_id: refused with that reason', e2 instanceof H.SavedHalfError && /not collector_session_id/.test(e2.message), e2?.message)
}

console.log('FINDING THE HALF')
{ const S = makeSheet(); await saved(S, 'sA'); await saved(S, 'sB')
  const mk = (sid, o) => { const r = SESSION_COLUMNS.map(() => ''); const set = (k, v) => { r[SESSION_COLUMNS.indexOf(k)] = v }; set('session_id', sid); set('match_id', '1454815'); set('half', '1H'); set('collector_hr_code', 'C-77'); set('is_model', '0'); Object.entries(o).forEach(([k, v]) => set(k, v)); return r }
  S.tabs.field_sessions.push(mk('other_collector', { collector_hr_code: 'C-99' }), mk('other_half', { half: '2H' }), mk('other_match', { match_id: '999' }), mk('model_one', { is_model: '1', collector_hr_code: 'C-77' }),
    mk('dashy', { collector_hr_code: 'c\u201377' }), mk('spaced', { collector_hr_code: ' C-77 ' }), mk('old_row_no_part', { half: '1HH', part: '' }))
  const got = (await H.findSavedHalves({ matchId: '1454815', half: '1H', hrCode: 'C-77' })).map(h => h.sessionId).sort()
  ok('7. only THIS collector\'s halves of THIS match and half: sA, sB, and the spelling variants (en dash + lower case, stray spaces, an old "1HH" row with no part)', J(got) === J(['dashy', 'old_row_no_part', 'sA', 'sB', 'spaced']), J(got))
  ok('   another collector\'s half is never offered; neither is another half, another match, or a model answer', !got.includes('other_collector') && !got.includes('other_half') && !got.includes('other_match') && !got.includes('model_one'))
  ok('   a typed code that is not the login code finds nothing of the owner\'s', (await H.findSavedHalves({ matchId: '1454815', half: '1H', hrCode: 'C-99' })).map(h => h.sessionId).join() === 'other_collector')
  ok('   no HR-code, no match, or no half: nothing', (await H.findSavedHalves({ matchId: '1454815', half: '1H', hrCode: '' })).length === 0 && (await H.findSavedHalves({ matchId: '', half: '1H', hrCode: 'C-77' })).length === 0)
  S.tabs.field_sessions.push(S.tabs.field_sessions[1].slice())          // sA stored twice (the old Retry defect)
  const again = await H.findSavedHalves({ matchId: '1454815', half: '1H', hrCode: 'C-77' }); const a = again.find(h => h.sessionId === 'sA')
  ok('   a session stored twice is listed ONCE, flagged with its duplicate rows', again.filter(h => h.sessionId === 'sA').length === 1 && a.duplicateRows === 2 && a.rowNumbers.length === 2, J(a))
  const d = await H.describeSavedHalves(again); ok('   the list also gets the event count (column A of field_events) and the compared status', d.counts.get('sA') === 3 && d.runs instanceof Map && !d.countsError, J([...d.counts]))
}

console.log('SAVING AN EDITED HALF (one atomic batch)')
{ const S = makeSheet(); await saved(S); await saved(S, 'OTHER', 2)
  const otherBefore = J([S.tabs.field_events.filter(r => r[0] === 'OTHER'), S.tabs.field_sessions.filter(r => r[1] === 'OTHER')])
  const startBefore = sessRows(S, SID)[0][SESSION_COLUMNS.indexOf('collection_start_wall_iso')], videoBefore = sessRows(S, SID)[0][SESSION_COLUMNS.indexOf('video_filename')], exportBefore = sessRows(S, SID)[0][SESSION_COLUMNS.indexOf('export_date')]
  const opened = await open(S); const before = S.tabs.field_events.length
  const r = await trySave(SAVE(opened))
  ok('2. edit one, add one, delete one, save: it succeeds', r.ok, r.e?.message)
  ok('   field_events now has EXACTLY the new set under the same session_id (event_seq 1, 2, 4), nothing else of this session', J(evIds(S, SID).sort()) === J(['1', '2', '4']), J(evIds(S, SID)))
  ok('   the changed event carries its new code, the new one its time, and there is no copy of the deleted one', S.tabs.field_events.some(r => r[0] === SID && r[EVENT_COLUMNS.indexOf('event_code')] === 'tackle') && !evIds(S, SID).includes('3'))
  ok('   field_sessions still has exactly ONE row for it (same row, no second copy)', sessRows(S, SID).length === 1 && S.tabs.field_sessions.length === 3)
  const row = sessRows(S, SID)[0], c = n => row[SESSION_COLUMNS.indexOf(n)]
  ok('   the collection END and the active time are updated (old + new, as passed: 90000); the original START is kept', String(c('collection_elapsed_raw_ms')) === '90000' && c('collection_start_wall_iso') === startBefore && c('collection_end_wall_iso') === new Date(1700000090000).toISOString(), J([c('collection_elapsed_raw_ms'), c('collection_start_wall_iso'), c('collection_end_wall_iso')]))
  ok('   the speed is events per minute of that active time: 3 events in 1.5 minutes = 2.00 (not derived from the wall-clock gap)', String(c('collection_events_per_min')) === '2.00', c('collection_events_per_min'))
  ok('   video, match, half, HR-code, saved date: untouched on the row', c('video_filename') === videoBefore && c('match_id') === '1454815' && c('half') === '1H' && c('collector_hr_code') === 'C-77' && c('export_date') === exportBefore)
  ok('   another session\'s rows are exactly as they were', J([S.tabs.field_events.filter(r => r[0] === 'OTHER'), S.tabs.field_sessions.filter(r => r[1] === 'OTHER')]) === otherBefore)
  ok('   NO new column on either tab', S.tabs.field_events[0].length === EVENT_COLUMNS.length && S.tabs.field_sessions[0].length === SESSION_COLUMNS.length)
  const log = S.tabs[EDIT_LOG_TAB].slice(1).at(-1), L = n => log[EDIT_LOG_HEADER.indexOf(n)]
  ok('   one log row in session_edits: who, when, session_id, field "events", old 3, new 3, APPLIED, "edited by collector"', S.tabs[EDIT_LOG_TAB].length === 2 && L('changed_by') === 'c@x.com' && L('session_id') === SID && L('field') === 'events' && String(L('old_value')) === '3' && String(L('new_value')) === '3' && L('status') === 'APPLIED' && /edited by collector/.test(L('note')) && !Number.isNaN(Date.parse(L('timestamp_iso'))), J(log))
  const batches = S.calls.filter(c => c.path.endsWith(':batchUpdate') && c.body.requests.some(q => q.appendCells || q.deleteDimension))
  ok('   it was ONE batchUpdate (atomic), carrying the delete, the append, the cell updates and the log', batches.length === 1 && batches[0].body.requests.some(q => q.deleteDimension) && batches[0].body.requests.filter(q => q.appendCells).length === 2 && batches[0].body.requests.some(q => q.updateCells))
  ok('   the tab ids used are the sheet\'s own (looked up by name), never a literal 0 or 1', batches[0].body.requests.every(q => { const id = (q.deleteDimension?.range || q.appendCells || q.updateCells?.start).sheetId; return Object.values(MY).includes(id) }))
  ok('   the result carries the fingerprint READ BACK from the sheet, and it verified', r.r.verified === true && r.r.fingerprint.eventRows === 3, J(r.r))
  const again = await trySave(SAVE({ fingerprint: r.r.fingerprint }, { saveToken: 'tok-2', events: [...edited(), ev(SID, 5, 'pass', 55)] }))
  ok('   a SECOND save from the same window, with the returned fingerprint, works (old 3, new 4)', again.ok && evIds(S, SID).length === 4 && String(S.tabs[EDIT_LOG_TAB].at(-1)[EDIT_LOG_HEADER.indexOf('old_value')]) === '3' && String(S.tabs[EDIT_LOG_TAB].at(-1)[EDIT_LOG_HEADER.indexOf('new_value')]) === '4', again.e?.message)
}
{ const S = makeSheet(); await saved(S)   // scattered rows
  const mine = S.tabs.field_events.filter((r, i) => i > 0 && r[0] === SID); await saved(S, 'B', 2); await saved(S, 'C', 2)
  const others = S.tabs.field_events.filter((r, i) => i > 0 && r[0] !== SID)
  S.tabs.field_events = [EVENT_COLUMNS.slice(), mine[0], others[0], mine[1], others[1], others[2], mine[2], others[3]]
  const o = await open(S); const r = await trySave(SAVE(o))
  ok('   events scattered in SEVERAL blocks are all replaced, and the other sessions\' rows are all still there', r.ok && J(evIds(S, SID).sort()) === J(['1', '2', '4']) && evIds(S, 'B').length === 2 && evIds(S, 'C').length === 2, r.e?.message + ' ' + J(evIds(S, SID)))
}

console.log('FAILURES: nothing changes')
{ const S = makeSheet(); await saved(S); const o = await open(S); const before = snap(S); S.failBatch = 1
  const a = await trySave(SAVE(o))
  ok('3. the write fails (HTTP 500): refused as a write error, and the sheet is EXACTLY as it was (events, session row, log)', !a.ok && a.e.kind === 'write' && /Nothing was changed/.test(a.e.message) && snap(S) === before, a.e?.message)
  const b = await trySave(SAVE(o))
  ok('   Retry (same edit) then succeeds, once', b.ok && evIds(S, SID).length === 3 && S.tabs[EDIT_LOG_TAB].length === 2)
}
{ const S = makeSheet(); await saved(S); const o = await open(S)
  const a0 = await H.saveEditedHalf(SAVE(o)).then(() => null, e => e)    // first window saves
  const S2 = makeSheet(); await saved(S2); const o2 = await open(S2)
  await H.saveEditedHalf(SAVE(o2))                                       // window A saves
  const before = snap(S2)
  const b = await trySave(SAVE(o2, { saveToken: 'tok-B', events: [ev(SID, 1), ev(SID, 9, 'pass', 99)] }))   // window B still holds the OLD fingerprint
  ok('4. two windows on the same half: the SECOND save is refused ("changed"), and the sheet is untouched by it', !b.ok && b.e.kind === 'changed' && /saved by someone else|another window/.test(b.e.message) && snap(S2) === before, b.e?.message)
}
{ const S = makeSheet(); await saved(S); const o = await open(S)
  const row = SCORES_COLUMNS.map(() => ''); row[SCORES_COLUMNS.indexOf('collector_session_id')] = SID; S.tabs.scores.push(row)
  const before = snap(S); const a = await trySave(SAVE(o))
  ok('6. a COMPARED half: a forced save by its session id is refused ("compared"), nothing written', !a.ok && a.e.kind === 'compared' && snap(S) === before, a.e?.message)
  ok('9. the reviewer compared WHILE the collector had it open: the refusal reads "A reviewer compared this half while you were editing. It is now locked. Your changes were not saved."', a.e?.message === 'A reviewer compared this half while you were editing. It is now locked. Your changes were not saved.', a.e?.message)
  ok('   the sheets are unchanged (field_events, field_sessions, scores, session_edits)', snap(S) === before)
}
{ const S = makeSheet(); await saved(S); const o = await open(S); S.beforeBatch = null
  // a comparison lands BETWEEN the lock check and the write: the fresh check at save time cannot see the future, so the guarantee is the check itself, made immediately before
  const before = snap(S); S.failScores = 1; const a = await trySave(SAVE(o))
  ok('11. scores unreadable at SAVE time: refused with the real reason (HTTP 429, quota), and nothing is written', !a.ok && a.e.kind === 'unreadable' && /429/.test(a.e.message) && snap(S) === before, a.e?.message)
  const b = await trySave(SAVE(o)); ok('    Retry once the scores can be read: saves', b.ok)
}
{ const S = makeSheet(); await saved(S); const o = await open(S); const before = snap(S)
  const a = await trySave(SAVE(o, { events: [] }))
  ok('   saving a half with NO events is refused (it would wipe it), nothing written', !a.ok && a.e.kind === 'empty' && snap(S) === before)
}
{ const S = makeSheet(); await saved(S); const o = await open(S); S.tabs.field_sessions.push(S.tabs.field_sessions[1].slice()); const before = snap(S)
  const a = await trySave(SAVE(o))
  ok('   a half stored TWICE in field_sessions (the old Retry defect) is refused with the row numbers, nothing written', !a.ok && a.e.kind === 'duplicate_rows' && /rows 2, 3/.test(a.e.message) && snap(S) === before, a.e?.message)
}
{ const S = makeSheet(); const a = await trySave(SAVE({ fingerprint: { sessionRows: [], endIso: '', elapsedMs: '', eventRows: 0 } }))
  ok('   a half that is not in the sheet: refused ("missing")', !a.ok && a.e.kind === 'missing') }

console.log('A TIMEOUT: unsure whether the batch applied')
{ const S = makeSheet(); await saved(S); const o = await open(S); S.loseResponse = 1
  const a = await trySave(SAVE(o, { saveToken: 'tok-X' }))
  ok('16. the batch is APPLIED but the answer is lost: MARK says it cannot confirm, and to press Retry', !a.ok && a.e.kind === 'unsure' && /Retry/.test(a.e.message), a.e?.message)
  const afterFirst = J(S.tabs.field_events.filter(r => r[0] === SID)), logRows = S.tabs[EDIT_LOG_TAB].length
  ok('    the sheet really did change (so a naive retry would have saved twice)', evIds(S, SID).sort().join() === '1,2,4' && logRows === 2)
  const b = await trySave(SAVE(o, { saveToken: 'tok-X' }))
  ok('    Retry with the same token is recognised as "already saved": no second write', b.ok && b.r.alreadySaved === true && J(S.tabs.field_events.filter(r => r[0] === SID)) === afterFirst && S.tabs[EDIT_LOG_TAB].length === 2)
  ok('    events are NOT duplicated (still 3 rows), and there is still exactly one log row', evIds(S, SID).length === 3 && S.tabs[EDIT_LOG_TAB].length === 2)
}

console.log('TAB IDS')
{ const S = makeSheet(); await saved(S); const o = await open(S); S.hide = 'field_events'; const before = snap(S); S.calls.length = 0
  const a = await trySave(SAVE(o))
  ok('17. a tab missing from the spreadsheet is caught BEFORE any delete: a clear error naming it, nothing sent that writes', !a.ok && a.e.kind === 'tabs' && /Tab "field_events" was not found/.test(a.e.message) && !S.calls.some(c => c.path.endsWith(':batchUpdate')) && snap(S) === before, a.e?.message) }
{ const S = makeSheet({ extra: { Sheet1: { gid: 0, rows: [['a'], ...Array.from({ length: 6 }, (_, i) => ['keep' + i])] }, Notes: { gid: 1, rows: [['a'], ...Array.from({ length: 6 }, (_, i) => ['note' + i])] } } }); await saved(S); const o = await open(S); const keep = J([S.tabs.Sheet1, S.tabs.Notes])
  const a = await trySave(SAVE(o))
  ok('17. other tabs that own the ids 0 and 1 are never touched by a save', a.ok && J([S.tabs.Sheet1, S.tabs.Notes]) === keep, a.e?.message) }
{ const S = makeSheet({ noEditLog: true }); await saved(S); const o = await open(S); const a = await trySave(SAVE(o))
  ok('    a spreadsheet with no session_edits tab yet: it is created with its header, and the log row is written there', a.ok && S.tabs[EDIT_LOG_TAB][0].join() === EDIT_LOG_HEADER.join() && S.tabs[EDIT_LOG_TAB].length === 2, a.e?.message) }

console.log('THE LOG ROW AND ADMIN')
{ const S = makeSheet(); await saved(S); const o = await open(S); await trySave(SAVE(o))
  const runRow = SCORES_COLUMNS.map(() => ''); runRow[SCORES_COLUMNS.indexOf('collector_session_id')] = SID; runRow[SCORES_COLUMNS.indexOf('run_id')] = 'r9'; runRow[SCORES_COLUMNS.indexOf('run_timestamp_iso')] = '2026-01-01T00:00:00.000Z'
  const edits = SS.buildEditIndex(S.tabs[EDIT_LOG_TAB].map(r => r.map(String))), runs = SS.buildRunIndex([SCORES_COLUMNS.map(String), runRow.map(String)])
  ok('18. the Admin code reads the "events" log row without error, and it does NOT mark a score stale (even a run written BEFORE it)', Array.isArray(edits.get(SID)) && edits.get(SID).length === 1 && SS.isRunStale(runs.get(SID)[0], edits.get(SID)) === false)
}

console.log('READ-ONLY GUARD')
{ const S = makeSheet(); await saved(S); const o = await open(S); const before = snap(S); S.calls.length = 0
  G.setWriteReadOnly(true)
  const a = await trySave(SAVE(o))
  ok('13. with readOnly on, saveEditedHalf is refused before ANY request is sent', !a.ok && a.e instanceof G.ReadOnlyError && S.calls.length === 0 && snap(S) === before, a.e?.message)
  let g = 0; for (const f of [() => G.assertWritable('x')]) { try { f() } catch (e) { if (e.readOnly) g++ } }
  const GF = await import('./guardedFirestore.js'); const refused = []
  for (const [n, f] of [['setDoc', () => GF.setDoc({}, {})], ['updateDoc', () => GF.updateDoc({}, {})], ['deleteDoc', () => GF.deleteDoc({})], ['writeBatch', () => GF.writeBatch({})]]) { try { f(); refused.push(n + ': NOT refused') } catch (e) { if (!e.readOnly) refused.push(n + ': ' + e.message.slice(0, 60)) } }
  ok('13. the guarded Firestore writes (setDoc, updateDoc, deleteDoc, writeBatch) all refuse with readOnly on', g === 1 && refused.length === 0, J(refused))
  S.calls.length = 0
  let first; try { await syncSessionToSheet(sess('NEWSESSION'), evs('NEWSESSION')) } catch (e) { first = e }
  ok('13. the OLDER first-save path (syncSessionToSheet) refuses too, before any request is sent', first instanceof G.ReadOnlyError && S.calls.length === 0, first?.message)
  G.setWriteReadOnly(false)
  const b = await trySave(SAVE(o)); ok('    and with readOnly off again, the same save goes through', b.ok, b.e?.message)
}

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
