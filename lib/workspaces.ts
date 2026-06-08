// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Canonical workspace roles shared with the Admin dashboard.
 *
 * - owner: business owner / account authority
 * - developer: ReadyAimGo developer with workspace execution access
 * - collaborator: external collaborator with active workspace access
 * - employee-of-client: client-side team member
 * - beam-participant: BEAM participant attached to the work
 */
export type WorkspaceRole =
  | "owner"
  | "developer"
  | "collaborator"
  | "employee-of-client"
  | "beam-participant"

export type AssetProjectType = "webdev" | "participant" | "transportation" | "real-estate"

export const ASSET_PROJECT_TYPES: Array<{ value: AssetProjectType; label: string }> = [
  { value: "webdev", label: "Nexus" },
  { value: "participant", label: "Cohort Network" },
  { value: "transportation", label: "Motion Network" },
  { value: "real-estate", label: "Space Network" },
]

export function parseAssetProjectType(value: unknown): AssetProjectType {
  return value === "participant" ||
    value === "transportation" ||
    value === "real-estate" ||
    value === "webdev"
    ? value
    : "webdev"
}

export function assetProjectTypeLabel(value: AssetProjectType) {
  return ASSET_PROJECT_TYPES.find((type) => type.value === value)?.label ?? "Nexus"
}

export interface GitHubRepo {
  id: number
  fullName: string
  url: string
  description: string | null
  language: string | null
  homepage: string | null
  stars: number
  isPrivate: boolean
  updatedAt: string
}

export interface VercelProject {
  id: string
  name: string
  url: string | null
  framework: string | null
  updatedAt: string | null
  teamId?: string | null
  deploymentState?: string | null
  domains?: string[]
  repoSlug?: string | null
  githubRepo?: string | null
  repository?: { fullName?: string; url?: string } | null
}

export type HostingProvider =
  | "vercel"
  | "namecheap"
  | "manual-dns"
  | "static-host"
  | "other"

export interface DomainRegistrarRecord {
  id: string
  registrar: "namecheap" | "other"
  domain: string
  nameservers: string[]
  renewalDate: string | null
  accountLabel: string | null
  notes: string | null
}

export interface ManualDnsTarget {
  id: string
  host: string
  recordType: "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "NS" | "SRV" | "CAA"
  value: string
  ttl: number | null
  status: "planned" | "active" | "needs-review"
  notes: string | null
}

export interface StaticHostingPlatform {
  id: string
  provider: "netlify" | "cloudflare-pages" | "github-pages" | "firebase-hosting" | "other"
  projectName: string
  dashboardUrl: string | null
  productionUrl: string | null
  repoSlug: string | null
  status: "planned" | "active" | "paused" | "needs-review"
}

export interface WorkspaceHostingConfig {
  primaryProvider: HostingProvider
  domainRegistrars: DomainRegistrarRecord[]
  manualDnsTargets: ManualDnsTarget[]
  staticHosts: StaticHostingPlatform[]
  infrastructureFlags: {
    hasExternalDns: boolean
    hasManualRecords: boolean
    hasStaticFallback: boolean
    needsDnsReview: boolean
  }
  notes: string | null
}

export type MeetingProviderId = "google-meet" | "zoom" | "microsoft-teams" | "facebook-messenger"

export interface WorkspaceMeetingProvider {
  id: MeetingProviderId
  enabled: boolean
  label: string
  accountEmail: string | null
  calendarId: string | null
  webhookUrl: string | null
  meetingBaseUrl: string | null
  isDefault: boolean
  source: "google-login" | "workspace" | "profile" | "ra-command"
}

export interface WorkspaceMember {
  uid: string
  email: string
  displayName: string | null
  role: WorkspaceRole
  addedAt: string
  /**
   * Subset of workspace repo IDs this member can see.
   * Empty array = all repos.
   */
  assignedRepos: string[]
  /**
   * Subset of workspace Vercel project IDs this member can see.
   * Empty array = all projects.
   */
  assignedVercelIds: string[]
}

export interface WorkspaceMemberSummary {
  uid: string
  email: string
  displayName: string | null
  role: WorkspaceRole
}

export interface Workspace {
  id: string
  name: string
  workspaceName: string | null
  businessName: string | null
  clientBusinessName: string | null
  ownerUid: string
  repos: GitHubRepo[]
  vercelProjects: VercelProject[]
  memberCount: number
  createdAt: string
  updatedAt: string
  /**
   * Email domain suffixes that auto-grant the specified role on sign-in.
   * e.g. ["acme.com"] → any @acme.com user becomes a collaborator automatically.
   */
  domains: string[]
  /**
   * Default role granted to users whose email matches a domain in `domains`.
   * Defaults to "employee-of-client" if not set.
   */
  domainRole: WorkspaceRole
  /** GitHub org/user slug used for browsing repos (e.g. "acme-inc"). */
  githubOrg: string | null
  /** Vercel team slug or id used for browsing projects. */
  vercelTeamId: string | null
  /** Provider-agnostic hosting metadata for Vercel, DNS, registrars, and static hosts. */
  hosting: WorkspaceHostingConfig
  /** Workspace-level meeting/call account preferences. */
  meetingProviders: WorkspaceMeetingProvider[]

