"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { format } from "date-fns"
import { Loader2, LogOut, RefreshCw, UserPlus } from "lucide-react"
import { doc, getDoc } from "firebase/firestore"

import { useAuth } from "@/components/auth/AuthProvider"
import { ProjectStatusBadge } from "@/components/admin/project-status-badge"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { normalizeBeamProjectDocument, type BeamProject } from "@/lib/beam"
import { signOut } from "@/lib/firebase/auth"
import { getDb } from "@/lib/firebase/config"

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
  const [error, setError] = useState<string | null>(null)
  const [inviteStatus, setInviteStatus] = useState<string | null>(null)

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
    try {
      setPageLoading(true)
      setError(null)

      const snapshot = await getDoc(doc(getDb(), "projects", projectId))
      if (!snapshot.exists()) {
        throw new Error("Project not found.")
      }

      setProject(
        normalizeBeamProjectDocument(snapshot.id, snapshot.data() as Record<string, unknown>)
      )
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
                <CardTitle>Deliverables and expansion</CardTitle>
                <CardDescription>
                  This record starts with empty deliverables and an empty expansion plan.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-[20px] border border-border/70 bg-muted/35 p-4">
                  <p className="text-sm font-semibold text-slate-900">Deliverables</p>
                  <p className="mt-2 text-sm text-slate-600">
                    {project.deliverables.length > 0
                      ? project.deliverables.join(", ")
                      : "No deliverables attached yet."}
                  </p>
                </div>

                <div className="rounded-[20px] border border-border/70 bg-muted/35 p-4">
                  <p className="text-sm font-semibold text-slate-900">Expansion plan</p>
                  <p className="mt-2 text-sm text-slate-600">
                    {Object.keys(project.expansionPlan).length > 0
                      ? "Expansion plan populated."
                      : "Expansion plan is empty."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
