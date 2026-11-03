/**
 * writeGuard.js: the ONE read-only flag for Tag's write paths.
 * ============================================================================
 * A half that a reviewer has compared opens in VIEW MODE: the collector may watch and read, never change. That has to
 * hold even if a button is missed or a key slips through, so it is enforced at the lowest layer: every Firestore write
 * Tag makes goes through guardedFirestore.js and every sheet write through savedHalfSheet.js / syncSessionToSheet, and
 * all of them ask this module first. The UI also hides and disables things, but a hidden button is not a block.
 *
 * Module-level on purpose: the flag must flip SYNCHRONOUSLY (the moment a comparison is seen), not on the next render.
 *
 * CLIENT-SIDE ONLY. This stops the honest mistake and the race with a reviewer. A modified copy of MARK could skip it.
 */
let readOnly = false

export class ReadOnlyError extends Error {
  constructor(what = 'write') {
    super(`View only: this half has been compared, so ${what} was refused. Nothing was written.`)
    this.name = 'ReadOnlyError'
    this.readOnly = true
  }
}

export const setWriteReadOnly = v => { readOnly = v === true }
export const isWriteReadOnly = () => readOnly
export function assertWritable(what) { if (readOnly) throw new ReadOnlyError(what) }
