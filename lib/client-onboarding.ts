import type { User } from "firebase/auth"
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore"

export const CLIENT_SERVICE_OPTIONS = [
  {
    id: "web",
    label: "Web presence",
    description: "Website updates, story publishing, and public presence management.",
  },
  {
    id: "app",
    label: "Apps and portals",
    description: "Client apps, internal portals, and product feature delivery.",
  },
  {
    id: "rd",
    label: "Research and development",
    description: "R&D support, experiments, and innovation planning.",
  },
  {
    id: "housing",
    label: "Housing support",
    description: "Housing wallet, lodging, and team accommodations.",
  },
  {
    id: "transportation",
    label: "Transportation",
    description: "Fleet operations, logistics, and transportation coordination.",
  },
  {
    id: "insurance",
    label: "Insurance",
    description: "Coverage planning and insurance support.",
  },
  {
    id: "property-ops",
    label: "Property ops",
    description: "Property operations, facilities oversight, and site coordination.",
  },
  {
    id: "beam-participants",
    label: "BEAM participants",
    description: "Participant operations, coaching, and cohort support.",
  },
] as const

export type ClientServiceInterestKey = (typeof CLIENT_SERVICE_OPTIONS)[number]["id"]

export interface ClientClaimPreview {
  id: string
  storyId: string
  name: string
  brands?: string[]
  pulseSummary?: string
  websiteUrl?: string
  deployUrl?: string
  appUrl?: string
  rdUrl?: string
  housingUrl?: string
  transportationUrl?: string
  insuranceUrl?: string
  modules?: Partial<
    Record<
      "web" | "app" | "rd" | "housing" | "transportation" | "insurance",
      { enabled?: boolean }
    >
  >
}

export interface ClientPortalHandoff {
  id: string
  mode: "claim" | "new"
  destination: "/signup" | "/login"
  companyName: string
  contactName: string
  workEmail: string
  phone: string
  role: string
  organizationType: string
  serviceInterests: string[]
  notes: string
  claimedClientId: string | null
  claimedStoryId: string
  claimedClientName: string
  sourceSite: string
  createdAt: string
  expiresAt: string
  phoneOnly?: boolean
}

export interface ClientPortalHandoffPayload {
  handoff: ClientPortalHandoff
  claimPreview: ClientClaimPreview | null
}

export interface ClientAccountOnboardingInput {
  fullName: string
  companyName: string
  contactTitle: string
  phone: string
  organizationType: string
  serviceInterests: ClientServiceInterestKey[]
  notes: string
}

const CLIENT_SERVICE_OPTION_SET = new Set<string>(
  CLIENT_SERVICE_OPTIONS.map((option) => option.id)
)

export function normalizeClientServiceInterests(
  values: unknown
): ClientServiceInterestKey[] {
  if (!Array.isArray(values)) {
    return []
  }

  const normalized = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value): value is ClientServiceInterestKey => CLIENT_SERVICE_OPTION_SET.has(value))

  return Array.from(new Set(normalized))
}

export function deriveClientInterestDefaults(
  claimPreview: ClientClaimPreview | null
): ClientServiceInterestKey[] {
  if (!claimPreview) {
    return []
  }

  const defaults: ClientServiceInterestKey[] = []

  if (claimPreview.websiteUrl || claimPreview.deployUrl || claimPreview.modules?.web?.enabled) {
    defaults.push("web")
  }

  if (claimPreview.appUrl || claimPreview.modules?.app?.enabled) {
    defaults.push("app")
  }

  if (claimPreview.rdUrl || claimPreview.modules?.rd?.enabled) {
    defaults.push("rd")
  }

  if (claimPreview.housingUrl || claimPreview.modules?.housing?.enabled) {
    defaults.push("housing")
  }

  if (
    claimPreview.transportationUrl ||
    claimPreview.modules?.transportation?.enabled
  ) {
    defaults.push("transportation")
  }

  if (claimPreview.insuranceUrl || claimPreview.modules?.insurance?.enabled) {
    defaults.push("insurance")
  }

  return Array.from(new Set(defaults))
}

