export type UserRole =
  | "owner"
  | "developer"
  | "collaborator"
  | "employee-of-client"
  | "beam-participant"
  | "admin"
export type MembershipStatus = "active" | "suspended" | "pending"

export interface ClientMembership {
  role: UserRole
  status: MembershipStatus
  createdAt: string
  updatedAt: string
}

export interface ClientRelationshipContract {
  userRole: UserRole
  clientIds: string[]
  activeClientId: string | null
  memberships: Record<string, ClientMembership>
}

const now = () => new Date().toISOString()

export function normalizeClientId(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

export function buildOwnerMembership(
  clientId: string,
  overrides?: Partial<ClientMembership>
): Record<string, ClientMembership> {
  return {
    [clientId]: {
      role: "owner",
      status: "active",
      createdAt: overrides?.createdAt ?? now(),
      updatedAt: now(),
      ...overrides,
    },
  }
}

export function contractFromUserDoc(
  data: Record<string, unknown>,
  preferredClientId?: string | null
): ClientRelationshipContract | null {
  const rawMemberships =
    data.memberships &&
    typeof data.memberships === "object" &&
    !Array.isArray(data.memberships)
      ? (data.memberships as Record<string, unknown>)
      : null
  const rawClientIds = Array.isArray(data.clientIds)
    ? data.clientIds
        .filter((value): value is string => typeof value === "string")
        .map(normalizeClientId)
        .filter(Boolean)
    : null

  if (rawMemberships && Object.keys(rawMemberships).length > 0) {
    const memberships: Record<string, ClientMembership> = {}

    for (const [rawClientId, rawMembership] of Object.entries(rawMemberships)) {
      const clientId = normalizeClientId(rawClientId)
      if (!clientId || !rawMembership || typeof rawMembership !== "object") {
        continue
      }

      const membership = rawMembership as Record<string, unknown>
      memberships[clientId] = {
        role: isUserRole(membership.role) ? membership.role : "collaborator",
        status: isMembershipStatus(membership.status) ? membership.status : "active",
        createdAt:
          typeof membership.createdAt === "string" ? membership.createdAt : now(),
        updatedAt:
          typeof membership.updatedAt === "string" ? membership.updatedAt : now(),
      }
    }

    const clientIds = Array.from(
      new Set([...(rawClientIds ?? []), ...Object.keys(memberships)])
    ).filter((clientId) => memberships[clientId]?.status === "active")
    const activeClientId = pickActiveClientId(clientIds, preferredClientId)

    return {
      clientIds,
      memberships,
      activeClientId,
      userRole: activeClientId
        ? memberships[activeClientId]?.role ?? "collaborator"
        : "collaborator",
    }
  }

  const legacyClientId = normalizeClientId(data.client_id)
  if (legacyClientId) {
    const memberships = buildOwnerMembership(legacyClientId)

    return {
      clientIds: [legacyClientId],
      memberships,
      activeClientId: legacyClientId,
      userRole: "owner",
    }
  }

  // Handle users with clientIds but no memberships (e.g., self-associated)
  if (rawClientIds && rawClientIds.length > 0) {
    const memberships: Record<string, ClientMembership> = {}
    for (const clientId of rawClientIds) {
      memberships[clientId] = {
        role: "owner",
        status: "active",
        createdAt: now(),
        updatedAt: now(),
      }
    }

    const activeClientId = pickActiveClientId(rawClientIds, preferredClientId)
    return {
      clientIds: rawClientIds,
      memberships,
      activeClientId,
      userRole: "owner",
    }
  }

  return null
}

function pickActiveClientId(clientIds: string[], preferred?: string | null) {
  const normalizedPreferred = normalizeClientId(preferred)
  if (normalizedPreferred && clientIds.includes(normalizedPreferred)) {
    return normalizedPreferred
  }

  return clientIds[0] ?? null
}

function isUserRole(value: unknown): value is UserRole {
  return (
    value === "owner" ||
    value === "developer" ||
    value === "collaborator" ||
    value === "employee-of-client" ||
    value === "beam-participant" ||
    value === "admin"
  )
}

function isMembershipStatus(value: unknown): value is MembershipStatus {
  return value === "active" || value === "suspended" || value === "pending"
}
