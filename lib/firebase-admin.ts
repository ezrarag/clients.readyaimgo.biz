import { cert, getApps, initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"
import type { NextRequest } from "next/server"

import {
  deriveSourceNgo,
  getEffectiveRoles,
  normalizeBeamUserDocument,
} from "@/lib/beam"

function getAdminApp() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    })
  }

  return getApps()[0]
}

export function getAdminDb() {
  return getFirestore(getAdminApp())
}

export function getAdminAuth() {
  return getAuth(getAdminApp())
}

function getBearerToken(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization") || ""

  if (!authorizationHeader.startsWith("Bearer ")) {
    return null
  }

  return authorizationHeader.slice("Bearer ".length).trim()
}

export async function getAuthenticatedBeamUser(request: NextRequest) {
  const idToken = getBearerToken(request)
  if (!idToken) {
    const error = new Error("Missing Firebase authorization token.")
    ;(error as Error & { status?: number }).status = 401
    throw error
  }

  const auth = getAdminAuth()
  const db = getAdminDb()
  const decodedToken = await auth.verifyIdToken(idToken)
  const sourceNgo = deriveSourceNgo(request.headers.get("host"))
  const userSnapshot = await db.collection("users").doc(decodedToken.uid).get()
  const beamUser = normalizeBeamUserDocument(
    decodedToken.uid,
    userSnapshot.exists ? (userSnapshot.data() as Record<string, unknown>) : null,
    {
      email: decodedToken.email,
      displayName: decodedToken.name,
      photoURL: decodedToken.picture,
    },
    sourceNgo
  )

  return {
    db,
    decodedToken,
    sourceNgo,
    beamUser,
    roles: getEffectiveRoles({
      uid: decodedToken.uid,
      roles: beamUser.roles,
    }),
  }
}
