"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  CheckCircle2,
  CreditCard,
  Loader2,
  LockKeyhole,
  LogOut,
  MessageSquare,
  Server,
  UnlockKeyhole,
  Wallet,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { ProjectStatusBadge } from "@/components/admin/project-status-badge"
import { RagNotesFeed } from "@/components/rag-notes-feed"
import { ClientPagesPanel } from "@/components/client-pages-panel"
import { AppShell } from "@/components/site/app-shell"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { findClientPortalProjectByIdAndEmail } from "@/lib/client-portal"
import { type BeamProject } from "@/lib/beam"
import { signOut } from "@/lib/firebase/auth"
import { getDb } from "@/lib/firebase/config"
import {
  computeValueProfileProgress,
  uniqueStrings,
  type ValueProfileResponse,
} from "@/lib/value-profile"

type FeedbackCategory = "design" | "content" | "functionality" | "other"
type FeedbackUrgency = "low" | "medium" | "high"

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

export default function ClientPortalPage() {
  const params = useParams<{ clientId: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [project, setProject] = useState<BeamProject | null>(null)
  const [valueData, setValueData] = useState<ValueProfileResponse | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [valueLoading, setValueLoading] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [valueError, setValueError] = useState<string | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [summary, setSummary] = useState("")
  const [category, setCategory] = useState<FeedbackCategory>("design")
  const [urgency, setUrgency] = useState<FeedbackUrgency>("medium")

  const clientId = typeof params?.clientId === "string" ? params.clientId : ""

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }
    if (!clientId) { router.replace("/dashboard"); return }

    let cancelled = false

    const loadPortal = async () => {
      try {
        const portalProject = await findClientPortalProjectByIdAndEmail({
          firestoreDb: getDb(),
          clientId,
          email: user.email,
        })

        if (!portalProject) { router.replace("/dashboard"); return }
        if (!cancelled) setProject(portalProject)
      } catch (error) {
        console.error("Unable to load client portal:", error)
        if (!cancelled) router.replace("/dashboard")
      } finally {
        if (!cancelled) setPageLoading(false)
      }
    }

    void loadPortal()
    return () => { cancelled = true }
  }, [authLoading, clientId, router, user])

  useEffect(() => {
    if (!project || !user || !clientId) return

    let cancelled = false

    const loadValueProfile = async () => {
      setValueLoading(true)
      setValueError(null)

      try {
        const token = await user.getIdToken()
        const response = await fetch(`/api/value-profile/${encodeURIComponent(clientId)}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        })
        const payload = (await response.json()) as ValueProfileResponse | { error?: string }

        if (!response.ok || !("success" in payload) || payload.success !== true) {
          throw new Error("error" in payload && payload.error ? payload.error : "Unable to load value profile.")
        }

        if (!cancelled) setValueData(payload)
      } catch (error) {
        console.error("Unable to load value profile:", error)
        if (!cancelled) {
          setValueError(error instanceof Error ? error.message : "Unable to load value profile.")
        }
      } finally {
        if (!cancelled) setValueLoading(false)
      }
    }

    void loadValueProfile()
    return () => { cancelled = true }
  }, [clientId, project, user])

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
      if (!response.ok) throw new Error(payload.error || "Unable to submit feedback.")

      setSummary("")
      setCategory("design")
      setUrgency("medium")
      setSubmitMessage("Feedback sent to the Readyaimgo team.")
    } catch (error) {
      console.error("Unable to submit feedback:", error)
      setSubmitError(error instanceof Error ? error.message : "Unable to submit feedback.")
    } finally {
      setSubmitLoading(false)
    }
  }

  const handleStartPayment = async () => {
    if (!user || !clientId) return

    const amount = Number(paymentAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Enter a payment amount.")
      return
    }

    setPaymentLoading(true)
    setPaymentError(null)

    try {
      const token = await user.getIdToken()
      const response = await fetch("/api/stripe/value-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId,
          amount,
        }),
      })
      const payload = (await response.json()) as { url?: string; error?: string }

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Unable to start payment.")
      }

      window.location.assign(payload.url)
    } catch (error) {
      console.error("Unable to start payment:", error)
      setPaymentError(error instanceof Error ? error.message : "Unable to start payment.")
      setPaymentLoading(false)
    }
  }

  if (authLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !project) return null

  const valueProgress = valueData ? computeValueProfileProgress(valueData.profile) : null
  const allDeliverables = uniqueStrings([
    ...project.deliverables,
    ...(valueData?.profile.thresholds.flatMap((threshold) => threshold.deliverables) ?? []),
  ])
  const unlockedSet = new Set(valueProgress?.unlockedDeliverables ?? [])
  const unlockedDeliverables = allDeliverables.filter((deliverable) => unlockedSet.has(deliverable))
  const lockedDeliverables = allDeliverables.filter((deliverable) => !unlockedSet.has(deliverable))
  const currentTier = valueProgress?.currentThreshold?.label ?? "Baseline"

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
      <div className="space-y-6">
        {valueError ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {valueError}
          </div>
        ) : null}

        <Tabs defaultValue="infrastructure" className="space-y-5">
          <TabsList className="grid w-full grid-cols-3 rounded-[26px]">
            <TabsTrigger value="infrastructure" className="gap-2">
              <Server className="h-4 w-4" />
              Infrastructure
            </TabsTrigger>
            <TabsTrigger value="investment" className="gap-2">
              <Wallet className="h-4 w-4" />
              Investment
            </TabsTrigger>
            <TabsTrigger value="deliverables" className="gap-2">
              <UnlockKeyhole className="h-4 w-4" />
              Deliverables
            </TabsTrigger>
          </TabsList>

          <TabsContent value="infrastructure" className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border border-border/70 bg-white/90">
                <CardHeader>
                  <CardDescription>Monthly infrastructure</CardDescription>
                  <CardTitle>
                    {formatCurrency(valueData?.infrastructureMonthlyTotal ?? 0)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card className="border border-border/70 bg-white/90">
                <CardHeader>
                  <CardDescription>Attributed services</CardDescription>
                  <CardTitle>{valueData?.infrastructureCosts.length ?? 0}</CardTitle>
                </CardHeader>
              </Card>
              <Card className="border border-border/70 bg-white/90">
                <CardHeader>
                  <CardDescription>Current tier</CardDescription>
                  <CardTitle>{currentTier}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card className="border border-border/70 bg-white/90">
              <CardHeader>
                <CardTitle>Live Cost Breakdown</CardTitle>
                <CardDescription>
                  Infrastructure services currently attributed to this client.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {valueLoading ? (
                  <div className="flex items-center gap-2 rounded-[24px] border border-dashed border-border/80 bg-muted/35 px-5 py-10 text-sm text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading costs...
                  </div>
                ) : valueData && valueData.infrastructureCosts.length > 0 ? (
                  <div className="space-y-3">
                    {valueData.infrastructureCosts.map((item) => (
                      <div
                        key={item.serviceId}
                        className="grid gap-3 rounded-[20px] border border-border/70 bg-white/85 px-4 py-3 sm:grid-cols-[1fr_auto]"
                      >
                        <div>
                          <p className="font-semibold text-slate-950">{item.name}</p>
                          <p className="text-sm text-slate-600">
                            {item.vendor} · {item.category}
                          </p>
                        </div>
                        <div className="sm:text-right">
                          <p className="font-semibold text-slate-950">
                            {formatCurrency(item.attributedMonthlyCost)}
                          </p>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                            {item.attribution}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-dashed border-border/80 bg-muted/35 px-5 py-10 text-center text-sm text-slate-600">
                    No infrastructure costs are attributed yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="investment" className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
              <Card className="border border-border/70 bg-white/90">
                <CardHeader>
                  <CardTitle>Investment</CardTitle>
                  <CardDescription>Payment total and next unlock state.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-[24px] border border-border/70 bg-white/85 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                      Total paid
                    </p>
                    <p className="mt-2 text-4xl font-semibold text-slate-950">
                      {formatCurrency(valueData?.profile.totalPaid ?? 0)}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Badge variant="accent">{currentTier}</Badge>
                      {valueProgress?.nextThreshold ? (
                        <Badge variant="warning">
                          {formatCurrency(valueProgress.amountToNext)} to next
                        </Badge>
                      ) : (
                        <Badge variant="secondary">All configured tiers open</Badge>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Payment amount
                    </label>
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={paymentAmount}
                        onChange={(event) => setPaymentAmount(event.target.value)}
                        placeholder="Any amount"
                      />
                      <Button onClick={handleStartPayment} disabled={paymentLoading}>
                        {paymentLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Opening...
                          </>
                        ) : (
                          <>
                            <CreditCard className="mr-2 h-4 w-4" />
                            Pay
                          </>
                        )}
                      </Button>
                    </div>
                    {paymentError ? (
                      <p className="text-sm text-rose-600">{paymentError}</p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-border/70 bg-white/90">
                <CardHeader>
                  <CardTitle>Next Threshold</CardTitle>
                  <CardDescription>
                    Deliverables preview for the next payment tier.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {valueProgress?.nextThreshold ? (
                    <div className="space-y-4">
                      <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4">
                        <p className="text-sm font-semibold text-amber-900">
                          {valueProgress.nextThreshold.label}
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-amber-950">
                          {formatCurrency(valueProgress.nextThreshold.amount)}
                        </p>
                      </div>
                      <div className="space-y-2">
                        {valueProgress.nextDeliverables.length > 0 ? (
                          valueProgress.nextDeliverables.map((deliverable) => (
                            <div
                              key={deliverable}
                              className="flex items-center gap-3 rounded-[18px] border border-border/70 bg-white/85 px-4 py-3 text-sm font-medium text-slate-800"
                            >
                              <LockKeyhole className="h-4 w-4 text-amber-500" />
                              {deliverable}
                            </div>
                          ))
                        ) : (
                          <p className="rounded-[20px] border border-dashed border-border/80 bg-muted/35 px-4 py-6 text-sm text-slate-600">
                            No deliverables attached to the next threshold.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-10 text-center text-sm text-emerald-700">
                      All configured thresholds are unlocked.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="deliverables" className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="border border-border/70 bg-white/90">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UnlockKeyhole className="h-5 w-5 text-emerald-600" />
                    Unlocked
                  </CardTitle>
                  <CardDescription>
                    Available at the current payment tier.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {unlockedDeliverables.length > 0 ? (
                    <div className="space-y-3">
                      {unlockedDeliverables.map((deliverable) => (
                        <div
                          key={deliverable}
                          className="flex items-center justify-between gap-4 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3"
                        >
                          <span className="text-sm font-medium text-emerald-950">
                            {deliverable}
                          </span>
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-border/80 bg-muted/35 px-5 py-10 text-center text-sm text-slate-600">
                      No deliverables unlocked yet.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border border-border/70 bg-white/90">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <LockKeyhole className="h-5 w-5 text-amber-600" />
                    Locked
                  </CardTitle>
                  <CardDescription>
                    Opens as the payment tier advances.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {lockedDeliverables.length > 0 ? (
                    <div className="space-y-3">
                      {lockedDeliverables.map((deliverable) => (
                        <div
                          key={deliverable}
                          className="flex items-center justify-between gap-4 rounded-[20px] border border-border/70 bg-white/80 px-4 py-3"
                        >
                          <span className="text-sm font-medium text-slate-900">
                            {deliverable}
                          </span>
                          <Badge variant="warning">Locked</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-border/80 bg-muted/35 px-5 py-10 text-center text-sm text-slate-600">
                      No locked deliverables remain.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <ClientPagesPanel clientId={clientId} />
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
      </div>
    </AppShell>
  )
}
