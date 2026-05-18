"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ExternalLink,
  Github,
  Loader2,
  LogOut,
  Plus,
  Server,
  Users,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GlobalWorkspaceNotifier } from "@/components/workspace/GlobalWorkspaceNotifier"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { signOut } from "@/lib/firebase/auth"
import type { Workspace } from "@/lib/workspaces"

function cleanString(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

function domainFromUrl(value: string | null | undefined) {
  const text = cleanString(value).toLowerCase()
  if (!text) return ""
  try {
    return new URL(text.startsWith("http") ? text : `https://${text}`).hostname.replace(
      /^www\./,
      ""
    )
  } catch {
    return text.replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? ""
  }
}

function isLikelyDefaultVercelUrl(value: string | null | undefined) {
  const domain = domainFromUrl(value)
  return domain.endsWith(".vercel.app")
}

function resolvePrimaryDomain(workspace: Workspace) {
  const directDomain =
    cleanString(workspace.primaryDomain) ||
    cleanString(workspace.targetDomain)
  if (directDomain) return domainFromUrl(directDomain)

  const registrarDomain = workspace.hosting.domainRegistrars.find((record) =>
    cleanString(record.domain)
  )?.domain
  if (registrarDomain) return domainFromUrl(registrarDomain)

  const dnsTarget = workspace.hosting.manualDnsTargets.find(
    (target) => cleanString(target.value) || cleanString(target.host)
  )
  if (dnsTarget) {
    const host = cleanString(dnsTarget.host)
    return domainFromUrl(host.includes(".") ? host : dnsTarget.value || host)
  }

  const vercelDomain = workspace.vercelProjects
    .flatMap((project) => project.domains ?? [])
    .find((domain) => cleanString(domain))
  if (vercelDomain) return domainFromUrl(vercelDomain)

  const staticHostUrl = workspace.hosting.staticHosts.find((host) =>
    cleanString(host.productionUrl)
  )?.productionUrl
  if (staticHostUrl) return domainFromUrl(staticHostUrl)

  const customVercelUrl = workspace.vercelProjects
    .map((project) => project.url)
    .find((url) => cleanString(url) && !isLikelyDefaultVercelUrl(url))
  return customVercelUrl ? domainFromUrl(customVercelUrl) : ""
}

function resolveWorkspaceDisplayName(workspace: Workspace) {
  const canonicalName =
    cleanString(workspace.workspaceName) ||
    cleanString(workspace.businessName) ||
    cleanString(workspace.clientBusinessName)
  return canonicalName || "Untitled Workspace"
}

function displayMemberName(member: {
  email?: string | null
  displayName?: string | null
}) {
  return cleanString(member.displayName) || cleanString(member.email) || "Unnamed member"
}

async function loadWorkspaces(user: { getIdToken: () => Promise<string> }) {
  const token = await user.getIdToken()
  const res = await fetch("/api/workspaces", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (!res.ok) return []
  const payload = (await res.json()) as { workspaces?: Workspace[] }
  return payload.workspaces ?? []
}

async function createWorkspace(user: { getIdToken: () => Promise<string> }, name: string) {
  const token = await user.getIdToken()
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  })
  const payload = (await res.json()) as { workspace?: Workspace; error?: string }
  if (!res.ok) throw new Error(payload.error ?? "Unable to create workspace.")
  return payload.workspace!
}

