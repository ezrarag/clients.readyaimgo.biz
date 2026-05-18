import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { CLIENT_SERVICE_OPTIONS } from "@/lib/client-onboarding"
import { emailToDocId, getBearerToken, resolvePortalIdentity } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

const CLIENT_SERVICE_OPTION_SET = new Set<string>(
  CLIENT_SERVICE_OPTIONS.map((option) => option.id)
)

function readProfileString(body: Record<string, unknown>, fieldName: string) {
  if (!(fieldName in body)) {
    return undefined
  }

  return typeof body[fieldName] === "string" ? body[fieldName].trim() : ""
}

function readServiceInterests(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error("serviceInterests must be an array.")
  }

  const normalized = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
  const invalid = normalized.filter((item) => !CLIENT_SERVICE_OPTION_SET.has(item))

  if (invalid.length > 0) {
    throw new Error(`Unsupported serviceInterests: ${invalid.join(", ")}`)
  }

  return normalized
}

function serializeClient(id: string, data: Record<string, unknown>) {
  return {
    id,
    uid: typeof data.uid === "string" ? data.uid : id,
    name: typeof data.name === "string" ? data.name : "",
    email: typeof data.email === "string" ? data.email : "",
    beamCoinBalance:
      typeof data.beamCoinBalance === "number" ? data.beamCoinBalance : 0,
    housingWalletBalance:
      typeof data.housingWalletBalance === "number" ? data.housingWalletBalance : 0,
    stripeCustomerId:
      typeof data.stripeCustomerId === "string" ? data.stripeCustomerId : undefined,
    planType: typeof data.planType === "string" ? data.planType : undefined,
    companyName: typeof data.companyName === "string" ? data.companyName : "",
    contactTitle: typeof data.contactTitle === "string" ? data.contactTitle : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    organizationType:
      typeof data.organizationType === "string" ? data.organizationType : "",
    serviceInterests: Array.isArray(data.serviceInterests)
      ? data.serviceInterests.filter(
          (value): value is string => typeof value === "string"
        )
      : [],
    onboardingNotes:
      typeof data.onboardingNotes === "string" ? data.onboardingNotes : "",
    onboardingStatus:
      typeof data.onboardingStatus === "string" ? data.onboardingStatus : "",
    onboardingSource:
      typeof data.onboardingSource === "string" ? data.onboardingSource : "",
    onboardingHandoffId:
      typeof data.onboardingHandoffId === "string" ? data.onboardingHandoffId : "",
    claimedClientId:
      typeof data.claimedClientId === "string" ? data.claimedClientId : "",
    claimedStoryId:
      typeof data.claimedStoryId === "string" ? data.claimedStoryId : "",
    claimedClientName:
      typeof data.claimedClientName === "string" ? data.claimedClientName : "",
    partnerTier: data.partnerTier === "agency" ? "agency" : null,
    partnerSince: data.partnerSince ?? null,
    partnerCommissionPct:
      typeof data.partnerCommissionPct === "number"
        ? data.partnerCommissionPct
        : undefined,
    partnerReferralCount:
      typeof data.partnerReferralCount === "number"
        ? data.partnerReferralCount
        : undefined,
    orgId: typeof data.orgId === "string" ? data.orgId : undefined,
    createdAt: data.createdAt ?? null,
  }
}

async function loadClient(clientId: string) {
  const clientSnapshot = await getAdminDb().collection("clients").doc(clientId).get()
  if (!clientSnapshot.exists) {
    return null
  }

  return serializeClient(
    clientSnapshot.id,
    (clientSnapshot.data() ?? {}) as Record<string, unknown>
  )
}

async function getUnavailableReason(request: NextRequest) {
  try {
    const token = getBearerToken(request)
    if (!token) return "unassociated"

    const decodedToken = await getAdminAuth().verifyIdToken(token)
    const email = decodedToken.email?.trim().toLowerCase()
    if (!email) return "unassociated"

    const allowlistSnapshot = await getAdminDb()
      .collection("ragAllowlist")
      .doc(emailToDocId(email))
      .get()

    return allowlistSnapshot.exists &&
      ((allowlistSnapshot.data() ?? {}) as Record<string, unknown>).active === false
      ? "revoked"
      : "unassociated"
  } catch {
    return "unassociated"
  }
}

export async function GET(request: NextRequest) {
  try {
    const identity = await resolvePortalIdentity(
      request,
      request.nextUrl.searchParams.get("clientId")
    )

    if (!identity) {
      return NextResponse.json(
        { error: "Portal access unavailable.", reason: await getUnavailableReason(request) },
        { status: 403 }
      )
    }

    return NextResponse.json({
      success: true,
      identity,
      client: await loadClient(identity.activeClientId),
    })
  } catch (error) {
    console.error("Client portal identity error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to resolve portal identity.",
      },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const identity = await resolvePortalIdentity(request)

    if (!identity) {
      return NextResponse.json({ error: "Portal access unavailable." }, { status: 403 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const name = readProfileString(body, "name")

    if ("name" in body && !name) {
      return NextResponse.json({ error: "name is required." }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}
    const profileFields = [
      "companyName",
      "contactTitle",
      "phone",
      "organizationType",
      "onboardingNotes",
    ]

    if (name !== undefined) {
      updates.name = name
    }

    for (const fieldName of profileFields) {
      const value = readProfileString(body, fieldName)
      if (value !== undefined) {
        updates[fieldName] = value
      }
    }

    try {
      const serviceInterests = readServiceInterests(body.serviceInterests)
      if (serviceInterests !== undefined) {
        updates.serviceInterests = serviceInterests
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid serviceInterests." },
        { status: 400 }
      )
    }

    if (Object.keys(updates).length > 0) {
      await getAdminDb().collection("clients").doc(identity.activeClientId).set(
        {
          ...updates,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    } else {
      await getAdminDb().collection("clients").doc(identity.activeClientId).set(
        {
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    }

    return NextResponse.json({
      success: true,
      identity,
      client: await loadClient(identity.activeClientId),
    })
  } catch (error) {
    console.error("Client portal identity update error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update client." },
      { status: 500 }
    )
  }
}
