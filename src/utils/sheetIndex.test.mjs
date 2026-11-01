import { buildIdIndex, indexedCount, fetchRowsById, rowsToObjects } from './sheetIndex.js'
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 200) + ']' : ''}`) }
let seed = 99; const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n

// an in-memory tab with an io that counts calls and can change the sheet at chosen moments
class Fake {
  constructor(rows) { this.rows = rows; this.calls = { colA: 0, batch: 0, all: 0 }; this.hooks = {} }
  io() {
    return {
      readColumnA: async () => { this.calls.colA++; await this.hooks.beforeColA?.(this); return this.rows.map(r => [r[0]]) },
      batchGetRows: async (_t, segs) => { this.calls.batch++; await this.hooks.beforeBatch?.(this); return segs.map(([s, e]) => this.rows.slice(s - 1, e)) },
      readAll: async () => { this.calls.all++; return this.rows.map(r => r.slice()) },
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

console.log('the index')
{
  const idx = buildIdIndex([['session_id'], ['a'], ['a'], ['b'], ['a'], [''], ['a'], [' b ']])
  ok('runs of one id become [start,end] segments (1-based), and a blank row or another id ends a run', same(idx.get('a'), [[2, 3], [5, 5], [7, 7]]) && same(idx.get('b'), [[4, 4], [8, 8]]), JSON.stringify([...idx]))
  ok('the header row is never an id; counts add up', indexedCount(idx, 'a') === 4 && indexedCount(idx, 'b') === 2 && indexedCount(idx, 'session_id') === 0 && indexedCount(idx, 'zzz') === 0)
  ok('an empty or missing column gives an empty index', buildIdIndex([]).size === 0 && buildIdIndex(undefined).size === 0 && buildIdIndex([['h']]).size === 0)
}

console.log('EQUIVALENCE: the result is identical to filtering a full read')
for (const [label, opts] of [['contiguous sessions', {}], ['rows of one id scattered all over the tab', { interleave: true }], ['contiguous with blank rows inside', { blanks: true }], ['scattered with blanks', { interleave: true, blanks: true }]]) {
  const ids = Array.from({ length: 60 }, (_, i) => 'sess_' + i)
  const f = new Fake(mk(3000, ids, opts)); const cache = {}; let bad = 0
  for (const id of [...ids, 'sess_nobody', ' sess_5 ']) { const got = await fetchRowsById(f.io(), 'field_events', id, cache); if (!same(got, truth(f.rows, id))) bad++ }
  ok(`${label}: all 60 ids + an unknown id, row for row, in the same order`, bad === 0, `${bad} differ`)
}
{
  const ids = Array.from({ length: 60 }, (_, i) => 'sess_' + i); const f = new Fake(mk(3000, ids)); const cache = {}
  await fetchRowsById(f.io(), 't', 'sess_7', cache); await fetchRowsById(f.io(), 't', 'sess_8', cache); await fetchRowsById(f.io(), 't', 'sess_9', cache)
  ok('contiguous sessions: one fetch per session, a column-A read to index and one after each fetch to confirm nothing moved, and the whole tab is never read', f.calls.colA === 4 && f.calls.batch === 3 && f.calls.all === 0, JSON.stringify(f.calls))
}

console.log('the sheet changes between the index and the fetch (the case that must never give a wrong answer)')
{
  const mkSheet = () => new Fake(mk(600, Array.from({ length: 10 }, (_, i) => 'sess_' + i)))
  // 1. rows inserted ABOVE the wanted rows after the index was built: every row number shifts
  let f = mkSheet(); let cache = {}; await fetchRowsById(f.io(), 't', 'sess_3', cache)
  f.rows.splice(1, 0, ...Array.from({ length: 25 }, (_, i) => ['sess_0', 'new' + i, 'pass', 'x']))
  let got = await fetchRowsById(f.io(), 't', 'sess_3', cache)
  ok('rows inserted above after indexing: the stale index is detected and the answer is still exactly right', same(got, truth(f.rows, 'sess_3')) && got.length === 60, got.length)
  // 2. the change happens DURING the fetch (between the index read and the range read)
  f = mkSheet(); cache = {}; f.hooks.beforeBatch = async s => { s.hooks.beforeBatch = null; s.rows.splice(1, 0, ...Array.from({ length: 7 }, () => ['sess_9', '0', 'pass', 'x'])) }
  got = await fetchRowsById(f.io(), 't', 'sess_3', cache)
  ok('rows inserted DURING the fetch: wrong rows are caught by the id check, re-indexed, and the answer is exactly right', same(got, truth(f.rows, 'sess_3')) && f.calls.all === 0, JSON.stringify(f.calls))
  // 3. rows deleted during the fetch
  f = mkSheet(); cache = {}; f.hooks.beforeBatch = async s => { s.hooks.beforeBatch = null; s.rows.splice(5, 30) }
  got = await fetchRowsById(f.io(), 't', 'sess_3', cache)
  ok('rows deleted during the fetch: still exactly right', same(got, truth(f.rows, 'sess_3')))
  // 4. the sheet keeps changing on both attempts: falls back to a full read, still right
  f = mkSheet(); cache = {}; f.hooks.beforeBatch = async s => { s.rows.splice(1, 0, ['sess_9', '0', 'pass', 'x']) }
  got = await fetchRowsById(f.io(), 't', 'sess_3', cache)
  ok('changing on every attempt: falls back to reading the whole tab, and is STILL exactly right', same(got, truth(f.rows, 'sess_3')) && f.calls.all === 1, JSON.stringify(f.calls))
  // 4b. rows for the SAME id appended between the index and the fetch: they would not look wrong, only missing
  f = mkSheet(); cache = {}; f.hooks.beforeBatch = async s => { s.hooks.beforeBatch = null; s.rows.push(['sess_3', 'late', 'pass', 'x'], ['sess_3', 'late2', 'pass', 'x']) }
  got = await fetchRowsById(f.io(), 't', 'sess_3', cache)
  ok('rows for the SAME id added between index and fetch are not missed (the bug the randomised test found)', same(got, truth(f.rows, 'sess_3')) && got.length === 62, got.length)
  // 5. a session saved AFTER the index was built (the index says "no rows")
  f = mkSheet(); cache = {}; await fetchRowsById(f.io(), 't', 'sess_1', cache)
  f.rows.push(...Array.from({ length: 12 }, (_, i) => ['sess_new', String(i), 'pass', 'x']))
  got = await fetchRowsById(f.io(), 't', 'sess_new', cache)
  ok('a session saved after the index was built is found, not reported as empty', got.length === 12 && same(got, truth(f.rows, 'sess_new')))
  // 6. a session DELETED after indexing (re-save deletes then rewrites): no stale rows returned
  f = mkSheet(); cache = {}; await fetchRowsById(f.io(), 't', 'sess_2', cache)
  f.rows = f.rows.filter((r, i) => i === 0 || r[0] !== 'sess_2')
  got = await fetchRowsById(f.io(), 't', 'sess_2', cache)
  ok('a session deleted after indexing returns nothing (never the old rows)', got.length === 0 && same(got, truth(f.rows, 'sess_2')))
  // 7. a trailing-edge case: the last rows of the sheet
  f = mkSheet(); f.rows.push(['sess_last', '0', 'pass', 'x']); got = await fetchRowsById(f.io(), 't', 'sess_last', {})
  ok('rows at the very end of the tab', got.length === 1)
}

console.log('randomised changes: 300 trials, a random edit at a random moment')
{
  let bad = 0
  for (let t = 0; t < 300; t++) {
    const ids = Array.from({ length: 12 }, (_, i) => 'sess_' + i)
    const f = new Fake(mk(200, ids, { interleave: rnd(2) === 0, blanks: rnd(2) === 0 }))
    const cache = {}; if (rnd(2)) await fetchRowsById(f.io(), 't', ids[rnd(12)], cache)
    const edit = s => { const k = rnd(3); const at = 1 + rnd(Math.max(1, s.rows.length - 1)); if (k === 0) s.rows.splice(at, 0, ...Array.from({ length: 1 + rnd(9) }, () => [ids[rnd(12)], 'n', 'pass', 'x'])); else if (k === 1) s.rows.splice(at, Math.min(1 + rnd(15), s.rows.length - at)); else s.rows.push([ids[rnd(12)], 'n', 'pass', 'x']) }
    const when = rnd(3); if (when === 0) edit(f); else if (when === 1) f.hooks.beforeBatch = async s => { s.hooks.beforeBatch = null; edit(s) }; else f.hooks.beforeColA = async s => { s.hooks.beforeColA = null; edit(s) }
    const id = ids[rnd(12)]; const got = await fetchRowsById(f.io(), 't', id, cache)
    if (!same(got, truth(f.rows, id))) bad++
  }
  ok('every one of 300 randomised trials equals filtering a full read of the sheet as it is at the end', bad === 0, `${bad} wrong`)
}
console.log('objects')
ok('rows become objects keyed by the header; a short row is padded', same(rowsToObjects(['a', 'b', 'c'], [['1', '2'], ['x']]), [{ a: '1', b: '2', c: '' }, { a: 'x', b: '', c: '' }]))
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
