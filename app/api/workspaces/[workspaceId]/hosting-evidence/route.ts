import { createHash } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

function readString(value: unknown, maxLength = 8000) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null
}

function stableId(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 32)
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
    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "developer")

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const evidenceText = readString(body.evidenceText)
    if (!evidenceText) {
      return NextResponse.json({ error: "Billing evidence text is required." }, { status: 400 })
    }

    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const workspaceSnap = await workspaceRef.get()
    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }

    const workspace = workspaceSnap.data() as Record<string, unknown>
    const clientId = readString(workspace.clientId, 300)?.toLowerCase()
    if (!clientId) {
      return NextResponse.json(
        { error: "Workspace is missing a clientId for correspondence storage." },
        { status: 400 }
      )
    }

    const subject = readString(body.subject, 240) ?? "Manual hosting billing evidence"
    const from = readString(body.from, 240) ?? decoded.email ?? "manual-entry"
    const now = new Date().toISOString()
    const evidenceId = `manual_hosting_${stableId([
      params.workspaceId,
      clientId,
      subject,
      evidenceText,
    ].join("|"))}`

    const emailRef = db
      .collection("clientComms")
      .doc(clientId)
      .collection("emails")
      .doc(evidenceId)

    await emailRef.set(
      {
        subject,
        title: subject,
        from,
        sender: from,
        to: clientId,
        date: now,
        syncedAt: FieldValue.serverTimestamp(),
        snippet: evidenceText.slice(0, 900),
        text: evidenceText,
        body: evidenceText,
        sourceSystem: "manual-zoho-evidence",
        sourceProvider: "manual",
        workspaceId: params.workspaceId,
        clientId,
        createdByUid: decoded.uid,
        createdByEmail: decoded.email ?? null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    await workspaceRef.set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true })

    return NextResponse.json({
      success: true,
      evidenceId,
      clientId,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /workspaces/[workspaceId]/hosting-evidence error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save billing evidence." },
      { status: 500 }
    )
  }
}
