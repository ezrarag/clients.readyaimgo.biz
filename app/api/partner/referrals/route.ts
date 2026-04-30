import { type NextRequest, NextResponse } from "next/server"
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

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

function normalizeReferralLink(value: unknown): PartnerReferralLink | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("handoffId" in value) ||
    typeof value.handoffId !== "string"
  ) {
    return null
  }

  return {
    handoffId: value.handoffId,
    label: "label" in value && typeof value.label === "string" ? value.label : "",
    businessType:
      "businessType" in value && typeof value.businessType === "string"
        ? value.businessType
        : "",
    serviceInterests:
      "serviceInterests" in value ? readStringArray(value.serviceInterests) : [],
    notes: "notes" in value && typeof value.notes === "string" ? value.notes : "",
    createdAt:
      "createdAt" in value && typeof value.createdAt === "string" ? value.createdAt : "",
    url: "url" in value && typeof value.url === "string" ? value.url : "",
    converted: "converted" in value && value.converted === true,
    convertedAt:
      "convertedAt" in value && typeof value.convertedAt === "string"
        ? value.convertedAt
        : null,
  }
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

async function getConvertedHandoffs(
  db: FirebaseFirestore.Firestore,
  handoffIds: string[]
) {
  if (handoffIds.length === 0) {
    return new Map<string, string | null>()
  }

  const snapshots = await Promise.all(
    chunk(handoffIds, 30).map((handoffChunk) =>
      db
        .collection("clients")
        .where("onboardingHandoffId", "in", handoffChunk)
        .get()
    )
  )
  const converted = new Map<string, string | null>()

  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((clientDoc) => {
      const data = clientDoc.data()
      if (typeof data.onboardingHandoffId === "string") {
        converted.set(data.onboardingHandoffId, serializeTimestamp(data.createdAt))
      }
    })
  })

  return converted
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
      return NextResponse.json({ error: "Only agency partners can view referrals." }, { status: 403 })
    }

    const partnerSnap = await db.collection("partners").doc(email).get()
    const partnerData = partnerSnap.exists ? partnerSnap.data() : {}
    const referralLinks = Array.isArray(partnerData?.referralLinks)
      ? partnerData.referralLinks
          .map(normalizeReferralLink)
          .filter((link): link is PartnerReferralLink => link !== null)
      : []
    const convertedHandoffs = await getConvertedHandoffs(
      db,
      referralLinks.map((link) => link.handoffId)
    )
    const reconciledReferralLinks = referralLinks.map((link) => {
      const convertedAt = convertedHandoffs.get(link.handoffId)

      if (convertedAt !== undefined) {
        return {
          ...link,
          converted: true,
          convertedAt: link.convertedAt ?? convertedAt,
        }
      }

      return link
    })

    return NextResponse.json({
      email,
      companyName:
        typeof partnerData?.companyName === "string"
          ? partnerData.companyName
          : typeof clientData.companyName === "string"
            ? clientData.companyName
            : "",
      partnerTier: "agency",
      commissionPct:
        typeof partnerData?.commissionPct === "number" ? partnerData.commissionPct : 10,
      totalReferrals:
        typeof partnerData?.totalReferrals === "number" ? partnerData.totalReferrals : 0,
      totalConvertedReferrals: reconciledReferralLinks.filter((link) => link.converted).length,
      referralLinks: reconciledReferralLinks,
      createdAt: serializeTimestamp(partnerData?.createdAt),
      updatedAt: serializeTimestamp(partnerData?.updatedAt),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load referrals."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
