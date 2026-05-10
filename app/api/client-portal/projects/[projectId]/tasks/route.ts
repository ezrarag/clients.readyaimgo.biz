import { type NextRequest, NextResponse } from "next/server"

import { getAdminDb } from "@/lib/firebase-admin"
import { isClientAllowed, resolvePortalIdentity } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

type RouteContext = {
  params: {
    projectId: string
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const identity = await resolvePortalIdentity(request)
    if (!identity) {
      return NextResponse.json(
        { error: "Portal access unavailable for this account." },
        { status: 403 }
      )
    }

    const projectId = context.params.projectId?.trim()
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 })
    }

    const db = getAdminDb()
    const projectSnapshot = await db.collection("projects").doc(projectId).get()

    if (!projectSnapshot.exists) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 })
    }

    const projectData = projectSnapshot.data() as Record<string, unknown>
    const projectClientId =
      typeof projectData.clientId === "string" ? projectData.clientId : ""

    if (!isClientAllowed(identity, projectClientId)) {
      return NextResponse.json(
        { error: "This project is not available for the signed-in account." },
        { status: 403 }
      )
    }

    const status = request.nextUrl.searchParams.get("status")?.trim()
    const limit = Math.min(
      Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50,
      100
    )
    let query: FirebaseFirestore.Query = db
      .collection("projectTasks")
      .where("projectId", "==", projectId)

    if (status) {
      query = query.where("status", "==", status)
    }

    const snapshot = await query.limit(limit).get()
    const tasks = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))

    return NextResponse.json({
      success: true,
      tasks,
      data: tasks,
    })
  } catch (error) {
    console.error("Client portal project tasks error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load tasks." },
      { status: 500 }
    )
  }
}
