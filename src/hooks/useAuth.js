import { useState, useEffect, createContext, useContext } from 'react'
import { auth, onAuthStateChanged, signOut, db } from '../firebase/config'
import { doc, getDoc } from 'firebase/firestore'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null) // Firestore profile {role, trainerCode, name}
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null); setProfile(null); setLoading(false); return
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
      setLoading(false)
    })
    return unsub
  }, [])

  const logout = () => signOut(auth)

  return (
    <AuthContext.Provider value={{ user, profile, loading, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() { return useContext(AuthContext) }
