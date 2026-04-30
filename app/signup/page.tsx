"use client"

import { Suspense, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { AuthShell } from "@/components/site/auth-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/components/auth/AuthProvider"
import {
  CLIENT_SERVICE_OPTIONS,
  appendHandoffQuery,
  deriveClientInterestDefaults,
  normalizeClientServiceInterests,
  upsertClientAccountRecord,
  type ClientPortalHandoffPayload,
  type ClientServiceInterestKey,
} from "@/lib/client-onboarding"
import { resolveClientDestination } from "@/lib/client-portal"
import { ensureBeamUserRecord } from "@/lib/beam-users-client"
import { getDb } from "@/lib/firebase/config"
import { signInWithGoogle, signUp } from "@/lib/firebase/auth"

const ORGANIZATION_TYPES = [
  "Transportation",
  "Property operations",
  "Retail",
  "Hospitality",
  "Professional services",
  "Community organization",
  "Real estate",
  "Construction",
  "Other",
]

function SignUpPageContent() {
  const searchParams = useSearchParams()
  const handoffId = searchParams.get("handoff")
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [role, setRole] = useState("")
  const [phone, setPhone] = useState("")
  const [organizationType, setOrganizationType] = useState("")
  const [notes, setNotes] = useState("")
  const [serviceInterests, setServiceInterests] = useState<ClientServiceInterestKey[]>([])
  const [handoffPayload, setHandoffPayload] = useState<ClientPortalHandoffPayload | null>(null)
  const [handoffLoading, setHandoffLoading] = useState(Boolean(handoffId))
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

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
    if (!handoffPayload) {
      return
    }

    const { handoff, claimPreview } = handoffPayload
    const isPhoneOnly = handoff.workEmail?.endsWith("@phone.readyaimgo.internal")
    setName((current) => current || handoff.contactName || claimPreview?.name || "")
    // Don't pre-fill the internal phone placeholder — let the user enter their real email
    setEmail((current) => (current || (!isPhoneOnly ? handoff.workEmail : "")))
    setCompanyName((current) => current || handoff.companyName || claimPreview?.name || "")
    setRole((current) => current || handoff.role || "")
    setPhone((current) => current || handoff.phone || "")
    setOrganizationType((current) => current || handoff.organizationType || "")
    setNotes((current) => current || handoff.notes || "")
    setServiceInterests((current) =>
      current.length > 0
        ? current
        : normalizeClientServiceInterests(
            handoff.serviceInterests.length > 0
              ? handoff.serviceInterests
              : deriveClientInterestDefaults(claimPreview)
          )
    )
  }, [handoffPayload])

  useEffect(() => {
    if (authLoading || !user || handoffLoading) {
      return
    }

    if (!handoffPayload) {
      if (!handoffId) {
        let cancelled = false

        const redirectSignedInUser = async () => {
          const destination = await resolveClientDestination(getDb(), user.email, {
            uid: user.uid,
            name: user.displayName,
          })
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
            fullName: name,
            companyName,
            contactTitle: role,
            phone,
            organizationType,
            serviceInterests,
            notes,
          },
          handoff: handoffPayload.handoff,
          claimPreview: handoffPayload.claimPreview,
        })

        if (!cancelled) {
          const destination = await resolveClientDestination(firestoreDb, user.email, {
            uid: user.uid,
            name: user.displayName,
          })
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
  }, [
    authLoading,
    companyName,
    handoffId,
    handoffLoading,
    handoffPayload,
    name,
    notes,
    organizationType,
    phone,
    role,
    router,
    serviceInterests,
    user,
  ])

  const notifySlack = async (emailAddress: string, fullName: string) => {
    try {
      await fetch("/api/slack/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "signup",
          email: emailAddress,
          name: fullName,
          planType: "free",
        }),
      })
    } catch (notifyError) {
      console.error("Error sending Slack notification:", notifyError)
    }
  }

  const persistAccount = async (accountUser: NonNullable<Awaited<ReturnType<typeof signUp>>["user"]>) => {
    const firestoreDb = getDb()
    await ensureBeamUserRecord({
      firestoreDb,
      user: accountUser,
    })

    await upsertClientAccountRecord({
      firestoreDb,
      user: accountUser,
      onboarding: {
        fullName: name,
        companyName,
        contactTitle: role,
        phone,
        organizationType,
        serviceInterests,
        notes,
      },
      handoff: handoffPayload?.handoff,
      claimPreview: handoffPayload?.claimPreview,
    })
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    setLoading(true)

    try {
      const result = await signUp(email, password, name)
      if (result.error || !result.user) {
        throw new Error(result.error || "Unable to create the account.")
      }

      const firestoreDb = getDb()
      await persistAccount(result.user)
      await notifySlack(result.user.email || email, name || companyName || "User")
      const destination = await resolveClientDestination(firestoreDb, result.user.email, {
        uid: result.user.uid,
        name: result.user.displayName,
      })
      router.push(destination)
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create the account."
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

      if (!name && result.user.displayName) {
        setName(result.user.displayName)
      }

      const firestoreDb = getDb()
      await persistAccount(result.user)
      await notifySlack(
        result.user.email || email,
        result.user.displayName || name || companyName || "User"
      )
      const destination = await resolveClientDestination(firestoreDb, result.user.email, {
        uid: result.user.uid,
        name: result.user.displayName,
      })
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

  const toggleServiceInterest = (
    serviceId: ClientServiceInterestKey,
    checked: boolean
  ) => {
    setServiceInterests((current) =>
      checked
        ? Array.from(new Set([...current, serviceId]))
        : current.filter((value) => value !== serviceId)
    )
  }

  const signInHref = appendHandoffQuery("/login", handoffId)
  const claimPreview = handoffPayload?.claimPreview ?? null

  return (
    <AuthShell
      title="Create your account"
      description="Set up your client workspace and keep subscriptions, credits, and onboarding context under one roof."
      asideTitle="Account creation should preserve the business context that started on ReadyAimGo."
      asideDescription="This flow now carries a claimed story or new-client intake into the portal, so the first dashboard session already knows which business it belongs to."
      highlights={[
        "Existing story claims carry through to the portal",
        "Service interests are saved with the client account record",
        "New businesses can start intake on the main site and finish here",
      ]}
      footer={
        <p className="text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link href={signInHref} className="font-semibold text-primary hover:opacity-80">
            Sign in
          </Link>
        </p>
      }
    >
      {handoffLoading ? (
        <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Loading your ReadyAimGo business context...
        </div>
      ) : null}

      {handoffPayload?.handoff?.workEmail?.endsWith("@phone.readyaimgo.internal") ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">You were added by phone number.</p>
          <p className="mt-1">
            Enter your email address and create a password below — you can use your phone number to sign in later once your account is set up.
          </p>
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
              <Badge variant="secondary">Claimed story</Badge>
            </div>

            <p className="text-sm leading-6 text-slate-600">
              {claimPreview.pulseSummary ||
                "This account will be linked to the business selected on readyaimgo.biz."}
            </p>

            {claimPreview.brands?.length ? (
              <div className="flex flex-wrap gap-2">
                {claimPreview.brands.slice(0, 4).map((brand) => (
                  <Badge key={brand} variant="secondary">
                    {brand}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Full name</label>
            <Input
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Company name</label>
            <Input
              type="text"
              placeholder="PaynePros"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
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
              placeholder="Create a password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Role or title</label>
            <Input
              type="text"
              placeholder="Founder, operations lead, executive director"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Phone</label>
            <Input
              type="tel"
              placeholder="(312) 555-0199"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">Organization type</label>
          <select
            value={organizationType}
            onChange={(event) => setOrganizationType(event.target.value)}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">Select one</option>
            {ORGANIZATION_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700">Service areas</p>
          <div className="grid gap-3">
            {CLIENT_SERVICE_OPTIONS.map((option) => {
              const checked = serviceInterests.includes(option.id)

              return (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      toggleServiceInterest(option.id, event.target.checked)
                    }
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-semibold text-slate-900">
                      {option.label}
                    </span>
                    <span className="block text-sm leading-6 text-slate-600">
                      {option.description}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">
            Demographic or onboarding notes
          </label>
          <Textarea
            placeholder="Operating region, team size, audience served, or what you need ReadyAimGo to activate first."
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="min-h-28"
          />
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading || handoffLoading}>
          {loading ? "Creating account..." : "Create Account"}
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

function SignUpFallback() {
  return (
    <AuthShell
      title="Create your account"
      description="Set up your client workspace and keep subscriptions, credits, and onboarding context under one roof."
      asideTitle="Account creation should preserve the business context that started on ReadyAimGo."
      asideDescription="Loading the account setup flow..."
      highlights={[
        "Existing story claims carry through to the portal",
        "Service interests are saved with the client account record",
        "New businesses can start intake on the main site and finish here",
      ]}
    >
      <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Loading account setup...
      </div>
    </AuthShell>
  )
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<SignUpFallback />}>
      <SignUpPageContent />
    </Suspense>
  )
}
