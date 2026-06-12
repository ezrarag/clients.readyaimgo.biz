import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAuthenticatedBeamUser } from "@/lib/firebase-admin"
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

    return NextResponse.json({ success: true, id: ref.id })
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
