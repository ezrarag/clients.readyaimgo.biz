import { type NextRequest, NextResponse } from "next/server"
import { FieldValue, type Firestore } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { normalizePhoneToE164 } from "@/lib/phone"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, resolveWorkspaceContext } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

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

async function resolveWritableClientIds(db: Firestore, workspace: Record<string, unknown>) {
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()
    const { workspace } = await resolveWorkspaceContext(
      db,
      params.workspaceId,
      decoded.uid,
      "employee-of-client"
    )

    const clientId = workspace.clientId?.trim()
    if (!clientId) {
      return NextResponse.json(
        { error: "This workspace is not linked to a client account." },
        { status: 400 }
      )
    }

    const body = (await request.json()) as Record<string, unknown>
    const phone =
      typeof body.phone === "string" ? normalizePhoneToE164(body.phone) : undefined
    const hasSmsPreference = Object.prototype.hasOwnProperty.call(
      body,
      "smsUpdateNotifications"
    )
    const smsUpdateNotifications = body.smsUpdateNotifications === true

    if (phone === undefined) {
      return NextResponse.json({ error: "phone is required." }, { status: 400 })
    }

    const now = FieldValue.serverTimestamp()
    const batch = db.batch()
    const clientIds = await resolveWritableClientIds(db, workspace as unknown as Record<string, unknown>)
    if (!clientIds.includes(clientId)) clientIds.push(clientId)

    for (const id of clientIds) {
      const updates = {
        phone,
        ...(hasSmsPreference ? { smsUpdateNotifications } : {}),
        updatedAt: now,
      }
      batch.set(db.collection("clients").doc(id), updates, { merge: true })
      batch.set(
        db.collection("clientComms").doc(id),
        {
          clientId: id,
          ...updates,
          updatedAt: now,
        },
        { merge: true }
      )
    }
    await batch.commit()

    return NextResponse.json({
      success: true,
      phone,
      smsUpdateNotifications,
      clientIds,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("PATCH /api/workspaces/[workspaceId]/account-info error:", error)
    return NextResponse.json({ error: "Unable to update account information." }, { status: 500 })
  }
}
