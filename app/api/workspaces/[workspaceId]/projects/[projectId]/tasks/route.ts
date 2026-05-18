import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

function serializeDoc(id: string, data: Record<string, unknown>) {
  return { id, ...data }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string; projectId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "beam-participant")

    const projectSnap = await db.collection("projects").doc(params.projectId).get()
    if (!projectSnap.exists) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 })
    }

    const project = projectSnap.data() as Record<string, unknown>
    const projectWorkspaceId =
      typeof project.workspaceId === "string" && project.workspaceId.trim()
        ? project.workspaceId.trim()
        : null
    if (projectWorkspaceId && projectWorkspaceId !== params.workspaceId) {
      return NextResponse.json({ error: "Project is not in this workspace." }, { status: 403 })
    }

    const snap = await db
      .collection("projectTasks")
      .where("projectId", "==", params.projectId)
      .limit(200)
      .get()

    return NextResponse.json({
      success: true,
      project: serializeDoc(projectSnap.id, project),
      tasks: snap.docs.map((doc) => serializeDoc(doc.id, doc.data())),
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /workspaces/[workspaceId]/projects/[projectId]/tasks error:", error)
    return NextResponse.json({ error: "Unable to load project tasks." }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string; projectId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "developer")

    const projectSnap = await db.collection("projects").doc(params.projectId).get()
    if (!projectSnap.exists) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 })
    }

    const project = projectSnap.data() as Record<string, unknown>
    const projectWorkspaceId =
      typeof project.workspaceId === "string" && project.workspaceId.trim()
        ? project.workspaceId.trim()
        : null
    if (projectWorkspaceId && projectWorkspaceId !== params.workspaceId) {
      return NextResponse.json({ error: "Project is not in this workspace." }, { status: 403 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const title = typeof body.title === "string" ? body.title.trim() : ""
    if (!title) {
      return NextResponse.json({ error: "title is required." }, { status: 400 })
    }

    const status =
      body.status === "accepted" ||
      body.status === "in_progress" ||
      body.status === "blocked" ||
      body.status === "done" ||
      body.status === "declined"
        ? body.status
        : "proposed"

    const taskRef = db.collection("projectTasks").doc()
    const now = FieldValue.serverTimestamp()
    const payload = {
      title,
      description: typeof body.description === "string" ? body.description.trim() : "",
      status,
      priority:
        body.priority === "high" || body.priority === "low" ? body.priority : "medium",
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      clientId: typeof project.clientId === "string" ? project.clientId : null,
      objectiveId: typeof body.objectiveId === "string" ? body.objectiveId.trim() : null,
      objectiveTitle:
        typeof body.objectiveTitle === "string" ? body.objectiveTitle.trim() : null,
      source: "manual",
      createdByUid: decoded.uid,
      createdByEmail: (decoded.email ?? "").toLowerCase(),
      createdAt: now,
      updatedAt: now,
    }

    await taskRef.set(payload)
    const created = await taskRef.get()

    return NextResponse.json(
      { success: true, task: serializeDoc(created.id, created.data() as Record<string, unknown>) },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /workspaces/[workspaceId]/projects/[projectId]/tasks error:", error)
    return NextResponse.json({ error: "Unable to create project task." }, { status: 500 })
  }
}
