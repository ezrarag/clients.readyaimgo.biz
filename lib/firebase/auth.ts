import { getAuthInstance } from "./config"
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth"

export async function signIn(email: string, password: string) {
  try {
    const userCredential = await signInWithEmailAndPassword(getAuthInstance(), email, password)
    return { user: userCredential.user, error: null }
  } catch (error: any) {
    return { user: null, error: error.message }
  }
}

export async function signUp(email: string, password: string, name: string) {
  try {
    const userCredential = await createUserWithEmailAndPassword(getAuthInstance(), email, password)
    if (name.trim()) {
      await updateProfile(userCredential.user, {
        displayName: name.trim(),
      })
    }
    return { user: userCredential.user, error: null }
  } catch (error: any) {
    return { user: null, error: error.message }
  }
}

export async function signInWithGoogle() {
  try {
    const provider = new GoogleAuthProvider()
    const userCredential = await signInWithPopup(getAuthInstance(), provider)
    return { user: userCredential.user, error: null }
  } catch (error: any) {
    return { user: null, error: error.message }
  }
}

export async function signOut() {
  try {
    await firebaseSignOut(getAuthInstance())
    return { error: null }
  } catch (error: any) {
    return { error: error.message }
  }
}
