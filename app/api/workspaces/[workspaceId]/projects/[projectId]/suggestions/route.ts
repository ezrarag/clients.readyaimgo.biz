import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

type FeedbackDoc = Record<string, unknown> & {
  createdAt?: { toDate?: () => Date }
  updatedAt?: { toDate?: () => Date }
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readPriority(value: unknown) {
  return value === "low" || value === "medium" || value === "high" ? value : "medium"
}

function serializeSuggestion(id: string, data: FeedbackDoc) {
  return {
    id,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
  }
}

function createdAtMillis(item: ReturnType<typeof serializeSuggestion>) {
  const value = typeof item.createdAt === "string" ? Date.parse(item.createdAt) : 0
  return Number.isFinite(value) ? value : 0
}

async function loadProjectFallback(projectId: string) {
  const db = getAdminDb()
  const snap = await db.collection("projects").doc(projectId).get()
  return snap.exists ? (snap.data() as Record<string, unknown>) : null
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

    const snapshot = await db
      .collection("clientFeedback")
      .where("workspaceId", "==", params.workspaceId)
      .limit(100)
      .get()

    const suggestions = snapshot.docs
      .map((doc) => serializeSuggestion(doc.id, doc.data() as FeedbackDoc))
      .filter((suggestion) => String((suggestion as Record<string, unknown>).projectId ?? "") === params.projectId)
      .sort((a, b) => createdAtMillis(b) - createdAtMillis(a))
      .slice(0, 50)

    return NextResponse.json({ success: true, suggestions })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /workspaces/[workspaceId]/projects/[projectId]/suggestions error:", error)
    return NextResponse.json({ error: "Unable to load project suggestions." }, { status: 500 })
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

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "beam-participant")

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const text = readString(body.rawText) || readString(body.summary) || readString(body.body)
    if (!text) {
      return NextResponse.json({ error: "Suggestion text is required." }, { status: 400 })
    }
    if (text.length > 2500) {
      return NextResponse.json({ error: "Suggestion text must be 2,500 characters or fewer." }, { status: 400 })
    }

    const workspaceSnap = await db.collection("workspaces").doc(params.workspaceId).get()
    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }
    const workspace = workspaceSnap.data() as Record<string, unknown>
    const project = await loadProjectFallback(params.projectId)
    const projectTitle =
      readString(body.projectTitle) ||
      readString(project?.title) ||
      readString(project?.name) ||
      params.projectId
    const projectType =
      readString(body.projectType) ||
      readString(project?.assetProjectType) ||
      readString(project?.projectType) ||
      null
    const clientId = readString(workspace.clientId) || readString(project?.clientId) || null
    const clientName =
      readString(workspace.name) ||
      readString(workspace.workspaceName) ||
      readString(project?.clientName) ||
      decoded.name ||
      "Workspace member"
    const priority = readPriority(body.urgency ?? body.priority)

    const ref = db.collection("clientFeedback").doc()
    const now = FieldValue.serverTimestamp()
    await ref.set({
      id: ref.id,
      projectId: params.projectId,
      projectTitle,
      projectType,
      workspaceId: params.workspaceId,
      workspaceName: readString(workspace.name) || readString(workspace.workspaceName) || null,
      clientId,
      clientEmail: (decoded.email ?? "").toLowerCase() || null,
      clientName,
      rawText: text,
      loomUrl: null,
      pageUrl: readString(body.pageUrl) || null,
      elementSelector: null,
      summary: text,
      category: readString(body.category) || "suggestion",
      urgency: priority,
      actionable: true,
      suggestedAction: "Review in ReadyAimGo admin or raCommand, then decide whether to implement locally.",
      pulseScore: priority === "high" ? 8 : priority === "low" ? 3 : 5,
      status: "open",
      resolvedAt: null,
      resolvedNote: null,
      source: "workspace-project-suggestion",
      intakeSurface: "clients.readyaimgo.biz/projects",
      agentContextStatus: "ready",
      createdByUid: decoded.uid,
      createdAt: now,
      updatedAt: now,
    })

    await db.collection("workspaces").doc(params.workspaceId).set(
      {
        lastClientActivity: now,
        openProjectSuggestionCount: FieldValue.increment(1),
        updatedAt: now,
      },
      { merge: true }
    )

    const created = await ref.get()
    return NextResponse.json(
      {
        success: true,
        suggestion: serializeSuggestion(created.id, created.data() as FeedbackDoc),
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /workspaces/[workspaceId]/projects/[projectId]/suggestions error:", error)
    return NextResponse.json({ error: "Unable to save project suggestion." }, { status: 500 })
  }
}
