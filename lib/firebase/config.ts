import { initializeApp, getApps, FirebaseApp } from "firebase/app"
import { getAuth, Auth } from "firebase/auth"
import { getFirestore, Firestore } from "firebase/firestore"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

// Check if config is valid (not dummy values)
const isConfigValid = () => {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== "dummy" &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== "dummy" &&
    firebaseConfig.authDomain &&
    firebaseConfig.authDomain !== "dummy"
  )
}

// Initialize Firebase app with error handling for build time
let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

const initializeFirebase = () => {
  if (app) return // Already initialized
  
  if (!isConfigValid()) {
    throw new Error(
      "Firebase configuration is missing or invalid. " +
      "Please set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID, and other Firebase environment variables."
    )
  }

  try {
    app = !getApps().length
      ? initializeApp(firebaseConfig)
      : getApps()[0]
    
    auth = getAuth(app)
    db = getFirestore(app)
  } catch (error) {
    console.error("Firebase initialization error:", error)
    throw error
  }
}

// Initialize Firebase - only if config is valid
if (isConfigValid()) {
  try {
    initializeFirebase()
  } catch (error) {
    // During build, this might fail - that's okay
    // At runtime, if config is valid, it should work
    if (typeof window !== "undefined") {
      console.error("Failed to initialize Firebase:", error)
    }
  }
} else {
  // If config is invalid, log a warning but don't initialize
  // This allows build to complete, but runtime will fail with clear errors
  if (typeof window !== "undefined") {
    console.error(
      "Firebase configuration is missing or invalid. " +
      "Please check your environment variables: NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID, etc."
    )
  }
}

// Export getters that ensure initialization
export const getApp = (): FirebaseApp => {
  if (!app && isConfigValid()) {
    initializeFirebase()
  }
  if (!app) {
    throw new Error("Firebase is not initialized. Please check your environment variables.")
  }
  return app
}

export const getAuthInstance = (): Auth => {
  if (!auth && isConfigValid()) {
    initializeFirebase()
  }
  if (!auth) {
    throw new Error("Firebase Auth is not initialized. Please check your environment variables.")
  }
  return auth
}

export const getDb = (): Firestore => {
  if (!db && isConfigValid()) {
    initializeFirebase()
  }
  if (!db) {
    throw new Error("Firestore is not initialized. Please check your environment variables and ensure the Firestore database exists.")
  }
  return db
}

// Export for backward compatibility
export { getApp as app, getAuthInstance as auth, getDb as db }

