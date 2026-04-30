export const ORG_PLANS = ["starter", "growth", "enterprise"] as const
export const ORG_STATUSES = ["active", "trial", "paused", "churned"] as const
export const ORG_MEMBER_ROLES = ["owner", "admin", "viewer"] as const
export const ORG_PROJECT_STATUSES = ["active", "paused", "complete"] as const
export const ORG_FILE_TYPES = ["upload", "google_drive", "link"] as const
export const ORG_TASK_PRIORITIES = ["high", "medium", "low"] as const
export const ORG_TASK_SOURCES = ["ai_extracted", "manual"] as const
export const ORG_TASK_EXTRACTION_STATUSES = [
  "pending",
  "processing",
  "done",
  "failed",
] as const

export type OrgPlan = (typeof ORG_PLANS)[number]
export type OrgStatus = (typeof ORG_STATUSES)[number]
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number]
export type OrgProjectStatus = (typeof ORG_PROJECT_STATUSES)[number]
export type OrgFileType = (typeof ORG_FILE_TYPES)[number]
export type OrgTaskPriority = (typeof ORG_TASK_PRIORITIES)[number]
export type OrgTaskSource = (typeof ORG_TASK_SOURCES)[number]
export type OrgTaskExtractionStatus =
  (typeof ORG_TASK_EXTRACTION_STATUSES)[number]

export interface OrgTask {
  id: string
  text: string
  done: boolean
  assignedTo: string | null
  dueDate: string | null
  priority: OrgTaskPriority | null
  source: OrgTaskSource
  createdAt: string | null
}

export interface Organization {
  id: string
  name: string
  slug: string
  plan: OrgPlan
  stripeCustomerId: string | null
  subscriptionId: string | null
  status: OrgStatus
  createdAt: string | null
  createdByUid: string
  city: string
  website: string
  logoUrl: string | null
  onboardingNotes: string
}

export interface OrgMember {
  uid: string
  email: string
  name: string
  role: OrgMemberRole
  joinedAt: string | null
  invitedBy: string | null
}

export interface OrgProject {
  id: string
  name: string
  status: OrgProjectStatus
  description: string
  startDate: string | null
  targetDate: string | null
  ragLeadEmail: string
  createdAt: string | null
  tasks: OrgTask[]
}

export interface OrgFile {
  id: string
  projectId: string | null
  name: string
  type: OrgFileType
  url: string
  mimeType: string
  size: number | null
  storagePath: string | null
  uploadedByUid: string
  uploadedAt: string | null
  extractedTasks: OrgTask[]
  taskExtractionStatus: OrgTaskExtractionStatus | null
}

export interface OrgInvite {
  email: string
  role: OrgMemberRole
  invitedBy: string | null
  invitedAt: string | null
  status: "pending" | "accepted" | "revoked"
  token?: string
  acceptedAt?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function serializeTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (
    isRecord(value) &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().toISOString()
  }

  return null
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null
}

function readNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback
}

export function slugifyOrgName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

export function generateReadableId(prefix = "org") {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14)

  return `${prefix}_${random}`
}

export function mapClientPlanToOrgPlan(planType?: string | null): OrgPlan {
  const normalized = (planType || "").toLowerCase().trim()

  if (
    normalized.includes("enterprise") ||
    normalized.includes("premium") ||
    normalized.includes("suite") ||
    normalized.includes("c-suite") ||
    normalized.includes("csuite")
  ) {
    return "enterprise"
  }

  if (normalized.includes("growth") || normalized.includes("standard")) {
    return "growth"
  }

  return "starter"
}

export function normalizeOrgTask(value: unknown): OrgTask | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const text = readString(value.text).trim()

  if (!id || !text) {
    return null
  }

  return {
    id,
    text,
    done: value.done === true,
    assignedTo: readNullableString(value.assignedTo),
    dueDate: readNullableString(value.dueDate),
    priority:
      value.priority === null
        ? null
        : readEnum(value.priority, ORG_TASK_PRIORITIES, "medium"),
    source: readEnum(value.source, ORG_TASK_SOURCES, "manual"),
    createdAt: serializeTimestamp(value.createdAt),
  }
}

