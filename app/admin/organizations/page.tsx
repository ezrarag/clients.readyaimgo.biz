"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore"
import { format } from "date-fns"
import { Loader2, LogOut, MessageSquare, RefreshCw } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { signOut } from "@/lib/firebase/auth"
import { getDb } from "@/lib/firebase/config"
import {
  normalizeOrganization,
  normalizeOrgFile,
  normalizeOrgMember,
  normalizeOrgProject,
  serializeTimestamp,
  type Organization,
  type OrgFile,
  type OrgMember,
  type OrgPlan,
  type OrgProject,
} from "@/lib/organizations"

interface AdminOrgRow {
  org: Organization
  members: OrgMember[]
  projects: OrgProject[]
  files: OrgFile[]
  lastActivityAt: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

function formatOptionalDate(value: string | null) {
  if (!value) {
    return "N/A"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "N/A"
  }

  return format(date, "MMM d, yyyy h:mm a")
}

export default function AdminOrganizationsPage() {
  const router = useRouter()
  const { user, effectiveRoles, loading: authLoading } = useAuth()
  const [orgRows, setOrgRows] = useState<AdminOrgRow[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingPlan, setSavingPlan] = useState(false)
  const [sendingNote, setSendingNote] = useState(false)
  const [noteSubject, setNoteSubject] = useState("")
  const [noteBody, setNoteBody] = useState("")
  const [noteType, setNoteType] = useState<"note" | "pulse" | "update">("note")
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const isBeamAdmin = effectiveRoles.includes("beam-admin")

  const selectedRow = useMemo(
    () => orgRows.find((row) => row.org.id === selectedOrgId) ?? orgRows[0] ?? null,
    [orgRows, selectedOrgId]
  )

  const loadOrganizations = async () => {
    setLoading(true)
    setStatusMessage(null)

    try {
      const firestoreDb = getDb()
      const orgSnapshot = await getDocs(
        query(collection(firestoreDb, "organizations"), orderBy("createdAt", "desc"))
      )

      const rows = await Promise.all(
        orgSnapshot.docs.map(async (orgDoc) => {
          const data = asRecord(orgDoc.data())
          const [membersSnapshot, projectsSnapshot, filesSnapshot] = await Promise.all([
            getDocs(collection(firestoreDb, "organizations", orgDoc.id, "members")),
            getDocs(collection(firestoreDb, "organizations", orgDoc.id, "projects")),
            getDocs(collection(firestoreDb, "organizations", orgDoc.id, "files")),
          ])

          return {
            org: normalizeOrganization(orgDoc.id, data),
            members: membersSnapshot.docs.map((memberDoc) =>
              normalizeOrgMember(memberDoc.id, asRecord(memberDoc.data()))
            ),
            projects: projectsSnapshot.docs.map((projectDoc) =>
              normalizeOrgProject(projectDoc.id, asRecord(projectDoc.data()))
            ),
            files: filesSnapshot.docs.map((fileDoc) =>
              normalizeOrgFile(fileDoc.id, asRecord(fileDoc.data()))
            ),
            lastActivityAt: serializeTimestamp(data.lastActivityAt),
          }
        })
      )

      setOrgRows(rows)
      setSelectedOrgId((current) => current ?? rows[0]?.org.id ?? null)
    } catch (loadError) {
      console.error("Error loading organizations:", loadError)
      setOrgRows([])
      setStatusMessage("Unable to load organizations.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
      return
    }

    if (user && !isBeamAdmin) {
      router.push("/dashboard")
      return
    }

    if (user && isBeamAdmin) {
      void loadOrganizations()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isBeamAdmin, router, user])

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  const handlePlanChange = async (plan: OrgPlan) => {
    if (!selectedRow) {
      return
    }

    setSavingPlan(true)
    setStatusMessage(null)

    try {
      await updateDoc(doc(getDb(), "organizations", selectedRow.org.id), { plan })
      setStatusMessage(`Moved ${selectedRow.org.name} to ${plan}.`)
      await loadOrganizations()
    } catch (planError) {
      console.error(planError)
      setStatusMessage("Unable to update organization plan.")
    } finally {
      setSavingPlan(false)
    }
  }

  const handleAddNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedRow || !noteSubject.trim() || !noteBody.trim()) {
      return
    }

    setSendingNote(true)
    setStatusMessage(null)

    try {
      const response = await fetch("/api/rag-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: selectedRow.org.id,
          subject: noteSubject,
          body: noteBody,
          type: noteType,
          authorName: user?.displayName || "Readyaimgo Team",
          authorEmail: user?.email || "",
        }),
      })
      const payload: unknown = await response.json()

      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Unable to add RAG note."
        throw new Error(message)
      }

      setNoteSubject("")
      setNoteBody("")
      setNoteType("note")
      setStatusMessage(`Added a RAG note for ${selectedRow.org.name}.`)
      await loadOrganizations()
    } catch (noteError) {
      console.error(noteError)
      setStatusMessage(noteError instanceof Error ? noteError.message : "Unable to add RAG note.")
    } finally {
      setSendingNote(false)
    }
  }

  if (authLoading || loading) {
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
      title="Organizations"
      description="Read-only oversight for client organizations, membership, projects, files, and RAG notes."
      eyebrow="Operations"
      nav={[
        { href: "/admin", label: "Admin" },
        { href: "/admin/projects", label: "Projects" },
        { href: "/admin/organizations", label: "Organizations", active: true },
      ]}
      actions={
        <>
          <Badge variant="secondary">{orgRows.length} orgs</Badge>
          <Button variant="outline" onClick={() => void loadOrganizations()}>
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
            Org reporting
          </p>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-slate-500">Members</p>
              <p className="text-2xl font-semibold text-slate-950">
                {orgRows.reduce((sum, row) => sum + row.members.length, 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Projects</p>
              <p className="text-2xl font-semibold text-slate-950">
                {orgRows.reduce((sum, row) => sum + row.projects.length, 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Files</p>
              <p className="text-2xl font-semibold text-slate-950">
                {orgRows.reduce((sum, row) => sum + row.files.length, 0)}
              </p>
            </div>
          </div>
        </div>
      }
    >
      {statusMessage ? (
        <div className="mb-6 rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          {statusMessage}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Organization Directory</CardTitle>
            <CardDescription>
              {orgRows.length} client organizations currently visible.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {orgRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-[860px] w-full text-left text-sm">
                  <thead className="border-b border-border/70 text-xs uppercase tracking-[0.24em] text-slate-500">
                    <tr>
                      <th className="px-2 py-3 font-semibold">Name</th>
                      <th className="px-2 py-3 font-semibold">Plan</th>
                      <th className="px-2 py-3 text-right font-semibold">Members</th>
                      <th className="px-2 py-3 text-right font-semibold">Projects</th>
                      <th className="px-2 py-3 font-semibold">Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgRows.map((row) => (
                      <tr
                        key={row.org.id}
                        className={`cursor-pointer border-b border-border/50 last:border-none ${
                          selectedRow?.org.id === row.org.id ? "bg-primary/5" : ""
                        }`}
                        onClick={() => setSelectedOrgId(row.org.id)}
                      >
                        <td className="px-2 py-4">
                          <p className="font-semibold text-slate-950">{row.org.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{row.org.slug}</p>
                        </td>
                        <td className="px-2 py-4">
                          <Badge variant="accent">{row.org.plan}</Badge>
                        </td>
                        <td className="px-2 py-4 text-right font-semibold text-slate-950">
                          {row.members.length}
                        </td>
                        <td className="px-2 py-4 text-right font-semibold text-slate-950">
                          {row.projects.length}
                        </td>
                        <td className="px-2 py-4 text-slate-600">
                          {formatOptionalDate(row.lastActivityAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">
                No organizations have been created yet.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Workspace Overlay</CardTitle>
              <CardDescription>
                Read-only summary for the selected organization.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedRow ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-2xl font-semibold text-slate-950">{selectedRow.org.name}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {selectedRow.org.city || "No city"} · {selectedRow.org.website || "No website"}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-border/70 bg-white/80 p-4">
                      <p className="text-xs text-slate-500">Members</p>
                      <p className="text-2xl font-semibold text-slate-950">{selectedRow.members.length}</p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-white/80 p-4">
                      <p className="text-xs text-slate-500">Projects</p>
                      <p className="text-2xl font-semibold text-slate-950">{selectedRow.projects.length}</p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-white/80 p-4">
                      <p className="text-xs text-slate-500">Files</p>
                      <p className="text-2xl font-semibold text-slate-950">{selectedRow.files.length}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Transfer plan</label>
                    <div className="flex gap-2">
                      {(["starter", "growth", "enterprise"] as OrgPlan[]).map((plan) => (
                        <Button
                          key={plan}
                          type="button"
                          variant={selectedRow.org.plan === plan ? "default" : "outline"}
                          size="sm"
                          disabled={savingPlan}
                          onClick={() => void handlePlanChange(plan)}
                        >
                          {plan}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-slate-700">Projects</p>
                    {selectedRow.projects.slice(0, 5).map((project) => (
                      <div key={project.id} className="rounded-2xl border border-border/70 bg-white/80 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-slate-950">{project.name}</p>
                          <Badge variant="secondary">{project.status}</Badge>
                        </div>
                      </div>
                    ))}
                    {selectedRow.projects.length === 0 ? (
                      <p className="text-sm text-slate-500">No projects yet.</p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-slate-500">
                  Select an organization to inspect it.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add RAG Note</CardTitle>
              <CardDescription>
                Notes appear inside the organization dashboard feed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddNote} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Type</label>
                  <select
                    value={noteType}
                    onChange={(event) => setNoteType(event.target.value as "note" | "pulse" | "update")}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="note">Team note</option>
                    <option value="pulse">Pulse summary</option>
                    <option value="update">Project update</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Subject</label>
                  <Input value={noteSubject} onChange={(event) => setNoteSubject(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Body</label>
                  <Textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} />
                </div>
                <Button type="submit" disabled={sendingNote || !selectedRow}>
                  {sendingNote ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <MessageSquare className="mr-2 h-4 w-4" />
                  )}
                  Add RAG Note
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
