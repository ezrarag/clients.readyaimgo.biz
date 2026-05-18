import { type NextRequest } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import {
  buildOwnerMembership,
  contractFromUserDoc,
  normalizeClientId,
  type ClientMembership,
  type ClientRelationshipContract,
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

function contractFromAllowlistDoc(
  data: Record<string, unknown>,
  preferredClientId?: string | null
): ClientRelationshipContract | null {
  const contract = contractFromUserDoc(data, preferredClientId)
  if (contract?.activeClientId) {
    return contract
  }

  const legacyClientId = normalizeClientId(data.clientId)
  if (!legacyClientId) {
    return null
  }

  const memberships = buildOwnerMembership(legacyClientId)
  return {
    clientIds: [legacyClientId],
    memberships,
    activeClientId: legacyClientId,
    userRole: "owner",
  }
}

async function bootstrapUserContractFromAllowlist({
  uid,
  email,
  allowlistData,
  preferredClientId,
}: {
  uid: string
  email: string | null
  allowlistData: Record<string, unknown>
  preferredClientId?: string | null
}): Promise<ClientRelationshipContract | null> {
  const contract = contractFromAllowlistDoc(allowlistData, preferredClientId)
  if (!contract?.activeClientId) {
    return null
  }

  await getAdminDb().collection("users").doc(uid).set(
    {
      ...(email ? { email } : {}),
      client_id: contract.activeClientId,
      clientIds: contract.clientIds,
      memberships: contract.memberships,
      portalAccessBootstrappedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )

  return contract
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
    let allowlistData: Record<string, unknown> | null = null

    if (email) {
      const allowlistSnapshot = await db
        .collection("ragAllowlist")
        .doc(emailToDocId(email))
        .get()

      if (allowlistSnapshot.exists) {
        allowlistData = (allowlistSnapshot.data() ?? {}) as Record<string, unknown>

        if (allowlistData.active === false) {
          return null
        }
      }
    }

    const userSnapshot = await db.collection("users").doc(decodedToken.uid).get()
    const contract = userSnapshot.exists
      ? contractFromUserDoc(
          (userSnapshot.data() ?? {}) as Record<string, unknown>,
          preferredClientId
        )
      : null

    const resolvedContract = contract?.activeClientId
      ? contract
      : allowlistData
        ? await bootstrapUserContractFromAllowlist({
            uid: decodedToken.uid,
            email,
            allowlistData,
            preferredClientId,
          })
        : null

    if (!resolvedContract?.activeClientId) return null

    return {
      uid: decodedToken.uid,
      email,
      activeClientId: resolvedContract.activeClientId,
      clientIds: resolvedContract.clientIds,
      userRole: resolvedContract.userRole,
      memberships: resolvedContract.memberships,
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
