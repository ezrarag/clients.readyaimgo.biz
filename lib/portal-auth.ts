import { type NextRequest } from "next/server"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import {
  contractFromUserDoc,
  normalizeClientId,
  type ClientMembership,
  type UserRole,
} from "@/lib/types/client-membership"

export interface PortalIdentity {
  uid: string
  email: string | null
  activeClientId: string
  clientIds: string[]
  userRole: UserRole
  memberships: Record<string, ClientMembership>
}

export function emailToDocId(email: string) {
  return email.trim().toLowerCase().replace(/\./g, "_")
}

export function getBearerToken(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization") || ""
  return authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length).trim()
    : null
}

export async function resolvePortalIdentity(
  request: NextRequest,
  preferredClientId?: string | null
): Promise<PortalIdentity | null> {
  const idToken = getBearerToken(request)
  if (!idToken) {
    return null
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()
    const email = decodedToken.email?.trim().toLowerCase() || null

    if (email) {
      const allowlistSnapshot = await db
        .collection("ragAllowlist")
        .doc(emailToDocId(email))
        .get()

      if (
        allowlistSnapshot.exists &&
        (allowlistSnapshot.data() as Record<string, unknown>)?.active === false
      ) {
        return null
      }
    }

    const userSnapshot = await db.collection("users").doc(decodedToken.uid).get()
    if (!userSnapshot.exists) {
      return null
    }

    const contract = contractFromUserDoc(
      (userSnapshot.data() ?? {}) as Record<string, unknown>,
      preferredClientId
    )

    if (!contract?.activeClientId) {
      return null
    }

    return {
      uid: decodedToken.uid,
      email,
      activeClientId: contract.activeClientId,
      clientIds: contract.clientIds,
      userRole: contract.userRole,
      memberships: contract.memberships,
    }
  } catch {
    return null
  }
}

export function isClientAllowed(identity: PortalIdentity, resourceClientId: string) {
  const normalizedResourceClientId = normalizeClientId(resourceClientId)
  return Boolean(
    normalizedResourceClientId &&
      identity.clientIds.some(
        (clientId) => normalizeClientId(clientId) === normalizedResourceClientId
      )
  )
}
