import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export async function POST(request: NextRequest) {
  const idToken = getBearerToken(request)
  if (!idToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const email = decoded.email?.trim().toLowerCase()
    if (!email) {
      return NextResponse.json({ error: "A verified email is required." }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const requestedCompanyName = readString(body.companyName)
    const requestedDisplayName = readString(body.displayName)
    const displayName = requestedDisplayName || decoded.name || email
    const companyName = requestedCompanyName || displayName || email
    const storyIdFallback = slugify(companyName) || slugify(email.split("@")[0]) || decoded.uid

    const db = getAdminDb()
    const clientRef = db.collection("clients").doc(email)
    const userRef = db.collection("users").doc(decoded.uid)
    const existingSnapshot = await clientRef.get()
    const existing = existingSnapshot.exists
      ? ((existingSnapshot.data() ?? {}) as Record<string, unknown>)
      : {}
    const now = FieldValue.serverTimestamp()

    const existingStoryId = readString(existing.storyId)
    const existingStoryVideoUrl = readString(existing.storyVideoUrl)
    const existingStripeStatus = readString(existing.stripeStatus)
    const existingStatus = readString(existing.status)
    const existingCompanyName = readString(existing.companyName)
    const existingClientBusinessName = readString(existing.clientBusinessName)
    const existingName = readString(existing.name)

    const batch = db.batch()
    batch.set(
      clientRef,
      {
        uid: decoded.uid,
        clientId: email,
        email,
        businessEmail: email,
        name: existingName || displayName || email,
        companyName: existingCompanyName || companyName,
        clientBusinessName: existingClientBusinessName || companyName,
        storyId: existingStoryId || storyIdFallback,
        storyVideoUrl: existingStoryVideoUrl || "",
        stripeStatus: existingStripeStatus || "pending",
        status: existingStatus || "onboarding",
        showOnFrontend:
          typeof existing.showOnFrontend === "boolean" ? existing.showOnFrontend : false,
        adminApprovalPending:
          typeof existing.adminApprovalPending === "boolean"
            ? existing.adminApprovalPending
            : true,
        onboardingSource: "clients.readyaimgo.biz/google-signin",
        updatedAt: now,
        createdAt: existing.createdAt ?? now,
      },
      { merge: true }
    )
    batch.set(
      userRef,
      {
        email,
        displayName,
        client_id: email,
        clientIds: FieldValue.arrayUnion(email),
        memberships: {
          [email]: {
            role: "owner",
            status: "pending",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        updatedAt: now,
      },
      { merge: true }
    )

    await batch.commit()

    return NextResponse.json({
      success: true,
      clientId: email,
      adminApprovalPending:
        typeof existing.adminApprovalPending === "boolean"
          ? existing.adminApprovalPending
          : true,
    })
  } catch (error) {
    console.error("POST /api/auth/bootstrap failed:", {
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to bootstrap account." },
      { status: 500 }
    )
  }
}
