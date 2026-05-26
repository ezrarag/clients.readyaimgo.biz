import { type NextRequest, NextResponse } from "next/server"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import {
  getVercelToken,
  listVercelProjects,
  normalizeVercelProject,
} from "@/lib/vercel-server"

export const dynamic = "force-dynamic"

async function isAdmin(uid: string) {
  if (process.env.NEXT_PUBLIC_ADMIN_UID && uid === process.env.NEXT_PUBLIC_ADMIN_UID) {
    return true
  }
  const snap = await getAdminDb().collection("users").doc(uid).get()
  const roles = snap.exists ? (snap.data() as Record<string, unknown>).roles : null
  return Array.isArray(roles) && roles.includes("beam-admin")
}

async function assertWorkspaceAccess(uid: string, workspaceId: string) {
  if (await isAdmin(uid)) return

  const memberSnap = await getAdminDb()
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .doc(uid)
    .get()

  if (!memberSnap.exists) {
    throw Object.assign(new Error("Not a member of this workspace."), { status: 403 })
  }
}

async function resolveWorkspaceTeam(uid: string, workspaceId: string) {
  if (!workspaceId) return null
  await assertWorkspaceAccess(uid, workspaceId)
  const snap = await getAdminDb().collection("workspaces").doc(workspaceId).get()
  if (!snap.exists) return null
  const data = snap.data() as Record<string, unknown>
  return typeof data.vercelTeamId === "string" && data.vercelTeamId.trim()
    ? data.vercelTeamId.trim()
    : null
}

export async function GET(request: NextRequest) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    let decodedToken: { uid: string }
    try {
      decodedToken = await getAdminAuth().verifyIdToken(idToken)
    } catch {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    const vercelToken = getVercelToken()
    if (!vercelToken) {
      return NextResponse.json({
        success: true,
        projects: [],
        meta: {
          configured: false,
          warning: "Vercel token not configured.",
        },
      })
    }

    const q = (request.nextUrl.searchParams.get("q") ?? "").toLowerCase().trim()
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim() || ""
    const workspaceTeamId = workspaceId
      ? await resolveWorkspaceTeam(decodedToken.uid, workspaceId)
      : null
    const teamId =
      request.nextUrl.searchParams.get("teamId")?.trim() ||
      workspaceTeamId ||
      process.env.VERCEL_TEAM_ID ||
      null

    let rawProjects: Awaited<ReturnType<typeof listVercelProjects>> = []
    let warning: string | null = null
    try {
      rawProjects = await listVercelProjects({ token: vercelToken, teamId })
    } catch (error) {
      warning = error instanceof Error ? error.message : "Unable to load Vercel projects."
      console.warn("Vercel projects unavailable:", warning)
    }

    const projects = rawProjects.map((project) => normalizeVercelProject(project, teamId))

    const filtered = q
      ? projects.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.url ?? "").toLowerCase().includes(q) ||
            (p.framework ?? "").toLowerCase().includes(q)
        )
      : projects

    return NextResponse.json({
      success: true,
      projects: filtered,
      meta: {
        configured: true,
        teamId,
        tokenEnv: process.env.VERCEL_ACCESS_TOKEN ? "VERCEL_ACCESS_TOKEN" : "VERCEL_TOKEN",
        warning,
      },
    })
  } catch (error) {
    console.error("Vercel projects error:", error)
    const status = (error as Error & { status?: number }).status ?? 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load Vercel projects." },
      { status }
    )
  }
}
