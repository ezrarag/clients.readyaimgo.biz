import type { GitHubRepo, VercelProject } from "@/lib/workspaces"

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
  projects?: VercelApiProject[]
  pagination?: { next?: number | null }
}

interface VercelProjectDomain {
  name?: string
  verified?: boolean
}

interface VercelProjectDomainsResponse {
  domains?: VercelProjectDomain[]
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function getVercelToken() {
  return process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN || null
}

export function cleanVercelDomain(value: unknown) {
  const raw = readString(value)
  if (!raw) return null
  const withoutProtocol = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "")
  const host = withoutProtocol.split(/[/?#]/)[0]?.trim().toLowerCase()
  return host && host.includes(".") ? host : null
}

async function fetchVercelJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Vercel API ${response.status}: ${body || response.statusText}`)
  }
  return (await response.json()) as T
}

export async function listVercelProjects(params: {
  token: string
  teamId: string | null
}) {
  const projects: VercelApiProject[] = []
  let until: number | null = null

  do {
    const query = new URLSearchParams({ limit: "100" })
    if (params.teamId) query.set("teamId", params.teamId)
    if (until) query.set("until", String(until))

    const payload = await fetchVercelJson<VercelApiResponse>(
      `https://api.vercel.com/v9/projects?${query.toString()}`,
      params.token
    )
    projects.push(...(payload.projects ?? []))
    until = payload.pagination?.next ?? null
  } while (until)

  return projects
}

export async function listVercelProjectDomains(params: {
  token: string
  teamId: string | null
  projectIdOrName: string
}) {
  const query = new URLSearchParams({ limit: "100" })
  if (params.teamId) query.set("teamId", params.teamId)
  const payload = await fetchVercelJson<VercelProjectDomainsResponse>(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(params.projectIdOrName)}/domains?${query.toString()}`,
    params.token
  )
  return payload.domains ?? []
}

export function normalizeVercelProject(
  raw: VercelApiProject,
  teamId: string | null
): VercelProject {
  const domains = [
    ...(raw.alias ?? []).map((alias) => alias.domain),
    ...(raw.targets?.production?.alias ?? []),
  ].flatMap((domain) => {
    const clean = cleanVercelDomain(domain)
    return clean ? [clean] : []
  })
  const uniqueDomains = Array.from(new Set(domains))
  const repoSlug = raw.link?.org && raw.link?.repo ? `${raw.link.org}/${raw.link.repo}` : null

  return {
    id: raw.id,
    name: raw.name,
    url: uniqueDomains[0] ? `https://${uniqueDomains[0]}` : null,
    framework: raw.framework ?? null,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : null,
    teamId,
    deploymentState: raw.targets?.production?.readyState ?? null,
    domains: uniqueDomains,
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

export async function enrichVercelProjectsWithDomains(params: {
  projects: VercelProject[]
  token: string | null
  teamId: string | null
}) {
  if (!params.token || params.projects.length === 0) return params.projects

  return Promise.all(
    params.projects.map(async (project) => {
      const projectLookupKey = project.id || project.name
      if (!projectLookupKey) return project

      const projectDomains = await listVercelProjectDomains({
        token: params.token!,
        teamId: project.teamId ?? params.teamId,
        projectIdOrName: projectLookupKey,
      }).catch(() => [])

      const domains = Array.from(
        new Set([
          ...(project.domains ?? []).flatMap((domain) => {
            const clean = cleanVercelDomain(domain)
            return clean ? [clean] : []
          }),
          ...projectDomains.flatMap((domain) => {
            const clean = cleanVercelDomain(domain.name)
            return clean ? [clean] : []
          }),
        ])
      )

      return {
        ...project,
        domains,
        url: project.url ?? (domains[0] ? `https://${domains[0]}` : null),
      }
    })
  )
}

export async function matchReposToVercelProjects(params: {
  repos: GitHubRepo[]
  token: string | null
  teamId: string | null
}) {
  if (!params.token || params.repos.length === 0) {
    return {
      projects: [] as VercelProject[],
      diagnostics: {
        scannedVercelProjects: 0,
        matchedVercelProjects: 0,
        matchedDomains: 0,
        warnings: params.token ? [] : ["Vercel token not configured."],
      },
    }
  }

  const repoSlugs = new Set(params.repos.map((repo) => repo.fullName.toLowerCase()))
  const rawProjects = await listVercelProjects({
    token: params.token,
    teamId: params.teamId,
  })
  const matched = rawProjects
    .filter((project) => {
      const linkedRepo =
        project.link?.org && project.link?.repo
          ? `${project.link.org}/${project.link.repo}`.toLowerCase()
          : null
      return Boolean(linkedRepo && repoSlugs.has(linkedRepo))
    })
    .map((project) => normalizeVercelProject(project, params.teamId))
  const enriched = await enrichVercelProjectsWithDomains({
    projects: matched,
    token: params.token,
    teamId: params.teamId,
  })

  return {
    projects: enriched,
    diagnostics: {
      scannedVercelProjects: rawProjects.length,
      matchedVercelProjects: enriched.length,
      matchedDomains: enriched.reduce((sum, project) => sum + (project.domains?.length ?? 0), 0),
      warnings:
        params.repos.length > 0 && enriched.length === 0
          ? ["No Vercel project matched attached GitHub repos."]
          : [],
    },
  }
}