  // ── Legacy bridge fields ────────────────────────────────────────────────────
  // These link a workspace back to the existing clients/{clientId} and
  // organizations/{orgId} collections so legacy API routes keep working while
  // we migrate to workspace-first identity.

  /** Doc ID of the linked clients/{clientId} record (typically the email). */
  clientId: string | null
  /** Canonical email address for the client, kept separate from the doc key. */
  clientEmail: string | null
  /** Email originally used to register or claim the workspace, when available. */
  registrationEmail: string | null
  /** Canonical primary domain for display/routing, when available. */
  primaryDomain: string | null
  /** Target domain or deployment domain currently mapped to this workspace. */
  targetDomain: string | null
  /** Linked organizations/{orgId} doc — populated when the workspace was
   *  created from or auto-resolved against an existing org record. */
  orgId: string | null
  /** Stripe customer ID mirrored from the client/org record for fast billing
   *  lookups without a round-trip to clients/{clientId}. */
  stripeCustomerId: string | null
  /** IDs of legacy project docs associated with this workspace. */
  projectIds: string[]
  /** IDs of contract docs associated with this workspace. */
  contractIds: string[]
  /** Caller-specific role added by workspace listing endpoints. */
  currentUserRole?: WorkspaceRole | "beam-admin" | null
  /** Lightweight member roster added by workspace listing endpoints. */
  memberSummaries?: WorkspaceMemberSummary[]
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

/** Safe role parser — returns null for unrecognised values. */
export function parseWorkspaceRole(value: unknown): WorkspaceRole | null {
  if (
    value === "owner" ||
    value === "developer" ||
    value === "collaborator" ||
    value === "employee-of-client" ||
    value === "beam-participant"
  ) {
    return value
  }
  return null
}

function normalizeTimestamp(value: unknown): string {
  if (!value) return new Date().toISOString()
  if (typeof value === "string") return value
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return new Date().toISOString()
}

function isGitHubRepo(value: unknown): value is GitHubRepo {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).fullName === "string"
  )
}

function isVercelProject(value: unknown): value is VercelProject {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === "string"
  )
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function serializeTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (
    value &&
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    const date = new Date((value as { seconds: number }).seconds * 1000)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return null
    }
  }
  return null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

function normalizeHosting(data: unknown): WorkspaceHostingConfig {
  const raw = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}
  const flags =
    typeof raw.infrastructureFlags === "object" && raw.infrastructureFlags !== null
      ? (raw.infrastructureFlags as Record<string, unknown>)
      : {}

  const primaryProvider =
    raw.primaryProvider === "namecheap" ||
    raw.primaryProvider === "manual-dns" ||
    raw.primaryProvider === "static-host" ||
    raw.primaryProvider === "other"
      ? raw.primaryProvider
      : "vercel"

  const domainRegistrars = Array.isArray(raw.domainRegistrars)
    ? raw.domainRegistrars.map((item, index) => {
        const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
        return {
          id: readString(entry.id) ?? `registrar-${index}`,
          registrar: entry.registrar === "namecheap" ? "namecheap" : "other",
          domain: readString(entry.domain) ?? "",
          nameservers: readStringArray(entry.nameservers),
          renewalDate: serializeTimestamp(entry.renewalDate),
          accountLabel: readString(entry.accountLabel),
          notes: readString(entry.notes),
        } satisfies DomainRegistrarRecord
      })
    : []

  const manualDnsTargets = Array.isArray(raw.manualDnsTargets)
    ? raw.manualDnsTargets.map((item, index) => {
        const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
        const recordType = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"].includes(
          String(entry.recordType)
        )
          ? (entry.recordType as ManualDnsTarget["recordType"])
          : "CNAME"
        const status =
          entry.status === "active" || entry.status === "needs-review" ? entry.status : "planned"
        return {
          id: readString(entry.id) ?? `dns-${index}`,
          host: readString(entry.host) ?? "",
          recordType,
          value: readString(entry.value) ?? "",
          ttl: typeof entry.ttl === "number" && Number.isFinite(entry.ttl) ? entry.ttl : null,
          status,
          notes: readString(entry.notes),
        } satisfies ManualDnsTarget
      })
    : []

  const staticHosts = Array.isArray(raw.staticHosts)
    ? raw.staticHosts.map((item, index) => {
        const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
        const provider = [
          "netlify",
          "cloudflare-pages",
          "github-pages",
          "firebase-hosting",
          "other",
        ].includes(String(entry.provider))
          ? (entry.provider as StaticHostingPlatform["provider"])
          : "other"
        const status =
          entry.status === "active" || entry.status === "paused" || entry.status === "needs-review"
            ? entry.status
            : "planned"
        return {
          id: readString(entry.id) ?? `static-${index}`,
          provider,
          projectName: readString(entry.projectName) ?? "",
          dashboardUrl: readString(entry.dashboardUrl),
          productionUrl: readString(entry.productionUrl),
          repoSlug: readString(entry.repoSlug),
          status,
        } satisfies StaticHostingPlatform
      })
    : []

  return {
    primaryProvider,
    domainRegistrars,
    manualDnsTargets,
    staticHosts,
    infrastructureFlags: {
      hasExternalDns: Boolean(flags.hasExternalDns),
      hasManualRecords: Boolean(flags.hasManualRecords),
      hasStaticFallback: Boolean(flags.hasStaticFallback),
      needsDnsReview: Boolean(flags.needsDnsReview),
    },
    notes: readString(raw.notes),
  }
}

