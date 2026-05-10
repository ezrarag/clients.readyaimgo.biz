import { type NextRequest, NextResponse } from "next/server"

import { normalizeBeamProjectDocument } from "@/lib/beam"
import { getAdminDb } from "@/lib/firebase-admin"
import { resolvePortalIdentity } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

function normalizeClientId(value: string | null) {
  return (value || "").trim().toLowerCase()
}

export async function GET(request: NextRequest) {
  try {
    const clientId = normalizeClientId(
      request.nextUrl.searchParams.get("clientId")
    )
    const identity = await resolvePortalIdentity(request, clientId)

    if (!identity) {
      return NextResponse.json(
        { error: "Portal access unavailable for this account." },
        { status: 403 }
      )
    }

    const db = getAdminDb()
    const resolvedClientId = clientId || identity.activeClientId
    const snapshot = await db
      .collection("projects")
      .where("clientId", "==", resolvedClientId)
      .limit(10)
      .get()

    const matchingDoc = snapshot.docs[0] || null

    if (!matchingDoc) {
      return NextResponse.json(
        {
          destination: "/dashboard",
          project: null,
        },
        { status: 404 }
      )
    }

    const project = normalizeBeamProjectDocument(
      matchingDoc.id,
      matchingDoc.data() as Record<string, unknown>
    )

    return NextResponse.json({
      destination: `/portal/${project.clientId}`,
      project,
    })
  } catch (error) {
    console.error("Client portal resolve error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to resolve client portal access.",
      },
      { status: 500 }
    )
  }
}
