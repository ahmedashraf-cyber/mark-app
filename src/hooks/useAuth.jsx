import { useState, useEffect, createContext, useContext } from 'react'
import { auth, onAuthStateChanged, db } from '../firebase/config'
import { doc, getDoc } from 'firebase/firestore'
import { resolveRole } from '../utils/sheetRole'
import { startupGate, endSession } from '../utils/sessionPolicy'
import { capabilities } from './useAdmin'

// ── Bootstrap full-access accounts ──────────────────────────────────────────
// These email addresses get every capability regardless of the Supervisor sheet.
// The check requires the Firebase user's emailVerified flag to be true (which
// Google OAuth always sets, and which email+password accounts only get after
// clicking a verification link — so an attacker who creates a fake account with
// one of these addresses cannot exploit this).
//
// Add entries here only. Do not change any other part of the auth flow.
// Comparison is lower-cased and trimmed on both sides.
const FULL_ACCESS_EMAILS = ['ahmed.ashraf@hudl.com']

/** Returns true only when both the email matches AND Firebase has verified it. */
function isFullAccessUser(firebaseUser) {
  if (!firebaseUser) return false
  const email = (firebaseUser.email || '').toLowerCase().trim()
  if (!FULL_ACCESS_EMAILS.includes(email)) return false
  // emailVerified is true for Google sign-ins and for email+password accounts
  // after the user has clicked the verification link Google sends.
  return firebaseUser.emailVerified === true
}

/** The capability object granted to full-access users — every flag is true. */
function fullAccessCaps() {
  // Build via capabilities('Batch Manager') so we get every key automatically,
  // then override every boolean to true. This means a newly added capability
  // key is included automatically without touching this function.
  const base = capabilities('Batch Manager', null)
  const out = { ...base }
  Object.keys(out).forEach(k => { if (typeof out[k] === 'boolean') out[k] = true })
  return out
}

/** The roleInfo object for a full-access user. role and known are set so that
 *  diagnostics and the "Access denied" screen read cleanly. code is intentionally
 *  blank so Self-Review shows the normal "no HR-Code" message. */
function fullAccessRoleInfo() {
  return {
    role:            'Batch Manager',
    known:           true,
    name:            '',
    code:            '',   // no HR-code → Self-Review shows its normal guard
    email:           '',
    active:          true,
    minimumVersion:  '',   // never version-gated
    accessOverrides: null,
    source:          'builtin',
    offline:         false,
  }
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null) // Firestore profile {role, trainerCode, name}
  const [loading, setLoading] = useState(true)
  // Role from the Supervisor tab. Resolved ONCE per login and held for the
  // session — no screen transition re-reads the sheet. A Batch Manager's role
  // change therefore takes effect on the user's next login, which is the
  // documented behaviour and avoids polling for a monthly event.
  const [sheetRole, setSheetRole] = useState(null)
  // A message for the login screen after the app signed someone out on its own
  // (deactivated account, or a remembered sign-in that ran out).
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    let unsub = () => {}
    // Nothing below trusts a restored session until the startup guard has run:
    // at a real app start it signs out anyone who was not remembered on purpose.
    startupGate().then(guard => {
      if (cancelled) return
      if (guard?.notice) setNotice(guard.notice)
    unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null); setProfile(null); setSheetRole(null); setLoading(false); return
      }
      setUser(firebaseUser)

      // ── Full-access bypass (verified email only) ──────────────────────
      // Must run before the sheet lookup so the sheet is never consulted
      // for these accounts. All other accounts skip this block entirely.
      if (isFullAccessUser(firebaseUser)) {
        console.log('[MARK] full-access account — skipping sheet lookup')
        setProfile({ uid: firebaseUser.uid, email: firebaseUser.email, role: 'Batch Manager' })
        setSheetRole(fullAccessRoleInfo())
        setLoading(false)
        return
      }
      // ── Normal path (unchanged) ──────────────────────────────────────

      try {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
        if (snap.exists()) {
          setProfile({ ...snap.data(), uid: firebaseUser.uid, email: firebaseUser.email })
        } else {
          setProfile({ uid: firebaseUser.uid, email: firebaseUser.email, role: 'trainer' })
        }
      } catch (e) {
        setProfile({ uid: firebaseUser.uid, email: firebaseUser.email, role: 'trainer' })
      }
      // Resolve the sheet role alongside the Firestore profile. A failure here
      // must never block sign-in: resolveRole falls back to a cached role, or
      // to collector-only for an HR-code, and returns role: null rather than
      // throwing.
      try {
        const r = await resolveRole({ email: firebaseUser.email })
        // The status is checked at EVERY start, so a remembered user who was
        // deactivated since is signed out here, not just refused at first login.
        // (endSession signs out; the listener then fires again with no user.)
        if (r.deactivated) {
          setNotice(r.reason)
          await endSession()
          return
        }
        setSheetRole(r)
        if (!r.role) console.warn('[MARK] no role for', firebaseUser.email, '—', r.reason)
      } catch (e) {
        console.error('[MARK] role lookup failed:', e)
        setSheetRole({ role: null, reason: 'Role lookup failed: ' + (e?.message || e) })
      }

      setLoading(false)
    })
    })
    return () => { cancelled = true; unsub() }
  }, [])

  // Ends the session and forgets what the app remembered about it (the remember
  // flag, the saved role). In-progress work on disk is left alone.
  const logout = () => endSession()

  return (
    <AuthContext.Provider value={{
      user, profile, loading, logout,
      notice, clearNotice: () => setNotice(''),
      // the resolved role, and the full result for diagnostics
      role: sheetRole?.role || null,
      roleInfo: sheetRole,
      // The capability set, computed ONCE here with the Role Access Manager's
      // overrides applied. Screens read this rather than re-deriving from the
      // role string — the overrides were being fetched and then dropped,
      // because the useInternalUser shim never received them.
      // Full-access accounts (source:'builtin') get every capability true.
      // Every other account uses the existing sheet-derived path unchanged.
      caps: sheetRole?.source === 'builtin'
        ? fullAccessCaps()
        : capabilities(sheetRole?.role, sheetRole?.accessOverrides),
      setSheetRole,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() { return useContext(AuthContext) }
