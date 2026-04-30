"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore"
import { Loader2 } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { OrgShell } from "@/components/org/org-shell"
import { OrgTaskBoard } from "@/components/org/org-task-board"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getDb } from "@/lib/firebase/config"
import {
  listOrgMembers,
  loadOrgAccessContext,
} from "@/lib/org-client"
import {
  isOrgAdmin,
  normalizeOrgFile,
  normalizeOrgProject,
  type Organization,
  type OrgFile,
  type OrgMember,
  type OrgProject,
} from "@/lib/organizations"

interface OrgTasksPageProps {
  params: {
    orgId: string
  }
}

export default function OrgTasksPage({ params }: OrgTasksPageProps) {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [org, setOrg] = useState<Organization | null>(null)
  const [member, setMember] = useState<OrgMember | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [projects, setProjects] = useState<OrgProject[]>([])
  const [files, setFiles] = useState<OrgFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
      return
    }

    if (authLoading || !user) {
      return
    }

    let unsubscribeProjects: (() => void) | null = null
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

        unsubscribeProjects = onSnapshot(
          query(
            collection(firestoreDb, "organizations", params.orgId, "projects"),
            orderBy("createdAt", "desc")
          ),
          (snapshot) => {
            setProjects(
              snapshot.docs.map((projectDoc) =>
                normalizeOrgProject(projectDoc.id, projectDoc.data() as Record<string, unknown>)
              )
            )
            setLoading(false)
          },
          (snapshotError) => {
            console.error(snapshotError)
            setError("Unable to stream organization projects.")
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
            setError("Unable to stream organization files.")
          }
        )
      } catch (loadError) {
        console.error(loadError)
        if (!cancelled) {
          setError("Unable to load organization tasks.")
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      unsubscribeProjects?.()
      unsubscribeFiles?.()
    }
  }, [authLoading, params.orgId, router, user])

  const allTasks = useMemo(
    () => [
      ...projects.flatMap((project) => project.tasks),
      ...files.flatMap((file) => file.extractedTasks),
    ],
    [files, projects]
  )
  const myTasks = allTasks.filter((task) => task.assignedTo === user?.uid)

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
      active="tasks"
      title="Tasks"
      description="All extracted and manual tasks across every project in this organization."
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Task summary
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500">All tasks</p>
              <p className="text-2xl font-semibold text-slate-950">{allTasks.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Mine</p>
              <p className="text-2xl font-semibold text-slate-950">{myTasks.length}</p>
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

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Organization Tasks</CardTitle>
              <CardDescription>
                Filter by status, ownership, and priority across the whole workspace.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{projects.length} projects</Badge>
              <Badge variant="secondary">{files.length} files</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <OrgTaskBoard
            orgId={org.id}
            currentUid={user.uid}
            projects={projects}
            files={files}
            members={members}
            canEdit={isOrgAdmin(member)}
            showProjectBadge
          />
        </CardContent>
      </Card>
    </OrgShell>
  )
}
