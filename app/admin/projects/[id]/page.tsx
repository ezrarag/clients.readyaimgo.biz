"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { format } from "date-fns"
import { CreditCard, ExternalLink, ImageIcon, Loader2, LogOut, Plus, RefreshCw, UserPlus } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { ProjectStatusBadge } from "@/components/admin/project-status-badge"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { type BeamProject } from "@/lib/beam"
import { type ClientDeliverable } from "@/lib/deliverables"
import { signOut } from "@/lib/firebase/auth"

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-border/70 bg-white/80 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-900">{value}</p>
    </div>
  )
}

export default function AdminProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user, effectiveRoles, loading: authLoading } = useAuth()
  const [project, setProject] = useState<BeamProject | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [deliverables, setDeliverables] = useState<ClientDeliverable[]>([])
  const [deliverablesLoading, setDeliverablesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteStatus, setInviteStatus] = useState<string | null>(null)
  const [deliverableTitle, setDeliverableTitle] = useState("")
  const [deliverableDescription, setDeliverableDescription] = useState("")
  const [deliverableLiveUrl, setDeliverableLiveUrl] = useState("")
  const [deliverableScreenshots, setDeliverableScreenshots] = useState("")
  const [deliverableRecordingUrl, setDeliverableRecordingUrl] = useState("")
  const [deliverableAmount, setDeliverableAmount] = useState("")
  const [deliverableSaving, setDeliverableSaving] = useState(false)
  const [deliverableMessage, setDeliverableMessage] = useState<string | null>(null)
  const [deliverableError, setDeliverableError] = useState<string | null>(null)

  const isBeamAdmin = effectiveRoles.includes("beam-admin")
  const projectId = typeof params?.id === "string" ? params.id : ""

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!user) {
      router.push("/login")
      return
    }

    if (!isBeamAdmin) {
      router.push("/dashboard")
      return
    }

    if (!projectId) {
      setError("Missing project id.")
      setPageLoading(false)
      return
    }

    void loadProject()
  }, [authLoading, isBeamAdmin, projectId, router, user])

  const loadProject = async () => {
    if (!user || !projectId) {
      return
    }

    try {
      setPageLoading(true)
      setError(null)

      const token = await user.getIdToken()
      const response = await fetch(`/api/projects?id=${encodeURIComponent(projectId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      })
      const payload = (await response.json().catch(() => null)) as
        | {
            project?: BeamProject | null
            error?: string
          }
        | null

      if (!response.ok || !payload?.project) {
        throw new Error(payload?.error || "Project not found.")
      }

      setProject(payload.project)
      await loadDeliverables(payload.project.clientId)
    } catch (loadError) {
      console.error("Unable to load project:", loadError)
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load project."
      )
      setProject(null)
    } finally {
      setPageLoading(false)
    }
  }

  const loadDeliverables = async (targetClientId = project?.clientId) => {
    if (!user || !targetClientId) return

    try {
      setDeliverablesLoading(true)
      setDeliverableError(null)
      const token = await user.getIdToken()
      const response = await fetch(`/api/deliverables?clientId=${encodeURIComponent(targetClientId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      })
      const payload = (await response.json()) as {
        success?: boolean
        deliverables?: ClientDeliverable[]
        error?: string
      }

      if (!response.ok || payload.success !== true || !Array.isArray(payload.deliverables)) {
        throw new Error(payload.error || "Unable to load deliverables.")
      }

      setDeliverables(payload.deliverables)
    } catch (loadError) {
      console.error("Unable to load deliverables:", loadError)
      setDeliverableError(
        loadError instanceof Error ? loadError.message : "Unable to load deliverables."
      )
    } finally {
      setDeliverablesLoading(false)
    }
  }

  const handleCreateDeliverable = async () => {
    if (!user || !project) return

    setDeliverableSaving(true)
    setDeliverableError(null)
    setDeliverableMessage(null)

    try {
      const token = await user.getIdToken()
      const screenshotUrls = deliverableScreenshots
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean)
      const response = await fetch("/api/deliverables", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId: project.clientId,
          projectId: project.id,
          title: deliverableTitle,
          description: deliverableDescription,
          liveUrl: deliverableLiveUrl,
          screenshotUrls,
          screenRecordingUrl: deliverableRecordingUrl,
          amount: Number(deliverableAmount),
        }),
      })
      const payload = (await response.json()) as {
        success?: boolean
        deliverable?: ClientDeliverable
        error?: string
      }

      if (!response.ok || payload.success !== true || !payload.deliverable) {
        throw new Error(payload.error || "Unable to create deliverable.")
      }

      setDeliverables((current) => [payload.deliverable as ClientDeliverable, ...current])
      setDeliverableTitle("")
      setDeliverableDescription("")
      setDeliverableLiveUrl("")
      setDeliverableScreenshots("")
      setDeliverableRecordingUrl("")
      setDeliverableAmount("")
      setDeliverableMessage("Deliverable created and available in the client portal.")
    } catch (createError) {
      console.error("Unable to create deliverable:", createError)
      setDeliverableError(
        createError instanceof Error ? createError.message : "Unable to create deliverable."
      )
    } finally {
      setDeliverableSaving(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  if (authLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !isBeamAdmin) {
    return null
  }

  return (
    <AppShell
      title={project?.clientName || "Project detail"}
      description="Review the project record, inspect the roster, and prepare participant invitations."
      eyebrow="Project detail"
      nav={[
        { href: "/admin", label: "Admin" },
        { href: "/admin/projects", label: "Projects" },
        { href: "/admin/organizations", label: "Organizations" },
        { href: `/admin/projects/${projectId}`, label: projectId, active: true },
      ]}
      actions={
        <>
          <Button variant="outline" onClick={loadProject}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </>
      }
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          {project ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Record state
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ProjectStatusBadge status={project.status} />
                <Badge variant="accent">{project.sourceNgo}</Badge>
                {project.beamBookEntry ? <Badge>Forge portal</Badge> : null}
              </div>
            </>
          ) : null}
        </div>
      }
    >
      {error ? (
        <Card className="border border-border/70 bg-white/90">
          <CardContent className="space-y-3 p-6">
            <p className="text-lg font-semibold text-slate-950">Project unavailable</p>
            <p className="text-sm leading-7 text-slate-600">{error}</p>
          </CardContent>
        </Card>
      ) : null}

      {project ? (
        <div className="space-y-6">
          <Card className="border border-border/70 bg-white/90">
            <CardHeader>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>Project record</CardTitle>
                  <CardDescription>
                    Canonical Firestore fields for this project document.
                  </CardDescription>
                </div>
                <Button
                  onClick={() => setInviteStatus("Invite participant is a placeholder for now.")}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  Invite participant
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {inviteStatus ? (
                <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {inviteStatus}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-3">
                <FieldRow label="Client name" value={project.clientName} />
                <FieldRow label="Client ID" value={project.clientId} />
                <FieldRow label="Client portal email" value={project.clientPortalEmail} />
                <FieldRow label="RAG project lead" value={project.ragProjectLead} />
                <FieldRow label="Source NGO" value={project.sourceNgo} />
                <FieldRow label="Source business" value={project.sourceBusiness} />
                <FieldRow label="RAG revenue" value={`$${project.ragRevenue.toLocaleString()}`} />
                <FieldRow
                  label="Participant revenue share"
                  value={`${(project.participantRevenueShare * 100).toFixed(0)}%`}
                />
                <FieldRow
                  label="Created at"
                  value={
                    project.createdAt
                      ? format(new Date(project.createdAt), "MMM d, yyyy h:mm a")
                      : "Pending server timestamp"
                  }
                />
                <FieldRow
                  label="Attached repository"
                  value={project.repository?.fullName || "Not attached"}
                />
                <FieldRow
                  label="Deployment URL"
                  value={project.repository?.deploymentUrl || "Not attached"}
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="border border-border/70 bg-white/90">
              <CardHeader>
                <CardTitle>Cohort roster</CardTitle>
                <CardDescription>
                  Participants assigned to this project will appear here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {project.cohort.length > 0 ? (
                  <div className="space-y-3">
                    {project.cohort.map((member) => (
                      <div
                        key={`${member.uid}-${member.role}`}
                        className="rounded-[20px] border border-border/70 bg-white/80 p-4"
                      >
                        <p className="font-semibold text-slate-950">{member.uid}</p>
                        <p className="mt-1 text-sm text-slate-600">{member.role}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-dashed border-border/80 bg-muted/35 px-5 py-10 text-center text-sm text-slate-600">
                    No cohort members yet.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-border/70 bg-white/90">
              <CardHeader>
                <CardTitle>Client deliverables</CardTitle>
                <CardDescription>
                  Create reviewable payment cards for the client portal.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {deliverableMessage ? (
                  <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {deliverableMessage}
                  </div>
                ) : null}

                {deliverableError ? (
                  <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {deliverableError}
                  </div>
                ) : null}

                <div className="grid gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Title</label>
                    <Input
                      value={deliverableTitle}
                      onChange={(event) => setDeliverableTitle(event.target.value)}
                      placeholder="Weekly sprint 1"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">
                      Two-sentence summary
                    </label>
                    <Textarea
                      rows={4}
                      value={deliverableDescription}
                      onChange={(event) => setDeliverableDescription(event.target.value)}
                      placeholder="Summarize what changed and what the client should review."
                    />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Live URL</label>
                      <Input
                        value={deliverableLiveUrl}
                        onChange={(event) => setDeliverableLiveUrl(event.target.value)}
                        placeholder="https://project.vercel.app"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Price</label>
                      <Input
                        inputMode="decimal"
                        value={deliverableAmount}
                        onChange={(event) => setDeliverableAmount(event.target.value)}
                        placeholder="150"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">
                      Screenshot URLs
                    </label>
                    <Textarea
                      rows={3}
                      value={deliverableScreenshots}
                      onChange={(event) => setDeliverableScreenshots(event.target.value)}
                      placeholder="One image URL per line"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">
                      Screen recording URL
                    </label>
                    <Input
                      value={deliverableRecordingUrl}
                      onChange={(event) => setDeliverableRecordingUrl(event.target.value)}
                      placeholder="https://www.loom.com/share/..."
                    />
                  </div>

                  <Button onClick={handleCreateDeliverable} disabled={deliverableSaving}>
                    {deliverableSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 h-4 w-4" />
                        Create deliverable
                      </>
                    )}
                  </Button>
                </div>

                <div className="rounded-[20px] border border-border/70 bg-muted/35 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">Current cards</p>
                    <Badge variant="secondary">{deliverables.length}</Badge>
                  </div>
                  {deliverablesLoading ? (
                    <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading deliverables...
                    </div>
                  ) : deliverables.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      {deliverables.map((deliverable) => (
                        <div
                          key={deliverable.id}
                          className="rounded-[18px] border border-border/70 bg-white/80 p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-slate-950">{deliverable.title}</p>
                              <p className="mt-1 text-sm text-slate-600">
                                {formatCurrency(deliverable.amount)}
                              </p>
                            </div>
                            <Badge variant={deliverable.status === "paid" ? "success" : "warning"}>
                              {deliverable.status}
                            </Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {deliverable.liveUrl ? (
                              <Button asChild variant="outline" size="sm">
                                <a href={deliverable.liveUrl} rel="noreferrer" target="_blank">
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Live
                                </a>
                              </Button>
                            ) : null}
                            {deliverable.screenshotUrls.length > 0 ? (
                              <Badge>
                                <ImageIcon className="mr-2 h-3 w-3" />
                                {deliverable.screenshotUrls.length} screenshots
                              </Badge>
                            ) : null}
                            <Badge>
                              <CreditCard className="mr-2 h-3 w-3" />
                              Portal checkout
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-600">
                      No deliverable payment cards have been created yet.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
