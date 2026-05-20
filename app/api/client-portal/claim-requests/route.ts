import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"

function getBearerToken(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization") || ""
  return authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length).trim()
    : null
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function serializeRequest(id: string, data: Record<string, unknown>) {
  return {
    id,
    uid: readString(data.uid),
    email: readString(data.email),
    displayName: readString(data.displayName),
    requestedWorkspaceId: readString(data.requestedWorkspaceId),
    requestedWorkspaceName: readString(data.requestedWorkspaceName),
    requestedClientId: readString(data.requestedClientId),
    requestedClientName: readString(data.requestedClientName),
    requestedProjectId: readString(data.requestedProjectId),
    requestedProjectName: readString(data.requestedProjectName),
    evidenceNotes: readString(data.evidenceNotes),
    status: readString(data.status) || "pending",
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  }
}

async function getAuthenticatedUser(request: NextRequest) {
  const token = getBearerToken(request)
  if (!token) {
    const error = new Error("Missing authorization token.")
    ;(error as Error & { status?: number }).status = 401
    throw error
  }

  try {
    return await getAdminAuth().verifyIdToken(token)
  } catch {
    const error = new Error("Invalid authorization token.")
    ;(error as Error & { status?: number }).status = 401
    throw error
  }
}

function serializeWorkspaceOption(id: string, data: Record<string, unknown>) {
  const clientId = readString(data.clientId)
  const clientEmail = readString(data.clientEmail)
  const name = readString(data.name) || readString(data.companyName) || id

  return {
    workspaceId: id,
    clientId: clientId || id,
    name,
    clientEmail,
    source: "workspace",
  }
}

function matchesSearch(option: Record<string, string>, query: string) {
  const haystack = Object.values(option).join(" ").toLowerCase()
  return haystack.includes(query)
}

async function searchWorkspaceOptions(query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length < 2) return []

  const db = getAdminDb()
  const [workspaceSnapshot, clientSnapshot, projectSnapshot] = await Promise.all([
    db.collection("workspaces").limit(200).get(),
    db.collection("clients").limit(200).get(),
    db.collection("projects").limit(200).get(),
  ])

  const options = new Map<string, ReturnType<typeof serializeWorkspaceOption>>()

  for (const doc of workspaceSnapshot.docs) {
    const option = serializeWorkspaceOption(doc.id, (doc.data() ?? {}) as Record<string, unknown>)
    if (
      matchesSearch(
        {
          workspaceId: option.workspaceId,
          clientId: option.clientId,
          name: option.name,
          clientEmail: option.clientEmail,
        },
        normalizedQuery
      )
    ) {
      options.set(option.workspaceId || option.clientId, option)
    }
  }

  for (const doc of clientSnapshot.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>
    const workspaceId = readString(data.workspaceId)
    const option = {
      workspaceId,
      clientId: readString(data.clientId) || doc.id,
      name: readString(data.companyName) || readString(data.name) || doc.id,
      clientEmail: readString(data.email) || doc.id,
      source: "client",
    }
    if (matchesSearch(option, normalizedQuery)) {
      options.set(option.workspaceId || option.clientId, option)
    }
  }

  for (const doc of projectSnapshot.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>
    const workspaceId = readString(data.workspaceId)
    const option = {
      workspaceId,
      clientId: readString(data.clientId) || doc.id,
      name: readString(data.clientName) || readString(data.name) || doc.id,
      clientEmail: readString(data.clientPortalEmail) || readString(data.clientEmail),
      source: "project",
    }
    if (matchesSearch(option, normalizedQuery)) {
      options.set(option.workspaceId || option.clientId, option)
    }
  }

  return Array.from(options.values()).slice(0, 25)
}

