"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ExternalLink,
  Github,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  Server,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { signOut } from "@/lib/firebase/auth"
import type { GitHubRepo, VercelProject, Workspace } from "@/lib/workspaces"

interface ConnectorMeta {
  warning?: string | null
}

interface WorkspaceDraft {
  githubOrg: string
  vercelTeamId: string
  repoId: string
  vercelId: string
}

async function apiFetch<T>(
  user: { getIdToken: () => Promise<string> },
  path: string,
  options?: RequestInit
): Promise<T> {
  const token = await user.getIdToken()
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    cache: "no-store",
  })
  const payload = await res.json()
  if (!res.ok) throw new Error((payload as { error?: string }).error ?? "Request failed.")
  return payload as T
}

function createDraft(workspace: Workspace): WorkspaceDraft {
  return {
    githubOrg: workspace.githubOrg ?? "",
    vercelTeamId: workspace.vercelTeamId ?? "",
    repoId: "",
    vercelId: "",
  }
}

export default function AdminWorkspacesPage() {
  const router = useRouter()
  const { user } = useAuth()

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [vercelProjects, setVercelProjects] = useState<VercelProject[]>([])
  const [drafts, setDrafts] = useState<Record<string, WorkspaceDraft>>({})
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [githubMeta, setGithubMeta] = useState<ConnectorMeta | null>(null)
  const [vercelMeta, setVercelMeta] = useState<ConnectorMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [workspaceRes, repoRes, vercelRes] = await Promise.all([
        apiFetch<{ workspaces: Workspace[] }>(user, "/api/workspaces?admin=true"),
        apiFetch<{ repos: GitHubRepo[]; meta?: ConnectorMeta }>(user, "/api/github/repos").catch(
          (err) => ({
            repos: [] as GitHubRepo[],
            meta: {
              warning: err instanceof Error ? err.message : "Unable to load GitHub repos.",
            },
          })
        ),
        apiFetch<{ projects: VercelProject[]; meta?: ConnectorMeta }>(
          user,
          "/api/vercel/projects"
        ).catch((err) => ({
          projects: [] as VercelProject[],
          meta: {
            warning: err instanceof Error ? err.message : "Unable to load Vercel projects.",
          },
        })),
      ])

      setWorkspaces(workspaceRes.workspaces)
      setRepos(repoRes.repos)
      setVercelProjects(vercelRes.projects)
      setGithubMeta(repoRes.meta ?? null)
      setVercelMeta(vercelRes.meta ?? null)
      setDrafts((current) => {
        const next = { ...current }
        for (const workspace of workspaceRes.workspaces) {
          next[workspace.id] = next[workspace.id] ?? createDraft(workspace)
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load workspaces.")
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) void load()
  }, [load, user])

  const filteredWorkspaces = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter((workspace) =>
      [
        workspace.id,
        workspace.name,
        workspace.clientEmail ?? "",
        workspace.clientId ?? "",
        workspace.githubOrg ?? "",
        workspace.vercelTeamId ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
  }, [search, workspaces])

  function updateDraft(workspaceId: string, patch: Partial<WorkspaceDraft>) {
    setDrafts((current) => ({
      ...current,
      [workspaceId]: {
        ...(current[workspaceId] ?? {
          githubOrg: "",
          vercelTeamId: "",
          repoId: "",
          vercelId: "",
        }),
        ...patch,
      },
    }))
  }

  async function saveConnectors(workspace: Workspace) {
    if (!user) return
    const draft = drafts[workspace.id] ?? createDraft(workspace)
    setBusyId(workspace.id)
    setError(null)
    setMessage(null)
    try {
      await apiFetch(user, `/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          githubOrg: draft.githubOrg.trim() || null,
          vercelTeamId: draft.vercelTeamId.trim() || null,
        }),
      })
      setWorkspaces((current) =>
        current.map((item) =>
          item.id === workspace.id
            ? {
                ...item,
                githubOrg: draft.githubOrg.trim() || null,
                vercelTeamId: draft.vercelTeamId.trim() || null,
              }
            : item
        )
      )
      setMessage(`Saved connectors for ${workspace.name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save workspace connectors.")
    } finally {
      setBusyId(null)
    }
  }

  async function attachRepo(workspace: Workspace) {
    if (!user) return
    const selected = repos.find((repo) => String(repo.id) === drafts[workspace.id]?.repoId)
    if (!selected) return
    setBusyId(workspace.id)
    setError(null)
    setMessage(null)
    try {
      await apiFetch(user, `/api/workspaces/${workspace.id}/repos`, {
        method: "POST",
        body: JSON.stringify({ repos: [selected] }),
      })
      setWorkspaces((current) =>
        current.map((item) =>
          item.id === workspace.id && !item.repos.some((repo) => repo.id === selected.id)
            ? { ...item, repos: [...item.repos, selected] }
            : item
        )
      )
      updateDraft(workspace.id, { repoId: "" })
      setMessage(`Attached ${selected.fullName} to ${workspace.name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to attach GitHub repo.")
    } finally {
      setBusyId(null)
    }
  }

  async function attachVercel(workspace: Workspace) {
    if (!user) return
    const selected = vercelProjects.find((project) => project.id === drafts[workspace.id]?.vercelId)
    if (!selected) return
    setBusyId(workspace.id)
    setError(null)
    setMessage(null)
    try {
      await apiFetch(user, `/api/workspaces/${workspace.id}/repos`, {
        method: "POST",
        body: JSON.stringify({ vercelProjects: [selected] }),
      })
      setWorkspaces((current) =>
        current.map((item) =>
          item.id === workspace.id &&
          !item.vercelProjects.some((project) => project.id === selected.id)
            ? { ...item, vercelProjects: [...item.vercelProjects, selected] }
            : item
        )
      )
      updateDraft(workspace.id, { vercelId: "" })
      setMessage(`Attached ${selected.name} to ${workspace.name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to attach Vercel project.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AppShell
      eyebrow="Admin"
      title="Workspace Connections"
      description={
        loading
          ? "Loading..."
          : `${workspaces.length} workspace${workspaces.length !== 1 ? "s" : ""}`
      }
      nav={[
        { href: "/dashboard", label: "Workspaces" },
        { href: "/admin/workspaces", label: "Admin · Workspaces", active: true },
        { href: "/admin/contracts", label: "Admin · Contracts" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await signOut()
              router.replace("/login")
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      }
    >
      {error ? (
        <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {githubMeta?.warning || vercelMeta?.warning ? (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {[githubMeta?.warning, vercelMeta?.warning].filter(Boolean).join(" ")}
        </div>
      ) : null}

      <div className="mb-6">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search workspace, client email, GitHub owner, or Vercel team"
        />
      </div>

      {loading ? (
        <div className="flex min-h-80 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredWorkspaces.map((workspace) => {
            const draft = drafts[workspace.id] ?? createDraft(workspace)
            const busy = busyId === workspace.id
            const unattachedRepos = repos.filter(
              (repo) => !workspace.repos.some((attached) => attached.id === repo.id)
            )
            const unattachedVercel = vercelProjects.filter(
              (project) =>
                !workspace.vercelProjects.some((attached) => attached.id === project.id)
            )

            return (
              <Card key={workspace.id}>
                <CardHeader>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <CardTitle>{workspace.name || workspace.id}</CardTitle>
                      <CardDescription>
                        {workspace.clientEmail || workspace.clientId || workspace.id}
                      </CardDescription>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/workspace/${workspace.id}`}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open Workspace
                      </Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      <Github className="mr-1 h-3 w-3" />
                      {workspace.repos.length} repo{workspace.repos.length !== 1 ? "s" : ""}
                    </Badge>
                    <Badge variant="secondary">
                      <Server className="mr-1 h-3 w-3" />
                      {workspace.vercelProjects.length} Vercel
                    </Badge>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">
                        GitHub owner/org
                      </label>
                      <Input
                        value={draft.githubOrg}
                        placeholder="ezrarag or client-org"
                        onChange={(event) =>
                          updateDraft(workspace.id, { githubOrg: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">
                        Vercel team ID
                      </label>
                      <Input
                        value={draft.vercelTeamId}
                        placeholder="team_..."
                        onChange={(event) =>
                          updateDraft(workspace.id, { vercelTeamId: event.target.value })
                        }
                      />
                    </div>
                    <Button onClick={() => void saveConnectors(workspace)} disabled={busy}>
                      {busy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save
                    </Button>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="grid gap-2 rounded-2xl border border-border bg-white/70 p-4">
                      <label className="text-sm font-semibold text-slate-700">
                        Attach GitHub repo
                      </label>
                      <select
                        value={draft.repoId}
                        onChange={(event) =>
                          updateDraft(workspace.id, { repoId: event.target.value })
                        }
                        className="h-11 rounded-2xl border border-border/80 bg-white px-3 text-sm"
                      >
                        <option value="">Select repository</option>
                        {unattachedRepos.map((repo) => (
                          <option key={repo.id} value={repo.id}>
                            {repo.fullName}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        onClick={() => void attachRepo(workspace)}
                        disabled={busy || !draft.repoId}
                      >
                        <Github className="mr-2 h-4 w-4" />
                        Attach Repo
                      </Button>
                    </div>

                    <div className="grid gap-2 rounded-2xl border border-border bg-white/70 p-4">
                      <label className="text-sm font-semibold text-slate-700">
                        Attach Vercel project
                      </label>
                      <select
                        value={draft.vercelId}
                        onChange={(event) =>
                          updateDraft(workspace.id, { vercelId: event.target.value })
                        }
                        className="h-11 rounded-2xl border border-border/80 bg-white px-3 text-sm"
                      >
                        <option value="">Select Vercel project</option>
                        {unattachedVercel.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        onClick={() => void attachVercel(workspace)}
                        disabled={busy || !draft.vercelId}
                      >
                        <Server className="mr-2 h-4 w-4" />
                        Attach Vercel
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
