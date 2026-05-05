import { serializeTimestamp } from "@/lib/beam"

export const DELIVERABLE_STATUSES = ["pending", "paid"] as const

export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number]

export interface ClientDeliverable {
  id: string
  clientId: string
  projectId?: string | null
  title: string
  description: string
  liveUrl?: string | null
  screenshotUrls: string[]
  screenRecordingUrl?: string | null
  amount: number
  currency: string
  status: DeliverableStatus
  stripeCheckoutSessionId?: string | null
  stripePaymentIntentId?: string | null
  createdAt?: Date | string | null
  paidAt?: Date | string | null
}

function normalizeStatus(value: unknown): DeliverableStatus {
  return value === "paid" ? "paid" : "pending"
}

export function normalizeUrlList(value: unknown) {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

export function parseDollarAmount(value: unknown, fieldName = "amount") {
  const amount = typeof value === "number" ? value : Number(value)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${fieldName} must be greater than 0.`)
  }

  return Math.round(amount * 100) / 100
}

export function normalizeClientDeliverableDocument(
  id: string,
  value: Record<string, unknown>,
  fallbackClientId = ""
): ClientDeliverable {
  return {
    id,
    clientId:
      typeof value.clientId === "string" && value.clientId.trim()
        ? value.clientId.trim().toLowerCase()
        : fallbackClientId,
    projectId:
      typeof value.projectId === "string" && value.projectId.trim()
        ? value.projectId.trim()
        : null,
    title: typeof value.title === "string" ? value.title : "",
    description: typeof value.description === "string" ? value.description : "",
    liveUrl:
      typeof value.liveUrl === "string" && value.liveUrl.trim()
        ? value.liveUrl.trim()
        : null,
    screenshotUrls: normalizeUrlList(value.screenshotUrls),
    screenRecordingUrl:
      typeof value.screenRecordingUrl === "string" && value.screenRecordingUrl.trim()
        ? value.screenRecordingUrl.trim()
        : null,
    amount: typeof value.amount === "number" ? value.amount : Number(value.amount) || 0,
    currency:
      typeof value.currency === "string" && value.currency.trim()
        ? value.currency.trim().toLowerCase()
        : "usd",
    status: normalizeStatus(value.status),
    stripeCheckoutSessionId:
      typeof value.stripeCheckoutSessionId === "string"
        ? value.stripeCheckoutSessionId
        : null,
    stripePaymentIntentId:
      typeof value.stripePaymentIntentId === "string" ? value.stripePaymentIntentId : null,
    createdAt: serializeTimestamp(value.createdAt),
    paidAt: serializeTimestamp(value.paidAt),
  }
}
