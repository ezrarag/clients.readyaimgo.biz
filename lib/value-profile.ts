export const VALUE_PROFILE_COLLECTION = "valueProfile"
export const VALUE_PROFILE_STATE_DOC = "state"
export const VALUE_PROFILE_PAYMENTS_COLLECTION = "payments"

export type ValueThreshold = {
  id: string
  label: string
  amount: number
  deliverables: string[]
  description?: string
}

export type ValueProfile = {
  clientId: string
  totalPaid: number
  currency: string
  thresholds: ValueThreshold[]
  unlockedDeliverables: string[]
  currentThresholdId?: string
  stripeCustomerId?: string
  updatedAt?: string
  createdAt?: string
}

export type ValuePaymentRecord = {
  id: string
  amount: number
  currency: string
  status: string
  source: "stripe" | "manual"
  description?: string
  clientEmail?: string
  stripeCheckoutSessionId?: string
  stripePaymentIntentId?: string
  createdAt?: string
}

export type ValueInfrastructureCostItem = {
  serviceId: string
  name: string
  vendor: string
  category: string
  monthlyCost: number
  attributedMonthlyCost: number
  attribution: "clientCostAllocations" | "clientIds" | "dependentProjects"
  matchedToken: string
}

export type ValueProfileResponse = {
  success: true
  client: {
    id: string
    storyId?: string
    name: string
    brands: string[]
  }
  profile: ValueProfile
  infrastructureCosts: ValueInfrastructureCostItem[]
  infrastructureMonthlyTotal: number
  payments: ValuePaymentRecord[]
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : []

function asTimestampString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function stableThresholdId(label: string, amount: number, index: number) {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)

  return slug || `threshold-${index + 1}-${Math.round(amount)}`
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export function normalizeValueThreshold(value: unknown, index: number): ValueThreshold | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const label = asString(raw.label, `Threshold ${index + 1}`).trim() || `Threshold ${index + 1}`
  const amount = Math.max(0, asNumber(raw.amount))

  return {
    id: asString(raw.id) || stableThresholdId(label, amount, index),
    label,
    amount,
    deliverables: uniqueStrings(asStringArray(raw.deliverables)),
    description: asString(raw.description) || undefined,
  }
}

export function normalizeValueThresholds(value: unknown): ValueThreshold[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item, index) => normalizeValueThreshold(item, index))
    .filter((item): item is ValueThreshold => Boolean(item))
    .sort((left, right) => left.amount - right.amount || left.label.localeCompare(right.label))
}

export function getCurrentThreshold(thresholds: ValueThreshold[], totalPaid: number) {
  return thresholds
    .filter((threshold) => threshold.amount <= totalPaid)
    .sort((left, right) => right.amount - left.amount)[0]
}

export function getNextThreshold(thresholds: ValueThreshold[], totalPaid: number) {
  return thresholds
    .filter((threshold) => threshold.amount > totalPaid)
    .sort((left, right) => left.amount - right.amount)[0]
}

export function computeUnlockedDeliverables(
  thresholds: ValueThreshold[],
  totalPaid: number
): string[] {
  return uniqueStrings(
    thresholds
      .filter((threshold) => threshold.amount <= totalPaid)
      .flatMap((threshold) => threshold.deliverables)
  )
}

export function normalizeValueProfile(
  clientId: string,
  value: Record<string, unknown> | null | undefined
): ValueProfile {
  const thresholds = normalizeValueThresholds(value?.thresholds)
  const totalPaid = Math.max(0, asNumber(value?.totalPaid))
  const currentThreshold = getCurrentThreshold(thresholds, totalPaid)

  return {
    clientId,
    totalPaid,
    currency: asString(value?.currency, "usd").toLowerCase() || "usd",
    thresholds,
    unlockedDeliverables: uniqueStrings([
      ...asStringArray(value?.unlockedDeliverables),
      ...computeUnlockedDeliverables(thresholds, totalPaid),
    ]),
    currentThresholdId: asString(value?.currentThresholdId) || currentThreshold?.id,
    stripeCustomerId: asString(value?.stripeCustomerId) || undefined,
    createdAt: asTimestampString(value?.createdAt),
    updatedAt: asTimestampString(value?.updatedAt),
  }
}

