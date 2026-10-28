/**
 * sessionFlags.js — the small, pure part of sign-in session handling.
 *
 * No Firebase and no globals are touched at import time, so this file can be unit-tested on its own
 * (see sessionFlags.test.mjs). The part that talks to Firebase is sessionPolicy.js.
 *
 * What lives where
 *   mark_remember (localStorage)   { uid, at }   written ONLY when "Remember me" was ticked at sign-in.
 *                                                It is the single flag that tells startup the session is meant
 *                                                to survive a restart. It holds NO password and NO token: the
 *                                                token is Firebase's own, in the persistence Firebase chose.
 *   mark_run      (sessionStorage) timestamp     Present for as long as this app window lives, and gone after a
 *                                                restart. Tells a reload (F5) from a real app start.
 */

export const REMEMBER_KEY = 'mark_remember'
export const RUN_KEY = 'mark_run'

/**
 * How long "Remember me" lasts before a password is needed again.
 * Firebase has no server-free way to limit this: its refresh token lives until it is revoked (needs the Admin SDK
 * on a server) or the password changes. This is a client-side stamp, so treat it as a convenience policy, not a
 * security control: someone who edits their own local storage can extend it.
 */
export const MAX_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000

export const MSG_DEACTIVATED = 'Your account has been deactivated. Contact your Batch Manager.'
export const MSG_EXPIRED = 'Your saved sign-in expired. Please sign in again.'

const safeStorage = kind => { try { return globalThis[kind] || null } catch { return null } }

export function readRemember(storage = safeStorage('localStorage')) {
  try {
    const v = JSON.parse(storage.getItem(REMEMBER_KEY))
    return v && typeof v.uid === 'string' && v.uid && Number.isFinite(v.at) ? { uid: v.uid, at: v.at } : null
  } catch { return null }
}

export function writeRemember(uid, now = Date.now(), storage = safeStorage('localStorage')) {
  try { storage.setItem(REMEMBER_KEY, JSON.stringify({ uid, at: now })) } catch { /* storage unavailable: session simply is not remembered */ }
}

export function clearRemember(storage = safeStorage('localStorage')) {
  try { storage.removeItem(REMEMBER_KEY) } catch { /* nothing to clear */ }
}

/** True when this is a real app start (no run marker yet), false for a reload inside the same app window. */
export function isFreshStart(session = safeStorage('sessionStorage')) {
  try { return session.getItem(RUN_KEY) == null } catch { return true }
}

export function markRunStarted(now = Date.now(), session = safeStorage('sessionStorage')) {
  try { session.setItem(RUN_KEY, String(now)) } catch { /* ignore */ }
}

/**
 * What to do with a signed-in user found when the app STARTS.
 *   keep     the user chose "Remember me", it was this same user, and it has not run out
 *   signout  everything else, including a user left behind by an older version of the app (which kept everyone
 *            signed in): no flag means the session was never meant to survive a restart
 */
export function decideStartup({ uid, remember, now, maxAgeMs = MAX_REMEMBER_MS }) {
  if (!uid) return { action: 'none' }
  if (!remember || remember.uid !== uid) return { action: 'signout', reason: 'not-remembered' }
  if (now - remember.at > maxAgeMs) return { action: 'signout', reason: 'expired' }
  return { action: 'keep' }
}
