import { type NextRequest, NextResponse } from "next/server"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import { normalizeInfrastructureLink } from "@/lib/infrastructure-links"

export const dynamic = "force-dynamic"

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
      .collection("infrastructureLinks")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get()

    const links = snap.docs
      .map((doc) =>
        normalizeInfrastructureLink(doc.id, doc.data() as Record<string, unknown>)
      )
      .filter((link) => link.clientVisible && link.confidence >= 0.45)

    return NextResponse.json({ success: true, links })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /workspaces/[workspaceId]/infrastructure-links error:", error)
    return NextResponse.json({ error: "Unable to load hosting records." }, { status: 500 })
  }
}
