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

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function getAppUrl(request: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, "")
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const callerEmail = readString(body.callerEmail || body.partnerEmail).toLowerCase()
    const label = readString(body.label)
    const businessType = readString(body.businessType)
    const notes = readString(body.notes)
    const serviceInterests = readStringArray(body.serviceInterests)

    if (!callerEmail) {
      return NextResponse.json({ error: "callerEmail is required." }, { status: 400 })
    }

    if (!label) {
      return NextResponse.json({ error: "label is required." }, { status: 400 })
    }

    const db = getAdminDb()
    const clientSnap = await db.collection("clients").doc(callerEmail).get()
    const clientData = clientSnap.exists ? clientSnap.data() : null

    if (!clientData || clientData.partnerTier !== "agency") {
      return NextResponse.json({ error: "Only agency partners can generate links." }, { status: 403 })
    }

    const handoffRef = db.collection("handoffs").doc()
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + 30)

    const url = `${getAppUrl(request)}/signup?handoff=${encodeURIComponent(handoffRef.id)}`
    const referralLink: PartnerReferralLink = {
      handoffId: handoffRef.id,
      label,
      businessType,
      serviceInterests,
      notes,
      createdAt: now.toISOString(),
      url,
      converted: false,
      convertedAt: null,
    }

    await handoffRef.set({
      id: handoffRef.id,
      mode: "new",
      destination: "/signup",
      companyName: label,
      contactName: "",
      workEmail: "",
      phone: "",
      role: "",
      organizationType: businessType,
      serviceInterests,
      notes,
      claimedClientId: null,
      claimedStoryId: "",
      claimedClientName: "",
      sourceSite: getAppUrl(request),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      referredByPartnerEmail: callerEmail,
    })

    const companyName =
      typeof clientData.companyName === "string" && clientData.companyName.trim()
        ? clientData.companyName.trim()
        : typeof clientData.name === "string"
          ? clientData.name
          : ""

    const partnerRef = db.collection("partners").doc(callerEmail)
    const partnerSnap = await partnerRef.get()

    await partnerRef.set(
      {
        email: callerEmail,
        companyName,
        partnerTier: "agency",
        commissionPct:
          typeof partnerSnap.data()?.commissionPct === "number"
            ? partnerSnap.data()?.commissionPct
            : 10,
        totalReferrals: FieldValue.increment(1),
        referralLinks: FieldValue.arrayUnion(referralLink),
        createdAt: partnerSnap.exists
          ? partnerSnap.data()?.createdAt ?? FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    await db.collection("clients").doc(callerEmail).set(
      {
        partnerReferralCount: FieldValue.increment(1),
      },
      { merge: true }
    )

    return NextResponse.json({
      handoffId: handoffRef.id,
      url,
      referralLink,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate referral link."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
