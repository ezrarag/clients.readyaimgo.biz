import { type NextRequest, NextResponse } from "next/server"
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

const DEFAULT_MARKETING_SITE_URL = "https://readyaimgo.biz"

function getAdminDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    })
  }

  return getFirestore()
}

function readString(data: Record<string, unknown>, key: string) {
  const value = data[key]
  return typeof value === "string" ? value : ""
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === "string")
}

async function getLocalHandoff(handoffId: string) {
  const db = getAdminDb()
  const handoffSnap = await db.collection("handoffs").doc(handoffId).get()

  if (!handoffSnap.exists) {
    return null
  }

  const data = handoffSnap.data() as Record<string, unknown>

  return {
    handoff: {
      id: readString(data, "id") || handoffSnap.id,
      mode: readString(data, "mode") === "claim" ? "claim" : "new",
      destination: readString(data, "destination") === "/login" ? "/login" : "/signup",
      companyName: readString(data, "companyName"),
      contactName: readString(data, "contactName"),
      workEmail: readString(data, "workEmail"),
      phone: readString(data, "phone"),
      role: readString(data, "role"),
      organizationType: readString(data, "organizationType"),
      serviceInterests: readStringArray(data.serviceInterests),
      notes: readString(data, "notes"),
      claimedClientId:
        typeof data.claimedClientId === "string" ? data.claimedClientId : null,
      claimedStoryId: readString(data, "claimedStoryId"),
      claimedClientName: readString(data, "claimedClientName"),
      sourceSite: readString(data, "sourceSite"),
      createdAt: readString(data, "createdAt"),
      expiresAt: readString(data, "expiresAt"),
    },
    claimPreview: null,
  }
}

export async function GET(request: NextRequest) {
  const handoffId = request.nextUrl.searchParams.get("handoff")?.trim()
  if (!handoffId) {
    return NextResponse.json(
      {
        success: false,
        error: "A handoff id is required.",
      },
      { status: 400 }
    )
  }

  try {
    const localHandoff = await getLocalHandoff(handoffId)

    if (localHandoff) {
      return NextResponse.json(localHandoff)
    }
  } catch (localError) {
    console.warn("Local onboarding handoff lookup failed:", localError)
  }

  const marketingSiteUrl =
    process.env.MARKETING_SITE_URL ||
    process.env.NEXT_PUBLIC_MARKETING_SITE_URL ||
    DEFAULT_MARKETING_SITE_URL

  try {
    const response = await fetch(
      `${marketingSiteUrl.replace(/\/$/, "")}/api/client-handoff/${encodeURIComponent(handoffId)}`,
      {
        cache: "no-store",
      }
    )

    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to fetch onboarding handoff.",
      },
      { status: 500 }
    )
  }
}
