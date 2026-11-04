/**
 * selfReviewPassMark.js: the Self-Review pass mark. One value, one reader, ONE writer.
 * ============================================================================
 * Stored in the key/value `config` tab of the People spreadsheet under `self_review_pass_mark`, next to minimum_version
 * (see selfReviewDashboardConfig.js for the spreadsheet; a test build can point it at a copy). Every change is logged to the
 * `role_changes` tab with the old and new value, exactly as setConfigValue does for minimum_version.
 *
 * WHO MAY CHANGE IT: only a role whose `selfReviewPassMark` permission is on (Batch Manager by default). setPassMark is the
 * only function that writes it, and it does NOT trust what the screen believed: it re-reads the caller's role and the access
 * matrix from the sheet at that moment, and refuses unless both reads are live. (resolveRole falls back to a cached role when
 * the sheet is unreachable; that is fine for working offline and not fine for changing a setting everyone sees.)
 *
 * Honest limit: this is a client-side check. The service-account key ships in the installer and there are no Firestore rules
 * in this repository, so a modified client could write the cell directly. The check stops every ordinary route.
 *
 * Changing it re-colours pills and recomputes the pass rate for everybody on their next load. It does not touch stored scores.
 */
import {
  SELF_REVIEW_CONFIG_SPREADSHEET_ID, PASS_MARK_KEY, PASS_MARK_DEFAULT, PASS_MARK_OPTIONS,
} from '../config/selfReviewDashboardConfig.js'
import {
  readRange, writeRange, appendRows, ensureTab, CONFIG_TAB, CONFIG_HEADER, LOG_TAB, LOG_HEADER,
} from './adminSheet.js'
import { resolveRole, fetchRoleAccess } from './sheetRole.js'
import { capabilities } from '../hooks/useAdmin.js'

export class PassMarkError extends Error {
  constructor(code, message) { super(message); this.name = 'PassMarkError'; this.code = code }
}

const norm = v => String(v ?? '').trim()

export const defaultDeps = {
  spreadsheetId: SELF_REVIEW_CONFIG_SPREADSHEET_ID,
  readRange, writeRange, appendRows, ensureTab, resolveRole, fetchRoleAccess, capabilities,
  now: () => new Date(),
}

/** 50 to 100 in steps of 5, as a number or its text. */
export function isValidPassMark(v) {
  const n = Number(norm(v))
  return norm(v) !== '' && Number.isInteger(n) && PASS_MARK_OPTIONS.includes(n)
}

/**
 * -> { value, source: 'config' | 'default', notice }
 * Never throws and never silently substitutes: a failed read or a bad stored value returns the default WITH a notice.
 * A key that was never set, or a config tab that does not exist yet, is a normal state: default, no notice.
 */
export async function readPassMark(deps = defaultDeps) {
  let rows
  try {
    rows = await deps.readRange(deps.spreadsheetId, `${CONFIG_TAB}!A1:B100`)
  } catch (e) {
    if (/\(400\)/.test(String(e?.message))) return { value: PASS_MARK_DEFAULT, source: 'default', notice: '' }   // tab not created yet
    return { value: PASS_MARK_DEFAULT, source: 'default',
      notice: `The pass mark could not be read (${e?.message || e}), so the default ${PASS_MARK_DEFAULT}% is shown.` }
  }
  const hit = rows.slice(1).find(r => norm(r[0]) === PASS_MARK_KEY)
  if (!hit || norm(hit[1]) === '') return { value: PASS_MARK_DEFAULT, source: 'default', notice: '' }
  if (!isValidPassMark(hit[1])) {
    return { value: PASS_MARK_DEFAULT, source: 'default',
      notice: `The stored pass mark "${norm(hit[1])}" is not valid (it must be 50 to 100 in steps of 5), so the default ${PASS_MARK_DEFAULT}% is shown.` }
  }
  return { value: Number(norm(hit[1])), source: 'config', notice: '' }
}

