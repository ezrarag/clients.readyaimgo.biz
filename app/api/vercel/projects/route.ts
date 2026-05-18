import { type NextRequest, NextResponse } from "next/server"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import type { VercelProject } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

interface VercelApiProject {
  id: string
  name: string
  alias?: Array<{ domain: string }> | null
  framework?: string | null
  updatedAt?: number | null
  targets?: Record<string, { alias?: string[]; readyState?: string }> | null
  link?: {
    type?: string | null
    org?: string | null
    repo?: string | null
    repoId?: number | string | null
  } | null
}

interface VercelApiResponse {
  projects: VercelApiProject[]
  pagination?: { next?: number | null }
}

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

async function fetchVercelProjects({
  token,
  teamId,
  until,
}: {
  token: string
  teamId: string | null
  until?: number
}): Promise<VercelApiProject[]> {
  const params = new URLSearchParams({ limit: "100" })
  if (teamId) params.set("teamId", teamId)
  if (until) params.set("until", String(until))

  const response = await fetch(`https://api.vercel.com/v9/projects?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    const hint =
      response.status === 401 || response.status === 403
        ? "Check VERCEL_ACCESS_TOKEN/VERCEL_TOKEN and VERCEL_TEAM_ID."
        : "Check the Vercel project API response and team scope."
    throw new Error(`Vercel API ${response.status}: ${body || hint}`)
  }
  const payload = (await response.json()) as VercelApiResponse
  return payload.projects ?? []
}

function normalizeProject(raw: VercelApiProject, teamId: string | null): VercelProject {
  const domains = [
    ...(raw.alias ?? []).map((alias) => alias.domain),
    ...(raw.targets?.production?.alias ?? []),
  ].filter((domain): domain is string => typeof domain === "string" && domain.length > 0)
  const primaryAlias = domains[0] ?? null
  const repoSlug =
    raw.link?.org && raw.link?.repo ? `${raw.link.org}/${raw.link.repo}` : null
  return {
    id: raw.id,
    name: raw.name,
    url: primaryAlias ? `https://${primaryAlias}` : null,
    framework: raw.framework ?? null,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : null,
    teamId,
    deploymentState: raw.targets?.production?.readyState ?? null,
    domains: Array.from(new Set(domains)),
    repoSlug,
    githubRepo: repoSlug,
    repository: repoSlug
      ? {
          fullName: repoSlug,
          url: `https://github.com/${repoSlug}`,
        }
      : null,
  }
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

    const vercelToken = process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN
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

    let rawProjects: VercelApiProject[] = []
    let warning: string | null = null
    try {
      rawProjects = await fetchVercelProjects({ token: vercelToken, teamId })
    } catch (error) {
      warning = error instanceof Error ? error.message : "Unable to load Vercel projects."
      console.warn("Vercel projects unavailable:", warning)
    }

    const projects: VercelProject[] = rawProjects.map((project) =>
      normalizeProject(project, teamId)
    )

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
