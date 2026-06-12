import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAuthenticatedBeamUser } from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"

/**
 * PATCH — set or clear the Google Calendar ID on a workspace. beam-admin only.
 * Body: { googleCalendarId: string | null }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const { db, roles } = await getAuthenticatedBeamUser(request)

    if (!roles.includes("beam-admin")) {
      return NextResponse.json({ error: "Requires beam-admin role." }, { status: 403 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const googleCalendarId =
      typeof body.googleCalendarId === "string" && body.googleCalendarId.trim()
        ? body.googleCalendarId.trim()
        : null

    const ref = db.collection("workspaces").doc(params.workspaceId)
    const snap = await ref.get()
    if (!snap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }

    await ref.set(
      { googleCalendarId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && typeof (error as { status?: unknown }).status === "number") {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error("PATCH /workspaces/[workspaceId]/calendar-id error:", error)
    return NextResponse.json({ error: "Unable to save calendar ID." }, { status: 500 })
  }
}
