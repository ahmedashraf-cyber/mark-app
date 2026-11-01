/**
 * sheetIndex.js — read only the rows of ONE id from a very large tab, and get exactly what a full read would give.
 *
 * field_events (39 columns, every event of every session) and comparison_detail are far too big to read whole each
 * time a screen opens (a Google file is capped at 10 million cells). Rows of one session or one run are written
 * together, so:
 *   1. read column A only (one cheap read), and note which rows hold each id
 *   2. fetch just those rows
 *   3. CHECK every row that came back really has that id in column A, and that the count is what the index said
 * It then reads column A AGAIN and requires this id to sit on exactly the same rows (a row added for the same id in
 * between would not look wrong, only missing). If either check fails the index is rebuilt and it is tried again, and
 * after three attempts the whole tab is read and filtered. So the result is always
 * what filtering a full read would give, never a guess; the check is what makes that true, and sheetIndex.test.mjs
 * proves it against a full read on randomised sheets, including ones that change mid-way.
 *
 * Pure: all sheet access goes through `io`, so it can be tested without a network.
 *   io.readColumnA(tab)            → [[cell], …]              row 1 is the header
 *   io.batchGetRows(tab, segments) → [[row, …], …]            one array of rows per [start, end] (1-based, inclusive)
 *   io.readAll(tab)                → [[cell, …], …]           row 1 is the header
 */
const key = v => String(v ?? '').trim()

/** Map(id → [[startRow, endRow], …]) from column A. Row 1 is the header and is skipped; a blank cell ends a run. */
export function buildIdIndex(colA) {
  const index = new Map()
  let cur = null
  for (let i = 1; i < (colA || []).length; i++) {
    const id = key(colA[i]?.[0]), row = i + 1
    if (!id) { cur = null; continue }
    if (cur && cur.id === id && cur.end === row - 1) { cur.end = row; cur.seg[1] = row; continue }
    const seg = [row, row]
    if (!index.has(id)) index.set(id, [])
    index.get(id).push(seg)
    cur = { id, end: row, seg }
  }
  return index
}

/** How many rows an id has, according to the index. */
export const indexedCount = (index, id) => (index.get(key(id)) || []).reduce((n, [s, e]) => n + (e - s + 1), 0)

const sameSegs = (x, y) => x.length === y.length && x.every((s, i) => s[0] === y[i][0] && s[1] === y[i][1])

/**
 * Rows for `id`, as arrays of cells in sheet order. `cache` ({ index }) is reused between calls.
 *
 * The answer is accepted only when BOTH of these hold:
 *   - what came back is right: the row count is what the index said and every row has this id in column A
 *   - nothing moved: column A, read again AFTER the fetch, puts this id on exactly the same rows
 * The second check is what catches a row added for the same id between the two reads (it would not look wrong, it
 * would just be missing). Otherwise the index is replaced with the fresh one and it is tried again, and after three
 * attempts the whole tab is read and filtered (slow, and right by definition).
 */
export async function fetchRowsById(io, tab, id, cache = {}) {
  const want = key(id)
  if (!want) return []
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!cache.index) cache.index = buildIdIndex(await io.readColumnA(tab))
    const segs = cache.index.get(want) || []
    const rows = segs.length ? (await io.batchGetRows(tab, segs)).flat() : []
    const after = buildIdIndex(await io.readColumnA(tab))
    const expected = segs.reduce((n, [s, e]) => n + (e - s + 1), 0)
    const valid = rows.length === expected && rows.every(r => key(r?.[0]) === want)
    const stable = sameSegs(segs, after.get(want) || [])
    cache.index = after                                      // the fresher index is the one to keep
    if (valid && stable) return rows
  }
  const all = await io.readAll(tab)
  return all.slice(1).filter(r => key(r?.[0]) === want)
}

/** Cells → objects keyed by the header row. A short row is padded with ''. */
export function rowsToObjects(header, rows) {
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, String(r?.[i] ?? '')])))
}