export function normalizeValuePaymentRecord(
  id: string,
  value: Record<string, unknown>
): ValuePaymentRecord {
  return {
    id,
    amount: Math.max(0, asNumber(value.amount)),
    currency: asString(value.currency, "usd").toLowerCase() || "usd",
    status: asString(value.status, "succeeded"),
    source: value.source === "manual" ? "manual" : "stripe",
    description: asString(value.description) || undefined,
    clientEmail: asString(value.clientEmail) || undefined,
    stripeCheckoutSessionId: asString(value.stripeCheckoutSessionId) || undefined,
    stripePaymentIntentId: asString(value.stripePaymentIntentId) || undefined,
    createdAt: asTimestampString(value.createdAt),
  }
}

export function computeValueProfileProgress(profile: ValueProfile) {
  const currentThreshold = getCurrentThreshold(profile.thresholds, profile.totalPaid)
  const nextThreshold = getNextThreshold(profile.thresholds, profile.totalPaid)
  const unlockedDeliverables = uniqueStrings([
    ...profile.unlockedDeliverables,
    ...computeUnlockedDeliverables(profile.thresholds, profile.totalPaid),
  ])

  return {
    currentThreshold,
    nextThreshold,
    unlockedDeliverables,
    nextDeliverables: nextThreshold?.deliverables ?? [],
    amountToNext: nextThreshold ? Math.max(0, nextThreshold.amount - profile.totalPaid) : 0,
  }
}

export function computeNewlyUnlockedDeliverables(
  previousUnlocked: string[],
  nextUnlocked: string[]
) {
  const previous = new Set(previousUnlocked)
  return nextUnlocked.filter((deliverable) => !previous.has(deliverable))
}

type ServiceLike = {
  id: string
  name: string
  vendor: string
  category: string
  monthlyCost: number
  dependentProjects?: string[]
  clientIds?: string[]
  clientCostAllocations?: Record<string, number>
}

type ClientIdentity = {
  id: string
  storyId?: string
  name?: string
  brands?: string[]
}

function normalizeToken(value: string) {
  return value.toLowerCase().trim()
}

function getClientIdentityTokens(client: ClientIdentity) {
  return uniqueStrings([
    client.id,
    client.storyId ?? "",
    client.name ?? "",
    ...(client.brands ?? []),
  ]).map(normalizeToken)
}

function findMatchingToken(tokens: string[], values: string[]) {
  const normalizedValues = values.map(normalizeToken)
  return tokens.find((token) =>
    normalizedValues.some((value) => value === token || value.includes(token))
  )
}

export function computeInfrastructureCostAttribution(
  services: ServiceLike[],
  client: ClientIdentity
): ValueInfrastructureCostItem[] {
  const tokens = getClientIdentityTokens(client)
  const items: ValueInfrastructureCostItem[] = []

  for (const service of services) {
    const allocations = service.clientCostAllocations ?? {}
    const allocationKey = Object.keys(allocations).find((key) => tokens.includes(normalizeToken(key)))
    if (allocationKey) {
      items.push({
        serviceId: service.id,
        name: service.name,
        vendor: service.vendor,
        category: service.category,
        monthlyCost: service.monthlyCost,
        attributedMonthlyCost: Math.max(0, allocations[allocationKey] ?? 0),
        attribution: "clientCostAllocations",
        matchedToken: allocationKey,
      })
      continue
    }

    const clientIds = service.clientIds ?? []
    const clientIdToken = findMatchingToken(tokens, clientIds)
    if (clientIdToken) {
      items.push({
        serviceId: service.id,
        name: service.name,
        vendor: service.vendor,
        category: service.category,
        monthlyCost: service.monthlyCost,
        attributedMonthlyCost: service.monthlyCost / Math.max(1, clientIds.length),
        attribution: "clientIds",
        matchedToken: clientIdToken,
      })
      continue
    }

    const dependentProjects = service.dependentProjects ?? []
    const dependentProjectToken = findMatchingToken(tokens, dependentProjects)
    if (!dependentProjectToken) continue

    items.push({
      serviceId: service.id,
      name: service.name,
      vendor: service.vendor,
      category: service.category,
      monthlyCost: service.monthlyCost,
      attributedMonthlyCost: service.monthlyCost / Math.max(1, dependentProjects.length),
      attribution: "dependentProjects",
      matchedToken: dependentProjectToken,
    })
  }

  return items
}
