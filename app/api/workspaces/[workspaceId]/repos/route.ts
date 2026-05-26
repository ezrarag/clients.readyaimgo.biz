import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import {
  enrichVercelProjectsWithDomains,
  getVercelToken,
  matchReposToVercelProjects,
} from "@/lib/vercel-server"
import type { GitHubRepo, VercelProject } from "@/lib/workspaces"
import { normalizeWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

async function isAdmin(uid: string) {
  if (process.env.NEXT_PUBLIC_ADMIN_UID && uid === process.env.NEXT_PUBLIC_ADMIN_UID) {
    return true
  }
  const snap = await getAdminDb().collection("users").doc(uid).get()
  const roles = snap.exists ? (snap.data() as Record<string, unknown>).roles : null
  return Array.isArray(roles) && roles.includes("beam-admin")
}

async function assertWorkspaceMember(uid: string, workspaceId: string) {
  if (await isAdmin(uid)) return "beam-admin"

  const db = getAdminDb()
  const memberSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .doc(uid)
    .get()

  if (!memberSnap.exists) {
    throw Object.assign(new Error("Not a member of this workspace."), { status: 403 })
  }

  const data = memberSnap.data() as Record<string, unknown>
  return data.role as string
}

function safeDocId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180)
}

function githubProjectId(workspaceId: string, repo: GitHubRepo) {
  return safeDocId(`${workspaceId}__github__${repo.id}`)
}

function vercelProjectId(workspaceId: string, project: VercelProject) {
  return safeDocId(`${workspaceId}__vercel__${project.id}`)
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function githubProjectPayload(
  workspaceId: string,
  repo: GitHubRepo,
  workspace: Record<string, unknown>
) {
  const repoName = repo.fullName.split("/").at(-1) || repo.fullName
  return {
    name: repoName,
    title: repoName,
    description: repo.description ?? "",
    workspaceId,
    clientId: typeof workspace.clientId === "string" ? workspace.clientId : null,
    repository: {
      fullName: repo.fullName,
      url: repo.url,
    },
    repoSlug: repo.fullName,
    githubRepo: repo.fullName,
    liveUrl: repo.homepage || null,
    projectType: "github-repository",
    source: "github-connection",
    updatedAt: FieldValue.serverTimestamp(),
  }
}

function vercelProjectPayload(
  workspaceId: string,
  project: VercelProject,
  workspace: Record<string, unknown>
) {
  return {
    name: project.name,
    title: project.name,
    description: project.framework ? `${project.framework} deployment` : "",
    workspaceId,
    clientId: typeof workspace.clientId === "string" ? workspace.clientId : null,
    vercelProjectId: project.id,
    vercelProjectName: project.name,
    vercelTeamId: project.teamId ?? null,
    deploymentState: project.deploymentState ?? null,
    domains: project.domains ?? [],
    repository: project.repository ?? null,
    repoSlug: project.repoSlug ?? project.githubRepo ?? project.repository?.fullName ?? null,
    githubRepo: project.githubRepo ?? project.repoSlug ?? project.repository?.fullName ?? null,
    liveUrl: project.url,
    deployUrl: project.url,
    productionUrl: project.url,
    projectType: "vercel-project",
    source: "vercel-connection",
    updatedAt: FieldValue.serverTimestamp(),
  }
}

function responseProject(id: string, payload: Record<string, unknown>) {
  return {
    id,
    ...payload,
    updatedAt: new Date().toISOString(),
  }
}

// ─── POST /api/workspaces/[workspaceId]/repos — attach repos / vercel projects ─

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    await assertWorkspaceMember(decodedToken.uid, params.workspaceId)

    const db = getAdminDb()
    const body = (await request.json()) as Record<string, unknown>

    // Accept either a list of GitHub repos, Vercel projects, or both.
    const incomingRepos: GitHubRepo[] = Array.isArray(body.repos)
      ? (body.repos as GitHubRepo[])
      : []
    const incomingVercel: VercelProject[] = Array.isArray(body.vercelProjects)
      ? (body.vercelProjects as VercelProject[])
      : []

    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const workspaceSnap = await workspaceRef.get()

    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }

    const current = workspaceSnap.data() as Record<string, unknown>
    const existingRepos: GitHubRepo[] = Array.isArray(current.repos) ? current.repos as GitHubRepo[] : []
    const existingVercel: VercelProject[] = Array.isArray(current.vercelProjects) ? current.vercelProjects as VercelProject[] : []
    const teamId = readString(current.vercelTeamId) || process.env.VERCEL_TEAM_ID || null
    const vercelToken = getVercelToken()
    const enrichedIncomingVercel = await enrichVercelProjectsWithDomains({
      projects: incomingVercel,
      token: vercelToken,
      teamId,
    })
    const repoVercelMatch = await matchReposToVercelProjects({
      repos: incomingRepos,
      token: vercelToken,
      teamId,
    }).catch((error) => ({
      projects: [] as VercelProject[],
      diagnostics: {
        scannedVercelProjects: 0,
        matchedVercelProjects: 0,
        matchedDomains: 0,
        warnings: [
          error instanceof Error
            ? error.message
            : "Unable to reconcile GitHub repositories with Vercel projects.",
        ],
      },
    }))

    // Merge — deduplicate by id/fullName
    const repoMap = new Map<number, GitHubRepo>()
    for (const r of [...existingRepos, ...incomingRepos]) repoMap.set(r.id, r)
    const vercelMap = new Map<string, VercelProject>()
    for (const p of [...existingVercel, ...enrichedIncomingVercel, ...repoVercelMatch.projects]) {
      vercelMap.set(p.id, p)
    }

    const existingProjectIds = Array.isArray(current.projectIds)
      ? (current.projectIds as unknown[]).filter((id): id is string => typeof id === "string")
      : []
    const generatedProjects = [
      ...incomingRepos.map((repo) => ({
        id: githubProjectId(params.workspaceId, repo),
        payload: githubProjectPayload(params.workspaceId, repo, current),
      })),
      ...enrichedIncomingVercel.map((project) => ({
        id: vercelProjectId(params.workspaceId, project),
        payload: vercelProjectPayload(params.workspaceId, project, current),
      })),
      ...repoVercelMatch.projects.map((project) => ({
        id: vercelProjectId(params.workspaceId, project),
        payload: vercelProjectPayload(params.workspaceId, project, current),
      })),
    ]
    const nextProjectIds = Array.from(
      new Set([...existingProjectIds, ...generatedProjects.map((project) => project.id)])
    )

    const batch = db.batch()
    batch.update(workspaceRef, {
      repos: Array.from(repoMap.values()),
      vercelProjects: Array.from(vercelMap.values()),
      projectIds: nextProjectIds,
      updatedAt: FieldValue.serverTimestamp(),
    })
    for (const project of generatedProjects) {
      batch.set(db.collection("projects").doc(project.id), project.payload, { merge: true })
    }
    await batch.commit()

    const updated = normalizeWorkspace(params.workspaceId, {
      ...current,
      repos: Array.from(repoMap.values()),
      vercelProjects: Array.from(vercelMap.values()),
      projectIds: nextProjectIds,
    })

    return NextResponse.json({
      success: true,
      workspace: updated,
      projects: generatedProjects.map((project) => responseProject(project.id, project.payload)),
      diagnostics: {
        repoVercelReconciliation: repoVercelMatch.diagnostics,
      },
    })
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update workspace repos." },
      { status }
    )
  }
}

