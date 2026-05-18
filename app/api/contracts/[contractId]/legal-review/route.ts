import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { normalizeLegalReview } from "@/lib/contracts"

export const dynamic = "force-dynamic"

function getBearerToken(req: NextRequest) {
  const h = req.headers.get("authorization") || ""
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null
}

async function resolveUser(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) return null
  try {
    return await getAdminAuth().verifyIdToken(token)
  } catch {
    return null
  }
}

async function isAdmin(uid: string) {
  const db = getAdminDb()
  const snap = await db.collection("users").doc(uid).get()
  if (!snap.exists) return false
  const roles = (snap.data() as Record<string, unknown>).roles
  return Array.isArray(roles) && roles.includes("beam-admin")
}

function readString(v: unknown, fallback = "") {
  return typeof v === "string" ? v.trim() : fallback
}

// POST /api/contracts/[contractId]/legal-review — admin only
export async function POST(
  req: NextRequest,
  { params }: { params: { contractId: string } }
) {
  try {
    const decoded = await resolveUser(req)
    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    if (!(await isAdmin(decoded.uid))) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 })
    }

    const { contractId } = params
    if (!contractId) {
      return NextResponse.json({ error: "contractId is required." }, { status: 400 })
    }

    const db = getAdminDb()
    const contractSnap = await db.collection("contracts").doc(contractId).get()
    if (!contractSnap.exists) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 })
    }

    const body = (await req.json()) as Record<string, unknown>

    const ref = await db
      .collection("contracts")
      .doc(contractId)
      .collection("legalReviews")
      .add({
        participantId: readString(body.participantId),
        participantName: readString(body.participantName),
        reviewDate: body.reviewDate || null,
        status: "pending",
        flaggedClauses: Array.isArray(body.flaggedClauses)
          ? (body.flaggedClauses as unknown[]).filter((c): c is string => typeof c === "string")
          : [],
        memo: readString(body.memo),
        supervisorId: readString(body.supervisorId),
        supervisorApproved: false,
        attachmentUrl: typeof body.attachmentUrl === "string" ? body.attachmentUrl : null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: decoded.uid,
      })

    // Mark contract as having a legal review in progress
    await db.collection("contracts").doc(contractId).update({
      updatedAt: FieldValue.serverTimestamp(),
    })

    const newSnap = await ref.get()
    const review = normalizeLegalReview(ref.id, newSnap.data() as Record<string, unknown>)

    return NextResponse.json({ review }, { status: 201 })
  } catch (error) {
    console.error("POST /api/contracts/[contractId]/legal-review error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create legal review." },
      { status: 500 }
    )
  }
}

// GET /api/contracts/[contractId]/legal-review — list all legal reviews
export async function GET(
  req: NextRequest,
  { params }: { params: { contractId: string } }
) {
  try {
    const decoded = await resolveUser(req)
    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    const { contractId } = params
    if (!contractId) {
      return NextResponse.json({ error: "contractId is required." }, { status: 400 })
    }

    const db = getAdminDb()
    const contractSnap = await db.collection("contracts").doc(contractId).get()
    if (!contractSnap.exists) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 })
    }

    const snap = await db
      .collection("contracts")
      .doc(contractId)
      .collection("legalReviews")
      .orderBy("reviewDate", "desc")
      .get()

    const reviews = snap.docs.map((d) =>
      normalizeLegalReview(d.id, d.data() as Record<string, unknown>)
    )

    return NextResponse.json({ reviews })
  } catch (error) {
    console.error("GET /api/contracts/[contractId]/legal-review error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load legal reviews." },
      { status: 500 }
    )
  }
}
