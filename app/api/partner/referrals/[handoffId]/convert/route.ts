import { type NextRequest, NextResponse } from "next/server"
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"

import type { PartnerReferralLink } from "@/lib/partner"

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

function isPartnerReferralLink(value: unknown): value is PartnerReferralLink {
  return (
    typeof value === "object" &&
    value !== null &&
    "handoffId" in value &&
    typeof value.handoffId === "string"
  )
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { handoffId: string } }
) {
  try {
    const expectedSecret = process.env.RAG_INTERNAL_SECRET
    const providedSecret = request.headers.get("x-rag-internal-secret")

    if (!expectedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    const handoffId = params.handoffId?.trim()
    if (!handoffId) {
      return NextResponse.json({ error: "handoffId is required." }, { status: 400 })
    }

    const db = getAdminDb()
    const handoffSnap = await db.collection("handoffs").doc(handoffId).get()
    const handoffData = handoffSnap.exists ? handoffSnap.data() : null
    const partnerEmail =
      typeof handoffData?.referredByPartnerEmail === "string"
        ? handoffData.referredByPartnerEmail.toLowerCase().trim()
        : ""

    if (!handoffSnap.exists || !partnerEmail) {
      return NextResponse.json({ ok: true })
    }

    const partnerRef = db.collection("partners").doc(partnerEmail)
    const partnerSnap = await partnerRef.get()
    const partnerData = partnerSnap.exists ? partnerSnap.data() : null
    const referralLinks = Array.isArray(partnerData?.referralLinks)
      ? partnerData.referralLinks.filter(isPartnerReferralLink)
      : []
    const matchingLink = referralLinks.find((link) => link.handoffId === handoffId)

    if (!matchingLink) {
      return NextResponse.json({ ok: true })
    }

    if (matchingLink.converted) {
      return NextResponse.json({ ok: true })
    }

    const now = new Date().toISOString()
    const updatedLinks = referralLinks.map((link) =>
      link.handoffId === handoffId
        ? {
            ...link,
            converted: true,
            convertedAt: now,
          }
        : link
    )

    await partnerRef.set(
      {
        referralLinks: updatedLinks,
        totalConvertedReferrals: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to convert referral."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
