"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { formatDistanceToNow } from "date-fns"
import { FileUp, FolderPlus, Loader2, UserPlus } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { OrgShell } from "@/components/org/org-shell"
import { RagNotesFeed } from "@/components/rag-notes-feed"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getDb } from "@/lib/firebase/config"
import {
  listOrgFiles,
  listOrgMembers,
  listOrgProjects,
  loadOrgAccessContext,
} from "@/lib/org-client"
import {
  getProjectTasks,
  taskCompletionPct,
  type Organization,
  type OrgFile,
  type OrgMember,
  type OrgProject,
} from "@/lib/organizations"

interface OrgDashboardPageProps {
  params: {
    orgId: string
  }
}

export default function OrgDashboardPage({ params }: OrgDashboardPageProps) {
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

        const [nextMembers, nextProjects, nextFiles] = await Promise.all([
          listOrgMembers(firestoreDb, params.orgId),
          listOrgProjects(firestoreDb, params.orgId),
          listOrgFiles(firestoreDb, params.orgId),
        ])

        if (!cancelled) {
          setOrg(access.org)
          setMember(access.member)
          setMembers(nextMembers)
          setProjects(nextProjects)
          setFiles(nextFiles)
        }
      } catch (loadError) {
        console.error(loadError)
        if (!cancelled) {
          setError("Unable to load this organization workspace.")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [authLoading, params.orgId, router, user])

  const recentActivity = useMemo(() => {
    return files
      .filter((file) => file.uploadedAt)
      .slice(0, 6)
      .map((file) => {
        const uploader = members.find((item) => item.uid === file.uploadedByUid)
        const uploadedAt = file.uploadedAt ? new Date(file.uploadedAt) : null

        return {
          id: file.id,
          text: `${uploader?.name || uploader?.email || "Someone"} uploaded ${file.name}`,
          time:
            uploadedAt && !Number.isNaN(uploadedAt.getTime())
              ? `${formatDistanceToNow(uploadedAt, { addSuffix: true })}`
              : "",
        }
      })
  }, [files, members])

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
      active="dashboard"
      title={`${org.name} workspace`}
      description="Shared project, file, and team access for everyone connected to this client relationship."
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <div className="flex items-center gap-4">
            {org.logoUrl ? (
              <img
                src={org.logoUrl}
                alt=""
                className="h-14 w-14 rounded-2xl border border-white object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-xl font-semibold text-primary">
                {org.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Organization
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="accent">{org.plan}</Badge>
                <Badge variant="secondary">{members.length} members</Badge>
              </div>
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

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Button asChild>
          <Link href={`/org/${org.id}/files`}>
            <FileUp className="mr-2 h-4 w-4" />
            Upload file
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/org/${org.id}/projects`}>
            <FolderPlus className="mr-2 h-4 w-4" />
            Add project
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/org/${org.id}/settings/members`}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite member
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.75fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
              <CardDescription>
                Active workstreams, file coverage, and task completion.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {projects.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {projects.map((project) => {
                    const projectFiles = files.filter((file) => file.projectId === project.id)
                    const tasks = getProjectTasks(project, files)

                    return (
                      <Link
                        key={project.id}
                        href={`/org/${org.id}/projects/${project.id}`}
                        className="rounded-[24px] border border-border/70 bg-white/80 p-5 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-lg font-semibold text-slate-950">
                              {project.name}
                            </p>
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                              {project.description || "No description added yet."}
                            </p>
                          </div>
                          <Badge variant={project.status === "complete" ? "success" : "secondary"}>
                            {project.status}
                          </Badge>
                        </div>
                        <div className="mt-5 grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-slate-500">Files</p>
                            <p className="text-2xl font-semibold text-slate-950">
                              {projectFiles.length}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Tasks</p>
                            <p className="text-2xl font-semibold text-slate-950">
                              {taskCompletionPct(tasks)}%
                            </p>
                          </div>
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

          <RagNotesFeed orgId={org.id} clientEmail={user.email ?? ""} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Uploads and workspace changes across this org.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.length > 0 ? (
              <div className="space-y-4">
                {recentActivity.map((activity) => (
                  <div key={activity.id} className="rounded-2xl border border-border/70 bg-white/80 p-4">
                    <p className="text-sm font-medium text-slate-900">{activity.text}</p>
                    {activity.time ? (
                      <p className="mt-1 text-xs text-slate-500">{activity.time}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">
                Activity will appear after files are added.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </OrgShell>
  )
}
