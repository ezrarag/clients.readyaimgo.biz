import { type NextRequest, NextResponse } from "next/server"
import { FieldValue, type Firestore } from "firebase-admin/firestore"

import { getAuthenticatedBeamUser } from "@/lib/firebase-admin"
import { sendSms } from "@/lib/sms-server"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import {
  WORKSPACE_UPDATE_TYPES,
  normalizeWorkspaceUpdate,
  type WorkspaceUpdateType,
} from "@/lib/workspace-updates"

export const dynamic = "force-dynamic"

function errorStatus(error: unknown): number | null {
  if (error instanceof WorkspaceAuthError) return error.status
  if (error instanceof Error && typeof (error as { status?: unknown }).status === "number") {
    return (error as Error & { status: number }).status
  }
  return null
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

async function addClientDocIdByQuery(
  db: Firestore,
  ids: Set<string>,
  field: string,
  value: string
) {
  if (!value) return
  const snapshot = await db
    .collection("clients")
    .where(field, "==", value)
    .limit(5)
    .get()
    .catch(() => null)
  for (const doc of snapshot?.docs ?? []) ids.add(doc.id)
}

async function resolveCandidateClientIds(db: Firestore, workspaceId: string) {
  const workspaceSnap = await db.collection("workspaces").doc(workspaceId).get()
  const workspace = workspaceSnap.exists
    ? (workspaceSnap.data() as Record<string, unknown>)
    : {}
  const candidateIds = new Set<string>()
  const directCandidates = [
    workspace.clientId,
    workspace.clientEmail,
    workspace.registrationEmail,
    workspace.id,
    workspace.name,
    workspace.workspaceName,
    workspace.businessName,
    workspace.clientBusinessName,
  ]
    .map((value) => readString(value))
    .filter(Boolean)

  for (const value of directCandidates) {
    candidateIds.add(value)
    candidateIds.add(value.toLowerCase())
    const slug = slugify(value)
    if (slug) candidateIds.add(slug)
  }

  const directSnaps = await Promise.all(
    Array.from(candidateIds).map((id) => db.collection("clients").doc(id).get().catch(() => null))
  )

  for (const snap of directSnaps) {
    if (!snap?.exists) continue
    const data = snap.data() as Record<string, unknown>
    candidateIds.add(snap.id)
    const storyId = readString(data.storyId)
    if (storyId) candidateIds.add(storyId)
  }

  const queryValues = Array.from(candidateIds)
  await Promise.all(
    queryValues.flatMap((value) => [
      addClientDocIdByQuery(db, candidateIds, "storyId", value),
      addClientDocIdByQuery(db, candidateIds, "clientId", value),
      addClientDocIdByQuery(db, candidateIds, "email", value.toLowerCase()),
      addClientDocIdByQuery(db, candidateIds, "businessEmail", value.toLowerCase()),
      addClientDocIdByQuery(db, candidateIds, "clientPortalEmail", value.toLowerCase()),
    ])
  )

  return Array.from(candidateIds)
}

async function sendWorkspaceUpdateSms({
  db,
  workspaceId,
  title,
}: {
  db: Firestore
  workspaceId: string
  title: string
}) {
  const clientIds = await resolveCandidateClientIds(db, workspaceId)
  const phones = new Set<string>()

  await Promise.all(
    clientIds.flatMap((clientId) => [
      db.collection("clientComms").doc(clientId).get().catch(() => null),
      db.collection("clients").doc(clientId).get().catch(() => null),
    ])
  ).then((snaps) => {
    for (const snap of snaps) {
      if (!snap?.exists) continue
      const data = snap.data() as Record<string, unknown>
      if (data.smsUpdateNotifications !== true) continue
      const phone = readString(data.phone)
      if (phone) phones.add(phone)
    }
  })

  if (phones.size === 0) {
    return { attempted: 0, sent: 0, skipped: true, reason: "No opted-in phone numbers." }
  }

  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://clients.readyaimgo.biz"}/workspace/${encodeURIComponent(workspaceId)}?tab=updates`
  const body = `Readyaimgo update: ${title}. View it here: ${portalUrl}`
  let sent = 0

  for (const phone of phones) {
    const result = await sendSms({ to: phone, body })
    if (result.sent) sent += 1
  }

  return { attempted: phones.size, sent, skipped: false }
}

/**
 * GET — list updates for a workspace.
 * Any workspace member (or beam-admin) can read. Pinned updates first,
 * then newest first.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const { db, decodedToken, roles } = await getAuthenticatedBeamUser(request)

    if (!roles.includes("beam-admin")) {
      await assertWorkspaceRole(db, params.workspaceId, decodedToken.uid, "beam-participant")
    }

    const snap = await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("updates")
      .orderBy("postedAt", "desc")
      .limit(100)
      .get()

    const updates = snap.docs
      .map((doc) => normalizeWorkspaceUpdate(doc.id, doc.data() as Record<string, unknown>))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned))

    return NextResponse.json({ success: true, updates })
  } catch (error) {
    const status = errorStatus(error)
    if (status) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unauthorized." },
        { status }
      )
    }
    console.error("GET /workspaces/[workspaceId]/updates error:", error)
    return NextResponse.json({ error: "Unable to load updates." }, { status: 500 })
  }
}

/**
 * POST — create a new update. beam-admin only.
 * Body: { type, title, description?, url, thumbnailUrl?, pinned? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const { db, decodedToken, roles } = await getAuthenticatedBeamUser(request)

    if (!roles.includes("beam-admin")) {
      return NextResponse.json({ error: "Requires beam-admin role." }, { status: 403 })
    }

    const body = (await request.json()) as Record<string, unknown>

    const url = typeof body.url === "string" ? body.url.trim() : ""
    if (!url) {
      return NextResponse.json({ error: "url is required." }, { status: 400 })
    }

    const title = typeof body.title === "string" ? body.title.trim() : ""
    if (!title) {
      return NextResponse.json({ error: "title is required." }, { status: 400 })
    }

    const type: WorkspaceUpdateType = WORKSPACE_UPDATE_TYPES.includes(
      body.type as WorkspaceUpdateType
    )
      ? (body.type as WorkspaceUpdateType)
      : "note"

    const ref = db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("updates")
      .doc()

    await ref.set({
      type,
      title,
      description:
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null,
      url,
      thumbnailUrl:
        typeof body.thumbnailUrl === "string" && body.thumbnailUrl.trim()
          ? body.thumbnailUrl.trim()
          : null,
      postedByUid: decodedToken.uid,
      postedAt: FieldValue.serverTimestamp(),
      seenBy: [],
      workspaceId: params.workspaceId,
      pinned: body.pinned === true,
    })

    let smsNotification:
      | { attempted: number; sent: number; skipped: boolean; reason?: string }
      | null = null
    try {
      smsNotification = await sendWorkspaceUpdateSms({
        db,
        workspaceId: params.workspaceId,
        title,
      })
    } catch (smsError) {
      console.warn("Workspace update SMS failed:", smsError)
      smsNotification = {
        attempted: 0,
        sent: 0,
        skipped: true,
        reason: smsError instanceof Error ? smsError.message : "SMS failed.",
      }
    }

    return NextResponse.json({ success: true, id: ref.id, smsNotification })
  } catch (error) {
    const status = errorStatus(error)
    if (status) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unauthorized." },
        { status }
      )
    }
    console.error("POST /workspaces/[workspaceId]/updates error:", error)
    return NextResponse.json({ error: "Unable to post update." }, { status: 500 })
  }
}
