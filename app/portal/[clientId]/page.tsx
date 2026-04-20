"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Loader2, LogOut, MessageSquare } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { ProjectStatusBadge } from "@/components/admin/project-status-badge"
import { RagNotesFeed } from "@/components/rag-notes-feed"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { findClientPortalProjectByIdAndEmail } from "@/lib/client-portal"
import { type BeamProject } from "@/lib/beam"
import { signOut } from "@/lib/firebase/auth"
import { getDb } from "@/lib/firebase/config"

type FeedbackCategory = "design" | "content" | "functionality" | "other"
type FeedbackUrgency = "low" | "medium" | "high"

export default function ClientPortalPage() {
  const params = useParams<{ clientId: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [project, setProject] = useState<BeamProject | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [summary, setSummary] = useState("")
  const [category, setCategory] = useState<FeedbackCategory>("design")
  const [urgency, setUrgency] = useState<FeedbackUrgency>("medium")

  const clientId = typeof params?.clientId === "string" ? params.clientId : ""

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!user) {
      router.push("/login")
      return
    }

    if (!clientId) {
      router.replace("/dashboard")
      return
    }

    let cancelled = false

    const loadPortal = async () => {
      try {
        const portalProject = await findClientPortalProjectByIdAndEmail({
          firestoreDb: getDb(),
          clientId,
          email: user.email,
        })

        if (!portalProject) {
          router.replace("/dashboard")
          return
        }

        if (!cancelled) {
          setProject(portalProject)
        }
      } catch (error) {
        console.error("Unable to load client portal:", error)
        if (!cancelled) {
          router.replace("/dashboard")
        }
      } finally {
        if (!cancelled) {
          setPageLoading(false)
        }
      }
    }

    void loadPortal()

    return () => {
      cancelled = true
    }
  }, [authLoading, clientId, router, user])

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  const handleSubmitFeedback = async () => {
    if (!project || !user?.email || !summary.trim()) {
      setSubmitError("Add a feedback summary before submitting.")
      return
    }

    setSubmitLoading(true)
    setSubmitError(null)
    setSubmitMessage(null)

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.clientId,
          clientEmail: user.email,
          clientName: user.displayName || user.email,
          summary: summary.trim(),
          category,
          urgency,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Unable to submit feedback.")
      }

      setSummary("")
      setCategory("design")
      setUrgency("medium")
      setSubmitMessage("Feedback sent to the Readyaimgo team.")
    } catch (error) {
      console.error("Unable to submit feedback:", error)
      setSubmitError(
        error instanceof Error ? error.message : "Unable to submit feedback."
      )
    } finally {
      setSubmitLoading(false)
    }
  }

  if (authLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !project) {
    return null
  }

  return (
    <AppShell
      title={project.clientName}
      description="Client portal view for project updates, deliverables, and direct feedback."
      eyebrow="Client portal"
      nav={[{ href: `/portal/${project.clientId}`, label: "Portal", active: true }]}
      actions={
        <>
          <Badge variant="secondary">{user.email}</Badge>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </>
      }
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Project state
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ProjectStatusBadge status={project.status} />
            <Badge variant="accent">{project.sourceNgo}</Badge>
          </div>
        </div>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <Card className="border border-border/70 bg-white/90">
            <CardHeader>
              <CardTitle>Deliverables</CardTitle>
              <CardDescription>
                Current deliverables for this project. These are view-only in the client portal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {project.deliverables.length > 0 ? (
                <div className="space-y-3">
                  {project.deliverables.map((deliverable) => (
                    <div
                      key={deliverable}
                      className="flex items-center justify-between gap-4 rounded-[20px] border border-border/70 bg-white/80 px-4 py-3"
                    >
                      <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
                        <input
                          type="checkbox"
                          checked={false}
                          disabled
                          className="h-4 w-4 rounded border-slate-300"
                          readOnly
                        />
                        <span>{deliverable}</span>
                      </label>
                      <Badge variant="warning">Pending</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[24px] border border-dashed border-border/80 bg-muted/35 px-5 py-10 text-center text-sm text-slate-600">
                  No deliverables have been attached yet.
                </div>
              )}
            </CardContent>
          </Card>

          <RagNotesFeed clientEmail={user.email ?? ""} />
        </div>

        <Card className="border border-border/70 bg-white/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Send feedback
            </CardTitle>
            <CardDescription>
              Share design, content, or functionality feedback directly with the project team.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {submitMessage ? (
              <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {submitMessage}
              </div>
            ) : null}

            {submitError ? (
              <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {submitError}
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Summary</label>
              <Textarea
                rows={6}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="Tell the team what you want changed or reviewed."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Category</label>
                <Select
                  value={category}
                  onValueChange={(value) => setCategory(value as FeedbackCategory)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="design">Design</SelectItem>
                    <SelectItem value="content">Content</SelectItem>
                    <SelectItem value="functionality">Functionality</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Urgency</label>
                <Select
                  value={urgency}
                  onValueChange={(value) => setUrgency(value as FeedbackUrgency)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button onClick={handleSubmitFeedback} disabled={submitLoading}>
              {submitLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending feedback...
                </>
              ) : (
                "Submit feedback"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
