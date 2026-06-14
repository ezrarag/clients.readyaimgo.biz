import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
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

function normalizeNote(id: string, data: Record<string, unknown>) {
  const body = readString(data.body)
  if (!body) return null

  return {
    id,
    body,
    authorUid: readString(data.authorUid),
    authorEmail: readString(data.authorEmail),
    authorName: readString(data.authorName) || "Workspace member",
    role: readString(data.role) || "member",
    source: readString(data.source) || "client-portal",
    resolved: data.resolved === true,
    createdAt: data.createdAt ?? null,
  }
}

function parseVideoKey(rawVideoId: string) {
  const decoded = decodeURIComponent(rawVideoId)
  const separatorIndex = decoded.indexOf(":")
  if (separatorIndex <= 0 || separatorIndex === decoded.length - 1) {
    return null
  }

  return {
    sourceClientId: decoded.slice(0, separatorIndex),
    statusVideoId: decoded.slice(separatorIndex + 1),
  }
}

async function addClientDocIdByQuery(
  ids: Set<string>,
  field: string,
  value: string
) {
  if (!value) return
  const snapshot = await getAdminDb()
    .collection("clients")
    .where(field, "==", value)
    .limit(5)
    .get()
    .catch(() => null)
  for (const doc of snapshot?.docs ?? []) ids.add(doc.id)
}

async function resolveCandidateClientIds(workspaceId: string, uid: string) {
  const db = getAdminDb()
  const { workspace, role } = await resolveWorkspaceContext(
    db,
    workspaceId,
    uid,
    "beam-participant"
  )

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
    Array.from(candidateIds).map((id) =>
      db.collection("clients").doc(id).get().catch(() => null)
    )
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
      addClientDocIdByQuery(candidateIds, "storyId", value),
      addClientDocIdByQuery(candidateIds, "clientId", value),
      addClientDocIdByQuery(candidateIds, "email", value.toLowerCase()),
      addClientDocIdByQuery(candidateIds, "businessEmail", value.toLowerCase()),
      addClientDocIdByQuery(candidateIds, "clientPortalEmail", value.toLowerCase()),
    ])
  )

  return { candidateIds, role }
}

async function resolveVideoRef(workspaceId: string, uid: string, rawVideoId: string) {
  const parsed = parseVideoKey(rawVideoId)
  if (!parsed) {
    throw new WorkspaceAuthError("Invalid status video id.", 404)
  }

  const { candidateIds, role } = await resolveCandidateClientIds(workspaceId, uid)
  if (!candidateIds.has(parsed.sourceClientId)) {
    throw new WorkspaceAuthError("Status video not found for this workspace.", 404)
  }

  const videoRef = getAdminDb()
    .collection("clients")
    .doc(parsed.sourceClientId)
    .collection("statusVideos")
    .doc(parsed.statusVideoId)
  const videoSnap = await videoRef.get()
  if (!videoSnap.exists) {
    throw new WorkspaceAuthError("Status video not found.", 404)
  }

  return { videoRef, parsed, role }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string; videoId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const { videoRef } = await resolveVideoRef(
      params.workspaceId,
      decoded.uid,
      params.videoId
    )

    const snapshot = await videoRef
      .collection("notes")
      .orderBy("createdAt", "asc")
      .limit(50)
      .get()

    const notes = snapshot.docs
      .map((doc) => normalizeNote(doc.id, doc.data() as Record<string, unknown>))
      .filter((note): note is NonNullable<typeof note> => Boolean(note))

    return NextResponse.json({ success: true, notes })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /api/workspaces/[workspaceId]/status-videos/[videoId]/notes error:", error)
    return NextResponse.json({ error: "Unable to load video notes." }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string; videoId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const { videoRef, parsed, role } = await resolveVideoRef(
      params.workspaceId,
      decoded.uid,
      params.videoId
    )

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const noteBody = readString(body.body)
    if (!noteBody) {
      return NextResponse.json({ error: "Note body is required." }, { status: 400 })
    }
    if (noteBody.length > 2000) {
      return NextResponse.json({ error: "Note body must be 2,000 characters or fewer." }, { status: 400 })
    }

    const createdAt = new Date().toISOString()
    const noteRef = await videoRef.collection("notes").add({
      body: noteBody,
      authorUid: decoded.uid,
      authorEmail: decoded.email ?? null,
      authorName: decoded.name ?? decoded.email ?? "Workspace member",
      role,
      source: "client-portal",
      resolved: false,
      createdAt,
    })

    await videoRef.set(
      {
        notesCount: FieldValue.increment(1),
        latestNoteAt: createdAt,
        latestNoteAuthorUid: decoded.uid,
      },
      { merge: true }
    )

    return NextResponse.json({
      success: true,
      note: {
        id: noteRef.id,
        body: noteBody,
        authorUid: decoded.uid,
        authorEmail: decoded.email ?? null,
        authorName: decoded.name ?? decoded.email ?? "Workspace member",
        role,
        source: "client-portal",
        resolved: false,
        createdAt,
      },
      sourceClientId: parsed.sourceClientId,
      statusVideoId: parsed.statusVideoId,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /api/workspaces/[workspaceId]/status-videos/[videoId]/notes error:", error)
    return NextResponse.json({ error: "Unable to save video note." }, { status: 500 })
  }
}
