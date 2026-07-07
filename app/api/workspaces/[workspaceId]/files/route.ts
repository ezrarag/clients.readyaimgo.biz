import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import {
  normalizeWorkspaceFile,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  WORKSPACE_FILES_STORAGE_PREFIX,
} from "@/lib/workspace-files"

export const dynamic = "force-dynamic"

// ─── GET /api/workspaces/[workspaceId]/files ──────────────────────────────────
// Returns all file metadata docs ordered newest-first.
// Requires workspace membership.

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "beam-participant")

    const snap = await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("files")
      .orderBy("createdAt", "desc")
      .get()

    const files = snap.docs.map((d) =>
      normalizeWorkspaceFile(d.id, d.data() as Record<string, unknown>)
    )

    return NextResponse.json({ success: true, files })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /files error:", error)
    return NextResponse.json({ error: "Unable to load files." }, { status: 500 })
  }
}

// ─── POST /api/workspaces/[workspaceId]/files ─────────────────────────────────
// Saves file metadata AFTER the client has uploaded to Firebase Storage.
// The server validates membership, MIME type, size, and storage path prefix
// before writing the Firestore doc. Requires workspace membership.
//
// Body: { name, contentType, size, storagePath, downloadUrl, category?, projectId? }

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "beam-participant")

    const body = (await request.json()) as Record<string, unknown>

    const name =
      typeof body.name === "string" && body.name.trim() ? body.name.trim() : null
    const contentType =
      typeof body.contentType === "string" ? body.contentType.trim() : ""
    const size = typeof body.size === "number" ? body.size : -1
    const storagePath =
      typeof body.storagePath === "string" ? body.storagePath.trim() : ""
    const downloadUrl =
      typeof body.downloadUrl === "string" ? body.downloadUrl.trim() : ""
    const category =
      body.category === "general" ? "general" : "contract"
    const projectId =
      typeof body.projectId === "string" && body.projectId.trim()
        ? body.projectId.trim()
        : null

    // ── Validation ────────────────────────────────────────────────────────────

    if (!name) {
      return NextResponse.json({ error: "name is required." }, { status: 400 })
    }
    if (!downloadUrl) {
      return NextResponse.json({ error: "downloadUrl is required." }, { status: 400 })
    }
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${contentType || "(empty)"}` },
        { status: 400 }
      )
    }
    if (size < 0 || size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File size must be between 1 byte and 50 MB.` },
        { status: 400 }
      )
    }
    // Ensure the storage path belongs to this workspace — prevents a member of
    // workspace A from registering a file they uploaded to workspace B's path.
    const expectedPrefix = `${WORKSPACE_FILES_STORAGE_PREFIX}/${params.workspaceId}/`
    if (!storagePath.startsWith(expectedPrefix)) {
      return NextResponse.json(
        { error: "storagePath does not belong to this workspace." },
        { status: 400 }
      )
    }

    const now = FieldValue.serverTimestamp()
    const docRef = db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("files")
      .doc()

    await docRef.set({
      workspaceId: params.workspaceId,
      uploadedByUid: decoded.uid,
      uploadedByEmail: (decoded.email ?? "").toLowerCase(),
      projectId,
      name,
      contentType,
      size,
      storagePath,
      downloadUrl,
      category,
      createdAt: now,
    })

    const fileDoc = await docRef.get()
    const file = normalizeWorkspaceFile(
      docRef.id,
      fileDoc.data() as Record<string, unknown>
    )

    return NextResponse.json({ success: true, file }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /files error:", error)
    return NextResponse.json({ error: "Unable to save file metadata." }, { status: 500 })
  }
}

// ─── DELETE /api/workspaces/[workspaceId]/files/[fileId] ──────────────────────
// Developers and owners can delete file metadata (Storage object must be deleted
// separately via the client SDK or an admin script).
// We handle this via a query param to avoid a deeper route file.

export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "developer")

    const fileId = request.nextUrl.searchParams.get("fileId")?.trim()
    if (!fileId) {
      return NextResponse.json({ error: "fileId query param is required." }, { status: 400 })
    }

    const docRef = db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("files")
      .doc(fileId)

    const snap = await docRef.get()
    if (!snap.exists) {
      return NextResponse.json({ error: "File not found." }, { status: 404 })
    }

    await docRef.delete()
    return NextResponse.json({ success: true, deleted: fileId })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("DELETE /files error:", error)
    return NextResponse.json({ error: "Unable to delete file." }, { status: 500 })
  }
}
