"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Building2,
  FolderKanban,
  Github,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { ProjectStatusBadge } from "@/components/admin/project-status-badge"
import { RagNotesFeed } from "@/components/rag-notes-feed"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { type BeamProject } from "@/lib/beam"
import { loadClientPortalProject } from "@/lib/client-portal"
import { signOut } from "@/lib/firebase/auth"
import { getDb } from "@/lib/firebase/config"
import { type Organization } from "@/lib/organizations"

type FeedbackCategory = "design" | "content" | "functionality" | "other"
type FeedbackUrgency = "low" | "medium" | "high"

type GitHubProject = {
  id: number
  name: string
  fullName: string
  description: string | null
  url: string
  homepage: string | null
  language: string | null
  stars: number
  updatedAt: string
  deploymentUrl: string | null
}

export default function ClientPortalPage() {
  const params = useParams<{ clientId: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [project, setProject] = useState<BeamProject | null>(null)
  const [availableProjects, setAvailableProjects] = useState<BeamProject[]>([])
  const [availableRepos, setAvailableRepos] = useState<GitHubProject[]>([])
  const [availableOrganizations, setAvailableOrganizations] = useState<Organization[]>([])
  const [pageLoading, setPageLoading] = useState(true)
  const [associationLoading, setAssociationLoading] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [associationError, setAssociationError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [summary, setSummary] = useState("")
  const [category, setCategory] = useState<FeedbackCategory>("design")
  const [urgency, setUrgency] = useState<FeedbackUrgency>("medium")
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [repositoryUrl, setRepositoryUrl] = useState("")
  const [deploymentUrl, setDeploymentUrl] = useState("")
  const [repositorySaving, setRepositorySaving] = useState(false)
  const [repositoryMessage, setRepositoryMessage] = useState<string | null>(null)
  const [repositoryError, setRepositoryError] = useState<string | null>(null)
  const [requestProjectName, setRequestProjectName] = useState("")
  const [requestWebsiteUrl, setRequestWebsiteUrl] = useState("")
  const [requestOrganizationName, setRequestOrganizationName] = useState("")
  const [requestRepositoryUrl, setRequestRepositoryUrl] = useState("")
  const [requestNotes, setRequestNotes] = useState("")
  const [requestSaving, setRequestSaving] = useState(false)
  const [requestMessage, setRequestMessage] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)

  const clientId = typeof params?.clientId === "string" ? params.clientId : ""
  const normalizedSearch = searchQuery.trim().toLowerCase()

  const matchingProjects =
    normalizedSearch.length > 0
      ? availableProjects.filter((candidate) =>
          [candidate.clientName, candidate.clientId, candidate.sourceNgo]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        )
      : availableProjects

  const matchingRepos =
    normalizedSearch.length > 0
      ? availableRepos.filter((repo) =>
          [
            repo.name,
            repo.fullName,
            repo.description || "",
            repo.url,
            repo.homepage || "",
            repo.deploymentUrl || "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        )
      : availableRepos.slice(0, 12)

  const matchingOrganizations =
    normalizedSearch.length > 0
      ? availableOrganizations.filter((org) =>
          [org.name, org.slug, org.website || ""]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        )
      : availableOrganizations.slice(0, 12)

  const loadAssociationOptions = async () => {
    if (!user) {
      return
    }

    setAssociationLoading(true)
    setAssociationError(null)

    try {
      const token = await user.getIdToken()
      const [projectsResponse, organizationsResponse, reposResponse] = await Promise.all([
        fetch("/api/client-portal/projects", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }),
        fetch("/api/client-portal/organizations", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }),
        fetch("/api/github/projects", {
          cache: "no-store",
        }),
      ])

      const [projectsPayload, organizationsPayload, reposPayload] = await Promise.all([
        projectsResponse.json().catch(() => null),
        organizationsResponse.json().catch(() => null),
        reposResponse.json().catch(() => null),
      ])

      if (!projectsResponse.ok || !Array.isArray(projectsPayload?.projects)) {
        throw new Error(projectsPayload?.error || "Unable to load existing client projects.")
      }

      if (
        !organizationsResponse.ok ||
        !Array.isArray(organizationsPayload?.organizations)
      ) {
        throw new Error(
          organizationsPayload?.error || "Unable to load organization matches."
        )
      }

      if (!reposResponse.ok || !Array.isArray(reposPayload?.projects)) {
        throw new Error(reposPayload?.error || "Unable to load repository matches.")
      }

      setAvailableProjects(projectsPayload.projects as BeamProject[])
      setAvailableOrganizations(organizationsPayload.organizations as Organization[])
      setAvailableRepos(reposPayload.projects as GitHubProject[])
    } catch (error) {
      console.error("Unable to load association options:", error)
      setAssociationError(
        error instanceof Error
          ? error.message
          : "Unable to load association options."
      )
    } finally {
      setAssociationLoading(false)
    }
  }

  const loadProject = async () => {
    if (!user || !clientId) {
      return
    }

    try {
      setPageLoading(true)
      setPageError(null)

      const nextProject = await loadClientPortalProject({
        firestoreDb: getDb(),
        clientId,
        user,
      })

      if (!nextProject) {
        router.replace("/dashboard")
        return
      }

      setProject(nextProject)
      setRepositoryUrl(nextProject.repository?.url || "")
      setDeploymentUrl(nextProject.repository?.deploymentUrl || "")
      setRequestOrganizationName(nextProject.clientName)
    } catch (error) {
      console.error("Unable to load client portal:", error)
      setPageError(
        error instanceof Error ? error.message : "Unable to load this client portal."
      )
    } finally {
      setPageLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!user) {
      router.push("/login")
      return
    }

    if (!clientId) {
      router.replace("/dashboard")
      return
    }

    void loadProject()
    void loadAssociationOptions()
  }, [authLoading, clientId, router, user])

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  const handleSubmitFeedback = async () => {
    if (!project || !user?.email || !summary.trim()) {
      setSubmitError("Add a feedback summary before submitting.")
      return
    }

    setSubmitLoading(true)
    setSubmitError(null)
    setSubmitMessage(null)

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: project.id,
          clientEmail: user.email,
          clientName: user.displayName || user.email,
          summary: summary.trim(),
          category,
          urgency,
        }),
      })
      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean
            error?: string
          }
        | null

      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error || "Unable to submit feedback.")
      }

      setSummary("")
      setCategory("design")
      setUrgency("medium")
      setSubmitMessage("Feedback sent to the Readyaimgo team.")
    } catch (error) {
      console.error("Unable to submit feedback:", error)
      setSubmitError(
        error instanceof Error ? error.message : "Unable to submit feedback."
      )
    } finally {
      setSubmitLoading(false)
    }
  }

  const attachRepository = async (nextRepositoryUrl: string, nextDeploymentUrl?: string | null) => {
    if (!project || !user) {
      return
    }

    setRepositorySaving(true)
    setRepositoryError(null)
    setRepositoryMessage(null)

    try {
      const token = await user.getIdToken()
      const response = await fetch("/api/client-portal/repository", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: project.id,
          repositoryUrl: nextRepositoryUrl.trim(),
          deploymentUrl: (nextDeploymentUrl || "").trim(),
        }),
      })
      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean
            project?: BeamProject
            error?: string
          }
        | null

      if (!response.ok || payload?.success !== true || !payload.project) {
        throw new Error(payload?.error || "Unable to attach repository.")
      }

      setProject(payload.project)
      setRepositoryUrl(payload.project.repository?.url || nextRepositoryUrl.trim())
      setDeploymentUrl(
        payload.project.repository?.deploymentUrl || (nextDeploymentUrl || "").trim()
      )
      setRepositoryMessage("Repository attached to this project.")
    } catch (error) {
      console.error("Unable to attach repository:", error)
      setRepositoryError(
        error instanceof Error ? error.message : "Unable to attach repository."
      )
    } finally {
      setRepositorySaving(false)
    }
  }

  const handleManualAttachRepository = async () => {
    await attachRepository(repositoryUrl, deploymentUrl)
  }

  const handleSubmitProjectRequest = async () => {
    if (!project || !user) {
      return
    }

    setRequestSaving(true)
    setRequestError(null)
    setRequestMessage(null)

    try {
      const token = await user.getIdToken()
      const response = await fetch("/api/client-portal/project-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectName: requestProjectName.trim(),
          websiteUrl: requestWebsiteUrl.trim(),
          organizationName: requestOrganizationName.trim(),
          repositoryUrl: requestRepositoryUrl.trim(),
          notes: requestNotes.trim(),
          currentPortalProjectId: project.id,
          currentPortalClientId: project.clientId,
        }),
      })
      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean
            error?: string
          }
        | null

      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error || "Unable to submit project request.")
      }

      setRequestProjectName("")
      setRequestWebsiteUrl("")
      setRequestRepositoryUrl("")
      setRequestNotes("")
      setRequestMessage(
        "Project request submitted. This gives the team the information needed to start the GitHub/Codex workflow."
      )
    } catch (error) {
      console.error("Unable to submit project request:", error)
      setRequestError(
        error instanceof Error ? error.message : "Unable to submit project request."
      )
    } finally {
      setRequestSaving(false)
    }
  }

  if (authLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !project) {
    return null
  }

  return (
    <AppShell
      title={project.clientName}
      description="Review the current project scope, search for matching workspaces or repositories, and send feedback from one client-facing portal."
      eyebrow="Client portal"
      nav={[
        { href: `/portal/${project.clientId}`, label: "Portal", active: true },
      ]}
      actions={
        <>
          <Button
            variant="outline"
            onClick={() => {
              void loadProject()
              void loadAssociationOptions()
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </>
      }
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            <Badge variant="accent">{project.sourceNgo}</Badge>
            {project.beamBookEntry ? <Badge>Forge portal</Badge> : null}
            {project.repository ? <Badge variant="secondary">{project.repository.fullName}</Badge> : null}
          </div>
        </div>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card className="border border-border/70 bg-white/90">
            <CardHeader>
              <CardTitle>Project snapshot</CardTitle>
              <CardDescription>
                Your current deliverables and project record.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {pageError ? (
                <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {pageError}
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-[20px] border border-border/70 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Client ID
                  </p>
                  <p className="mt-2 text-sm text-slate-900">{project.clientId}</p>
                </div>
                <div className="rounded-[20px] border border-border/70 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Portal email
                  </p>
                  <p className="mt-2 text-sm text-slate-900">{project.clientPortalEmail}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Deliverables</p>
                  <p className="text-sm text-slate-500">
                    Current scope shared with the client portal.
                  </p>
                </div>

                {project.deliverables.length > 0 ? (
                  <div className="space-y-3">
                    {project.deliverables.map((deliverable) => (
                      <label
                        key={deliverable}
                        className="flex items-center justify-between gap-3 rounded-[20px] border border-border/70 bg-white/80 px-4 py-3"
                      >
                        <span className="flex items-center gap-3 text-sm text-slate-800">
                          <input
                            checked={false}
                            disabled
                            readOnly
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          {deliverable}
                        </span>
                        <Badge variant="secondary">Pending</Badge>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-border/80 bg-muted/35 px-4 py-5 text-sm text-slate-600">
                    No deliverables have been published to this portal yet.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border/70 bg-white/90">
            <CardHeader>
              <CardTitle>Search and associate</CardTitle>
              <CardDescription>
                Search for existing projects, GitHub repositories, and organizations before starting a new request.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {associationError ? (
                <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {associationError}
                </div>
              ) : null}

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-10"
                  placeholder="Search by project, repository, website, or organization"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>

              {associationLoading ? (
                <div className="flex items-center gap-2 rounded-[20px] border border-border/70 bg-muted/35 px-4 py-4 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading project, repository, and organization matches...
                </div>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-3">
                <Card className="border border-border/70 bg-white/80 shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FolderKanban className="h-4 w-4" />
                      Existing projects
                    </CardTitle>
                    <CardDescription>
                      Projects already linked to this client email.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {matchingProjects.length > 0 ? (
                      matchingProjects.map((candidate) => (
                        <div
                          key={candidate.id}
                          className="rounded-[18px] border border-border/70 bg-white px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {candidate.clientName}
                              </p>
                              <p className="text-xs text-slate-500">{candidate.clientId}</p>
                            </div>
                            {candidate.clientId === project.clientId ? (
                              <Badge variant="secondary">Current</Badge>
                            ) : null}
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <ProjectStatusBadge status={candidate.status} />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push(`/portal/${candidate.clientId}`)}
                            >
                              Open
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-border/80 bg-muted/35 px-4 py-4 text-sm text-slate-600">
                        No matching client projects found.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border border-border/70 bg-white/80 shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Github className="h-4 w-4" />
                      Repository matches
                    </CardTitle>
                    <CardDescription>
                      Attach one to the current project or use it in a new project request.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {matchingRepos.length > 0 ? (
                      matchingRepos.slice(0, 12).map((repo) => (
                        <div
                          key={repo.id}
                          className="rounded-[18px] border border-border/70 bg-white px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-slate-900">{repo.fullName}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {repo.description || repo.deploymentUrl || repo.url}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => void attachRepository(repo.url, repo.deploymentUrl)}
                              disabled={repositorySaving}
                            >
                              Attach current
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setRequestRepositoryUrl(repo.url)
                                setRequestProjectName((current) => current || repo.name)
                                setRequestWebsiteUrl(
                                  (current) => current || repo.deploymentUrl || repo.homepage || ""
                                )
                              }}
                            >
                              Use in request
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-border/80 bg-muted/35 px-4 py-4 text-sm text-slate-600">
                        No matching repositories found.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border border-border/70 bg-white/80 shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="h-4 w-4" />
                      Organization matches
                    </CardTitle>
                    <CardDescription>
                      Pick the organization name you want the new project associated with.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {matchingOrganizations.length > 0 ? (
                      matchingOrganizations.slice(0, 12).map((org) => (
                        <div
                          key={org.id}
                          className="rounded-[18px] border border-border/70 bg-white px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-slate-900">{org.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {org.slug}
                            {org.website ? ` · ${org.website}` : ""}
                          </p>
                          <div className="mt-3">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRequestOrganizationName(org.name)}
                            >
                              Use org
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-border/80 bg-muted/35 px-4 py-4 text-sm text-slate-600">
                        No matching organizations found.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {project.repository ? (
                <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <Github className="h-4 w-4" />
                    {project.repository.fullName}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm">
                    <a
                      href={project.repository.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4"
                    >
                      Open repository
                    </a>
                    {project.repository.deploymentUrl ? (
                      <a
                        href={project.repository.deploymentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                      >
                        Open deployment
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {repositoryMessage ? (
                <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {repositoryMessage}
                </div>
              ) : null}

              {repositoryError ? (
                <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {repositoryError}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">
                    Custom repository URL
                  </label>
                  <Input
                    placeholder="https://github.com/owner/repository"
                    value={repositoryUrl}
                    onChange={(event) => setRepositoryUrl(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">
                    Deployment URL
                  </label>
                  <Input
                    placeholder="https://project.vercel.app"
                    value={deploymentUrl}
                    onChange={(event) => setDeploymentUrl(event.target.value)}
                  />
                </div>
                <Button onClick={() => void handleManualAttachRepository()} disabled={repositorySaving}>
                  {repositorySaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Github className="mr-2 h-4 w-4" />
                      Attach
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border/70 bg-white/90">
            <CardHeader>
              <CardTitle>Start a new project request</CardTitle>
              <CardDescription>
                If the project is not already started, send a structured request that captures the repo, site, organization, and GitHub/Codex handoff context.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {requestMessage ? (
                <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {requestMessage}
                </div>
              ) : null}

              {requestError ? (
                <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {requestError}
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Project name</label>
                  <Input
                    value={requestProjectName}
                    onChange={(event) => setRequestProjectName(event.target.value)}
                    placeholder="Home Permit Dashboard"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Website or app URL</label>
                  <Input
                    value={requestWebsiteUrl}
                    onChange={(event) => setRequestWebsiteUrl(event.target.value)}
                    placeholder="https://example.com"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Organization</label>
                  <Input
                    value={requestOrganizationName}
                    onChange={(event) => setRequestOrganizationName(event.target.value)}
                    placeholder="MKE Black"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Repository URL</label>
                  <Input
                    value={requestRepositoryUrl}
                    onChange={(event) => setRequestRepositoryUrl(event.target.value)}
                    placeholder="https://github.com/owner/repository"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Notes</label>
                <Textarea
                  value={requestNotes}
                  onChange={(event) => setRequestNotes(event.target.value)}
                  placeholder="Describe the app, website, repo, and what should happen next in the GitHub/Codex workflow."
                  rows={5}
                />
              </div>

              <Button onClick={() => void handleSubmitProjectRequest()} disabled={requestSaving}>
                {requestSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting request...
                  </>
                ) : (
                  "Submit project request"
                )}
              </Button>
            </CardContent>
          </Card>

          <RagNotesFeed clientEmail={user.email ?? ""} />
        </div>

        <Card className="border border-border/70 bg-white/90">
          <CardHeader>
            <CardTitle>Send feedback</CardTitle>
            <CardDescription>
              Share design, content, or functionality notes with the Readyaimgo team.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {submitMessage ? (
              <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {submitMessage}
              </div>
            ) : null}

            {submitError ? (
              <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {submitError}
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Summary</label>
              <Textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What should change or what should the team review next?"
                rows={7}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Category</label>
                <Select value={category} onValueChange={(value) => setCategory(value as FeedbackCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="design">Design</SelectItem>
                    <SelectItem value="content">Content</SelectItem>
                    <SelectItem value="functionality">Functionality</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Urgency</label>
                <Select value={urgency} onValueChange={(value) => setUrgency(value as FeedbackUrgency)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button onClick={handleSubmitFeedback} disabled={submitLoading}>
              {submitLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending feedback...
                </>
              ) : (
                "Send feedback"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
