import { useState, useEffect, createContext, useContext } from 'react'
import { auth, onAuthStateChanged, signOut, db } from '../firebase/config'
import { doc, getDoc } from 'firebase/firestore'
import { resolveRole } from '../utils/sheetRole'

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null); setProfile(null); setSheetRole(null); setLoading(false); return
      }
      setUser(firebaseUser)
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
        setSheetRole(r)
        if (!r.role) console.warn('[MARK] no role for', firebaseUser.email, '—', r.reason)
      } catch (e) {
        console.error('[MARK] role lookup failed:', e)
        setSheetRole({ role: null, reason: 'Role lookup failed: ' + (e?.message || e) })
      }

      setLoading(false)
    })
    return unsub
  }, [])

  const logout = () => signOut(auth)

  return (
    <AuthContext.Provider value={{
      user, profile, loading, logout,
      // the resolved role, and the full result for diagnostics
      role: sheetRole?.role || null,
      roleInfo: sheetRole,
      setSheetRole,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() { return useContext(AuthContext) }