function normalizeMeetingProviders(data: unknown): WorkspaceMeetingProvider[] {
  if (!Array.isArray(data)) return []
  return data.map((item): WorkspaceMeetingProvider | null => {
    const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
    const id =
      entry.id === "google-meet" ||
      entry.id === "zoom" ||
      entry.id === "microsoft-teams" ||
      entry.id === "facebook-messenger"
        ? entry.id
        : null
    if (!id) return null
    const source =
      entry.source === "google-login" ||
      entry.source === "profile" ||
      entry.source === "ra-command"
        ? entry.source
        : "workspace"
    return {
      id,
      enabled: Boolean(entry.enabled),
      label: readString(entry.label) ?? id,
      accountEmail: readString(entry.accountEmail),
      calendarId: readString(entry.calendarId),
      webhookUrl: readString(entry.webhookUrl),
      meetingBaseUrl: readString(entry.meetingBaseUrl),
      isDefault: Boolean(entry.isDefault),
      source,
    }
  }).filter((item): item is WorkspaceMeetingProvider => Boolean(item))
}

export function normalizeWorkspace(id: string, data: Record<string, unknown>): Workspace {
  return {
    id,
    name: typeof data.name === "string" ? data.name.trim() : "",
    workspaceName: typeof data.workspaceName === "string" ? data.workspaceName.trim() : null,
    businessName: typeof data.businessName === "string" ? data.businessName.trim() : null,
    clientBusinessName:
      typeof data.clientBusinessName === "string" ? data.clientBusinessName.trim() : null,
    ownerUid: typeof data.ownerUid === "string" ? data.ownerUid : "",
    repos: Array.isArray(data.repos) ? data.repos.filter(isGitHubRepo) : [],
    vercelProjects: Array.isArray(data.vercelProjects)
      ? data.vercelProjects.filter(isVercelProject)
      : [],
    memberCount: typeof data.memberCount === "number" ? data.memberCount : 1,
    createdAt: normalizeTimestamp(data.createdAt),
    updatedAt: normalizeTimestamp(data.updatedAt),
    domains: Array.isArray(data.domains)
      ? (data.domains as unknown[]).filter((d): d is string => typeof d === "string")
      : [],
    domainRole: parseWorkspaceRole(data.domainRole) ?? "employee-of-client",
    githubOrg: typeof data.githubOrg === "string" ? data.githubOrg : null,
    vercelTeamId: typeof data.vercelTeamId === "string" ? data.vercelTeamId : null,
    hosting: normalizeHosting(data.hosting),
    meetingProviders: normalizeMeetingProviders(data.meetingProviders),
    // Legacy bridge
    clientId: typeof data.clientId === "string" ? data.clientId : null,
    clientEmail: typeof data.clientEmail === "string" ? data.clientEmail : null,
    registrationEmail:
      typeof data.registrationEmail === "string" ? data.registrationEmail : null,
    primaryDomain: typeof data.primaryDomain === "string" ? data.primaryDomain : null,
    targetDomain: typeof data.targetDomain === "string" ? data.targetDomain : null,
    orgId: typeof data.orgId === "string" ? data.orgId : null,
    stripeCustomerId: typeof data.stripeCustomerId === "string" ? data.stripeCustomerId : null,
    projectIds: Array.isArray(data.projectIds)
      ? (data.projectIds as unknown[]).filter((p): p is string => typeof p === "string")
      : [],
    contractIds: Array.isArray(data.contractIds)
      ? (data.contractIds as unknown[]).filter((c): c is string => typeof c === "string")
      : [],
  }
}

export function normalizeWorkspaceMember(
  uid: string,
  data: Record<string, unknown>
): WorkspaceMember {
  return {
    uid,
    email: typeof data.email === "string" ? data.email : "",
    displayName: typeof data.displayName === "string" ? data.displayName : null,
    role: parseWorkspaceRole(data.role) ?? "employee-of-client",
    addedAt: normalizeTimestamp(data.addedAt),
    assignedRepos: Array.isArray(data.assignedRepos)
      ? (data.assignedRepos as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
    assignedVercelIds: Array.isArray(data.assignedVercelIds)
      ? (data.assignedVercelIds as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
  }
}

// ─── Helpers for API routes ───────────────────────────────────────────────────

export function slugifyWorkspaceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
}

export function generateWorkspaceId(name: string): string {
  const slug = slugifyWorkspaceName(name)
  const suffix = Math.random().toString(36).slice(2, 7)
  return slug ? `${slug}-${suffix}` : `workspace-${suffix}`
}
