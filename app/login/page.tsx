"use client"

import { Suspense, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { AuthShell } from "@/components/site/auth-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/components/auth/AuthProvider"
import {
  appendHandoffQuery,
  deriveClientInterestDefaults,
  normalizeClientServiceInterests,
  upsertClientAccountRecord,
  type ClientPortalHandoffPayload,
} from "@/lib/client-onboarding"
import { resolveClientDestination } from "@/lib/client-portal"
import { ensureBeamUserRecord } from "@/lib/beam-users-client"
import { getDb } from "@/lib/firebase/config"
import { signIn, signInWithGoogle } from "@/lib/firebase/auth"

function LoginPageContent() {
  const searchParams = useSearchParams()
  const handoffId = searchParams.get("handoff")
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [handoffPayload, setHandoffPayload] = useState<ClientPortalHandoffPayload | null>(null)
  const [handoffLoading, setHandoffLoading] = useState(Boolean(handoffId))

  useEffect(() => {
    let cancelled = false

    const loadHandoff = async () => {
      if (!handoffId) {
        setHandoffLoading(false)
        return
      }

      try {
        const response = await fetch(
          `/api/onboarding-handoff?handoff=${encodeURIComponent(handoffId)}`,
          {
            cache: "no-store",
          }
        )
        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload?.error || "Unable to load onboarding context.")
        }

        if (!cancelled) {
          setHandoffPayload(payload as ClientPortalHandoffPayload)
          if (payload?.handoff?.workEmail) {
            setEmail((current: string) => current || payload.handoff.workEmail)
          }
        }
      } catch (handoffError) {
        console.error(handoffError)
        if (!cancelled) {
          setError(
            handoffError instanceof Error
              ? handoffError.message
              : "Unable to load onboarding context."
          )
        }
      } finally {
        if (!cancelled) {
          setHandoffLoading(false)
        }
      }
    }

    void loadHandoff()

    return () => {
      cancelled = true
    }
  }, [handoffId])

  useEffect(() => {
    if (authLoading || !user || handoffLoading) {
      return
    }

    if (!handoffPayload) {
      if (!handoffId) {
        let cancelled = false

        const redirectSignedInUser = async () => {
          const destination = await resolveClientDestination(getDb(), user.email)
          if (!cancelled) {
            router.push(destination)
          }
        }

        void redirectSignedInUser()

        return () => {
          cancelled = true
        }
      }

      return
    }

    let cancelled = false

    const applyHandoffForExistingUser = async () => {
      try {
        const firestoreDb = getDb()
        await ensureBeamUserRecord({
          firestoreDb,
          user,
        })

        await upsertClientAccountRecord({
          firestoreDb,
          user,
          onboarding: {
            fullName: user.displayName || handoffPayload.handoff.contactName || "",
            companyName:
              handoffPayload.handoff.companyName ||
              handoffPayload.claimPreview?.name ||
              "",
            contactTitle: handoffPayload.handoff.role || "",
            phone: handoffPayload.handoff.phone || "",
            organizationType: handoffPayload.handoff.organizationType || "",
            serviceInterests: normalizeClientServiceInterests(
              handoffPayload.handoff.serviceInterests.length > 0
                ? handoffPayload.handoff.serviceInterests
                : deriveClientInterestDefaults(handoffPayload.claimPreview)
            ),
            notes: handoffPayload.handoff.notes || "",
          },
          handoff: handoffPayload.handoff,
          claimPreview: handoffPayload.claimPreview,
        })

        if (!cancelled) {
          const destination = await resolveClientDestination(firestoreDb, user.email)
          router.push(destination)
        }
      } catch (persistError) {
        console.error(persistError)
        if (!cancelled) {
          setError(
            persistError instanceof Error
              ? persistError.message
              : "Unable to connect this account to the client record."
          )
        }
      }
    }

    void applyHandoffForExistingUser()

    return () => {
      cancelled = true
    }
  }, [authLoading, handoffId, handoffLoading, handoffPayload, router, user])

  const persistIfNeeded = async (
    accountUser: NonNullable<Awaited<ReturnType<typeof signIn>>["user"]>
  ) => {
    const firestoreDb = getDb()
    await ensureBeamUserRecord({
      firestoreDb,
      user: accountUser,
    })

    if (!handoffPayload) {
      return
    }

    await upsertClientAccountRecord({
      firestoreDb,
      user: accountUser,
      onboarding: {
        fullName: accountUser.displayName || handoffPayload.handoff.contactName || "",
        companyName:
          handoffPayload.handoff.companyName || handoffPayload.claimPreview?.name || "",
        contactTitle: handoffPayload.handoff.role || "",
        phone: handoffPayload.handoff.phone || "",
        organizationType: handoffPayload.handoff.organizationType || "",
        serviceInterests: normalizeClientServiceInterests(
          handoffPayload.handoff.serviceInterests.length > 0
            ? handoffPayload.handoff.serviceInterests
            : deriveClientInterestDefaults(handoffPayload.claimPreview)
        ),
        notes: handoffPayload.handoff.notes || "",
      },
      handoff: handoffPayload.handoff,
      claimPreview: handoffPayload.claimPreview,
    })
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    setLoading(true)

    try {
      const result = await signIn(email, password)
      if (result.error || !result.user) {
        throw new Error(result.error || "Unable to sign in.")
      }

      const firestoreDb = getDb()
      await persistIfNeeded(result.user)
      const destination = await resolveClientDestination(firestoreDb, result.user.email)
      router.push(destination)
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Unable to sign in."
      )
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError("")
    setLoading(true)

    try {
      const result = await signInWithGoogle()
      if (result.error || !result.user) {
        throw new Error(result.error || "Unable to sign in with Google.")
      }

      const firestoreDb = getDb()
      await persistIfNeeded(result.user)
      const destination = await resolveClientDestination(firestoreDb, result.user.email)
      router.push(destination)
    } catch (googleError) {
      setError(
        googleError instanceof Error
          ? googleError.message
          : "Unable to sign in with Google."
      )
      setLoading(false)
    }
  }

  const signUpHref = appendHandoffQuery("/signup", handoffId)
  const claimPreview = handoffPayload?.claimPreview ?? null

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to manage subscriptions, wallet balances, and client onboarding from one place."
      asideTitle="A cleaner client portal starts with a calmer sign-in flow."
      asideDescription="When someone arrives from the main ReadyAimGo site, the portal now preserves the selected business and service context instead of dropping them into a generic login screen."
      highlights={[
        "Existing businesses can be claimed before login",
        "Claim context carries into the client record after sign-in",
        "Returning clients keep one path from readyaimgo.biz into the portal",
      ]}
      footer={
        <p className="text-center text-sm text-slate-600">
          Don&apos;t have an account?{" "}
          <Link href={signUpHref} className="font-semibold text-primary hover:opacity-80">
            Create one
          </Link>
        </p>
      }
    >
      {handoffLoading ? (
        <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Loading your ReadyAimGo business context...
        </div>
      ) : null}

      {claimPreview ? (
        <Card className="border-slate-200 bg-slate-50">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-slate-950">{claimPreview.name}</p>
                <p className="text-sm text-slate-600">{claimPreview.storyId}</p>
              </div>
              <Badge variant="secondary">Portal handoff</Badge>
            </div>

            <p className="text-sm leading-6 text-slate-600">
              {claimPreview.pulseSummary ||
                "Sign in and this account will be linked to the selected ReadyAimGo business."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">Email</label>
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">Password</label>
          <Input
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading || handoffLoading}>
          {loading ? "Signing in..." : "Sign In"}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border/80" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-[0.28em]">
          <span className="bg-card px-4 text-slate-500">Or continue with</span>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGoogleSignIn}
        disabled={loading || handoffLoading}
      >
        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        Google
      </Button>
    </AuthShell>
  )
}

function LoginFallback() {
  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to manage subscriptions, wallet balances, and client onboarding from one place."
      asideTitle="A cleaner client portal starts with a calmer sign-in flow."
      asideDescription="Loading the sign-in flow..."
      highlights={[
        "Existing businesses can be claimed before login",
        "Claim context carries into the client record after sign-in",
        "Returning clients keep one path from readyaimgo.biz into the portal",
      ]}
    >
      <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Loading sign-in...
      </div>
    </AuthShell>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginPageContent />
    </Suspense>
  )
}
