import { auth as firebaseAuth } from "./config"
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User
} from "firebase/auth"

export async function signIn(email: string, password: string) {
  try {
    const userCredential = await signInWithEmailAndPassword(firebaseAuth, email, password)
    return { user: userCredential.user, error: null }
  } catch (error: any) {
    return { user: null, error: error.message }
  }
}

export async function signUp(email: string, password: string, name: string) {
  try {
    const userCredential = await createUserWithEmailAndPassword(firebaseAuth, email, password)
    return { user: userCredential.user, error: null }
  } catch (error: any) {
    return { user: null, error: error.message }
  }
}

export async function signInWithGoogle() {
  try {
    const provider = new GoogleAuthProvider()
    const userCredential = await signInWithPopup(firebaseAuth, provider)
    return { user: userCredential.user, error: null }
  } catch (error: any) {
    return { user: null, error: error.message }
  }
}

export async function signOut() {
  try {
    await firebaseSignOut(firebaseAuth)
    return { error: null }
  } catch (error: any) {
    return { error: error.message }
  }
}

