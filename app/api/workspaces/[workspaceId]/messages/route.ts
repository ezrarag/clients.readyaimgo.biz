import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function serializeTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return null
    }
  }
  if (
    value &&
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    const date = new Date((value as { seconds: number }).seconds * 1000)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

function normalizeMessage(id: string, data: Record<string, unknown>) {
  return {
    id,
    body: readString(data.body),
    authorUid: readString(data.authorUid),
    authorEmail: readString(data.authorEmail),
    authorName: readString(data.authorName) || "Workspace member",
    authorLabel: readString(data.authorLabel),
    createdAt: serializeTimestamp(data.createdAt),
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
    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "beam-participant")

    const snapshot = await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get()

    const messages = snapshot.docs
      .map((doc) => normalizeMessage(doc.id, doc.data() as Record<string, unknown>))
      .filter((message) => Boolean(message.body))
      .reverse()

    return NextResponse.json({ success: true, messages })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /api/workspaces/[workspaceId]/messages error:", error)
    return NextResponse.json({ error: "Unable to load messages." }, { status: 500 })
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
    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "beam-participant")

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const messageBody = readString(body.body)
    if (!messageBody) {
      return NextResponse.json({ error: "Message body is required." }, { status: 400 })
    }
    if (messageBody.length > 2000) {
      return NextResponse.json(
        { error: "Message body must be 2,000 characters or fewer." },
        { status: 400 }
      )
    }

    const memberSnap = await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("members")
      .doc(decoded.uid)
      .get()
    const member = memberSnap.exists ? (memberSnap.data() as Record<string, unknown>) : {}
    const now = FieldValue.serverTimestamp()
    const ref = await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("messages")
      .add({
        body: messageBody,
        authorUid: decoded.uid,
        authorEmail: decoded.email ?? readString(member.email) ?? null,
        authorName: decoded.name ?? readString(member.displayName) ?? decoded.email ?? "Workspace member",
        authorLabel: readString(member.label) || null,
        createdAt: now,
      })

    const messageSnap = await ref.get()
    return NextResponse.json({
      success: true,
      message: normalizeMessage(ref.id, messageSnap.data() as Record<string, unknown>),
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /api/workspaces/[workspaceId]/messages error:", error)
    return NextResponse.json({ error: "Unable to post message." }, { status: 500 })
  }
}