async function patchWorkspaceName(
  user: { getIdToken: () => Promise<string> },
  workspaceId: string,
  workspaceName: string
) {
  const token = await user.getIdToken()
  const res = await fetch(`/api/workspaces/${workspaceId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceName }),
  })
  const payload = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) throw new Error(payload?.error ?? "Unable to update workspace title.")
}

function WorkspaceTitleEditor({
  workspace,
  title,
  canEdit,
  user,
  onLocalTitleChange,
  onError,
}: {
  workspace: Workspace
  title: string
  canEdit: boolean
  user: { getIdToken: () => Promise<string> }
  onLocalTitleChange: (workspaceId: string, workspaceName: string) => void
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const lastSaved = useRef(cleanString(workspace.workspaceName) || title)

  useEffect(() => {
    if (!editing) setDraft(title)
  }, [editing, title])

  useEffect(() => {
    if (!editing || !canEdit) return

    const timer = window.setTimeout(() => {
      const nextTitle = cleanString(draft) || "Untitled Workspace"
      if (nextTitle === lastSaved.current) return

      lastSaved.current = nextTitle
      onLocalTitleChange(workspace.id, nextTitle)
      patchWorkspaceName(user, workspace.id, nextTitle).catch((err) => {
        onError(err instanceof Error ? err.message : "Unable to update workspace title.")
      })
    }, 700)

    return () => window.clearTimeout(timer)
  }, [canEdit, draft, editing, onError, onLocalTitleChange, user, workspace.id])

  if (!canEdit) {
    return <span className="truncate">{title}</span>
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="min-w-0 truncate text-left"
        onClick={() => setEditing(true)}
        title="Edit workspace title"
      >
        {title}
      </button>
    )
  }

  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const fallbackTitle = cleanString(draft) || "Untitled Workspace"
        setDraft(fallbackTitle)
        onLocalTitleChange(workspace.id, fallbackTitle)
        if (fallbackTitle !== lastSaved.current) {
          lastSaved.current = fallbackTitle
          patchWorkspaceName(user, workspace.id, fallbackTitle).catch((err) => {
            onError(err instanceof Error ? err.message : "Unable to update workspace title.")
          })
        }
        setEditing(false)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          setDraft(title)
          setEditing(false)
        }
      }}
      className="h-9 min-w-0 rounded-2xl text-base font-semibold"
      autoFocus
    />
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace("/login")
      return
    }

    setLoading(true)
    loadWorkspaces(user)
      .then(setWorkspaces)
      .catch(() => setError("Unable to load workspaces."))
      .finally(() => setLoading(false))
  }, [authLoading, user, router])

  const handleCreate = async () => {
    if (!user || !newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const ws = await createWorkspace(user, newName.trim())
      setWorkspaces((prev) => [ws, ...prev])
      setNewName("")
      setShowCreate(false)
      router.push(`/workspace/${ws.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create workspace.")
    } finally {
      setCreating(false)
    }
  }

  const handleLocalTitleChange = (workspaceId: string, workspaceName: string) => {
    setWorkspaces((prev) =>
      prev.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, workspaceName, name: workspace.name || workspaceName }
          : workspace
      )
    )
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user) return null

  return (
    <AppShell
      eyebrow="Client Hub"
      title="Your Workspaces"
      description="Each workspace represents a single target framework. We assemble the documentation, financial rails, and asset metrics required to track our production against your expectations."
      nav={[{ href: "/dashboard", label: "Workspaces", active: true }]}
      actions={
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
      }
    >
      {error && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Create workspace inline form */}
      <div className="mb-6">
        {showCreate ? (
          <div className="flex flex-col gap-3 rounded-[28px] border border-border bg-white/80 p-5 sm:flex-row">
            <Input
              placeholder="Workspace name — e.g. Acme Corp, My App"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate()
              }}
              autoFocus
            />
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Create
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreate(false)
                  setNewName("")
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Workspace
          </Button>
        )}
      </div>

      {/* Empty state */}
      {workspaces.length === 0 && !showCreate && (
        <div className="rounded-[28px] border border-dashed border-border bg-white/60 p-12 text-center">
          <Github className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-4 text-base font-semibold text-slate-800">
            Welcome to your ReadyAimGo Command Center.
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Create an initial workspace to bind your business objectives.
          </p>
          <Button className="mt-6" onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Workspace Configuration
          </Button>
        </div>
      )}

      {/* Workspace grid */}
      {workspaces.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((ws) => {
            const displayName = resolveWorkspaceDisplayName(ws)
            const primaryDomain = resolvePrimaryDomain(ws)
            const canEditTitle =
              ws.currentUserRole === "owner" || ws.currentUserRole === "developer"
            const primaryRepo = ws.repos[0] ?? null
            const memberSummaries = ws.memberSummaries ?? []

            return (
              <Card key={ws.id} className="h-full transition-shadow hover:shadow-md">
                  <CardHeader>
                    <CardTitle className="flex items-start justify-between gap-2">
                      <WorkspaceTitleEditor
                        workspace={ws}
                        title={displayName}
                        canEdit={canEditTitle}
                        user={user}
                        onLocalTitleChange={handleLocalTitleChange}
                        onError={setError}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-950"
                        onClick={() => router.push(`/workspace/${ws.id}`)}
                        title="Open workspace"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </CardTitle>
                    <CardDescription className="space-y-1">
                      <span className="block text-sm text-slate-500">
                        Primary Domain: {primaryDomain || "Not mapped yet"}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      <span className="group/git relative inline-flex">
                        <Badge variant="secondary">
                          <Github className="mr-1 h-3 w-3" />
                          Git {ws.repos.length}
                        </Badge>
                        {primaryRepo ? (
                          <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden min-w-64 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700 shadow-lg group-hover/git:block">
                            {primaryRepo.url}
                            {ws.repos.length > 1 ? (
                              <span className="block text-slate-500">
                                +{ws.repos.length - 1} more
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                      <Badge variant="secondary">
                        <Server className="mr-1 h-3 w-3" />
                        Vercel {ws.vercelProjects.length}
                      </Badge>
                      <span className="group/team relative inline-flex">
                        <Badge variant="secondary">
                          <Users className="mr-1 h-3 w-3" />
                          Team {ws.memberCount}
                        </Badge>
                        <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden min-w-64 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700 shadow-lg group-hover/team:block">
                          {memberSummaries.length > 0 ? (
                            memberSummaries.map((member) => (
                              <span key={member.uid} className="block">
                                {displayMemberName(member)}
                                <span className="ml-1 text-slate-400">({member.role})</span>
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-500">No workspace members loaded yet.</span>
                          )}
                        </span>
                      </span>
                    </div>
                  </CardContent>
                </Card>
            )
          })}
        </div>
      )}
      <GlobalWorkspaceNotifier />
    </AppShell>
  )
}