async function loadWorkspace({
  workspaceId,
  clientId,
}: {
  workspaceId?: string
  clientId?: string
}) {
  const db = getAdminDb()

  if (workspaceId) {
    const workspaceSnapshot = await db.collection("workspaces").doc(workspaceId).get()
    if (workspaceSnapshot.exists) {
      const workspaceData = (workspaceSnapshot.data() ?? {}) as Record<string, unknown>
      return {
        workspaceId,
        workspaceName: readString(workspaceData.name) || workspaceId,
        clientId: readString(workspaceData.clientId) || workspaceId,
        name: readString(workspaceData.name) || workspaceId,
        projectId: "",
        projectName: "",
      }
    }
  }

  if (!clientId) return null

  const [clientSnapshot, projectSnapshot] = await Promise.all([
    db.collection("clients").doc(clientId).get(),
    db.collection("projects").doc(clientId).get(),
  ])

  if (!clientSnapshot.exists && !projectSnapshot.exists) {
    return null
  }

  const clientData = (clientSnapshot.data() ?? {}) as Record<string, unknown>
  const projectData = (projectSnapshot.data() ?? {}) as Record<string, unknown>

  return {
    workspaceId: "",
    workspaceName: "",
    clientId,
    name:
      readString(clientData.companyName) ||
      readString(clientData.name) ||
      readString(projectData.clientName) ||
      readString(projectData.name) ||
      clientId,
    projectId: projectSnapshot.exists ? projectSnapshot.id : "",
    projectName: readString(projectData.name) || readString(projectData.clientName),
  }
}

export async function GET(request: NextRequest) {
  try {
    const decodedToken = await getAuthenticatedUser(request)
    const search = request.nextUrl.searchParams.get("search")?.trim() || ""

    if (search) {
      const workspaces = await searchWorkspaceOptions(search)
      return NextResponse.json({ success: true, workspaces })
    }

    const snapshot = await getAdminDb()
      .collection("clientClaimRequests")
      .where("uid", "==", decodedToken.uid)
      .limit(25)
      .get()

    const requests = snapshot.docs
      .map((doc) => serializeRequest(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))

    return NextResponse.json({ success: true, requests })
  } catch (error) {
    console.error("Claim requests GET error:", error)
    const status = (error as Error & { status?: number }).status
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load claim requests." },
      { status: status ?? 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const decodedToken = await getAuthenticatedUser(request)
    const email = decodedToken.email?.trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: "A signed-in email is required." }, { status: 400 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const requestedWorkspaceId = readString(body.requestedWorkspaceId)
    const requestedClientId = readString(body.requestedClientId).toLowerCase()
    const requestedProjectId = readString(body.requestedProjectId)
    const evidenceNotes = readString(body.evidenceNotes)

    if (!requestedWorkspaceId && !requestedClientId) {
      return NextResponse.json(
        { error: "requestedWorkspaceId or requestedClientId is required." },
        { status: 400 }
      )
    }

    const workspace = await loadWorkspace({
      workspaceId: requestedWorkspaceId,
      clientId: requestedClientId,
    })
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }

    const db = getAdminDb()
    let existingSnapshot = await db
      .collection("clientClaimRequests")
      .where("uid", "==", decodedToken.uid)
      .where(
        requestedWorkspaceId ? "requestedWorkspaceId" : "requestedClientId",
        "==",
        requestedWorkspaceId || requestedClientId
      )
      .limit(10)
      .get()

    if (existingSnapshot.empty && requestedWorkspaceId && workspace.clientId) {
      existingSnapshot = await db
        .collection("clientClaimRequests")
        .where("uid", "==", decodedToken.uid)
        .where("requestedClientId", "==", workspace.clientId)
        .limit(10)
        .get()
    }

    const openRequest = existingSnapshot.docs
      .map((doc) => serializeRequest(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
      .find((request) => request.status === "pending" || request.status === "approved")

    if (openRequest) {
      return NextResponse.json({ success: true, request: openRequest, duplicate: true })
    }

    const ref = await db.collection("clientClaimRequests").add({
      uid: decodedToken.uid,
      email,
      displayName: decodedToken.name ?? "",
      photoURL: decodedToken.picture ?? "",
      requestedWorkspaceId: workspace.workspaceId || requestedWorkspaceId,
      requestedWorkspaceName: workspace.workspaceName || workspace.name,
      requestedClientId: workspace.clientId || requestedClientId,
      requestedClientName: workspace.name,
      requestedProjectId: requestedProjectId || workspace.projectId,
      requestedProjectName: workspace.projectName,
      evidenceNotes,
      status: "pending",
      source: "clients.readyaimgo.biz",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    const created = await ref.get()
    return NextResponse.json({
      success: true,
      request: serializeRequest(ref.id, (created.data() ?? {}) as Record<string, unknown>),
    })
  } catch (error) {
    console.error("Claim requests POST error:", error)
    const status = (error as Error & { status?: number }).status
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit claim request." },
      { status: status ?? 500 }
    )
  }
}
