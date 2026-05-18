import { type NextRequest, NextResponse } from "next/server"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

function serializeDoc(id: string, data: Record<string, unknown>) {
  return { id, ...data }
}

function safeDocId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180)
}

function githubProjectId(workspaceId: string, repo: Record<string, unknown>) {
  return safeDocId(`${workspaceId}__github__${repo.id}`)
}

function vercelProjectId(workspaceId: string, project: Record<string, unknown>) {
  return safeDocId(`${workspaceId}__vercel__${project.id}`)
}

function synthesizeGitHubProject(
  workspaceId: string,
  repo: Record<string, unknown>,
  workspace: Record<string, unknown>
) {
  const fullName = typeof repo.fullName === "string" ? repo.fullName : ""
  const repoName = fullName.split("/").at(-1) || fullName || String(repo.id ?? "Repository")
  return {
    id: githubProjectId(workspaceId, repo),
    name: repoName,
    title: repoName,
    description: typeof repo.description === "string" ? repo.description : "",
    workspaceId,
    clientId: typeof workspace.clientId === "string" ? workspace.clientId : null,
    repository: {
      fullName,
      url: typeof repo.url === "string" ? repo.url : "",
    },
    repoSlug: fullName,
    githubRepo: fullName,
    liveUrl: typeof repo.homepage === "string" ? repo.homepage : null,
    projectType: "github-repository",
    source: "github-connection",
    updatedAt: new Date().toISOString(),
  }
}

function synthesizeVercelProject(
  workspaceId: string,
  project: Record<string, unknown>,
  workspace: Record<string, unknown>
) {
  const repository =
    typeof project.repository === "object" && project.repository !== null
      ? (project.repository as Record<string, unknown>)
      : null
  const repoSlug =
    (typeof project.repoSlug === "string" && project.repoSlug) ||
    (typeof project.githubRepo === "string" && project.githubRepo) ||
    (typeof repository?.fullName === "string" && repository.fullName) ||
    null

  return {
    id: vercelProjectId(workspaceId, project),
    name: typeof project.name === "string" ? project.name : String(project.id ?? "Vercel Project"),
    title: typeof project.name === "string" ? project.name : String(project.id ?? "Vercel Project"),
    description: typeof project.framework === "string" ? `${project.framework} deployment` : "",
    workspaceId,
    clientId: typeof workspace.clientId === "string" ? workspace.clientId : null,
    vercelProjectId: typeof project.id === "string" ? project.id : null,
    vercelProjectName: typeof project.name === "string" ? project.name : null,
    vercelTeamId: typeof project.teamId === "string" ? project.teamId : null,
    deploymentState: typeof project.deploymentState === "string" ? project.deploymentState : null,
    domains: Array.isArray(project.domains) ? project.domains : [],
    repository,
    repoSlug,
    githubRepo: repoSlug,
    liveUrl: typeof project.url === "string" ? project.url : null,
    deployUrl: typeof project.url === "string" ? project.url : null,
    productionUrl: typeof project.url === "string" ? project.url : null,
    projectType: "vercel-project",
    source: "vercel-connection",
    updatedAt: new Date().toISOString(),
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "beam-participant")

    const wsSnap = await db.collection("workspaces").doc(params.workspaceId).get()
    const wsData = wsSnap.exists ? (wsSnap.data() as Record<string, unknown>) : {}
    const clientId =
      typeof wsData.clientId === "string" && wsData.clientId.trim()
        ? wsData.clientId.trim().toLowerCase()
        : null
    const projectIds = Array.isArray(wsData.projectIds)
      ? (wsData.projectIds as unknown[]).filter((id): id is string => typeof id === "string")
      : []

    const [workspaceSnap, clientSnap, explicitSnaps] = await Promise.all([
      db.collection("projects").where("workspaceId", "==", params.workspaceId).limit(100).get(),
      clientId
        ? db.collection("projects").where("clientId", "==", clientId).limit(100).get()
        : Promise.resolve(null),
      Promise.all(projectIds.slice(0, 30).map((projectId) => db.collection("projects").doc(projectId).get())),
    ])

    const projects = new Map<string, Record<string, unknown>>()
    for (const doc of workspaceSnap.docs) projects.set(doc.id, serializeDoc(doc.id, doc.data()))
    for (const doc of clientSnap?.docs ?? []) projects.set(doc.id, serializeDoc(doc.id, doc.data()))
    for (const doc of explicitSnaps) {
      if (doc.exists) projects.set(doc.id, serializeDoc(doc.id, doc.data() as Record<string, unknown>))
    }

    const attachedRepos = Array.isArray(wsData.repos)
      ? (wsData.repos as unknown[]).filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).id === "number"
        )
      : []
    const attachedVercel = Array.isArray(wsData.vercelProjects)
      ? (wsData.vercelProjects as unknown[]).filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).id === "string"
        )
      : []

    for (const repo of attachedRepos) {
      const id = githubProjectId(params.workspaceId, repo)
      if (!projects.has(id)) projects.set(id, synthesizeGitHubProject(params.workspaceId, repo, wsData))
    }

    for (const project of attachedVercel) {
      const id = vercelProjectId(params.workspaceId, project)
      if (!projects.has(id)) projects.set(id, synthesizeVercelProject(params.workspaceId, project, wsData))
    }

    return NextResponse.json({
      success: true,
      projects: Array.from(projects.values()),
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /workspaces/[workspaceId]/projects error:", error)
    return NextResponse.json({ error: "Unable to load workspace projects." }, { status: 500 })
  }
}
