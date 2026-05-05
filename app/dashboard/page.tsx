"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { format } from "date-fns"
import {
  AlertCircle,
  ArrowUp,
  Calendar,
  Coins,
  CreditCard,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldPlus,
  UserRound,
  Wallet,
} from "lucide-react"
import { collection, doc, getDoc, getDocs, orderBy, query, where } from "firebase/firestore"

import { useAuth } from "@/components/auth/AuthProvider"
import { RagNotesFeed } from "@/components/rag-notes-feed"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { hasAnyRole } from "@/lib/beam"
import { resolveClientDestination } from "@/lib/client-portal"
import { CLIENT_SERVICE_OPTIONS } from "@/lib/client-onboarding"
import { signOut } from "@/lib/firebase/auth"
import { getDb } from "@/lib/firebase/config"
import { Client, HousingWallet, Subscription, Transaction } from "@/types"

interface BeamTransaction {
  amount?: number
  description?: string
  timestamp?: string
  type: "earn" | "spend"
}

type StatusMessage =
  | {
      tone: "success" | "warning" | "danger"
      text: string
    }
  | null

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function DashboardPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user, effectiveRoles, loading: authLoading } = useAuth()

  const [client, setClient] = useState<Client | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [housingWallet, setHousingWallet] = useState<HousingWallet | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [beamCoinBalance, setBeamCoinBalance] = useState<number | null>(null)
  const [beamCoinTransactions, setBeamCoinTransactions] = useState<BeamTransaction[]>([])
  const [beamCoinLoading, setBeamCoinLoading] = useState(false)
  const [beamCoinError, setBeamCoinError] = useState<string | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [redeemOpen, setRedeemOpen] = useState(false)
  const [redeemAmount, setRedeemAmount] = useState("")
  const [redeeming, setRedeeming] = useState(false)
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null)

  const marketingSiteUrl = (
    process.env.NEXT_PUBLIC_MARKETING_SITE_URL || "https://readyaimgo.biz"
  ).replace(/\/$/, "")

  const isBeamAdmin = effectiveRoles.includes("beam-admin")
  const hasStaffWorkspace = hasAnyRole(effectiveRoles, [
    "beam-admin",
    "rag-lead",
    "ngo-coordinator",
    "client-manager",
  ])
  const viewAsParticipant =
    isBeamAdmin && searchParams.get("viewAs") === "participant"
  const viewerRoles = viewAsParticipant ? ["participant"] : effectiveRoles
  const showParticipantExperience = Boolean(client) && (!hasStaffWorkspace || viewAsParticipant)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
    }
  }, [authLoading, router, user])

  useEffect(() => {
    if (authLoading || !user?.email || hasStaffWorkspace || viewAsParticipant) {
      return
    }

    let cancelled = false

    const maybeRedirectToWorkspace = async () => {
      const destination = await resolveClientDestination(getDb(), user.email, user)
      if (!cancelled && destination !== "/dashboard") {
        router.replace(destination)
      }
    }

    void maybeRedirectToWorkspace()

    return () => {
      cancelled = true
    }
  }, [authLoading, hasStaffWorkspace, router, user, viewAsParticipant])

  useEffect(() => {
    if (user) {
      void loadDashboardData()
      return
    }

    setClient(null)
    setSubscription(null)
    setHousingWallet(null)
    setTransactions([])
    setBeamCoinBalance(null)
    setBeamCoinTransactions([])
    setPageLoading(false)
  }, [user])

  const loadDashboardData = async () => {
    if (!user?.email) {
      setClient(null)
      setPageLoading(false)
      return
    }

    try {
      setPageLoading(true)
      setBeamCoinError(null)

      const firestoreDb = getDb()
      const emailKey = user.email.toLowerCase().trim()
      const clientDoc = await getDoc(doc(firestoreDb, "clients", emailKey))

      if (!clientDoc.exists()) {
        setClient(null)
        setSubscription(null)
        setHousingWallet(null)
        setTransactions([])
        setBeamCoinBalance(null)
        setBeamCoinTransactions([])
        return
      }

      const docData = clientDoc.data()
      const clientData: Client = {
        uid: docData.uid || user.uid,
        name: docData.name || "",
        email: docData.email || user.email,
        beamCoinBalance: docData.beamCoinBalance || 0,
        housingWalletBalance: docData.housingWalletBalance || 0,
        stripeCustomerId: docData.stripeCustomerId,
        planType: docData.planType,
        companyName: docData.companyName || "",
        contactTitle: docData.contactTitle || "",
        phone: docData.phone || "",
        organizationType: docData.organizationType || "",
        serviceInterests: Array.isArray(docData.serviceInterests)
          ? docData.serviceInterests.filter((value: unknown): value is string => typeof value === "string")
          : [],
        onboardingNotes: docData.onboardingNotes || "",
        onboardingStatus: docData.onboardingStatus || "",
        onboardingSource: docData.onboardingSource || "",
        onboardingHandoffId: docData.onboardingHandoffId || "",
        claimedClientId: docData.claimedClientId || "",
        claimedStoryId: docData.claimedStoryId || "",
        claimedClientName: docData.claimedClientName || "",
        partnerTier: docData.partnerTier === "agency" ? "agency" : docData.partnerTier ?? null,
        partnerSince: docData.partnerSince?.toDate?.() || docData.partnerSince || null,
        partnerCommissionPct:
          typeof docData.partnerCommissionPct === "number"
            ? docData.partnerCommissionPct
            : undefined,
        partnerReferralCount:
          typeof docData.partnerReferralCount === "number"
            ? docData.partnerReferralCount
            : undefined,
        createdAt: docData.createdAt?.toDate?.() || docData.createdAt,
      }

      setClient(clientData)

      if (clientData.stripeCustomerId) {
        const subscriptionResponse = await fetch(
          `/api/stripe/subscription?customerId=${clientData.stripeCustomerId}`
        )

        if (subscriptionResponse.ok) {
          const subscriptionData = await subscriptionResponse.json()
          setSubscription(subscriptionData)
        } else {
          setSubscription(null)
        }
      } else {
        setSubscription(null)
      }

      const housingWalletResponse = await fetch(`/api/housing-wallet?clientId=${user.uid}`)
      if (housingWalletResponse.ok) {
        const housingWalletData = await housingWalletResponse.json()
        setHousingWallet(housingWalletData)
      } else {
        setHousingWallet(null)
      }

      const transactionsQuery = query(
        collection(firestoreDb, "transactions"),
        where("clientId", "==", user.uid),
        orderBy("timestamp", "desc")
      )

      const transactionsSnapshot = await getDocs(transactionsQuery)
      const transactionsData = transactionsSnapshot.docs.map((transactionDoc) => ({
        id: transactionDoc.id,
        ...transactionDoc.data(),
        timestamp:
          transactionDoc.data().timestamp?.toDate?.() || transactionDoc.data().timestamp,
      })) as Transaction[]

      setTransactions(transactionsData)
      await loadBeamCoinBalance(user.uid, clientData.beamCoinBalance || 0)
    } catch (error: any) {
      console.error("Error loading dashboard data:", error)

      if (error?.code === "unavailable" || error?.message?.includes("offline")) {
        setBeamCoinError(
          "Unable to connect to the database. Check your connection and try again."
        )
      } else if (error?.code === "permission-denied") {
        setBeamCoinError("Permission denied. Please contact support.")
      } else {
        setBeamCoinError(error?.message || "Failed to load dashboard data")
      }
    } finally {
      setPageLoading(false)
    }
  }

  const loadBeamCoinBalance = async (uid: string, fallbackBalance: number) => {
    setBeamCoinLoading(true)
    setBeamCoinError(null)

    try {
      const balanceResponse = await fetch(`/api/beam-coin?clientId=${uid}`)
      if (!balanceResponse.ok) {
        throw new Error("Failed to fetch BEAM Coin balance")
      }

      const balanceData = await balanceResponse.json()
      const nextBalance = balanceData.balance || 0
      setBeamCoinBalance(nextBalance)
      setClient((currentClient) =>
        currentClient ? { ...currentClient, beamCoinBalance: nextBalance } : currentClient
      )

      const transactionsResponse = await fetch(`/api/beam-coin/transactions?clientId=${uid}`)
      if (transactionsResponse.ok) {
        const nextTransactions = await transactionsResponse.json()
        setBeamCoinTransactions(
          Array.isArray(nextTransactions) ? nextTransactions.slice(0, 8) : []
        )
      }
    } catch (error) {
      console.error("Error loading BEAM Coin data:", error)
      setBeamCoinError("Ledger unavailable, showing cached balance.")
      setBeamCoinBalance(fallbackBalance)
    } finally {
      setBeamCoinLoading(false)
    }
  }

  const handleRefreshBeamCoin = () => {
    if (!user || !client) {
      return
    }

    void loadBeamCoinBalance(user.uid, client.beamCoinBalance || 0)
  }

  const handleToggleParticipantPreview = () => {
    const nextParams = new URLSearchParams(searchParams.toString())

    if (viewAsParticipant) {
      nextParams.delete("viewAs")
    } else {
      nextParams.set("viewAs", "participant")
    }

    const queryString = nextParams.toString()
    router.replace(queryString ? `/dashboard?${queryString}` : "/dashboard")
  }

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  const handleManageSubscription = async () => {
    if (!client?.stripeCustomerId) {
      return
    }

    try {
      const response = await fetch("/api/stripe/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: client.stripeCustomerId }),
      })

      const { url } = await response.json()
      if (url) {
        window.location.href = url
      }
    } catch (error) {
      console.error("Error creating portal session:", error)
      setStatusMessage({
        tone: "danger",
        text: "Unable to open the Stripe portal right now.",
      })
    }
  }

  const handleCheckout = async () => {
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: user?.uid,
          email: user?.email,
        }),
      })

      const { url } = await response.json()
      if (url) {
        window.location.href = url
        return
      }

      throw new Error("Missing checkout URL")
    } catch (error) {
      console.error("Error creating checkout session:", error)
      setStatusMessage({
        tone: "danger",
        text: "Unable to start checkout. Please try again.",
      })
    }
  }

  const handleRedeemCredits = async () => {
    if (!user || !redeemAmount) {
      return
    }

    const credits = Number.parseInt(redeemAmount, 10)
    if (!Number.isFinite(credits) || credits <= 0) {
      setStatusMessage({
        tone: "warning",
        text: "Enter a valid credit amount before submitting the redemption.",
      })
      return
    }

    setRedeeming(true)

    try {
      const response = await fetch("/api/housing-wallet-redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: user.uid,
          credits,
          description: `Redeemed ${credits} housing credits`,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Unable to redeem credits")
      }

      setRedeemOpen(false)
      setRedeemAmount("")
      setStatusMessage({
        tone: "success",
        text: `Redeemed ${credits} housing credits successfully.`,
      })
      await loadDashboardData()
    } catch (error: any) {
      console.error("Error processing redemption:", error)
      setStatusMessage({
        tone: "danger",
        text: error?.message || "Error processing redemption.",
      })
    } finally {
      setRedeeming(false)
    }
  }

  if (authLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user) {
    return null
  }

  if (!client && !hasStaffWorkspace) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Account Not Found</CardTitle>
            <CardDescription>
              Your account could not be located in the Readyaimgo client database.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {beamCoinError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {beamCoinError}
              </div>
            ) : null}
            <Button onClick={handleSignOut}>Sign Out</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const currentPlanLabel = subscription?.planName
    ? subscription.planName
    : client?.planType === "free"
      ? "Free Tier"
      : client?.planType || "No active plan"
  const linkedBusinessName = client
    ? client.companyName || client.claimedClientName || client.name
    : null
  const storyPreviewUrl = client?.claimedStoryId
    ? `${marketingSiteUrl}/story/${encodeURIComponent(client.claimedStoryId)}/website`
    : null

  const messageStyles = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
  }

  const roleBadgeLabels = Array.from(new Set(viewerRoles))

  return (
    <>
      <AppShell
        title={
          viewAsParticipant
            ? `Participant preview${client?.name ? ` for ${client.name}` : ""}`
            : hasStaffWorkspace
              ? "BEAM workspace"
              : `Welcome back${client?.name ? `, ${client.name}` : ""}.`
        }
        description={
          viewAsParticipant
            ? "Preview the participant-facing dashboard without logging out of your admin session."
            : hasStaffWorkspace
              ? "Manage BEAM projects, test participant-only rendering, and keep client account context close when it exists."
              : "This dashboard keeps subscriptions, community credits, housing support, and account activity inside one consistent workspace."
        }
        eyebrow={
          viewAsParticipant
            ? "Participant preview"
            : hasStaffWorkspace
              ? "BEAM workspace"
              : "Client dashboard"
        }
        nav={[
          { href: "/dashboard", label: "Dashboard", active: true },
          ...(isBeamAdmin && !viewAsParticipant ? [{ href: "/admin", label: "Admin" }] : []),
          ...(client?.partnerTier === "agency"
            ? [{ href: "/partner", label: "Partner" }]
            : []),
          { href: "/settings", label: "Settings" },
        ]}
        actions={
          <>
            {client?.email || user.email ? (
              <Badge variant="secondary">{client?.email || user.email}</Badge>
            ) : null}
            {isBeamAdmin ? (
              <Button
                variant={viewAsParticipant ? "default" : "outline"}
                onClick={handleToggleParticipantPreview}
              >
                {viewAsParticipant ? (
                  <>
                    <ShieldPlus className="mr-2 h-4 w-4" />
                    Exit Participant Preview
                  </>
                ) : (
                  <>
                    <UserRound className="mr-2 h-4 w-4" />
                    View As Participant
                  </>
                )}
              </Button>
            ) : null}
            <Button variant="outline" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </>
        }
        intro={
          <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
            {hasStaffWorkspace ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Role scope
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {roleBadgeLabels.map((role) => (
                    <Badge key={role} variant={role === "beam-admin" ? "accent" : "secondary"}>
                      {role}
                    </Badge>
                  ))}
                  {viewAsParticipant ? <Badge variant="accent">Participant only</Badge> : null}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Account snapshot
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant="accent">{currentPlanLabel}</Badge>
                  {client ? (
                    <Badge variant="secondary">
                      {beamCoinBalance ?? client.beamCoinBalance ?? 0} BEAM
                    </Badge>
                  ) : null}
                  {housingWallet ? <Badge>{currencyFormatter.format(housingWallet.value)}</Badge> : null}
                </div>
              </>
            )}
          </div>
        }
      >
        {statusMessage ? (
          <div
            className={`mb-6 rounded-[24px] border px-5 py-4 text-sm ${messageStyles[statusMessage.tone]}`}
          >
            {statusMessage.text}
          </div>
        ) : null}

        {!client && hasStaffWorkspace ? (
          <Card className="mb-6 overflow-hidden border border-border/70 bg-white/90">
            <CardContent className="space-y-3 p-6">
              <p className="text-lg font-semibold text-slate-950">
                {viewAsParticipant ? "Participant preview has no linked client profile." : "No linked client profile for this account."}
              </p>
              <p className="text-sm leading-7 text-slate-600">
                {viewAsParticipant
                  ? "The participant-only preview is active, but this admin account does not have a matching `clients/{email}` record to populate the subscription and wallet cards."
                  : "Use the admin projects area to create and manage project records. This dashboard only renders the participant-facing experience."}
              </p>
              {beamCoinError ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {beamCoinError}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {client && hasStaffWorkspace && !viewAsParticipant ? (
          <Card className="mb-6 overflow-hidden border border-border/70 bg-white/90">
            <CardContent className="space-y-3 p-6">
              <p className="text-lg font-semibold text-slate-950">
                Participant widgets are hidden in staff mode.
              </p>
              <p className="text-sm leading-7 text-slate-600">
                Use the `View As Participant` toggle to re-render this page as participant-only, or manage projects from `/admin/projects`.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {showParticipantExperience &&
        client &&
        (client.companyName ||
          client.claimedClientName ||
          (client.serviceInterests && client.serviceInterests.length > 0)) ? (
          <Card className="mb-6 overflow-hidden border border-border/70 bg-white/90">
            <CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-start">
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                    Connected business
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold text-slate-950">
                    {linkedBusinessName}
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    {client.claimedStoryId
                      ? `This workspace is linked to the ${client.claimedStoryId} story entry on ReadyAimGo.`
                      : "This workspace was created from a new-client intake and is ready for service planning."}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {client.onboardingStatus ? (
                    <Badge variant="accent">{client.onboardingStatus}</Badge>
                  ) : null}
                  {client.organizationType ? (
                    <Badge variant="secondary">{client.organizationType}</Badge>
                  ) : null}
                  {client.contactTitle ? (
                    <Badge variant="secondary">{client.contactTitle}</Badge>
                  ) : null}
                </div>

                {client.serviceInterests && client.serviceInterests.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-slate-800">Selected service areas</p>
                    <div className="flex flex-wrap gap-2">
                      {client.serviceInterests.map((service) => {
                        const option = CLIENT_SERVICE_OPTIONS.find((item) => item.id === service)

                        return (
                          <Badge key={service} variant="secondary">
                            {option?.label || service}
                          </Badge>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                {client.onboardingNotes ? (
                  <div className="rounded-[24px] border border-border/70 bg-muted/35 p-4 text-sm leading-7 text-slate-600">
                    {client.onboardingNotes}
                  </div>
                ) : null}
              </div>

              {storyPreviewUrl ? (
                <Button variant="outline" asChild>
                  <a href={storyPreviewUrl} target="_blank" rel="noopener noreferrer">
                    Preview Story
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {showParticipantExperience && client && client.planType === "free" && !subscription ? (
          <Card className="mb-6 overflow-hidden bg-slate-950 text-white">
            <CardContent className="flex flex-col gap-5 p-7 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/55">
                  Upgrade path
                </p>
                <h2 className="text-3xl font-semibold">Unlock premium client features.</h2>
                <p className="max-w-2xl text-sm leading-7 text-white/72">
                  Move beyond the free tier to manage subscriptions, credits, and support with
                  fewer limits.
                </p>
              </div>
              <Button variant="secondary" onClick={handleCheckout}>
                <ArrowUp className="mr-2 h-4 w-4" />
                Upgrade Now
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {showParticipantExperience && client ? (
          <>
            <section className="grid gap-4 lg:grid-cols-3">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                      <CreditCard className="h-5 w-5" />
                    </span>
                    Subscription
                  </CardTitle>
                  <CardDescription>Current plan, renewal timing, and billing controls.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div>
                    <p className="text-3xl font-semibold text-slate-950">{currentPlanLabel}</p>
                    {subscription ? (
                      <p className="mt-2 text-sm text-slate-600">
                        {currencyFormatter.format(subscription.amount)}/month
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-slate-600">
                        {client.planType === "free"
                          ? "Upgrade to unlock premium features."
                          : "No active Stripe subscription found."}
                      </p>
                    )}
                  </div>

                  {subscription ? (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Calendar className="h-4 w-4 text-slate-400" />
                      <span>Renews {format(new Date(subscription.renewalDate), "MMM d, yyyy")}</span>
                    </div>
                  ) : null}

                  <Button
                    className="w-full"
                    onClick={subscription ? handleManageSubscription : handleCheckout}
                  >
                    {subscription ? "Manage Subscription" : "View Plans"}
                  </Button>
                </CardContent>
              </Card>

              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-slate-800">
                      <Wallet className="h-5 w-5" />
                    </span>
                    Housing Wallet
                  </CardTitle>
                  <CardDescription>Redeem credits and track their equivalent value.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {housingWallet ? (
                    <>
                      <div>
                        <p className="text-3xl font-semibold text-slate-950">
                          {housingWallet.credits} credits
                        </p>
                        <p className="mt-2 text-sm text-slate-600">
                          {currencyFormatter.format(housingWallet.value)} in housing support
                        </p>
                      </div>
                      <p className="text-sm leading-7 text-slate-600">{housingWallet.description}</p>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setRedeemOpen(true)}
                      >
                        Redeem Nights
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-slate-600">
                      Wallet details are loading or unavailable for this account.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-3">
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                          <Coins className="h-5 w-5" />
                        </span>
                        BEAM Coin Wallet
                      </CardTitle>
                      <CardDescription>
                        Live balance plus the most recent ledger activity.
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleRefreshBeamCoin}
                      disabled={beamCoinLoading}
                    >
                      <RefreshCw className={`h-4 w-4 ${beamCoinLoading ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div>
                    <p className="text-3xl font-semibold text-slate-950">
                      {beamCoinLoading
                        ? "Refreshing..."
                        : beamCoinBalance ?? client.beamCoinBalance ?? 0}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Earn, spend, and monitor impact credits in one place.
                    </p>
                    {beamCoinError ? (
                      <div className="mt-3 flex items-center gap-2 text-sm text-amber-700">
                        <AlertCircle className="h-4 w-4" />
                        <span>{beamCoinError}</span>
                      </div>
                    ) : null}
                  </div>

                  {beamCoinTransactions.length > 0 ? (
                    <div className="space-y-2 rounded-[24px] border border-border/70 bg-muted/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                        Recent BEAM activity
                      </p>
                      <div className="space-y-3">
                        {beamCoinTransactions.slice(0, 3).map((transaction, index) => (
                          <div
                            key={`${transaction.type}-${transaction.timestamp}-${index}`}
                            className="flex items-center justify-between gap-4 text-sm"
                          >
                            <div>
                              <p className="font-medium text-slate-900">
                                {transaction.description || "BEAM Coin transaction"}
                              </p>
                              <p className="text-slate-500">
                                {transaction.type === "earn" ? "Earned credits" : "Spent credits"}
                              </p>
                            </div>
                            <p
                              className={
                                transaction.type === "earn"
                                  ? "font-semibold text-emerald-600"
                                  : "font-semibold text-rose-600"
                              }
                            >
                              {transaction.type === "earn" ? "+" : "-"}
                              {transaction.amount || 0}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </section>

            <section className="mt-8 grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>BEAM Coin Transactions</CardTitle>
                  <CardDescription>Your latest ledger activity and balance changes.</CardDescription>
                </CardHeader>
                <CardContent>
                  {beamCoinTransactions.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="border-b border-border/70 text-xs uppercase tracking-[0.24em] text-slate-500">
                          <tr>
                            <th className="px-2 py-3 font-semibold">Type</th>
                            <th className="px-2 py-3 font-semibold">Description</th>
                            <th className="px-2 py-3 text-right font-semibold">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {beamCoinTransactions.map((transaction, index) => (
                            <tr
                              key={`${transaction.type}-${transaction.timestamp}-${index}`}
                              className="border-b border-border/50 last:border-none"
                            >
                              <td className="px-2 py-4">
                                <Badge variant={transaction.type === "earn" ? "success" : "danger"}>
                                  {transaction.type === "earn" ? "Earned" : "Spent"}
                                </Badge>
                              </td>
                              <td className="px-2 py-4 text-slate-700">
                                {transaction.description || "BEAM Coin transaction"}
                              </td>
                              <td
                                className={`px-2 py-4 text-right font-semibold ${
                                  transaction.type === "earn" ? "text-emerald-600" : "text-rose-600"
                                }`}
                              >
                                {transaction.type === "earn" ? "+" : "-"}
                                {transaction.amount || 0}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="py-10 text-center text-sm text-slate-500">No BEAM transactions yet.</p>
                  )}
                </CardContent>
              </Card>

              <RagNotesFeed clientEmail={user.email ?? ""} />

              <Card>
                <CardHeader>
                  <CardTitle>Recent Account Transactions</CardTitle>
                  <CardDescription>Payments, redemptions, and credit activity.</CardDescription>
                </CardHeader>
                <CardContent>
                  {transactions.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="border-b border-border/70 text-xs uppercase tracking-[0.24em] text-slate-500">
                          <tr>
                            <th className="px-2 py-3 font-semibold">Date</th>
                            <th className="px-2 py-3 font-semibold">Type</th>
                            <th className="px-2 py-3 font-semibold">Description</th>
                            <th className="px-2 py-3 text-right font-semibold">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {transactions.map((transaction) => (
                            <tr
                              key={transaction.id}
                              className="border-b border-border/50 last:border-none"
                            >
                              <td className="px-2 py-4 text-slate-700">
                                {format(new Date(transaction.timestamp), "MMM d, yyyy")}
                              </td>
                              <td className="px-2 py-4">
                                <Badge
                                  variant={
                                    transaction.type === "credit"
                                      ? "success"
                                      : transaction.type === "redemption"
                                        ? "warning"
                                        : "secondary"
                                  }
                                >
                                  {transaction.type}
                                </Badge>
                              </td>
                              <td className="px-2 py-4 text-slate-700">{transaction.description}</td>
                              <td className="px-2 py-4 text-right font-semibold text-slate-950">
                                {currencyFormatter.format(transaction.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="py-10 text-center text-sm text-slate-500">No transactions yet.</p>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        ) : null}
      </AppShell>

      {showParticipantExperience ? (
        <Dialog open={redeemOpen} onOpenChange={setRedeemOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Redeem Housing Wallet Credits</DialogTitle>
              <DialogDescription>
                Enter the number of credits you want to redeem toward housing support.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="text-sm font-semibold text-slate-700">Credit amount</label>
              <Input
                inputMode="numeric"
                min={1}
                placeholder="10"
                value={redeemAmount}
                onChange={(event) => setRedeemAmount(event.target.value)}
              />
              {housingWallet ? (
                <p className="text-sm text-slate-500">
                  Available balance: {housingWallet.credits} credits
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRedeemOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleRedeemCredits} disabled={redeeming}>
                {redeeming ? "Redeeming..." : "Confirm Redemption"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <DashboardPageContent />
    </Suspense>
  )
}
