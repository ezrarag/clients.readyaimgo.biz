import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import {
  normalizeClientDeliverableDocument,
  normalizeUrlList,
  parseDollarAmount,
} from "@/lib/deliverables"
import { getEffectiveRoles, normalizeBeamUserDocument } from "@/lib/beam"

export const dynamic = "force-dynamic"

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") || ""
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : null
}

function normalizeClientId(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

async function getRequestContext(request: NextRequest) {
  const token = getBearerToken(request)
  if (!token) {
    return { error: NextResponse.json({ error: "Missing authorization token." }, { status: 401 }) }
  }

  const auth = getAdminAuth()
  const db = getAdminDb()
  const decoded = await auth.verifyIdToken(token)
  const email = decoded.email?.trim().toLowerCase() || ""
  const userSnapshot = await db.collection("users").doc(decoded.uid).get()
  const beamUser = normalizeBeamUserDocument(
    decoded.uid,
    userSnapshot.exists ? (userSnapshot.data() as Record<string, unknown>) : null,
    {
      email: decoded.email,
      displayName: decoded.name,
      photoURL: decoded.picture,
    }
  )
  const roles = getEffectiveRoles({ uid: decoded.uid, roles: beamUser.roles })

  return { auth, db, decoded, email, roles }
}

function canManageDeliverables(roles: string[]) {
  return (
    roles.includes("beam-admin") ||
    roles.includes("rag-lead") ||
    roles.includes("client-manager")
  )
}

async function canReadClientDeliverables({
  db,
  clientId,
  email,
  roles,
}: {
  db: FirebaseFirestore.Firestore
  clientId: string
  email: string
  roles: string[]
}) {
  if (canManageDeliverables(roles)) return true
  if (!email) return false

  const projectSnapshot = await db
    .collection("projects")
    .where("clientId", "==", clientId)
    .where("clientPortalEmail", "==", email)
    .limit(1)
    .get()

  return !projectSnapshot.empty
}

export async function GET(request: NextRequest) {
  try {
    const clientId = normalizeClientId(request.nextUrl.searchParams.get("clientId"))
    if (!clientId) {
      return NextResponse.json({ error: "clientId is required." }, { status: 400 })
    }

    const context = await getRequestContext(request)
    if ("error" in context) return context.error

    const allowed = await canReadClientDeliverables({
      db: context.db,
      clientId,
      email: context.email,
      roles: context.roles,
    })
    if (!allowed) {
      return NextResponse.json({ error: "Deliverables unavailable for this account." }, { status: 403 })
    }

    const snapshot = await context.db
      .collection("clients")
      .doc(clientId)
      .collection("deliverables")
      .orderBy("createdAt", "desc")
      .get()

    return NextResponse.json({
      success: true,
      deliverables: snapshot.docs.map((deliverableDoc) =>
        normalizeClientDeliverableDocument(
          deliverableDoc.id,
          deliverableDoc.data() as Record<string, unknown>,
          clientId
        )
      ),
    })
  } catch (error) {
    console.error("Unable to load deliverables:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load deliverables." },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request)
    if ("error" in context) return context.error
    if (!canManageDeliverables(context.roles)) {
      return NextResponse.json({ error: "Only RAG admins can create deliverables." }, { status: 403 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const clientId = normalizeClientId(body.clientId)
    const title = typeof body.title === "string" ? body.title.trim() : ""
    const description = typeof body.description === "string" ? body.description.trim() : ""
    const liveUrl = typeof body.liveUrl === "string" ? body.liveUrl.trim() : ""
    const screenRecordingUrl =
      typeof body.screenRecordingUrl === "string" ? body.screenRecordingUrl.trim() : ""
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : ""
    const screenshotUrls = normalizeUrlList(body.screenshotUrls)
    const amount = parseDollarAmount(body.amount)

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required." }, { status: 400 })
    }

    if (!title) {
      return NextResponse.json({ error: "title is required." }, { status: 400 })
    }

    if (!description) {
      return NextResponse.json({ error: "description is required." }, { status: 400 })
    }

    const deliverableRef = context.db
      .collection("clients")
      .doc(clientId)
      .collection("deliverables")
      .doc()

    await deliverableRef.set({
      clientId,
      projectId: projectId || null,
      title,
      description,
      liveUrl: liveUrl || null,
      screenshotUrls,
      screenRecordingUrl: screenRecordingUrl || null,
      amount,
      currency: "usd",
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      paidAt: null,
      createdBy: context.decoded.uid,
      createdByEmail: context.email || null,
    })

    const deliverableSnapshot = await deliverableRef.get()

    return NextResponse.json({
      success: true,
      deliverable: normalizeClientDeliverableDocument(
        deliverableRef.id,
        deliverableSnapshot.data() as Record<string, unknown>,
        clientId
      ),
    })
  } catch (error) {
    console.error("Unable to create deliverable:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create deliverable." },
      { status: 500 }
    )
  }
}
