export const BEAM_ROLES = [
  "beam-admin",
  "rag-lead",
  "ngo-coordinator",
  "participant",
  "client-manager",
] as const

export type BeamRole = (typeof BEAM_ROLES)[number]

export const PROJECT_STATUSES = ["scoping", "active", "review", "complete"] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_SOURCE_NGOS = [
  "forge",
  "environment",
  "grounds",
  "orchestra",
  "finance",
  "law",
] as const

export type ProjectSourceNgo = (typeof PROJECT_SOURCE_NGOS)[number]

export interface BeamUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  roles: BeamRole[]
  memberships: string[]
  ngoScope: string[]
  createdAt?: Date | string | null
  lastLoginAt?: Date | string | null
}

export interface ProjectCohortMember {
  uid: string
  role: string
  revenueSharePct: number
  portfolioCredit: boolean
}

export interface BeamProject {
  id: string
  clientName: string
  clientId: string
  ragProjectLead: string
  beamParticipantLead: string
  sourceNgo: string
  ragRevenue: number
  participantRevenueShare: number
  status: ProjectStatus
  deliverables: string[]
  cohort: ProjectCohortMember[]
  clientPortalEmail: string
  expansionPlan: Record<string, never>
  sourceBusiness: string
  beamBookEntry: boolean
  repository: BeamProjectRepository | null
  createdAt?: Date | string | null
}

export interface BeamProjectRepository {
  provider: "github"
  owner: string
  name: string
  fullName: string
  url: string
  deploymentUrl: string | null
  attachedByUid: string | null
  attachedByEmail: string | null
  attachedAt?: Date | string | null
}

export interface BeamUserOption {
  uid: string
  email: string | null
  displayName: string | null
  roles: BeamRole[]
  memberships: string[]
}

const BEAM_ROLE_SET = new Set<string>(BEAM_ROLES)
const PROJECT_STATUS_SET = new Set<string>(PROJECT_STATUSES)
const PROJECT_SOURCE_NGO_SET = new Set<string>(PROJECT_SOURCE_NGOS)
const FALLBACK_SOURCE_NGO = "readyaimgo"

export function readTimestamp(value: unknown) {
  if (value instanceof Date || typeof value === "string" || value === null) {
    return value
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate()
  }

  return null
}

export function serializeTimestamp(value: unknown) {
  const timestamp = readTimestamp(value)

  if (timestamp instanceof Date) {
    return timestamp.toISOString()
  }

  if (typeof timestamp === "string") {
    return timestamp
  }

  return null
}

export function normalizeBeamRoles(value: unknown): BeamRole[] {
  if (!Array.isArray(value)) {
    return ["participant"]
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item): item is BeamRole => BEAM_ROLE_SET.has(item))

  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["participant"]
}

export function normalizeNgoList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => normalizeNgoSlug(item))
        .filter(Boolean)
    )
  )
}

export function normalizeProjectStatus(value: unknown): ProjectStatus {
  if (typeof value === "string" && PROJECT_STATUS_SET.has(value)) {
    return value as ProjectStatus
  }

  return "scoping"
}

