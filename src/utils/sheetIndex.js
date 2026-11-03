/**
 * sheetIndex.js — read only the rows of ONE id from a very large tab, without ever reading the whole tab.
 *
 * field_events (39 columns, every event of every session) and comparison_detail are far too big to read whole (a Google
 * file is capped at 10 million cells). Rows of one session or one run are written together, so:
 *   1. read column A of the tab ONCE per session of the screen and keep the index in memory (`cache.index`); Reload
 *      builds a new cache, which is what clears it
 *   2. fetch just the rows the index gives for the id
 *   3. check what came back: the row count is what the index said and every row has this id in column A
 * Only when a fetched row does NOT match is the index thrown away, column A read again, and the fetch retried (up to
 * three tries in all). If it still does not match, it THROWS an IndexUntrustedError: it never falls back to reading the
 * whole tab. The caller shows "Reload" and the person tries again.
 *
 * AN EMPTY ANSWER IS RE-CHECKED: when the index says an id has no rows (a collector who has just saved a half, whose
 * rows were written after column A was read), column A is read ONCE more before saying "none", and the fetch is tried
 * again. Only if it is still empty is the empty answer returned. Cost: opening an id that really has no rows costs one
 * column-A read each time.
 *
 * WHAT THIS STILL DOES NOT CATCH (accepted, so Reload exists): rows for the SAME id added after column A was read, when
 * some of its rows were already indexed: nothing fetched looks wrong, so the new rows are only missing.
 * A re-save writes the session's rows again at the end of the tab and removes the old ones, which shifts the rows
 * below and IS caught by step 3.
 *
 * Pure: all sheet access goes through `io`, so it can be tested without a network.
 *   io.readColumnA(tab)            → [[cell], …]              row 1 is the header
 *   io.batchGetRows(tab, segments) → [[row, …], …]            one array of rows per [start, end] (1-based, inclusive)
 * There is deliberately no "read everything" in the interface.
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

/** Thrown when the rows fetched keep disagreeing with column A: the sheet is changing faster than it can be read. */
export class IndexUntrustedError extends Error {
  constructor(tab) {
    super(`The ${tab} sheet changed while it was being read, so these rows cannot be trusted. Press Reload and open the half again.`)
    this.name = 'IndexUntrustedError'
    this.untrusted = true
  }
}

/**
 * Rows for `id`, as arrays of cells in sheet order. `cache` ({ index }) belongs to one tab and is kept by the caller for
 * the whole session of the screen.
 */
export async function fetchRowsById(io, tab, id, cache = {}) {
  const want = key(id)
  if (!want) return []
  let readHere = false                                                          // was column A read during THIS call (so it is fresh)?
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!cache.index) { cache.index = buildIdIndex(await io.readColumnA(tab)); readHere = true }   // once, then reused by every later fetch
    const segs = cache.index.get(want) || []
    const rows = segs.length ? (await io.batchGetRows(tab, segs)).flat() : []
    const expected = segs.reduce((n, [s, e]) => n + (e - s + 1), 0)
    if (rows.length === expected && rows.every(r => key(r?.[0]) === want)) {
      if (rows.length === 0 && !readHere) { cache.index = null; continue }      // "no rows" from an old index: read column A once more before saying so
      return rows
    }
    cache.index = null                                                          // a fetched row did not match: re-read column A
  }
  cache.index = null
  throw new IndexUntrustedError(tab)
}

/** Cells → objects keyed by the header row. A short row is padded with ''. */
export function rowsToObjects(header, rows) {
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, String(r?.[i] ?? '')])))
}
