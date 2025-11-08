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

// Initialize Firebase app with error handling for build time
let app: FirebaseApp
let auth: Auth
let db: Firestore

try {
  // Only initialize if we have the minimum required config
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    app = !getApps().length
      ? initializeApp(firebaseConfig)
      : getApps()[0]
    
    auth = getAuth(app)
    db = getFirestore(app)
  } else {
    // During build, if config is missing, create dummy instances
    // These will be properly initialized at runtime when env vars are available
    throw new Error("Firebase config missing")
  }
} catch (error) {
  // During build time, if Firebase fails to initialize, create placeholder exports
  // This allows the build to complete. Runtime will fail with proper error messages.
  console.warn("Firebase initialization skipped during build:", error instanceof Error ? error.message : "Unknown error")
  
  // Create a minimal app instance to satisfy type requirements
  // This will fail at runtime if actually used without proper config
  const dummyConfig = {
    apiKey: "dummy",
    authDomain: "dummy",
    projectId: "dummy",
    storageBucket: "dummy",
    messagingSenderId: "dummy",
    appId: "dummy",
  }
  
  app = initializeApp(dummyConfig, "dummy")
  auth = getAuth(app)
  db = getFirestore(app)
}

export { app, auth, db }

