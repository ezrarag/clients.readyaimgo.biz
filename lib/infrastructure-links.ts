/**
 * infrastructure-links.ts
 *
 * Normalized schema for workspace infrastructure evidence.
 * Records in `workspaces/{id}/infrastructureLinks` follow this shape.
 * Nothing is rendered client-side unless a real evidence record exists here.
 */

export const INFRASTRUCTURE_PROVIDERS = [
  "Namecheap",
  "Zoho",
  "Twilio",
  "Vercel",
  "Other",
] as const
export type InfrastructureProvider = (typeof INFRASTRUCTURE_PROVIDERS)[number]

export const INFRASTRUCTURE_TYPES = [
  "domain",
  "mail",
  "hosting",
  "communications",
  "invoice",
] as const
export type InfrastructureType = (typeof INFRASTRUCTURE_TYPES)[number]

export const INFRASTRUCTURE_STATUSES = [
  "active",
  "pending",
  "renewal_due",
  "unpaid",
  "unknown",
] as const
export type InfrastructureStatus = (typeof INFRASTRUCTURE_STATUSES)[number]

export interface InfrastructureLink {
  id: string
  /** Third-party service provider. */
  provider: InfrastructureProvider
  /** Functional category of this record. */
  type: InfrastructureType
  /** Primary domain name, if any. */
  domain: string | null
  /** Current lifecycle state. */
  status: InfrastructureStatus
  /** Invoice / renewal amount in USD, if any. */
  amount: number | null
  /** Next payment or renewal due date (ISO string). */
  dueDate: string | null
  /** Which system produced this record. */
  sourceSystem: string
  /** ID of the source document (email id, activity item id, etc.). */
  sourceRef: string | null
  /** Short phrase pulled from the original evidence. */
  evidenceSnippet: string | null
  /** 0–1 confidence the record is correct. */
  confidence: number
  /** Whether this record should be shown in the client portal. */
  clientVisible: boolean
  /** Vercel domain/project verification state when the source is Vercel. */
  verified: boolean | null
  /** Registrar label returned by Vercel or captured from email/admin evidence. */
  registrar: string | null
  /** Human-readable source of the expiration/due date, when known. */
  expirationSource: string | null
  /** Vercel project id/name that confirmed the domain binding. */
  vercelProjectId: string | null
  vercelProjectName: string | null
  createdAt: string | null
  updatedAt: string | null
}

// ─── Serialization helpers ────────────────────────────────────────────────────

function serializeTimestamp(value: unknown): string | null {
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  if (
    value !== null &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return null
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

// ─── Normalizer ───────────────────────────────────────────────────────────────

export function normalizeInfrastructureLink(
  id: string,
  data: Record<string, unknown>
): InfrastructureLink {
  const confidence =
    typeof data.confidence === "number" && Number.isFinite(data.confidence)
      ? Math.max(0, Math.min(1, data.confidence))
      : 0

  return {
    id,
    provider: readEnum(data.provider, INFRASTRUCTURE_PROVIDERS, "Other"),
    type: readEnum(data.type, INFRASTRUCTURE_TYPES, "invoice"),
    domain:
      typeof data.domain === "string" && data.domain.trim()
        ? data.domain.trim()
        : null,
    status: readEnum(data.status, INFRASTRUCTURE_STATUSES, "unknown"),
    amount:
      typeof data.amount === "number" &&
      Number.isFinite(data.amount) &&
      data.amount > 0
        ? data.amount
        : null,
    dueDate: serializeTimestamp(data.dueDate),
    sourceSystem:
      typeof data.sourceSystem === "string" && data.sourceSystem.trim()
        ? data.sourceSystem.trim()
        : "unknown",
    sourceRef:
      typeof data.sourceRef === "string" && data.sourceRef.trim()
        ? data.sourceRef.trim()
        : null,
    evidenceSnippet:
      typeof data.evidenceSnippet === "string" && data.evidenceSnippet.trim()
        ? data.evidenceSnippet.trim()
        : null,
    confidence,
    clientVisible: data.clientVisible !== false,
    verified: typeof data.verified === "boolean" ? data.verified : null,
    registrar:
      typeof data.registrar === "string" && data.registrar.trim()
        ? data.registrar.trim()
        : null,
    expirationSource:
      typeof data.expirationSource === "string" && data.expirationSource.trim()
        ? data.expirationSource.trim()
        : null,
    vercelProjectId:
      typeof data.vercelProjectId === "string" && data.vercelProjectId.trim()
        ? data.vercelProjectId.trim()
        : null,
    vercelProjectName:
      typeof data.vercelProjectName === "string" && data.vercelProjectName.trim()
        ? data.vercelProjectName.trim()
        : null,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

export function infraStatusVariant(
  status: InfrastructureStatus
): "success" | "warning" | "danger" | "secondary" {
  switch (status) {
    case "active":
      return "success"
    case "pending":
      return "warning"
    case "renewal_due":
      return "warning"
    case "unpaid":
      return "danger"
    default:
      return "secondary"
  }
}

export function infraStatusLabel(status: InfrastructureStatus): string {
  switch (status) {
    case "active":
      return "Active"
    case "pending":
      return "Pending"
    case "renewal_due":
      return "Renewal Due"
    case "unpaid":
      return "Unpaid"
    case "unknown":
      return "Unknown"
  }
}

const TYPE_LABELS: Record<InfrastructureType, string> = {
  domain: "Domain",
  mail: "Mail",
  hosting: "Hosting",
  communications: "Communications",
  invoice: "Invoice",
}

export function infraProviderLabel(link: InfrastructureLink): string {
  return link.provider === "Other" ? (TYPE_LABELS[link.type] ?? "Service") : link.provider
}
