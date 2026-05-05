import { type NextRequest, NextResponse } from "next/server"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { normalizeOrganization } from "@/lib/organizations"

export const dynamic = "force-dynamic"

function getBearerToken(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization") || ""

  if (!authorizationHeader.startsWith("Bearer ")) {
    return null
  }

  return authorizationHeader.slice("Bearer ".length).trim()
}

export async function GET(request: NextRequest) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) {
      return NextResponse.json(
        { error: "Missing Firebase authorization token." },
        { status: 401 }
      )
    }

    await getAdminAuth().verifyIdToken(idToken)

    const snapshot = await getAdminDb()
      .collection("organizations")
      .limit(100)
      .get()

    return NextResponse.json({
      organizations: snapshot.docs.map((doc) =>
        normalizeOrganization(doc.id, doc.data() as Record<string, unknown>)
      ),
    })
  } catch (error) {
    console.error("Client portal organizations error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load organizations.",
      },
      { status: 500 }
    )
  }
}
