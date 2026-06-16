import { type NextRequest, NextResponse } from "next/server"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, resolveWorkspaceContext } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function normalizeMeetingRequest(id: string, data: Record<string, unknown>) {
  return {
    id,
    topic: readString(data.topic) || "Workspace meeting",
    requestedDate: readString(data.requestedDate),
    requestedTime: readString(data.requestedTime),
    timezone: readString(data.timezone) || "America/Chicago",
    notes: readString(data.notes),
    status: readString(data.status) || "pending",
    authorUid: readString(data.authorUid),
    authorEmail: readString(data.authorEmail),
    authorName: readString(data.authorName) || "Workspace member",
    createdAt: data.createdAt ?? null,
  }
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
    await resolveWorkspaceContext(db, params.workspaceId, decoded.uid, "beam-participant")

    const snapshot = await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("meetingRequests")
      .orderBy("createdAt", "desc")
      .limit(10)
      .get()

    return NextResponse.json({
      success: true,
      meetingRequests: snapshot.docs.map((doc) =>
        normalizeMeetingRequest(doc.id, doc.data() as Record<string, unknown>)
      ),
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /api/workspaces/[workspaceId]/meeting-requests error:", error)
    return NextResponse.json({ error: "Unable to load meeting requests." }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()
    await resolveWorkspaceContext(db, params.workspaceId, decoded.uid, "beam-participant")

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const topic = readString(body.topic) || "Workspace meeting"
    const requestedDate = readString(body.requestedDate)
    const requestedTime = readString(body.requestedTime)
    const timezone = readString(body.timezone) || "America/Chicago"
    const notes = readString(body.notes)

    if (!requestedDate || !requestedTime) {
      return NextResponse.json({ error: "Date and time are required." }, { status: 400 })
    }

    const createdAt = new Date().toISOString()
    const requestRef = await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("meetingRequests")
      .add({
        topic,
        requestedDate,
        requestedTime,
        timezone,
        notes,
        status: "pending",
        authorUid: decoded.uid,
        authorEmail: decoded.email ?? null,
        authorName: decoded.name ?? decoded.email ?? "Workspace member",
        createdAt,
      })

    return NextResponse.json({
      success: true,
      meetingRequest: {
        id: requestRef.id,
        topic,
        requestedDate,
        requestedTime,
        timezone,
        notes,
        status: "pending",
        authorUid: decoded.uid,
        authorEmail: decoded.email ?? null,
        authorName: decoded.name ?? decoded.email ?? "Workspace member",
        createdAt,
      },
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /api/workspaces/[workspaceId]/meeting-requests error:", error)
    return NextResponse.json({ error: "Unable to request meeting." }, { status: 500 })
  }
}
