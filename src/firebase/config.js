// MARK uses the same Firebase project as FIELD (hudl-training-ops)
import { initializeApp } from 'firebase/app'
import {
  getAuth,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyB-HWh2kJgoPDwzYhZWgW6pi8uZK8u9K7U',
  authDomain: 'hudl-training-ops.firebaseapp.com',
  projectId: 'hudl-training-ops',
  storageBucket: 'hudl-training-ops.appspot.com',
  messagingSenderId: '',
  appId: '',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

// Persistence is NOT set here. It used to be (browserLocalPersistence, fire-and-forget), which kept every user
// signed in forever. It is now chosen per sign-in, before the sign-in call: see utils/sessionPolicy.js.

export { signInWithEmailAndPassword, signInWithPopup, signInWithCredential, GoogleAuthProvider, onAuthStateChanged, signOut }
