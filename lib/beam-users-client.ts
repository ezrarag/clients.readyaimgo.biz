import type { User } from "firebase/auth"
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore"

import {
  deriveSourceNgo,
  normalizeBeamUserDocument,
  normalizeNgoSlug,
} from "@/lib/beam"

export async function ensureBeamUserRecord({
  firestoreDb,
  user,
  sourceNgo,
}: {
  firestoreDb: Firestore
  user: User
  sourceNgo?: string | null
}) {
  const normalizedSourceNgo = normalizeNgoSlug(
    sourceNgo || deriveSourceNgo(typeof window !== "undefined" ? window.location.hostname : undefined)
  )

  const userRef = doc(firestoreDb, "users", user.uid)
  const existingSnapshot = await getDoc(userRef)
  const existing = existingSnapshot.exists()
    ? (existingSnapshot.data() as Record<string, unknown>)
    : null

  const normalizedUser = normalizeBeamUserDocument(
    user.uid,
    existing,
    {
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    },
    normalizedSourceNgo
  )

  const roles = existingSnapshot.exists() ? normalizedUser.roles : ["participant"]
  const memberships = existingSnapshot.exists()
    ? normalizedUser.memberships
    : [normalizedSourceNgo]

  await setDoc(
    userRef,
    {
      email: user.email ?? normalizedUser.email ?? null,
      displayName: user.displayName ?? normalizedUser.displayName ?? null,
      photoURL: user.photoURL ?? normalizedUser.photoURL ?? null,
      roles,
      memberships,
      ngoScope: normalizedUser.ngoScope,
      createdAt: existing?.createdAt ?? serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    },
    { merge: true }
  )

  return {
    created: !existingSnapshot.exists(),
    profile: {
      ...normalizedUser,
      roles,
      memberships,
    },
  }
}
