import { type NextRequest, NextResponse } from "next/server"

import { getAuthenticatedBeamUser } from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"

/** DELETE — remove an update. beam-admin only. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string; updateId: string } }
) {
  try {
    const { db, roles } = await getAuthenticatedBeamUser(request)

    if (!roles.includes("beam-admin")) {
      return NextResponse.json({ error: "Requires beam-admin role." }, { status: 403 })
    }

    await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("updates")
      .doc(params.updateId)
      .delete()

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && typeof (error as { status?: unknown }).status === "number") {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error("DELETE /workspaces/[workspaceId]/updates/[updateId] error:", error)
    return NextResponse.json({ error: "Unable to delete update." }, { status: 500 })
  }
}
