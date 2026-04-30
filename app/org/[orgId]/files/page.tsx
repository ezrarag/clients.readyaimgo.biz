"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore"
import { Cloud, Loader2 } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { OrgFileCard } from "@/components/org/org-file-card"
import { OrgFileUpload } from "@/components/org/org-file-upload"
import { OrgShell } from "@/components/org/org-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getDb } from "@/lib/firebase/config"
import {
  listOrgMembers,
  listOrgProjects,
  loadOrgAccessContext,
} from "@/lib/org-client"
import {
  generateReadableId,
  isOrgAdmin,
  normalizeOrgFile,
  type Organization,
  type OrgFile,
  type OrgMember,
  type OrgProject,
} from "@/lib/organizations"

interface OrgFilesPageProps {
  params: {
    orgId: string
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

function isDriveUrl(value: string) {
  try {
    const url = new URL(value)
    return url.hostname.includes("drive.google.com") || url.hostname.includes("docs.google.com")
  } catch {
    return false
  }
}

function inferDriveName(value: string) {
  try {
    const url = new URL(value)
    const pathParts = url.pathname.split("/").filter(Boolean)
    const lastPart = pathParts[pathParts.length - 1]
    return lastPart && lastPart !== "view" ? lastPart : "Google Drive file"
  } catch {
    return "Google Drive file"
  }
}

export default function OrgFilesPage({ params }: OrgFilesPageProps) {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [org, setOrg] = useState<Organization | null>(null)
  const [member, setMember] = useState<OrgMember | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [projects, setProjects] = useState<OrgProject[]>([])
  const [files, setFiles] = useState<OrgFile[]>([])
  const [loading, setLoading] = useState(true)
  const [savingDrive, setSavingDrive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [driveUrl, setDriveUrl] = useState("")
  const [driveName, setDriveName] = useState("")
  const [driveProjectId, setDriveProjectId] = useState("none")

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
      return
    }

    if (authLoading || !user) {
      return
    }

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

        const [nextMembers, nextProjects] = await Promise.all([
          listOrgMembers(firestoreDb, params.orgId),
          listOrgProjects(firestoreDb, params.orgId),
        ])

        if (cancelled) {
          return
        }

        setOrg(access.org)
        setMember(access.member)
        setMembers(nextMembers)
        setProjects(nextProjects)

        unsubscribeFiles = onSnapshot(
          query(
            collection(firestoreDb, "organizations", params.orgId, "files"),
            orderBy("uploadedAt", "desc")
          ),
          (snapshot) => {
            setFiles(
              snapshot.docs.map((fileDoc) =>
                normalizeOrgFile(fileDoc.id, asRecord(fileDoc.data()))
              )
            )
            setLoading(false)
          },
          (snapshotError) => {
            console.error(snapshotError)
            setError("Unable to stream organization files.")
            setLoading(false)
          }
        )
      } catch (loadError) {
        console.error(loadError)
        if (!cancelled) {
          setError("Unable to load organization files.")
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      unsubscribeFiles?.()
    }
  }, [authLoading, params.orgId, router, user])

  const handleDriveImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!org || !user) {
      return
    }

    if (!isDriveUrl(driveUrl.trim())) {
      setError("Paste a valid Google Drive share link.")
      return
    }

    setSavingDrive(true)
    setError(null)

    try {
      const firestoreDb = getDb()
      const fileId = generateReadableId("file")

      await setDoc(doc(firestoreDb, "organizations", org.id, "files", fileId), {
        id: fileId,
        projectId: driveProjectId === "none" ? null : driveProjectId,
        name: driveName.trim() || inferDriveName(driveUrl),
        type: "google_drive",
        url: driveUrl.trim(),
        mimeType: "application/vnd.google-apps.file",
        size: null,
        storagePath: null,
        uploadedByUid: user.uid,
        uploadedAt: serverTimestamp(),
        extractedTasks: [],
        taskExtractionStatus: null,
      })
      await updateDoc(doc(firestoreDb, "organizations", org.id), {
        lastActivityAt: serverTimestamp(),
      })

      setDriveUrl("")
      setDriveName("")
      setDriveProjectId("none")
    } catch (driveError) {
      console.error(driveError)
      setError("Unable to import Google Drive link.")
    } finally {
      setSavingDrive(false)
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
      active="files"
      title="Files"
      description="Shared source material, briefs, links, and uploads across this workspace."
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            File summary
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500">Files</p>
              <p className="text-2xl font-semibold text-slate-950">{files.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Projects</p>
              <p className="text-2xl font-semibold text-slate-950">{projects.length}</p>
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

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.35fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Upload File</CardTitle>
              <CardDescription>
                Add a document, spreadsheet, image, or text file to this organization.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OrgFileUpload orgId={org.id} userUid={user.uid} projects={projects} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Import Drive Link</CardTitle>
              <CardDescription>Attach a shared Google Drive file to the workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDriveImport} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Drive link</label>
                  <Input
                    value={driveUrl}
                    onChange={(event) => setDriveUrl(event.target.value)}
                    placeholder="https://drive.google.com/..."
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Display name</label>
                  <Input
                    value={driveName}
                    onChange={(event) => setDriveName(event.target.value)}
                    placeholder="App Design Brief"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Project</label>
                  <select
                    value={driveProjectId}
                    onChange={(event) => setDriveProjectId(event.target.value)}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="none">General files</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" disabled={savingDrive}>
                  {savingDrive ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Cloud className="mr-2 h-4 w-4" />
                  )}
                  Import Drive Link
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Files</CardTitle>
            <CardDescription>{files.length} files available to this organization.</CardDescription>
          </CardHeader>
          <CardContent>
            {files.length > 0 ? (
              <div className="space-y-4">
                {files.map((file) => (
                  <OrgFileCard
                    key={file.id}
                    orgId={org.id}
                    file={file}
                    members={members}
                    projects={projects}
                    canEdit={isOrgAdmin(member)}
                  />
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">
                No files have been added yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </OrgShell>
  )
}
