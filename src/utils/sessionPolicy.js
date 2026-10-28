/**
 * sessionPolicy.js — how long a sign-in lasts (the Firebase half; the pure half is sessionFlags.js).
 *
 * The rules
 *   HR-code login ......... ends when the app closes. Never remembered.
 *   Email + password ...... ends when the app closes, unless "Remember me" was ticked.
 *   "Sign out" ............ always ends it, clears the remembered flag and the saved role.
 *
 * How it is done
 *   1. Persistence is chosen per sign-in, BEFORE the sign-in call (Firebase stores the new user wherever the
 *      persistence says at that moment): session storage normally, local storage for "Remember me". Session
 *      storage belongs to the app window, so it is gone after a restart, a crash or a force-kill, with no
 *      cleanup code that could fail to run.
 *   2. Startup guard. Older versions kept everyone signed in forever, in local storage. Firebase would still
 *      restore such a user, so at a real app start (not a reload) a restored user is signed out unless the
 *      remember flag says that exact user chose it, and it has not run out (30 days).
 *   3. The role is never read from a cache here. useAuth re-reads it from the sheet on every start.
 *
 * What is deliberately NOT touched: the Google OAuth refresh token used for Drive exports (mark_g_refresh).
 * It is not the app login; removing it would send every reviewer back to Google's consent screen on every launch.
 */
import { auth } from '../firebase/config'
import {
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  signInWithEmailAndPassword, signOut,
} from 'firebase/auth'
import {
  decideStartup, readRemember, writeRemember, clearRemember, isFreshStart, markRunStarted, MSG_EXPIRED,
} from './sessionFlags'
import { clearRoleCache } from './sheetRole'

/**
 * Sign in with the right persistence. `remember` is true only for an email login with the box ticked.
 * The order matters: persistence first, then the sign-in.
 */
export async function signInWithSession(email, password, { remember = false } = {}) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
  const cred = await signInWithEmailAndPassword(auth, email, password)
  if (remember) writeRemember(cred.user.uid)
  else clearRemember()
  return cred
}

/** Sign out and forget everything the app remembers about the sign-in. Local work data is left alone. */
export async function endSession() {
  clearRemember()
  clearRoleCache()
  await signOut(auth)
}

/**
 * Runs once, before the first auth state is used. At a real app start it signs out any restored user who was
 * not remembered on purpose. A reload inside the same app window changes nothing.
 * Returns { action, reason?, notice? }.
 */
async function runStartupGuard() {
  const fresh = isFreshStart()
  markRunStarted()
  if (!fresh) return { action: 'reload' }
  await auth.authStateReady()
  const user = auth.currentUser
  const d = decideStartup({ uid: user?.uid, remember: readRemember(), now: Date.now() })
  if (d.action === 'signout') {
    clearRemember(); clearRoleCache()
    await signOut(auth)
    return { ...d, notice: d.reason === 'expired' ? MSG_EXPIRED : '' }
  }
  if (d.action !== 'keep') {
    // No session to continue (a normal close, or the user signed out): a leftover remember flag or saved role
    // would only describe someone who has to sign in again anyway.
    clearRemember(); clearRoleCache()
  }
  return d
}

let gate = null
/** Memoised: every caller awaits the same single run. Never rejects, a failed guard must not lock anyone out. */
export function startupGate() {
  if (!gate) gate = runStartupGuard().catch(e => { console.warn('[MARK session] startup guard failed:', e?.message || e); return { action: 'error' } })
  return gate
}
