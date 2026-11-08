/**
 * ownerMatch.js: "is this saved half MINE?" — ONE rule, used by every screen that finds a person's own halves.
 * ============================================================================
 * PURE. The rule, in order:
 *
 *   1. The row has a collector_email  ->  it is mine ONLY if that email equals the signed-in email (trimmed, case-insensitive).
 *      The HR-code is NEVER consulted when an email is present, so a half that carries someone else's code, or a code that is
 *      shared by two people, cannot be shown to the wrong person, and a half carrying a wrong code is still found by its owner.
 *   2. The row has NO email           ->  fall back to the HR-code, compared with the same normaliser as before (hrCode.js),
 *      and only if I have an HR-code.
 *   3. Otherwise                      ->  not mine.
 *
 * WHO "I" AM: { email, hrCode }.  email = the signed-in Firebase email (useAuth().profile.email). NEVER roleInfo.email: that is
 * blank for the full-access account and in the offline fallback. hrCode = roleInfo.code, which may be blank (the full-access
 * account; a roster row with no code). A person with only an email is still identified: they match rows by email, and the check
 * is never skipped. A person with neither cannot be identified, and the screen must SAY so (canIdentify) rather than show nothing.
 *
 * Returns how a row matched so a list line can say "matched by email" or "matched by HR-code".
 *
 * CLIENT-SIDE ONLY, like every other ownership check in MARK: it keeps honest screens from showing other people's halves.
 */
import { canonHr, sameHr } from './hrCode.js'

export const normEmail = v => String(v ?? '').trim().toLowerCase()

/** { email, hrCode } with the email normalised and the HR-code trimmed. Accepts missing parts. */
export const identityOf = ({ email, hrCode } = {}) => ({ email: normEmail(email), hrCode: String(hrCode ?? '').trim() })

/** True when there is at least one thing to match on. False means the screen must say it cannot look. */
export const canIdentify = id => !!(id && (normEmail(id.email) || canonHr(id.hrCode)))

/**
 * identity: { email, hrCode }   row: { email, hrCode } (the saved half's collector_email and collector_hr_code)
 * -> { match: boolean, by: 'email' | 'hr' | null }
 */
export function matchOwner(identity, row) {
  const me = identityOf(identity || {})
  const rowEmail = normEmail(row?.email)
  if (rowEmail) return me.email && me.email === rowEmail ? { match: true, by: 'email' } : { match: false, by: null }
  return canonHr(me.hrCode) && sameHr(row?.hrCode, me.hrCode) ? { match: true, by: 'hr' } : { match: false, by: null }
}

/**
 * The second look, at FIRESTORE's own copy of the owner (the session record Tag keeps). The sheet row has already decided the
 * half is mine; this only refuses when Firestore's record CONTRADICTS me, in the same order as ownerMatch:
 *   - the record has a collectorEmail                   -> it must equal my signed-in email (the HR-code is not consulted)
 *   - no email, and the sheet matched me by HR-code     -> the record's collectorHrCode must be my code
 *   - no email, and the sheet matched me by email       -> allowed: the record then carries only the code that was typed
 * No record at all is allowed (the sheet decided).
 */
export function firestoreOwnerAllows(fsDoc, identity, matchedBy) {
  if (!fsDoc) return true
  const docEmail = normEmail(fsDoc.collectorEmail)
  if (docEmail) return docEmail === normEmail(identity?.email)
  if (matchedBy === 'hr' && String(fsDoc.collectorHrCode ?? '').trim()) return sameHr(fsDoc.collectorHrCode, identity?.hrCode)
  return true
}

/** The text a list line shows. */
export const MATCHED_BY_TEXT = { email: 'matched by email', hr: 'matched by HR-code' }

/** Shown, not hidden, when neither an email nor an HR-code is known. */
export const UNIDENTIFIED_NOTICE = 'Cannot look for your saved halves: this account has no email or HR-code. Ask a Batch Manager.'

/**
 * Do two rows belong to the same person? Both have an email -> the emails must be equal (the HR-codes are not consulted: one person
 * may carry several mis-typed codes, and two people may share one). Otherwise -> the same non-empty HR-code.
 */
export function sameOwner(a, b) {
  const ea = normEmail(a?.email), eb = normEmail(b?.email)
  if (ea && eb) return ea === eb
  return sameHr(a?.hrCode, b?.hrCode)
}

/** Which person a row belongs to, as one comparable string: the email when there is one, else the HR-code. */
export const ownerKey = row => normEmail(row?.email) || (canonHr(row?.hrCode) ? `hr:${canonHr(row.hrCode)}` : '')
