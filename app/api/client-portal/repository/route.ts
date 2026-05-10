import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { normalizeBeamProjectDocument } from "@/lib/beam"
import { getAdminDb } from "@/lib/firebase-admin"
import { isClientAllowed, resolvePortalIdentity } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

function normalizeProjectId(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeUrl(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    if (fieldName === "deploymentUrl") {
      return null
    }

    throw new Error(`${fieldName} is required.`)
  }

  const candidate = value.trim()
  const parsed = new URL(candidate)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${fieldName} must use http or https.`)
  }

  return parsed.toString()
}

function parseGitHubRepository(repositoryUrl: string) {
  const parsedUrl = new URL(repositoryUrl)
  if (!["github.com", "www.github.com"].includes(parsedUrl.hostname.toLowerCase())) {
    throw new Error("repositoryUrl must be a GitHub repository URL.")
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean)
  if (segments.length < 2) {
    throw new Error("repositoryUrl must include both owner and repository name.")
  }

  const owner = segments[0].trim()
  const repositoryName = segments[1].trim().replace(/\.git$/i, "")
  if (!owner || !repositoryName) {
    throw new Error("repositoryUrl must include both owner and repository name.")
  }

  return {
    owner,
    name: repositoryName,
    fullName: `${owner}/${repositoryName}`,
    url: `https://github.com/${owner}/${repositoryName}`,
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const identity = await resolvePortalIdentity(request)
    if (!identity) {
      return NextResponse.json(
        { error: "Portal access unavailable for this account." },
        { status: 403 }
      )
    }

    const body = (await request.json()) as Record<string, unknown>
    const projectId = normalizeProjectId(body.projectId)
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 })
    }

    const repositoryUrl = normalizeUrl(body.repositoryUrl, "repositoryUrl")
    if (!repositoryUrl) {
      return NextResponse.json(
        { error: "repositoryUrl is required." },
        { status: 400 }
      )
    }
    const deploymentUrl = normalizeUrl(body.deploymentUrl, "deploymentUrl")
    const repository = parseGitHubRepository(repositoryUrl)

    const db = getAdminDb()
    const projectRef = db.collection("projects").doc(projectId)
    const projectSnapshot = await projectRef.get()
    if (!projectSnapshot.exists) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 })
    }

    const projectData = projectSnapshot.data() as Record<string, unknown>
    const projectClientId =
      typeof projectData.clientId === "string"
        ? projectData.clientId.trim().toLowerCase()
        : ""

    if (!isClientAllowed(identity, projectClientId)) {
      return NextResponse.json(
        { error: "This project is not available for the signed-in account." },
        { status: 403 }
      )
    }

    await projectRef.set(
      {
        repository: {
          provider: "github",
          owner: repository.owner,
          name: repository.name,
          fullName: repository.fullName,
          url: repository.url,
          deploymentUrl,
          attachedByUid: identity.uid,
          attachedByEmail: identity.email,
          attachedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    )

    const updatedSnapshot = await projectRef.get()
    return NextResponse.json({
      success: true,
      project: normalizeBeamProjectDocument(
        updatedSnapshot.id,
        updatedSnapshot.data() as Record<string, unknown>
      ),
    })
  } catch (error) {
    console.error("Client portal repository attach error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to attach repository to project.",
      },
      { status: 500 }
    )
  }
}