export function normalizeOrgTasks(value: unknown): OrgTask[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeOrgTask)
    .filter((task): task is OrgTask => task !== null)
}

export function normalizeOrganization(
  id: string,
  data: Record<string, unknown>
): Organization {
  return {
    id: readString(data.id, id) || id,
    name: readString(data.name, "Organization"),
    slug: readString(data.slug, slugifyOrgName(readString(data.name, id))) || id,
    plan: readEnum(data.plan, ORG_PLANS, "starter"),
    stripeCustomerId: readNullableString(data.stripeCustomerId),
    subscriptionId: readNullableString(data.subscriptionId),
    status: readEnum(data.status, ORG_STATUSES, "trial"),
    createdAt: serializeTimestamp(data.createdAt),
    createdByUid: readString(data.createdByUid),
    city: readString(data.city),
    website: readString(data.website),
    logoUrl: readNullableString(data.logoUrl),
    onboardingNotes: readString(data.onboardingNotes),
  }
}

export function normalizeOrgMember(
  uid: string,
  data: Record<string, unknown>
): OrgMember {
  return {
    uid: readString(data.uid, uid) || uid,
    email: readString(data.email),
    name: readString(data.name),
    role: readEnum(data.role, ORG_MEMBER_ROLES, "viewer"),
    joinedAt: serializeTimestamp(data.joinedAt),
    invitedBy: readNullableString(data.invitedBy),
  }
}

export function normalizeOrgProject(
  id: string,
  data: Record<string, unknown>
): OrgProject {
  return {
    id: readString(data.id, id) || id,
    name: readString(data.name, "Untitled project"),
    status: readEnum(data.status, ORG_PROJECT_STATUSES, "active"),
    description: readString(data.description),
    startDate: serializeTimestamp(data.startDate),
    targetDate: serializeTimestamp(data.targetDate),
    ragLeadEmail: readString(data.ragLeadEmail),
    createdAt: serializeTimestamp(data.createdAt),
    tasks: normalizeOrgTasks(data.tasks),
  }
}

export function normalizeOrgFile(
  id: string,
  data: Record<string, unknown>
): OrgFile {
  return {
    id: readString(data.id, id) || id,
    projectId: readNullableString(data.projectId),
    name: readString(data.name, "Untitled file"),
    type: readEnum(data.type, ORG_FILE_TYPES, "link"),
    url: readString(data.url),
    mimeType: readString(data.mimeType),
    size: readNullableNumber(data.size),
    storagePath: readNullableString(data.storagePath),
    uploadedByUid: readString(data.uploadedByUid),
    uploadedAt: serializeTimestamp(data.uploadedAt),
    extractedTasks: normalizeOrgTasks(data.extractedTasks),
    taskExtractionStatus:
      data.taskExtractionStatus === null
        ? null
        : readEnum(data.taskExtractionStatus, ORG_TASK_EXTRACTION_STATUSES, "pending"),
  }
}

export function normalizeOrgInvite(
  email: string,
  data: Record<string, unknown>
): OrgInvite {
  const status =
    data.status === "accepted" || data.status === "revoked" ? data.status : "pending"

  return {
    email: readString(data.email, email) || email,
    role: readEnum(data.role, ORG_MEMBER_ROLES, "viewer"),
    invitedBy: readNullableString(data.invitedBy),
    invitedAt: serializeTimestamp(data.invitedAt),
    status,
    token: readNullableString(data.token) ?? undefined,
    acceptedAt: serializeTimestamp(data.acceptedAt),
  }
}

export function isOrgAdmin(member: OrgMember | null) {
  return member?.role === "owner" || member?.role === "admin"
}

export function isOrgOwner(member: OrgMember | null) {
  return member?.role === "owner"
}

export function taskCompletionPct(tasks: OrgTask[]) {
  if (tasks.length === 0) {
    return 0
  }

  return Math.round((tasks.filter((task) => task.done).length / tasks.length) * 100)
}

export function getProjectTasks(project: OrgProject, files: OrgFile[]) {
  return [
    ...project.tasks,
    ...files
      .filter((file) => file.projectId === project.id)
      .flatMap((file) => file.extractedTasks),
  ]
}