/**
 * Throws PassMarkError unless this caller may change the pass mark RIGHT NOW.
 * actor: { email, hrCode, bootstrapAdmin }. bootstrapAdmin is the app's hard-coded full-access account (useAuth's
 * FULL_ACCESS_EMAILS); it is honoured here exactly as it is on screen, because it is a client-side rule by design.
 */
export async function assertCanEditPassMark(actor, deps = defaultDeps) {
  if (actor && actor.bootstrapAdmin === true) return
  if (!actor || (!norm(actor.email) && !norm(actor.hrCode))) {
    throw new PassMarkError('DENIED', 'Only a Batch Manager can change the pass mark.')
  }
  let r
  // Ask exactly the question the login asks: staff by email ONLY, collectors by HR-code ONLY. resolveRole treats any call that
  // carries an HR-code as an HR-code login and refuses every non-collector, so passing both would reject a real Batch Manager.
  const who = norm(actor.email) ? { email: norm(actor.email) } : { hrCode: norm(actor.hrCode) }
  try { r = await deps.resolveRole(who) }
  catch (e) { throw new PassMarkError('NOT_LIVE', `Your role could not be confirmed (${e?.message || e}), so the pass mark was not changed.`) }
  if (!r || !r.role) throw new PassMarkError('DENIED', 'Only a Batch Manager can change the pass mark.')
  if (r.source !== 'sheet' || r.offline) {
    throw new PassMarkError('NOT_LIVE', 'Your role could not be confirmed from the sheet right now (offline or cached), so the pass mark was not changed. Try again when connected.')
  }
  let acc
  try { acc = await deps.fetchRoleAccess() }
  catch (e) { throw new PassMarkError('NOT_LIVE', `The access matrix could not be read (${e?.message || e}), so the pass mark was not changed.`) }
  const status = acc && acc.__status
  if (status !== 'ok' && status !== 'empty') {
    throw new PassMarkError('NOT_LIVE', `The access matrix could not be read (${status || 'no answer'}), so the pass mark was not changed.`)
  }
  const caps = deps.capabilities(r.role, r.accessOverrides)
  if (!caps || caps.selfReviewPassMark !== true) throw new PassMarkError('DENIED', 'Only a Batch Manager can change the pass mark.')
}

/**
 * Validate, re-check permission live, write, read back, log. -> { value, oldValue, logged }.
 * Nothing is written unless every check before it passed.
 */
export async function setPassMark(value, actor, deps = defaultDeps) {
  if (!isValidPassMark(value)) {
    throw new PassMarkError('INVALID', `The pass mark must be 50 to 100 in steps of 5 (got "${norm(value)}").`)
  }
  await assertCanEditPassMark(actor, deps)
  const n = Number(norm(value))
  const id = deps.spreadsheetId
  await deps.ensureTab(id, CONFIG_TAB, CONFIG_HEADER)
  const rows = await deps.readRange(id, `${CONFIG_TAB}!A1:B100`)
  let rowNum = null, oldValue = ''
  rows.forEach((r, i) => { if (i > 0 && norm(r[0]) === PASS_MARK_KEY) { rowNum = i + 1; oldValue = norm(r[1]) } })
  if (rowNum) await deps.writeRange(id, `${CONFIG_TAB}!B${rowNum}`, [[String(n)]])
  else await deps.appendRows(id, CONFIG_TAB, [[PASS_MARK_KEY, String(n)]])
  const back = await deps.readRange(id, `${CONFIG_TAB}!A1:B100`)                  // prove it landed
  const stored = back.slice(1).find(r => norm(r[0]) === PASS_MARK_KEY)
  if (!stored || norm(stored[1]) !== String(n)) {
    throw new PassMarkError('NOT_SAVED', 'The pass mark was written but could not be read back, so it may not have been saved. Check it and try again.')
  }
  let logged = true
  try {
    await deps.ensureTab(id, LOG_TAB, LOG_HEADER)
    await deps.appendRows(id, LOG_TAB, [[
      deps.now().toISOString(), norm(actor.email) || norm(actor.hrCode), '', '', PASS_MARK_KEY, oldValue, String(n),
    ]])
  } catch { logged = false }                                    // the change succeeded; losing the log line must not undo it
  return { value: n, oldValue, logged }
}
