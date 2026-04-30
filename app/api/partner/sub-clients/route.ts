import { type NextRequest, NextResponse } from "next/server"
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

import type { PartnerSubClient } from "@/lib/partner"

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

function serializeTimestamp(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().toISOString()
  }

  return null
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === "string")
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get("email")?.toLowerCase().trim()

    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 })
    }

    const db = getAdminDb()
    const clientSnap = await db.collection("clients").doc(email).get()
    const clientData = clientSnap.exists ? clientSnap.data() : null

    if (!clientData || clientData.partnerTier !== "agency") {
      return NextResponse.json({ error: "Only agency partners can view sub-clients." }, { status: 403 })
    }

    const partnerSnap = await db.collection("partners").doc(email).get()
    const partnerData = partnerSnap.exists ? partnerSnap.data() : null
    const referralLinks = Array.isArray(partnerData?.referralLinks)
      ? partnerData.referralLinks
      : []
    const handoffIds = Array.from(
      new Set(
        referralLinks
          .map((link) =>
            typeof link === "object" &&
            link !== null &&
            "handoffId" in link &&
            typeof link.handoffId === "string"
              ? link.handoffId
              : ""
          )
          .filter(Boolean)
      )
    )

    if (handoffIds.length === 0) {
      return NextResponse.json({ subClients: [] })
    }

    const snapshots = await Promise.all(
      chunk(handoffIds, 30).map((handoffChunk) =>
        db
          .collection("clients")
          .where("onboardingHandoffId", "in", handoffChunk)
          .get()
      )
    )

    const subClients: PartnerSubClient[] = snapshots.flatMap((snapshot) =>
      snapshot.docs.map((clientDoc) => {
        const data = clientDoc.data()

        return {
          email: clientDoc.id,
          companyName: typeof data.companyName === "string" ? data.companyName : "",
          organizationType:
            typeof data.organizationType === "string" ? data.organizationType : "",
          serviceInterests: readStringArray(data.serviceInterests),
          onboardingStatus:
            typeof data.onboardingStatus === "string" ? data.onboardingStatus : "",
          createdAt: serializeTimestamp(data.createdAt),
          handoffId:
            typeof data.onboardingHandoffId === "string" ? data.onboardingHandoffId : "",
        }
      })
    )

    return NextResponse.json({ subClients })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load sub-clients."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
