import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAuthenticatedBeamUser } from "@/lib/firebase-admin"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

/** PATCH — mark an update as seen by the caller. Workspace member or beam-admin. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string; updateId: string } }
) {
  try {
    const { db, decodedToken, roles } = await getAuthenticatedBeamUser(request)

    if (!roles.includes("beam-admin")) {
      await assertWorkspaceRole(db, params.workspaceId, decodedToken.uid, "beam-participant")
    }

    const ref = db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("updates")
      .doc(params.updateId)

    const snap = await ref.get()
    if (!snap.exists) {
      return NextResponse.json({ error: "Update not found." }, { status: 404 })
    }

    await ref.update({ seenBy: FieldValue.arrayUnion(decodedToken.uid) })

    return NextResponse.json({ success: true })
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
    console.error(
      "PATCH /workspaces/[workspaceId]/updates/[updateId]/seen error:",
      error
    )
    return NextResponse.json({ error: "Unable to mark update as seen." }, { status: 500 })
  }
}