export function appendHandoffQuery(path: string, handoffId: string | null) {
  if (!handoffId) {
    return path
  }

  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}handoff=${encodeURIComponent(handoffId)}`
}

export async function upsertClientAccountRecord({
  firestoreDb,
  user,
  onboarding,
  handoff,
  claimPreview,
}: {
  firestoreDb: Firestore
  user: User
  onboarding: ClientAccountOnboardingInput
  handoff?: ClientPortalHandoff | null
  claimPreview?: ClientClaimPreview | null
}) {
  if (!user.email) {
    throw new Error("A verified email is required to create a client account.")
  }

  const emailKey = user.email.toLowerCase().trim()
  const isPhoneOnlyHandoff = handoff?.workEmail?.endsWith("@phone.readyaimgo.internal") ?? false
  const clientRef = doc(firestoreDb, "clients", emailKey)
  const existingSnapshot = await getDoc(clientRef)
  const existing = existingSnapshot.exists()
    ? (existingSnapshot.data() as Record<string, unknown>)
    : null

  const normalizedServices = normalizeClientServiceInterests(
    onboarding.serviceInterests.length > 0
      ? onboarding.serviceInterests
      : handoff?.serviceInterests ?? deriveClientInterestDefaults(claimPreview ?? null)
  )

  const companyName =
    onboarding.companyName.trim() ||
    handoff?.companyName ||
    claimPreview?.name ||
    (typeof existing?.companyName === "string" ? existing.companyName : "")

  const fullName =
    onboarding.fullName.trim() ||
    user.displayName ||
    handoff?.contactName ||
    (typeof existing?.name === "string" ? existing.name : "")

  await setDoc(
    clientRef,
    {
      uid: user.uid,
      email: user.email,
      name: fullName,
      companyName: companyName || null,
      contactTitle:
        onboarding.contactTitle.trim() ||
        handoff?.role ||
        (typeof existing?.contactTitle === "string" ? existing.contactTitle : null),
      phone:
        onboarding.phone.trim() ||
        handoff?.phone ||
        (typeof existing?.phone === "string" ? existing.phone : null),
      organizationType:
        onboarding.organizationType.trim() ||
        handoff?.organizationType ||
        (typeof existing?.organizationType === "string"
          ? existing.organizationType
          : null),
      serviceInterests: normalizedServices,
      onboardingNotes:
        onboarding.notes.trim() ||
        handoff?.notes ||
        (typeof existing?.onboardingNotes === "string" ? existing.onboardingNotes : null),
      onboardingStatus: handoff?.mode === "claim" ? "claimed" : "new-client",
      onboardingSource:
        handoff?.sourceSite || "https://clients.readyaimgo.biz",
      onboardingHandoffId:
        handoff?.id ||
        (typeof existing?.onboardingHandoffId === "string"
          ? existing.onboardingHandoffId
          : null),
      onboardedViaPhone: isPhoneOnlyHandoff || (typeof existing?.onboardedViaPhone === "boolean" ? existing.onboardedViaPhone : false),
      claimedClientId:
        claimPreview?.id ||
        handoff?.claimedClientId ||
        (typeof existing?.claimedClientId === "string"
          ? existing.claimedClientId
          : null),
      claimedStoryId:
        claimPreview?.storyId ||
        handoff?.claimedStoryId ||
        (typeof existing?.claimedStoryId === "string"
          ? existing.claimedStoryId
          : null),
      claimedClientName:
        claimPreview?.name ||
        handoff?.claimedClientName ||
        (typeof existing?.claimedClientName === "string"
          ? existing.claimedClientName
          : null),
      planType:
        typeof existing?.planType === "string" ? existing.planType : "free",
      beamCoinBalance:
        typeof existing?.beamCoinBalance === "number" ? existing.beamCoinBalance : 0,
      housingWalletBalance:
        typeof existing?.housingWalletBalance === "number"
          ? existing.housingWalletBalance
          : 0,
      createdAt:
        existing?.createdAt ??
        serverTimestamp(),
      onboardingUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  )
}
