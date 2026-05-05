import {
  collection,
  getDocs,
  limit,
  query,
  type Firestore,
  where,
} from "firebase/firestore"

import { normalizeBeamProjectDocument, type BeamProject } from "@/lib/beam"

type AuthLikeUser = {
  uid?: string | null
  email?: string | null
  displayName?: string | null
  getIdToken?: () => Promise<string>
}

function normalizeEmail(email?: string | null) {
  return (email || "").trim().toLowerCase()
}

function normalizeClientId(clientId?: string | null) {
  return (clientId || "").trim().toLowerCase()
}

async function fetchClientPortalResolution({
  clientId,
  user,
}: {
  clientId?: string | null
  user?: AuthLikeUser | null
}) {
  if (typeof window === "undefined" || !user?.getIdToken) {
    return null
  }

  const token = await user.getIdToken()
  const params = new URLSearchParams()
  const normalizedClientId = normalizeClientId(clientId)
  if (normalizedClientId) {
    params.set("clientId", normalizedClientId)
  }

  const response = await fetch(
    `/api/client-portal/resolve${params.size > 0 ? `?${params.toString()}` : ""}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  )

  const payload = (await response.json().catch(() => null)) as
    | {
        destination?: string
        project?: BeamProject | null
        error?: string
      }
    | null

  if (response.status === 404) {
    return {
      destination: "/dashboard",
      project: null,
    }
  }

  if (!response.ok || !payload) {
    throw new Error(payload?.error || "Unable to resolve client portal access.")
  }

  return {
    destination:
      typeof payload.destination === "string" && payload.destination
        ? payload.destination
        : "/dashboard",
    project: payload.project ?? null,
  }
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

export async function loadClientPortalProject({
  firestoreDb,
  clientId,
  user,
}: {
  firestoreDb: Firestore
  clientId: string
  user?: AuthLikeUser | null
}) {
  try {
    const resolved = await fetchClientPortalResolution({
      clientId,
      user,
    })
    if (resolved) {
      return resolved.project
    }
  } catch (error) {
    console.error("Unable to resolve client portal access via API:", error)
  }

  return findClientPortalProjectByIdAndEmail({
    firestoreDb,
    clientId,
    email: user?.email,
  })
}

export async function resolveClientDestination(
  firestoreDb: Firestore,
  email?: string | null,
  user?: AuthLikeUser | null
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
          name: user?.displayName ?? null,
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

  try {
    const resolved = await fetchClientPortalResolution({
      user,
    })
    if (resolved) {
      return resolved.destination
    }
  } catch (error) {
    console.error("Unable to resolve client portal destination via API:", error)
  }

  const project = await findClientPortalProjectByEmail(firestoreDb, email)
  if (!project) {
    return "/dashboard"
  }

  return `/portal/${project.clientId}`
}
