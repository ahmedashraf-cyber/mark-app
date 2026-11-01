import { buildIdIndex, indexedCount, fetchRowsById, rowsToObjects, IndexUntrustedError } from './sheetIndex.js'
let pass = 0, fail = 0, gaps = []
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 220) + ']' : ''}`) }
const gap = (n, c, d = '') => { console.log(`  ${c ? '✓' : '⚠ KNOWN GAP'} ${n}${!c && d ? '   [' + String(d).slice(0, 200) + ']' : ''}`); if (!c) gaps.push(n) }
let seed = 99; const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n
const J = JSON.stringify

// an in-memory tab with an io that counts calls and can change the sheet at chosen moments. There is NO readAll in the io.
class Fake {
  constructor(rows) { this.rows = rows; this.calls = { colA: 0, batch: 0 }; this.hooks = {} }
  io() {
    return {
      readColumnA: async () => { this.calls.colA++; await this.hooks.beforeColA?.(this); return this.rows.map(r => [r[0]]) },
      batchGetRows: async (_t, segs) => { this.calls.batch++; await this.hooks.beforeBatch?.(this); return segs.map(([s, e]) => this.rows.slice(s - 1, e)) },
    }
  }
}
const header = ['session_id', 'event_seq', 'event_code', 'v']
const mk = (n, ids, { interleave = false, blanks = false } = {}) => {
  const rows = []
  for (let i = 0; i < n; i++) rows.push([ids[interleave ? rnd(ids.length) : Math.min(ids.length - 1, Math.floor(i / (n / ids.length)))], String(i), 'pass', 'v' + i])
  if (blanks) for (let k = 0; k < 40; k++) rows.splice(rnd(rows.length), 0, ['', '', '', ''])
  return [header, ...rows]
}
const truth = (rows, id) => rows.slice(1).filter(r => String(r[0] ?? '').trim() === String(id).trim())
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ids60 = Array.from({ length: 60 }, (_, i) => 'sess_' + i)

console.log('the index')
{
  const idx = buildIdIndex([['session_id'], ['a'], ['a'], ['b'], ['a'], [''], ['a'], [' b ']])
  ok('runs of one id become [start,end] segments (1-based), and a blank row or another id ends a run', same(idx.get('a'), [[2, 3], [5, 5], [7, 7]]) && same(idx.get('b'), [[4, 4], [8, 8]]), J([...idx]))
  ok('the header row is never an id; counts add up', indexedCount(idx, 'a') === 4 && indexedCount(idx, 'b') === 2 && indexedCount(idx, 'session_id') === 0 && indexedCount(idx, 'zzz') === 0)
  ok('an empty or missing column gives an empty index', buildIdIndex([]).size === 0 && buildIdIndex(undefined).size === 0 && buildIdIndex([['h']]).size === 0)
}

console.log('EQUIVALENCE on a sheet that does not change: identical to filtering a full read')
for (const [label, opts] of [['contiguous sessions', {}], ['rows of one id scattered all over the tab', { interleave: true }], ['contiguous with blank rows inside', { blanks: true }], ['scattered with blank rows', { interleave: true, blanks: true }]]) {
  const f = new Fake(mk(3000, ids60, opts)); const cache = {}; let bad = 0
  for (const id of [...ids60, 'sess_nobody', ' sess_5 ']) { const got = await fetchRowsById(f.io(), 'field_events', id, cache); if (!same(got, truth(f.rows, id))) bad++ }
  ok(`${label}: all 60 ids + an unknown id, row for row, in the same order`, bad === 0, `${bad} differ`)
}

console.log('COST: column A is read ONCE per session of the screen, however many halves are opened')
{
  const f = new Fake(mk(3000, ids60)); const cache = {}
  for (const id of ['sess_7', 'sess_8', 'sess_9', 'sess_7', 'sess_30', 'sess_nobody']) await fetchRowsById(f.io(), 'field_events', id, cache)
  ok('six fetches (one repeated, one for an id with no rows): ONE column-A read in total', f.calls.colA === 1, J(f.calls))
  ok('one range request per fetch that has rows (5), none for an id with no rows', f.calls.batch === 5, J(f.calls))
  const g = new Fake(mk(3000, ids60)); await fetchRowsById(g.io(), 't', 'sess_1', {}); await fetchRowsById(g.io(), 't', 'sess_1', {})
  ok('a NEW cache (what Reload makes) reads column A again', g.calls.colA === 2, J(g.calls))
  ok('a cache that was pre-filled with the index (the page builds it for the counts) costs no column-A read at all', (() => { const h = new Fake(mk(300, ids60.slice(0, 10))); return h })() && await (async () => { const h = new Fake(mk(300, ids60.slice(0, 10))); const c = { index: buildIdIndex(h.rows.map(r => [r[0]])) }; await fetchRowsById(h.io(), 't', 'sess_3', c); return h.calls.colA === 0 })())
  ok('the io has no way to read the whole tab', !('readAll' in new Fake([header]).io()))
}

console.log('the sheet changed after column A was read: caught ONLY by a fetched row not matching, then re-checked')
{
  const mkSheet = () => new Fake(mk(600, Array.from({ length: 10 }, (_, i) => 'sess_' + i)))
  // 1. rows inserted ABOVE the wanted rows after the index was built: every row number shifts
  let f = mkSheet(); let cache = {}; await fetchRowsById(f.io(), 't', 'sess_3', cache)
  f.rows.splice(1, 0, ...Array.from({ length: 25 }, (_, i) => ['sess_0', 'new' + i, 'pass', 'x']))
  let before = f.calls.colA, got = await fetchRowsById(f.io(), 't', 'sess_3', cache)
  ok('rows inserted above after indexing: the rows fetched are wrong, column A is re-read ONCE, and the answer is exactly right', same(got, truth(f.rows, 'sess_3')) && got.length === 60 && f.calls.colA === before + 1, J(f.calls))
  // 2. the change happens DURING the fetch (between the index read and the range read)
  f = mkSheet(); cache = {}; f.hooks.beforeBatch = async s => { s.hooks.beforeBatch = null; s.rows.splice(1, 0, ...Array.from({ length: 7 }, () => ['sess_9', '0', 'pass', 'x'])) }
  got = await fetchRowsById(f.io(), 't', 'sess_3', cache)
  ok('rows inserted DURING the first fetch: caught by the id check, re-indexed, and exactly right', same(got, truth(f.rows, 'sess_3')) && f.calls.colA === 2, J(f.calls))
  // 3. rows deleted during the fetch
  f = mkSheet(); cache = {}; f.hooks.beforeBatch = async s => { s.hooks.beforeBatch = null; s.rows.splice(5, 30) }
  got = await fetchRowsById(f.io(), 't', 'sess_3', cache)
  ok('rows deleted during the fetch: still exactly right', same(got, truth(f.rows, 'sess_3')))
  // 4. a re-save: the session's old rows are removed and new ones written at the end (shifts everything below)
  f = mkSheet(); cache = {}; await fetchRowsById(f.io(), 't', 'sess_5', cache)
  f.rows = [f.rows[0], ...f.rows.slice(1).filter(r => r[0] !== 'sess_2'), ...Array.from({ length: 40 }, (_, i) => ['sess_2', String(i), 'pass', 'x'])]
  got = await fetchRowsById(f.io(), 't', 'sess_5', cache)
  ok('another session was re-saved (rows removed, rewritten at the end): the shift is caught and the answer is exactly right', same(got, truth(f.rows, 'sess_5')) && got.length === 60)
  // 5. a re-saved session itself
  f = mkSheet(); cache = {}; await fetchRowsById(f.io(), 't', 'sess_2', cache)
  f.rows = [f.rows[0], ...f.rows.slice(1).filter(r => r[0] !== 'sess_2'), ...Array.from({ length: 40 }, (_, i) => ['sess_2', String(i), 'pass', 'x'])]
  got = await fetchRowsById(f.io(), 't', 'sess_2', cache)
  ok('the half\'s OWN session was re-saved: old rows are never returned, the new ones are', same(got, truth(f.rows, 'sess_2')) && got.length === 40)
  // 6. a session DELETED after indexing
  f = mkSheet(); cache = {}; await fetchRowsById(f.io(), 't', 'sess_2', cache)
  f.rows = f.rows.filter((r, i) => i === 0 || r[0] !== 'sess_2'); got = await fetchRowsById(f.io(), 't', 'sess_2', cache)
  ok('a session deleted after indexing returns nothing (never the old rows)', got.length === 0 && same(got, truth(f.rows, 'sess_2')))
}

console.log('it never falls back to reading the whole tab: if it cannot trust the rows, it STOPS')
{
  const f = new Fake(mk(600, Array.from({ length: 10 }, (_, i) => 'sess_' + i))); const cache = {}
  f.hooks.beforeBatch = async s => { s.rows.splice(1, 0, ['sess_9', '0', 'pass', 'x']) }          // the sheet changes on EVERY fetch
  let err = null; try { await fetchRowsById(f.io(), 'field_events', 'sess_3', cache) } catch (e) { err = e }
  ok('a sheet that changes on every attempt: throws an IndexUntrustedError after three tries', err instanceof IndexUntrustedError && err.untrusted === true && f.calls.batch === 3 && f.calls.colA === 3, J(f.calls))
  ok('the message names the tab and tells the person to press Reload', /field_events/.test(err.message) && /Reload/.test(err.message), err?.message)
  ok('it threw instead of returning a guess, and the bad index is dropped', cache.index === null)
  f.hooks.beforeBatch = null; const got = await fetchRowsById(f.io(), 'field_events', 'sess_3', cache)
  ok('and once the sheet stops changing, the next try works', same(got, truth(f.rows, 'sess_3')))
}

console.log('WHAT IT DOES NOT CATCH (accepted: Reload is the answer). These say so out loud.')
{
  const mkSheet = () => new Fake(mk(600, Array.from({ length: 10 }, (_, i) => 'sess_' + i)))
  let f = mkSheet(); let cache = {}; await fetchRowsById(f.io(), 't', 'sess_9', cache)
  f.rows.push(['sess_9', 'late', 'pass', 'x'], ['sess_9', 'late2', 'pass', 'x'])
  let got = await fetchRowsById(f.io(), 't', 'sess_9', cache)
  gap('rows for the SAME id appended after column A was read are not returned until Reload', got.length === truth(f.rows, 'sess_9').length, `returned ${got.length}, the sheet has ${truth(f.rows, 'sess_9').length}`)
  f = mkSheet(); cache = {}; await fetchRowsById(f.io(), 't', 'sess_1', cache)
  f.rows.push(...Array.from({ length: 12 }, (_, i) => ['sess_new', String(i), 'pass', 'x']))
  got = await fetchRowsById(f.io(), 't', 'sess_new', cache)
  gap('a session saved after column A was read comes back EMPTY until Reload', got.length === 12, `returned ${got.length}, the sheet has 12`)
}

console.log('randomised changes: 300 trials, a random edit at a random moment')
{
  let wrongRow = 0, threw = 0, exact = 0, incomplete = 0, other = 0
  for (let t = 0; t < 300; t++) {
    const ids = Array.from({ length: 12 }, (_, i) => 'sess_' + i)
    const f = new Fake(mk(200, ids, { interleave: rnd(2) === 0, blanks: rnd(2) === 0 }))
    const cache = {}; if (rnd(2)) await fetchRowsById(f.io(), 't', ids[rnd(12)], cache)
    const edit = s => { const k = rnd(3); const at = 1 + rnd(Math.max(1, s.rows.length - 1)); if (k === 0) s.rows.splice(at, 0, ...Array.from({ length: 1 + rnd(9) }, () => [ids[rnd(12)], 'n', 'pass', 'x'])); else if (k === 1) s.rows.splice(at, 1 + rnd(8)); else s.rows.push(...Array.from({ length: 1 + rnd(5) }, () => [ids[rnd(12)], 'n', 'pass', 'x'])) }
    const when = rnd(3); if (when === 0) edit(f); else if (when === 1) f.hooks.beforeBatch = async s => { s.hooks.beforeBatch = null; edit(s) }; else f.hooks.beforeColA = async s => { s.hooks.beforeColA = null; edit(s) }
    const id = ids[rnd(12)]
    try { const got = await fetchRowsById(f.io(), 't', id, cache); const want = id.trim(); if (got.some(r => String(r?.[0] ?? '').trim() !== want)) wrongRow++; else if (same(got, truth(f.rows, id))) exact++; else incomplete++ }
    catch (e) { if (e instanceof IndexUntrustedError) threw++; else other++ }
  }
  ok('NEVER returns a row that belongs to another id, in 300 trials', wrongRow === 0, `${wrongRow} wrong rows`)
  ok('never fails any way other than the Reload error', other === 0, `${other} other errors`)
  console.log(`      outcome of the 300: ${exact} exactly right, ${incomplete} incomplete (rows appended for the same id after column A was read: the documented gap), ${threw} stopped with the Reload error`)
}
console.log('objects')
ok('rows become objects keyed by the header; a short row is padded', same(rowsToObjects(['a', 'b', 'c'], [['1', '2'], ['x']]), [{ a: '1', b: '2', c: '' }, { a: 'x', b: '', c: '' }]))
console.log(`\n${pass} passed, ${fail} failed${gaps.length ? `, ${gaps.length} KNOWN GAPS (accepted, Reload clears them)` : ''}`); process.exit(fail ? 1 : 0)
