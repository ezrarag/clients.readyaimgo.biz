"use client"

import { useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore"
import { Loader2, Plus } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { OrgShell } from "@/components/org/org-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { getDb } from "@/lib/firebase/config"
import {
  listOrgFiles,
  listOrgProjects,
  loadOrgAccessContext,
} from "@/lib/org-client"
import {
  generateReadableId,
  getProjectTasks,
  isOrgAdmin,
  taskCompletionPct,
  type Organization,
  type OrgFile,
  type OrgMember,
  type OrgProject,
} from "@/lib/organizations"

interface OrgProjectsPageProps {
  params: {
    orgId: string
  }
}

function parseDateInput(value: string) {
  return value ? new Date(`${value}T00:00:00`) : null
}

export default function OrgProjectsPage({ params }: OrgProjectsPageProps) {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [org, setOrg] = useState<Organization | null>(null)
  const [member, setMember] = useState<OrgMember | null>(null)
  const [projects, setProjects] = useState<OrgProject[]>([])
  const [files, setFiles] = useState<OrgFile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<"active" | "paused" | "complete">("active")
  const [startDate, setStartDate] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [ragLeadEmail, setRagLeadEmail] = useState("")

  const load = async () => {
    if (!user) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const firestoreDb = getDb()
      const access = await loadOrgAccessContext({
        firestoreDb,
        orgId: params.orgId,
        uid: user.uid,
      })

      if (!access) {
        router.replace("/dashboard")
        return
      }

      const [nextProjects, nextFiles] = await Promise.all([
        listOrgProjects(firestoreDb, params.orgId),
        listOrgFiles(firestoreDb, params.orgId),
      ])

      setOrg(access.org)
      setMember(access.member)
      setProjects(nextProjects)
      setFiles(nextFiles)
    } catch (loadError) {
      console.error(loadError)
      setError("Unable to load organization projects.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
      return
    }

    if (!authLoading && user) {
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, params.orgId, router, user])

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!org || !member || !isOrgAdmin(member) || !name.trim()) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const firestoreDb = getDb()
      const projectId = generateReadableId("proj")
      const projectRef = doc(firestoreDb, "organizations", org.id, "projects", projectId)

      await setDoc(projectRef, {
        id: projectId,
        name: name.trim(),
        status,
        description: description.trim(),
        startDate: parseDateInput(startDate),
        targetDate: parseDateInput(targetDate),
        ragLeadEmail: ragLeadEmail.trim().toLowerCase(),
        createdAt: serverTimestamp(),
        tasks: [],
      })
      await updateDoc(doc(firestoreDb, "organizations", org.id), {
        lastActivityAt: serverTimestamp(),
      })

      setName("")
      setDescription("")
      setStatus("active")
      setStartDate("")
      setTargetDate("")
      setRagLeadEmail("")
      await load()
    } catch (createError) {
      console.error(createError)
      setError("Unable to create project.")
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !org || !member) {
    return null
  }

  return (
    <OrgShell
      org={org}
      member={member}
      active="projects"
      title="Projects"
      description="Track each workstream for this shared client workspace."
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Project summary
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500">Total</p>
              <p className="text-2xl font-semibold text-slate-950">{projects.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Active</p>
              <p className="text-2xl font-semibold text-slate-950">
                {projects.filter((project) => project.status === "active").length}
              </p>
            </div>
          </div>
        </div>
      }
    >
      {error ? (
        <div className="mb-6 rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
        <Card>
          <CardHeader>
            <CardTitle>Add Project</CardTitle>
            <CardDescription>
              Owners and admins can create shared projects for this organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isOrgAdmin(member) ? (
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Name</label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} required />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Status</label>
                  <select
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as "active" | "paused" | "complete")
                    }
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="complete">Complete</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Description</label>
                  <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Start date</label>
                    <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Target date</label>
                    <Input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">RAG lead email</label>
                  <Input
                    type="email"
                    value={ragLeadEmail}
                    onChange={(event) => setRagLeadEmail(event.target.value)}
                    placeholder="lead@readyaimgo.biz"
                  />
                </div>

                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add Project
                </Button>
              </form>
            ) : (
              <p className="text-sm leading-7 text-slate-600">
                Viewers can inspect projects, but only owners and admins can add new ones.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Project List</CardTitle>
            <CardDescription>{projects.length} projects in this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            {projects.length > 0 ? (
              <div className="space-y-3">
                {projects.map((project) => {
                  const projectFiles = files.filter((file) => file.projectId === project.id)
                  const tasks = getProjectTasks(project, files)

                  return (
                    <Link
                      key={project.id}
                      href={`/org/${org.id}/projects/${project.id}`}
                      className="block rounded-[24px] border border-border/70 bg-white/80 p-5 transition hover:border-primary/30 hover:shadow-sm"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-lg font-semibold text-slate-950">{project.name}</p>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                            {project.description || "No description added yet."}
                          </p>
                        </div>
                        <Badge variant={project.status === "complete" ? "success" : "secondary"}>
                          {project.status}
                        </Badge>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Badge variant="secondary">{projectFiles.length} files</Badge>
                        <Badge variant="secondary">{tasks.length} tasks</Badge>
                        <Badge variant="accent">{taskCompletionPct(tasks)}% complete</Badge>
                      </div>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">
                No projects have been added yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </OrgShell>
  )
}
