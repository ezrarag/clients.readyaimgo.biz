"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Calendar,
  ExternalLink,
  Github,
  Loader2,
  LogOut,
  Pin,
  RefreshCw,
  Save,
  Server,
  Trash2,
  Video,
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { signOut } from "@/lib/firebase/auth"
import type { WorkspaceUpdate, WorkspaceUpdateType } from "@/lib/workspace-updates"
import type { GitHubRepo, VercelProject, Workspace } from "@/lib/workspaces"

interface ConnectorMeta {
  warning?: string | null
}

interface WorkspaceDraft {
  githubOrg: string
  vercelTeamId: string
  repoId: string
  vercelId: string
  googleCalendarId: string
}

interface UpdateDraft {
  type: WorkspaceUpdateType
  title: string
  url: string
  description: string
  thumbnailUrl: string
  pinned: boolean
}

const EMPTY_UPDATE_DRAFT: UpdateDraft = {
  type: "video",
  title: "",
  url: "",
  description: "",
  thumbnailUrl: "",
  pinned: false,
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
    googleCalendarId: workspace.googleCalendarId ?? "",
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
  const [updatesByWorkspace, setUpdatesByWorkspace] = useState<
    Record<string, WorkspaceUpdate[]>
  >({})
  const [updatesVisibleFor, setUpdatesVisibleFor] = useState<Record<string, boolean>>({})
  const [postUpdateWorkspace, setPostUpdateWorkspace] = useState<Workspace | null>(null)
  const [updateDraftForm, setUpdateDraftForm] = useState<UpdateDraft>(EMPTY_UPDATE_DRAFT)
  const [postingUpdate, setPostingUpdate] = useState(false)

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
          googleCalendarId: "",
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

  async function saveCalendarId(workspace: Workspace) {
    if (!user) return
    const draft = drafts[workspace.id] ?? createDraft(workspace)
    const googleCalendarId = draft.googleCalendarId.trim() || null
    setBusyId(workspace.id)
    setError(null)
    setMessage(null)
    try {
      await apiFetch(user, `/api/workspaces/${workspace.id}/calendar-id`, {
        method: "PATCH",
        body: JSON.stringify({ googleCalendarId }),
      })
      setWorkspaces((current) =>
        current.map((item) =>
          item.id === workspace.id ? { ...item, googleCalendarId } : item
        )
      )
      setMessage(
        googleCalendarId
          ? `Saved calendar ID for ${workspace.name}.`
          : `Cleared calendar ID for ${workspace.name}.`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save calendar ID.")
    } finally {
      setBusyId(null)
    }
  }

  const loadUpdates = useCallback(
    async (workspaceId: string) => {
      if (!user) return
      try {
        const res = await apiFetch<{ updates: WorkspaceUpdate[] }>(
          user,
          `/api/workspaces/${workspaceId}/updates`
        )
        setUpdatesByWorkspace((current) => ({ ...current, [workspaceId]: res.updates }))
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load updates.")
      }
    },
    [user]
  )

  function toggleUpdates(workspaceId: string) {
    const next = !updatesVisibleFor[workspaceId]
    setUpdatesVisibleFor((current) => ({ ...current, [workspaceId]: next }))
    if (next && !updatesByWorkspace[workspaceId]) void loadUpdates(workspaceId)
  }

  async function submitUpdate() {
    if (!user || !postUpdateWorkspace) return
    const workspace = postUpdateWorkspace
    if (!updateDraftForm.title.trim() || !updateDraftForm.url.trim()) {
      setError("Title and URL are required to post an update.")
      return
    }
    setPostingUpdate(true)
    setError(null)
    setMessage(null)
    try {
      await apiFetch(user, `/api/workspaces/${workspace.id}/updates`, {
        method: "POST",
        body: JSON.stringify({
          type: updateDraftForm.type,
          title: updateDraftForm.title.trim(),
          url: updateDraftForm.url.trim(),
          description: updateDraftForm.description.trim() || null,
          thumbnailUrl: updateDraftForm.thumbnailUrl.trim() || null,
          pinned: updateDraftForm.pinned,
        }),
      })
      setPostUpdateWorkspace(null)
      setUpdateDraftForm(EMPTY_UPDATE_DRAFT)
      setUpdatesVisibleFor((current) => ({ ...current, [workspace.id]: true }))
      await loadUpdates(workspace.id)
      setMessage(`Posted update to ${workspace.name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to post update.")
    } finally {
      setPostingUpdate(false)
    }
  }

  async function deleteUpdate(workspaceId: string, updateId: string) {
    if (!user) return
    setError(null)
    try {
      await apiFetch(user, `/api/workspaces/${workspaceId}/updates/${updateId}`, {
        method: "DELETE",
      })
      setUpdatesByWorkspace((current) => ({
        ...current,
        [workspaceId]: (current[workspaceId] ?? []).filter((item) => item.id !== updateId),
      }))
      setMessage("Update deleted.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete update.")
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

                  <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">
                        Google Calendar ID
                      </label>
                      <Input
                        value={draft.googleCalendarId}
                        placeholder="abc123@group.calendar.google.com"
                        onChange={(event) =>
                          updateDraft(workspace.id, { googleCalendarId: event.target.value })
                        }
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => void saveCalendarId(workspace)}
                      disabled={busy}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      Save Calendar
                    </Button>
                  </div>

                  <div className="rounded-2xl border border-border bg-white/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-sm font-semibold text-slate-700">
                        Video & Note Updates
                      </label>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleUpdates(workspace.id)}
                        >
                          {updatesVisibleFor[workspace.id] ? "Hide Updates" : "Show Updates"}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setUpdateDraftForm(EMPTY_UPDATE_DRAFT)
                            setPostUpdateWorkspace(workspace)
                          }}
                        >
                          <Video className="mr-2 h-4 w-4" />
                          Post Update
                        </Button>
                      </div>
                    </div>

                    {updatesVisibleFor[workspace.id] ? (
                      <div className="mt-3">
                        {(updatesByWorkspace[workspace.id] ?? []).length === 0 ? (
                          <p className="text-sm text-slate-500">
                            No updates posted to this workspace yet.
                          </p>
                        ) : (
                          <div className="grid gap-2">
                            {(updatesByWorkspace[workspace.id] ?? []).map((update) => (
                              <div
                                key={update.id}
                                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-white px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    {update.pinned ? (
                                      <Pin className="h-3 w-3 shrink-0 text-amber-500" />
                                    ) : null}
                                    <p className="truncate text-sm font-semibold text-slate-800">
                                      {update.title}
                                    </p>
                                    <Badge variant="secondary">{update.type}</Badge>
                                  </div>
                                  <p className="truncate text-xs text-slate-500">
                                    {new Date(update.postedAt).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    })}
                                    {" · "}
                                    {update.seenBy.length} view
                                    {update.seenBy.length !== 1 ? "s" : ""}
                                    {" · "}
                                    {update.url}
                                  </p>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void deleteUpdate(workspace.id, update.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-rose-500" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog
        open={postUpdateWorkspace !== null}
        onOpenChange={(open) => {
          if (!open) setPostUpdateWorkspace(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Post Update{postUpdateWorkspace ? ` · ${postUpdateWorkspace.name}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Type</label>
              <select
                value={updateDraftForm.type}
                onChange={(event) =>
                  setUpdateDraftForm((current) => ({
                    ...current,
                    type: event.target.value as WorkspaceUpdateType,
                  }))
                }
                className="h-11 w-full rounded-2xl border border-border/80 bg-white px-3 text-sm"
              >
                <option value="video">Video (YouTube / Drive)</option>
                <option value="loom">Loom</option>
                <option value="note">Note</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Title</label>
              <Input
                value={updateDraftForm.title}
                placeholder="Weekly progress walkthrough"
                onChange={(event) =>
                  setUpdateDraftForm((current) => ({ ...current, title: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">URL</label>
              <Input
                value={updateDraftForm.url}
                placeholder="https://www.youtube.com/watch?v=..."
                onChange={(event) =>
                  setUpdateDraftForm((current) => ({ ...current, url: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">
                Description <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <Textarea
                value={updateDraftForm.description}
                rows={3}
                placeholder="What changed this week..."
                onChange={(event) =>
                  setUpdateDraftForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">
                Thumbnail URL <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <Input
                value={updateDraftForm.thumbnailUrl}
                placeholder="https://..."
                onChange={(event) =>
                  setUpdateDraftForm((current) => ({
                    ...current,
                    thumbnailUrl: event.target.value,
                  }))
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={updateDraftForm.pinned}
                onChange={(event) =>
                  setUpdateDraftForm((current) => ({
                    ...current,
                    pinned: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-border"
              />
              Pin this update (shows first)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostUpdateWorkspace(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitUpdate()}
              disabled={
                postingUpdate || !updateDraftForm.title.trim() || !updateDraftForm.url.trim()
              }
            >
              {postingUpdate ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Video className="mr-2 h-4 w-4" />
              )}
              Post Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