// ─── DELETE /api/workspaces/[workspaceId]/repos — detach repos / vercel projects ─

export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    await assertWorkspaceMember(decodedToken.uid, params.workspaceId)

    const db = getAdminDb()
    const body = (await request.json()) as Record<string, unknown>
    const repoIds: number[] = Array.isArray(body.repoIds) ? body.repoIds as number[] : []
    const vercelIds: string[] = Array.isArray(body.vercelIds) ? body.vercelIds as string[] : []

    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const snap = await workspaceRef.get()
    if (!snap.exists) return NextResponse.json({ error: "Workspace not found." }, { status: 404 })

    const current = snap.data() as Record<string, unknown>
    const existingRepos: GitHubRepo[] = Array.isArray(current.repos) ? current.repos as GitHubRepo[] : []
    const existingVercel: VercelProject[] = Array.isArray(current.vercelProjects) ? current.vercelProjects as VercelProject[] : []
    const existingProjectIds = Array.isArray(current.projectIds)
      ? (current.projectIds as unknown[]).filter((id): id is string => typeof id === "string")
      : []

    const repoIdSet = new Set(repoIds)
    const vercelIdSet = new Set(vercelIds)
    const generatedProjectIds = [
      ...existingRepos
        .filter((repo) => repoIdSet.has(repo.id))
        .map((repo) => githubProjectId(params.workspaceId, repo)),
      ...existingVercel
        .filter((project) => vercelIdSet.has(project.id))
        .map((project) => vercelProjectId(params.workspaceId, project)),
    ]
    const generatedProjectIdSet = new Set(generatedProjectIds)

    const batch = db.batch()
    batch.update(workspaceRef, {
      repos: existingRepos.filter((r) => !repoIdSet.has(r.id)),
      vercelProjects: existingVercel.filter((p) => !vercelIdSet.has(p.id)),
      projectIds: existingProjectIds.filter((id) => !generatedProjectIdSet.has(id)),
      updatedAt: FieldValue.serverTimestamp(),
    })
    for (const projectId of generatedProjectIds) {
      batch.delete(db.collection("projects").doc(projectId))
    }
    await batch.commit()

    return NextResponse.json({ success: true, removedProjectIds: generatedProjectIds })
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to remove from workspace." },
      { status }
    )
  }
}
