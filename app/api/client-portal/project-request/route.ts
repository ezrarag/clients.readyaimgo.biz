import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminDb } from "@/lib/firebase-admin"
import { isClientAllowed, resolvePortalIdentity } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

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
    const identity = await resolvePortalIdentity(request)
    if (!identity) {
      return NextResponse.json(
        { error: "Portal access unavailable for this account." },
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
    const requestedClientId = readOptionalString(body.currentPortalClientId)

    if (requestedClientId && !isClientAllowed(identity, requestedClientId)) {
      return NextResponse.json(
        { error: "This client workspace is not available for the signed-in account." },
        { status: 403 }
      )
    }

    const currentPortalClientId =
      requestedClientId && isClientAllowed(identity, requestedClientId)
        ? requestedClientId.trim().toLowerCase()
        : identity.activeClientId

    const db = getAdminDb()
    const requestRef = db.collection("clientProjectRequests").doc()

    await requestRef.set({
      id: requestRef.id,
      projectName,
      websiteUrl,
      organizationName,
      repositoryUrl,
      notes,
      requestedByUid: identity.uid,
      requestedByEmail: identity.email,
      requestedByName: identity.email,
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
