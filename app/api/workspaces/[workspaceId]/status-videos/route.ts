import { type NextRequest, NextResponse } from "next/server"

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

function timestampMillis(value: unknown) {
  if (typeof value === "string") {
    const time = new Date(value).getTime()
    return Number.isFinite(time) ? time : 0
  }
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === "object") {
    if (
      "seconds" in value &&
      typeof (value as { seconds: unknown }).seconds === "number"
    ) {
      return (value as { seconds: number }).seconds * 1000
    }
    if ("toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
      try {
        return (value as { toDate: () => Date }).toDate().getTime()
      } catch {
        return 0
      }
    }
  }
  return 0
}

function normalizeStatusVideo(
  clientId: string,
  id: string,
  data: Record<string, unknown>
) {
  const videoUrl =
    readString(data.videoUrl) ||
    readString(data.downloadUrl) ||
    readString(data.url) ||
    readString(data.publicUrl)
  if (!videoUrl) return null

  return {
    id: `${clientId}:${id}`,
    sourceClientId: clientId,
    title: readString(data.title) || "ReadyAimGo Build Update",
    videoUrl,
    aiSummary: data.aiSummary ?? data.summary ?? [],
    rawTranscript: readString(data.rawTranscript),
    category: readString(data.category),
    assetProjectType: data.assetProjectType ?? data.projectType ?? data.category ?? null,
    createdAt: data.createdAt ?? null,
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

export async function GET(
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
        addClientDocIdByQuery(candidateIds, "storyId", value),
        addClientDocIdByQuery(candidateIds, "clientId", value),
        addClientDocIdByQuery(candidateIds, "email", value.toLowerCase()),
        addClientDocIdByQuery(candidateIds, "businessEmail", value.toLowerCase()),
        addClientDocIdByQuery(candidateIds, "clientPortalEmail", value.toLowerCase()),
      ])
    )

    const videos = new Map<string, ReturnType<typeof normalizeStatusVideo>>()
    await Promise.all(
      Array.from(candidateIds).map(async (clientId) => {
        const snapshot = await db
          .collection("clients")
          .doc(clientId)
          .collection("statusVideos")
          .orderBy("createdAt", "desc")
          .limit(10)
          .get()
          .catch(() => null)

        for (const doc of snapshot?.docs ?? []) {
          const video = normalizeStatusVideo(clientId, doc.id, doc.data() as Record<string, unknown>)
          if (video) videos.set(video.id, video)
        }
      })
    )

    const statusVideos = Array.from(videos.values())
      .filter((video): video is NonNullable<typeof video> => Boolean(video))
      .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))
      .slice(0, 10)

    return NextResponse.json({
      success: true,
      candidateClientIds: Array.from(candidateIds),
      statusVideos,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /api/workspaces/[workspaceId]/status-videos error:", error)
    return NextResponse.json({ error: "Unable to load status videos." }, { status: 500 })
  }
}
