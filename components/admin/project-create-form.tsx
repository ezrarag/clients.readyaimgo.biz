"use client"

import { useMemo, useState } from "react"
import type { User } from "firebase/auth"
import { Loader2, Plus } from "lucide-react"

import type { ProjectSourceNgo, ProjectStatus } from "@/lib/beam"
import {
  PROJECT_SOURCE_NGOS,
  slugifyClientId,
  normalizeProjectSourceNgo,
} from "@/lib/beam"
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

const PROJECT_STATUSES: ProjectStatus[] = ["scoping", "active", "review", "complete"]

function parseRevenue(value: string, fieldName: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative number.`)
  }

  return parsed
}

function parseRevenueShare(value: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("participantRevenueShare must be between 0 and 1.")
  }

  return parsed
}

export function ProjectCreateForm({
  currentUser,
  defaultSourceNgo,
  onCreated,
}: {
  currentUser: User
  defaultSourceNgo?: string | null
  onCreated: (projectId: string) => void
}) {
  const [clientName, setClientName] = useState("")
  const [sourceNgo, setSourceNgo] = useState<ProjectSourceNgo>(
    normalizeProjectSourceNgo(defaultSourceNgo) || "forge"
  )
  const [ragRevenue, setRagRevenue] = useState("")
  const [participantRevenueShare, setParticipantRevenueShare] = useState("0.25")
  const [status, setStatus] = useState<ProjectStatus>("scoping")
  const [clientPortalEmail, setClientPortalEmail] = useState("")
  const [beamBookEntry, setBeamBookEntry] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clientId = useMemo(() => slugifyClientId(clientName), [clientName])

  const resetForm = () => {
    setClientName("")
    setSourceNgo(normalizeProjectSourceNgo(defaultSourceNgo) || "forge")
    setRagRevenue("")
    setParticipantRevenueShare("0.25")
    setStatus("scoping")
    setClientPortalEmail("")
    setBeamBookEntry(false)
  }

  const handleCreate = async () => {
    setError(null)
    setCreating(true)

    try {
      if (!clientName.trim()) {
        throw new Error("clientName is required.")
      }

      if (!clientId) {
        throw new Error("clientName must produce a valid clientId.")
      }

      if (!clientPortalEmail.trim()) {
        throw new Error("clientPortalEmail is required.")
      }

      const token = await currentUser.getIdToken()
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientName: clientName.trim(),
          clientId,
          ragProjectLead: currentUser.uid,
          beamParticipantLead: currentUser.uid,
          sourceNgo,
          ragRevenue: parseRevenue(ragRevenue, "ragRevenue"),
          participantRevenueShare: parseRevenueShare(participantRevenueShare),
          status,
          clientPortalEmail: clientPortalEmail.trim().toLowerCase(),
          beamBookEntry,
          sourceBusiness: "readyaimgo",
          cohort: [],
          deliverables: [],
          expansionPlan: {},
        }),
      })
      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean
            project?: { id?: string }
            error?: string
          }
        | null

      if (!response.ok || payload?.success !== true || !payload.project?.id) {
        throw new Error(payload?.error || "Unable to create project.")
      }

      resetForm()
      onCreated(payload.project.id)
    } catch (createError) {
      console.error("Unable to create project:", createError)
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create project."
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card className="border border-border/70 bg-white/90">
      <CardHeader>
        <CardTitle>Create project</CardTitle>
        <CardDescription>
          New project records are written to the Firestore `projects` collection and redirect to
          the project detail page after save.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Client name</label>
            <Input
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              placeholder="MKE Black"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Client ID</label>
            <div className="rounded-[20px] border border-border/70 bg-muted/35 px-4 py-3 text-sm text-slate-700">
              {clientId || "auto-generated from client name"}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">RAG project lead</label>
            <div className="rounded-[20px] border border-border/70 bg-muted/35 px-4 py-3 text-sm text-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent">Auto-set</Badge>
                <span>{currentUser.displayName || currentUser.email || currentUser.uid}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{currentUser.uid}</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Client portal email</label>
            <Input
              type="email"
              value={clientPortalEmail}
              onChange={(event) => setClientPortalEmail(event.target.value)}
              placeholder="team@mkeblack.org"
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Source NGO</label>
            <Select value={sourceNgo} onValueChange={(value) => setSourceNgo(value as ProjectSourceNgo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_SOURCE_NGOS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">RAG revenue</label>
            <Input
              inputMode="decimal"
              value={ragRevenue}
              onChange={(event) => setRagRevenue(event.target.value)}
              placeholder="15000"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">
              Participant revenue share
            </label>
            <Input
              inputMode="decimal"
              max="1"
              min="0"
              step="0.01"
              value={participantRevenueShare}
              onChange={(event) => setParticipantRevenueShare(event.target.value)}
              placeholder="0.25"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Status</label>
            <Select value={status} onValueChange={(value) => setStatus(value as ProjectStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((projectStatus) => (
                  <SelectItem key={projectStatus} value={projectStatus}>
                    {projectStatus}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Source business</label>
            <div className="rounded-[20px] border border-border/70 bg-muted/35 px-4 py-3 text-sm text-slate-700">
              readyaimgo
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-[20px] border border-border/70 bg-white/80 px-4 py-3 text-sm text-slate-700">
            <input
              checked={beamBookEntry}
              className="h-4 w-4 rounded border-slate-300"
              onChange={(event) => setBeamBookEntry(event.target.checked)}
              type="checkbox"
            />
            Create with `beamBookEntry`
          </label>
        </div>

        <Button onClick={handleCreate} disabled={creating}>
          {creating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving project...
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Save project
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
