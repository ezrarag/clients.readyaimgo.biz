"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore"
import { CheckCircle2, Circle, ExternalLink, Loader2, Plus } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { OrgShell } from "@/components/org/org-shell"
import { OrgTaskBoard } from "@/components/org/org-task-board"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { getDb } from "@/lib/firebase/config"
import {
  listOrgMembers,
  loadOrgAccessContext,
} from "@/lib/org-client"
import {
  generateReadableId,
  isOrgAdmin,
  normalizeOrgFile,
  normalizeOrgProject,
  taskCompletionPct,
  type Organization,
  type OrgFile,
  type OrgMember,
  type OrgProject,
  type OrgTask,
} from "@/lib/organizations"

interface OrgProjectPageProps {
  params: {
    orgId: string
    id: string
  }
}

function formatOptionalDate(value: string | null) {
  if (!value) {
    return "N/A"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "N/A"
  }

  return format(date, "MMM d, yyyy")
}

export default function OrgProjectPage({ params }: OrgProjectPageProps) {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [org, setOrg] = useState<Organization | null>(null)
  const [member, setMember] = useState<OrgMember | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [project, setProject] = useState<OrgProject | null>(null)
  const [files, setFiles] = useState<OrgFile[]>([])
  const [loading, setLoading] = useState(true)
  const [savingTask, setSavingTask] = useState(false)
  const [taskText, setTaskText] = useState("")
  const [taskPriority, setTaskPriority] = useState<"high" | "medium" | "low">("medium")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
      return
    }

    if (authLoading || !user) {
      return
    }

    let unsubscribeProject: (() => void) | null = null
    let unsubscribeFiles: (() => void) | null = null
    let cancelled = false

    const load = async () => {
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

        const nextMembers = await listOrgMembers(firestoreDb, params.orgId)
        if (cancelled) return

        setOrg(access.org)
        setMember(access.member)
        setMembers(nextMembers)

        unsubscribeProject = onSnapshot(
          doc(firestoreDb, "organizations", params.orgId, "projects", params.id),
          (snapshot) => {
            if (!snapshot.exists()) {
              router.replace(`/org/${params.orgId}/projects`)
              return
            }

            setProject(normalizeOrgProject(snapshot.id, snapshot.data() as Record<string, unknown>))
            setLoading(false)
          },
          (snapshotError) => {
            console.error(snapshotError)
            setError("Unable to stream this project.")
            setLoading(false)
          }
        )

        unsubscribeFiles = onSnapshot(
          query(
            collection(firestoreDb, "organizations", params.orgId, "files"),
            orderBy("uploadedAt", "desc")
          ),
          (snapshot) => {
            setFiles(
              snapshot.docs.map((fileDoc) =>
                normalizeOrgFile(fileDoc.id, fileDoc.data() as Record<string, unknown>)
              )
            )
          },
          (snapshotError) => {
            console.error(snapshotError)
            setError("Unable to stream project files.")
          }
        )
      } catch (loadError) {
        console.error(loadError)
        if (!cancelled) {
          setError("Unable to load this project.")
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      unsubscribeProject?.()
      unsubscribeFiles?.()
    }
  }, [authLoading, params.id, params.orgId, router, user])

  const projectFiles = useMemo(
    () => files.filter((file) => file.projectId === params.id),
    [files, params.id]
  )
  const projectTasks = useMemo(
    () =>
      project
        ? [
            ...project.tasks,
            ...files
              .filter((file) => file.projectId === project.id)
              .flatMap((file) => file.extractedTasks),
          ]
        : [],
    [files, project]
  )

  const updateManualTasks = async (nextTasks: OrgTask[]) => {
    if (!org || !project || !member || !isOrgAdmin(member)) {
      return
    }

    const firestoreDb = getDb()
    await updateDoc(doc(firestoreDb, "organizations", org.id, "projects", project.id), {
      tasks: nextTasks,
    })
    await updateDoc(doc(firestoreDb, "organizations", org.id), {
      lastActivityAt: serverTimestamp(),
    })
    setProject({ ...project, tasks: nextTasks })
  }

  const handleAddTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!project || !taskText.trim()) {
      return
    }

    setSavingTask(true)

    try {
      const nextTask: OrgTask = {
        id: generateReadableId("task"),
        text: taskText.trim(),
        done: false,
        assignedTo: null,
        dueDate: null,
        priority: taskPriority,
        source: "manual",
        createdAt: new Date().toISOString(),
      }

      await updateManualTasks([...project.tasks, nextTask])
      setTaskText("")
      setTaskPriority("medium")
    } catch (taskError) {
      console.error(taskError)
      setError("Unable to add task.")
    } finally {
      setSavingTask(false)
    }
  }

  const toggleTask = async (task: OrgTask) => {
    if (!project || task.source !== "manual") {
      return
    }

    try {
      await updateManualTasks(
        project.tasks.map((item) =>
          item.id === task.id ? { ...item, done: !item.done } : item
        )
      )
    } catch (toggleError) {
      console.error(toggleError)
      setError("Unable to update task.")
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !org || !member || !project) {
    return null
  }

  return (
    <OrgShell
      org={org}
      member={member}
      active="projects"
      title={project.name}
      description={project.description || "Project files, tasks, dates, and RAG ownership."}
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Project snapshot
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant={project.status === "complete" ? "success" : "secondary"}>
              {project.status}
            </Badge>
            <Badge variant="secondary">{projectFiles.length} files</Badge>
            <Badge variant="accent">{taskCompletionPct(projectTasks)}% tasks</Badge>
          </div>
        </div>
      }
    >
      {error ? (
        <div className="mb-6 rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tasks</CardTitle>
              <CardDescription>Manual tasks and AI-extracted tasks attached to project files.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isOrgAdmin(member) ? (
                <form onSubmit={handleAddTask} className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
                  <Input
                    value={taskText}
                    onChange={(event) => setTaskText(event.target.value)}
                    placeholder="Add a task"
                  />
                  <select
                    value={taskPriority}
                    onChange={(event) =>
                      setTaskPriority(event.target.value as "high" | "medium" | "low")
                    }
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <Button type="submit" disabled={savingTask || !taskText.trim()}>
                    {savingTask ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Add
                  </Button>
                </form>
              ) : null}

              <OrgTaskBoard
                orgId={org.id}
                currentUid={user.uid}
                projects={[project]}
                files={files}
                members={members}
                projectId={project.id}
                canEdit={isOrgAdmin(member)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
              <CardDescription>Files linked to this project.</CardDescription>
            </CardHeader>
            <CardContent>
              {projectFiles.length > 0 ? (
                <div className="space-y-3">
                  {projectFiles.map((file) => (
                    <a
                      key={file.id}
                      href={file.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-white/80 p-4 text-sm"
                    >
                      <div>
                        <p className="font-semibold text-slate-900">{file.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {file.type} · {formatOptionalDate(file.uploadedAt)}
                        </p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-slate-400" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-slate-500">
                  No files have been attached to this project.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Project dates and RAG assignment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-2xl border border-border/70 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Start</p>
              <p className="mt-1 font-semibold text-slate-950">{formatOptionalDate(project.startDate)}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Target</p>
              <p className="mt-1 font-semibold text-slate-950">{formatOptionalDate(project.targetDate)}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">RAG lead</p>
              <p className="mt-1 font-semibold text-slate-950">{project.ragLeadEmail || "Unassigned"}</p>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/org/${org.id}/files`}>Add or attach files</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </OrgShell>
  )
}