export function normalizeNgoSlug(value?: string | null): string {
  const normalized = (value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalized || FALLBACK_SOURCE_NGO
}

export function normalizeProjectSourceNgo(value?: string | null): ProjectSourceNgo | null {
  const normalized = normalizeNgoSlug(value)

  if (PROJECT_SOURCE_NGO_SET.has(normalized)) {
    return normalized as ProjectSourceNgo
  }

  return null
}

export function deriveSourceNgo(hostname?: string | null): string {
  const configured = process.env.NEXT_PUBLIC_SOURCE_NGO
  if (configured) {
    return normalizeNgoSlug(configured)
  }

  const sanitizedHost = (hostname || "")
    .toLowerCase()
    .trim()
    .replace(/:\d+$/, "")

  if (!sanitizedHost || sanitizedHost === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(sanitizedHost)) {
    return FALLBACK_SOURCE_NGO
  }

  const hostParts = sanitizedHost.split(".").filter(Boolean)
  if (hostParts.length >= 3) {
    return normalizeNgoSlug(hostParts[hostParts.length - 2])
  }

  return normalizeNgoSlug(hostParts[0] || FALLBACK_SOURCE_NGO)
}

export function getEffectiveRoles({
  uid,
  roles,
}: {
  uid?: string | null
  roles?: BeamRole[] | null
}): BeamRole[] {
  const nextRoles = new Set<BeamRole>(normalizeBeamRoles(roles))
  const legacyAdminUid = process.env.NEXT_PUBLIC_ADMIN_UID || ""

  if (uid && legacyAdminUid && uid === legacyAdminUid) {
    nextRoles.add("beam-admin")
  }

  return Array.from(nextRoles)
}

export function hasRole(roles: BeamRole[], role: BeamRole) {
  return roles.includes(role)
}

export function hasAnyRole(roles: BeamRole[], allowedRoles: BeamRole[]) {
  return allowedRoles.some((role) => roles.includes(role))
}

export function slugifyClientId(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

export function normalizeBeamUserDocument(
  uid: string,
  value: Record<string, unknown> | null,
  fallback?: {
    email?: string | null
    displayName?: string | null
    photoURL?: string | null
  },
  sourceNgo?: string | null
): BeamUser {
  const memberships = normalizeNgoList(value?.memberships)
  const normalizedSourceNgo = normalizeNgoSlug(sourceNgo)

  return {
    uid,
    email:
      typeof value?.email === "string"
        ? value.email
        : fallback?.email?.trim() || null,
    displayName:
      typeof value?.displayName === "string"
        ? value.displayName
        : fallback?.displayName?.trim() || null,
    photoURL:
      typeof value?.photoURL === "string"
        ? value.photoURL
        : fallback?.photoURL?.trim() || null,
    roles: normalizeBeamRoles(value?.roles),
    memberships: memberships.length > 0 ? memberships : [normalizedSourceNgo],
    ngoScope: normalizeNgoList(value?.ngoScope),
    createdAt: readTimestamp(value?.createdAt),
    lastLoginAt: readTimestamp(value?.lastLoginAt),
  }
}

export function isProjectParticipant(project: BeamProject, uid: string) {
  if (!uid) {
    return false
  }

  if (project.beamParticipantLead === uid) {
    return true
  }

  return project.cohort.some((member) => member.uid === uid)
}

export function normalizeProjectCohort(value: unknown): ProjectCohortMember[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return []
    }

    const candidate = item as Record<string, unknown>
    const uid = typeof candidate.uid === "string" ? candidate.uid.trim() : ""
    const role = typeof candidate.role === "string" ? candidate.role.trim() : ""
    const revenueSharePct =
      typeof candidate.revenueSharePct === "number"
        ? candidate.revenueSharePct
        : Number(candidate.revenueSharePct)

    if (
      !uid ||
      !role ||
      !Number.isFinite(revenueSharePct) ||
      revenueSharePct < 0 ||
      revenueSharePct > 100
    ) {
      return []
    }

    return [
      {
        uid,
        role,
        revenueSharePct,
        portfolioCredit: Boolean(candidate.portfolioCredit),
      },
    ]
  })
}

export function normalizeProjectDeliverables(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function normalizeBeamProjectDocument(
  id: string,
  value: Record<string, unknown>
): BeamProject {
  const rawRepository =
    typeof value.repository === "object" && value.repository !== null
      ? (value.repository as Record<string, unknown>)
      : null
  const repository =
    rawRepository &&
    typeof rawRepository.owner === "string" &&
    typeof rawRepository.name === "string" &&
    typeof rawRepository.fullName === "string" &&
    typeof rawRepository.url === "string"
      ? {
          provider: "github" as const,
          owner: rawRepository.owner.trim(),
          name: rawRepository.name.trim(),
          fullName: rawRepository.fullName.trim(),
          url: rawRepository.url.trim(),
          deploymentUrl:
            typeof rawRepository.deploymentUrl === "string" &&
            rawRepository.deploymentUrl.trim()
              ? rawRepository.deploymentUrl.trim()
              : null,
          attachedByUid:
            typeof rawRepository.attachedByUid === "string" &&
            rawRepository.attachedByUid.trim()
              ? rawRepository.attachedByUid.trim()
              : null,
          attachedByEmail:
            typeof rawRepository.attachedByEmail === "string" &&
            rawRepository.attachedByEmail.trim()
              ? rawRepository.attachedByEmail.trim()
              : null,
          attachedAt: readTimestamp(rawRepository.attachedAt),
        }
      : null

  return {
    id,
    clientName: typeof value.clientName === "string" ? value.clientName : "",
    clientId: typeof value.clientId === "string" ? value.clientId : id,
    ragProjectLead: typeof value.ragProjectLead === "string" ? value.ragProjectLead : "",
    beamParticipantLead:
      typeof value.beamParticipantLead === "string" ? value.beamParticipantLead : "",
    sourceNgo:
      normalizeProjectSourceNgo(typeof value.sourceNgo === "string" ? value.sourceNgo : null) ||
      "forge",
    ragRevenue: typeof value.ragRevenue === "number" ? value.ragRevenue : 0,
    participantRevenueShare:
      typeof value.participantRevenueShare === "number"
        ? value.participantRevenueShare
        : 0,
    status: normalizeProjectStatus(value.status),
    deliverables: normalizeProjectDeliverables(value.deliverables),
    cohort: normalizeProjectCohort(value.cohort),
    clientPortalEmail:
      typeof value.clientPortalEmail === "string" ? value.clientPortalEmail : "",
    expansionPlan: {},
    sourceBusiness:
      typeof value.sourceBusiness === "string" && value.sourceBusiness.trim()
        ? value.sourceBusiness.trim()
        : "readyaimgo",
    beamBookEntry: Boolean(value.beamBookEntry),
    repository,
    createdAt: serializeTimestamp(value.createdAt),
  }
}
