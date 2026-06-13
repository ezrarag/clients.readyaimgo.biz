import { type NextRequest, NextResponse } from "next/server"

import { getAuthenticatedBeamUser } from "@/lib/firebase-admin"
import { getCalendarClient, getUpcomingEvents } from "@/lib/google-calendar-server"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const { db, decodedToken, roles } = await getAuthenticatedBeamUser(request)

    if (!roles.includes("beam-admin")) {
      await assertWorkspaceRole(db, params.workspaceId, decodedToken.uid, "beam-participant")
    }

    const workspaceSnap = await db.collection("workspaces").doc(params.workspaceId).get()
    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }

    const workspace = workspaceSnap.data() as Record<string, unknown>
    const googleCalendarId =
      typeof workspace.googleCalendarId === "string" && workspace.googleCalendarId.trim()
        ? workspace.googleCalendarId.trim()
        : ""

    if (!googleCalendarId || !getCalendarClient()) {
      return NextResponse.json({ events: [], configured: false })
    }

    try {
      const events = await getUpcomingEvents(googleCalendarId)
      return NextResponse.json({ events, configured: true })
    } catch (error) {
      console.error("GET /workspaces/[workspaceId]/calendar-events fetch error:", error)
      return NextResponse.json({
        events: [],
        configured: true,
        error: "calendar_fetch_failed",
      })
    }
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error && typeof (error as { status?: unknown }).status === "number") {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error("GET /workspaces/[workspaceId]/calendar-events error:", error)
    return NextResponse.json({ error: "Unable to load calendar events." }, { status: 500 })
  }
}
