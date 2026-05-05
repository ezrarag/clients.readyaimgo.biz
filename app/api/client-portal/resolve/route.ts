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

function normalizeClientId(value: string | null) {
  return (value || "").trim().toLowerCase()
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

    const clientId = normalizeClientId(
      request.nextUrl.searchParams.get("clientId")
    )
    const db = getAdminDb()
    const snapshot = await db
      .collection("projects")
      .where("clientPortalEmail", "==", email)
      .limit(10)
      .get()

    const matchingDoc =
      clientId.length > 0
        ? snapshot.docs.find((doc) => {
            const docClientId = doc.get("clientId")
            return typeof docClientId === "string" && docClientId.trim().toLowerCase() === clientId
          }) || null
        : snapshot.docs[0] || null

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
