import {
  collection,
  getDocs,
  limit,
  query,
  type Firestore,
  where,
} from "firebase/firestore"

import { normalizeBeamProjectDocument, type BeamProject } from "@/lib/beam"

function normalizeEmail(email?: string | null) {
  return (email || "").trim().toLowerCase()
}

export async function findClientPortalProjectByEmail(
  firestoreDb: Firestore,
  email?: string | null
): Promise<BeamProject | null> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return null
  }

  const snapshot = await getDocs(
    query(
      collection(firestoreDb, "projects"),
      where("clientPortalEmail", "==", normalizedEmail),
      limit(1)
    )
  )

  if (snapshot.empty) {
    return null
  }

  const projectDoc = snapshot.docs[0]
  return normalizeBeamProjectDocument(
    projectDoc.id,
    projectDoc.data() as Record<string, unknown>
  )
}

export async function findClientPortalProjectByIdAndEmail({
  firestoreDb,
  clientId,
  email,
}: {
  firestoreDb: Firestore
  clientId: string
  email?: string | null
}): Promise<BeamProject | null> {
  const normalizedEmail = normalizeEmail(email)
  const normalizedClientId = clientId.trim().toLowerCase()

  if (!normalizedEmail || !normalizedClientId) {
    return null
  }

  const snapshot = await getDocs(
    query(
      collection(firestoreDb, "projects"),
      where("clientId", "==", normalizedClientId),
      where("clientPortalEmail", "==", normalizedEmail),
      limit(1)
    )
  )

  if (snapshot.empty) {
    return null
  }

  const projectDoc = snapshot.docs[0]
  return normalizeBeamProjectDocument(
    projectDoc.id,
    projectDoc.data() as Record<string, unknown>
  )
}

export async function resolveClientDestination(
  firestoreDb: Firestore,
  email?: string | null,
  user?: {
    uid?: string | null
    name?: string | null
  }
) {
  const normalizedEmail = normalizeEmail(email)

  if (normalizedEmail && typeof window !== "undefined") {
    try {
      const response = await fetch("/api/organizations/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          uid: user?.uid ?? null,
          name: user?.name ?? null,
        }),
      })
      const payload: unknown = await response.json()

      if (
        response.ok &&
        typeof payload === "object" &&
        payload !== null &&
        "orgId" in payload &&
        typeof payload.orgId === "string" &&
        payload.orgId
      ) {
        return `/org/${payload.orgId}/dashboard`
      }
    } catch (error) {
      console.error("Unable to resolve organization destination:", error)
    }
  }

  const project = await findClientPortalProjectByEmail(firestoreDb, email)
  if (!project) {
    return "/dashboard"
  }

  return `/portal/${project.clientId}`
}
