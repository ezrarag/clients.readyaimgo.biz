import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"

function getBearerToken(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization") || ""

  if (!authorizationHeader.startsWith("Bearer ")) {
    return null
  }

  return authorizationHeader.slice("Bearer ".length).trim()
}

function readRequiredString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`)
  }

  return value.trim()
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export async function POST(request: NextRequest) {
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

    const body = (await request.json()) as Record<string, unknown>
    const projectName = readRequiredString(body.projectName, "projectName")
    const websiteUrl = readOptionalString(body.websiteUrl)
    const organizationName = readRequiredString(
      body.organizationName,
      "organizationName"
    )
    const repositoryUrl = readOptionalString(body.repositoryUrl)
    const notes = readOptionalString(body.notes)
    const currentPortalProjectId = readOptionalString(body.currentPortalProjectId)
    const currentPortalClientId = readOptionalString(body.currentPortalClientId)

    const db = getAdminDb()
    const requestRef = db.collection("clientProjectRequests").doc()

    await requestRef.set({
      id: requestRef.id,
      projectName,
      websiteUrl,
      organizationName,
      repositoryUrl,
      notes,
      requestedByUid: decodedToken.uid,
      requestedByEmail: email,
      requestedByName: decodedToken.name || email,
      currentPortalProjectId,
      currentPortalClientId,
      status: "pending",
      source: "portal-search",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return NextResponse.json({
      success: true,
      requestId: requestRef.id,
    })
  } catch (error) {
    console.error("Client project request error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to submit project request.",
      },
      { status: 500 }
    )
  }
}
