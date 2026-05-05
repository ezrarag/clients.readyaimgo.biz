import { type NextRequest, NextResponse } from "next/server"

import { normalizeBeamProjectDocument } from "@/lib/beam"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

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

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const email = decodedToken.email?.trim().toLowerCase()
    if (!email) {
      return NextResponse.json(
        { error: "Authenticated email required." },
        { status: 403 }
      )
    }

    const snapshot = await getAdminDb()
      .collection("projects")
      .where("clientPortalEmail", "==", email)
      .limit(20)
      .get()

    return NextResponse.json({
      projects: snapshot.docs.map((doc) =>
        normalizeBeamProjectDocument(
          doc.id,
          doc.data() as Record<string, unknown>
        )
      ),
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
