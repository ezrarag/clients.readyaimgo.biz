import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminDb } from "@/lib/firebase-admin"
import { resolvePortalIdentity } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

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

export async function GET(request: NextRequest) {
  try {
    const identity = await resolvePortalIdentity(
      request,
      request.nextUrl.searchParams.get("clientId")
    )

    if (!identity) {
      return NextResponse.json({ error: "Portal access unavailable." }, { status: 403 })
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
    const name = typeof body.name === "string" ? body.name.trim() : null

    if (!name) {
      return NextResponse.json({ error: "name is required." }, { status: 400 })
    }

    await getAdminDb().collection("clients").doc(identity.activeClientId).set(
      {
        name,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

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
