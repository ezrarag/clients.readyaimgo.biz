import { type NextRequest, NextResponse } from "next/server"

import { normalizeBeamProjectDocument } from "@/lib/beam"
import { getAdminDb } from "@/lib/firebase-admin"
import { resolvePortalIdentity } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const identity = await resolvePortalIdentity(request)
    if (!identity) {
      return NextResponse.json(
        { error: "Portal access unavailable for this account." },
        { status: 403 }
      )
    }

    const db = getAdminDb()
    const projectDocs: FirebaseFirestore.QueryDocumentSnapshot[] = []
    const clientIdChunks =
      identity.clientIds.length > 0 ? identity.clientIds.slice(0, 30) : []

    if (clientIdChunks.length === 1) {
      const snapshot = await db
        .collection("projects")
        .where("clientId", "==", clientIdChunks[0])
        .limit(20)
        .get()
      projectDocs.push(...snapshot.docs)
    } else if (clientIdChunks.length > 1) {
      const snapshot = await db
        .collection("projects")
        .where("clientId", "in", clientIdChunks)
        .limit(20)
        .get()
      projectDocs.push(...snapshot.docs)
    }

    const projects = projectDocs.map((doc) =>
      normalizeBeamProjectDocument(doc.id, doc.data() as Record<string, unknown>)
    )

    return NextResponse.json({
      projects,
      data: projects,
    })
  } catch (error) {
    console.error("Client portal projects error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load client projects.",
      },
      { status: 500 }
    )
  }
}
