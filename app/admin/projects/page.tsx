"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ArrowRight, Loader2, LogOut, RefreshCw } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { ProjectCreateForm } from "@/components/admin/project-create-form"
import { ProjectStatusBadge } from "@/components/admin/project-status-badge"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { type BeamProject } from "@/lib/beam"
import { signOut } from "@/lib/firebase/auth"

export default function AdminProjectsPage() {
  const { user, effectiveRoles, loading: authLoading } = useAuth()
  const router = useRouter()
  const [projects, setProjects] = useState<BeamProject[]>([])
  const [pageLoading, setPageLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isBeamAdmin = effectiveRoles.includes("beam-admin")

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

    void loadProjects()
  }, [authLoading, isBeamAdmin, router, user])

  const loadProjects = async () => {
    if (!user) {
      return
    }

    try {
      setPageLoading(true)
      setError(null)

      const token = await user.getIdToken()
      const response = await fetch("/api/projects", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      })
      const payload = (await response.json().catch(() => null)) as
        | {
            projects?: BeamProject[]
            error?: string
          }
        | null

      if (!response.ok || !payload || !Array.isArray(payload.projects)) {
        throw new Error(payload?.error || "Unable to load projects.")
      }

      setProjects(payload.projects)
    } catch (loadError) {
      console.error("Unable to load projects:", loadError)
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load projects."
      )
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
      title="Admin projects"
      description="Create projects, review status across the shared collection, and jump into each project record."
      eyebrow="Projects"
      nav={[
        { href: "/admin", label: "Admin" },
        { href: "/admin/projects", label: "Projects", active: true },
        { href: "/admin/organizations", label: "Organizations" },
      ]}
      actions={
        <>
          <Badge variant="secondary">{projects.length} projects</Badge>
          <Button variant="outline" onClick={loadProjects}>
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
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Queue health
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="warning">
              {projects.filter((project) => project.status === "scoping").length} scoping
            </Badge>
            <Badge variant="accent">
              {projects.filter((project) => project.status === "active").length} active
            </Badge>
            <Badge variant="secondary">
              {projects.filter((project) => project.status === "review").length} review
            </Badge>
            <Badge variant="success">
              {projects.filter((project) => project.status === "complete").length} complete
            </Badge>
          </div>
        </div>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <ProjectCreateForm
          currentUser={user}
          onCreated={(projectId) => router.push(`/admin/projects/${projectId}`)}
        />

        <Card className="border border-border/70 bg-white/90">
          <CardHeader>
            <CardTitle>Project list</CardTitle>
            <CardDescription>
              Every project currently stored in Firestore, ordered by newest first.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? (
              <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            {projects.length > 0 ? (
              <div className="space-y-3">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/admin/projects/${project.id}`}
                    className="block rounded-[22px] border border-border/70 bg-white/80 p-4 transition-colors hover:border-primary/40 hover:bg-white"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-slate-950">{project.clientName}</p>
                        <p className="text-sm text-slate-500">
                          {project.clientId} · {project.clientPortalEmail}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ProjectStatusBadge status={project.status} />
                      <Badge variant="accent">{project.sourceNgo}</Badge>
                      {project.beamBookEntry ? <Badge>Forge portal</Badge> : null}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
                      <span>RAG revenue ${project.ragRevenue.toLocaleString()}</span>
                      <span>
                        {project.createdAt
                          ? format(new Date(project.createdAt), "MMM d, yyyy")
                          : "New project"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-border/80 bg-muted/35 px-5 py-10 text-center text-sm text-slate-600">
                No projects yet. Create the first one from the form on the left.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
