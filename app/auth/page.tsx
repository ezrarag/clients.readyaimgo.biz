"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import type { User } from "firebase/auth"

import { useAuth } from "@/components/auth/AuthProvider"
import { AuthShell } from "@/components/site/auth-shell"
import { Button } from "@/components/ui/button"
import { signInWithGoogle } from "@/lib/firebase/auth"

type AuthIntent = {
  redirectTo: string
  plan: string
}

const AUTH_INTENT_STORAGE_KEY = "readyaimgo.authIntent.v1"
const SUPPORTED_REDIRECTS = new Set(["/checkout"])

function sanitizeRedirectTo(value: string | null) {
  const redirectTo = value?.trim() || "/checkout"
  return SUPPORTED_REDIRECTS.has(redirectTo) ? redirectTo : "/checkout"
}

function sanitizePlan(value: string | null) {
  return value?.trim() || ""
}

function readCachedIntent(): AuthIntent | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.sessionStorage.getItem(AUTH_INTENT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthIntent>
    const plan = sanitizePlan(parsed.plan ?? null)
    if (!plan) return null
    return {
      redirectTo: sanitizeRedirectTo(parsed.redirectTo ?? null),
      plan,
    }
  } catch {
    return null
  }
}

function cacheIntent(intent: AuthIntent) {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(AUTH_INTENT_STORAGE_KEY, JSON.stringify(intent))
}

function clearCachedIntent() {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(AUTH_INTENT_STORAGE_KEY)
}

async function bootstrapUser(user: User) {
  const token = await user.getIdToken()
  const response = await fetch("/api/auth/bootstrap", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      displayName: user.displayName || user.email || "",
    }),
  })
  const payload = (await response.json().catch(() => ({}))) as { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || "Unable to prepare this account for checkout.")
  }
}

async function startStripeCheckout(user: User, intent: AuthIntent) {
  const token = await user.getIdToken()
  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      plan: intent.plan,
      redirectTo: intent.redirectTo,
    }),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
    url?: string
  }

  if (!response.ok || !payload.url) {
    throw new Error(payload.error || "Unable to start Stripe Checkout.")
  }

  return payload.url
}

function AuthCheckoutPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading } = useAuth()

  const [error, setError] = useState("")
  const [status, setStatus] = useState("Preparing secure checkout...")
  const [working, setWorking] = useState(false)
  const redirectingRef = useRef(false)

  const intent = useMemo<AuthIntent>(() => {
    const fromQuery = {
      redirectTo: sanitizeRedirectTo(searchParams.get("redirectTo")),
      plan: sanitizePlan(searchParams.get("plan")),
    }
    const cached = readCachedIntent()
    return fromQuery.plan ? fromQuery : cached ?? fromQuery
  }, [searchParams])

  useEffect(() => {
    if (intent.plan) {
      cacheIntent(intent)
    }
  }, [intent])

  const completeCheckout = useCallback(
    async (accountUser: User) => {
      if (redirectingRef.current) return
      if (!intent.plan) {
        setError("Checkout plan is missing. Use a link with ?redirectTo=/checkout&plan=space_100.")
        return
      }

      redirectingRef.current = true
      setWorking(true)
      setError("")

      try {
        setStatus("Creating or updating your ReadyAimGo portal record...")
        await bootstrapUser(accountUser)

        setStatus("Starting Stripe Checkout...")
        const checkoutUrl = await startStripeCheckout(accountUser, intent)
        clearCachedIntent()
        window.location.assign(checkoutUrl)
      } catch (checkoutError) {
        redirectingRef.current = false
        setWorking(false)
        setStatus("Checkout is paused until the issue below is resolved.")
        setError(
          checkoutError instanceof Error
            ? checkoutError.message
            : "Unable to continue to checkout."
        )
      }
    },
    [intent]
  )

  useEffect(() => {
    if (!authLoading && user) {
      void completeCheckout(user)
    }
  }, [authLoading, completeCheckout, user])

  const handleGoogleCheckout = async () => {
    setError("")
    setWorking(true)
    setStatus("Opening Google sign-in...")

    try {
      if (!intent.plan) {
        throw new Error("Checkout plan is missing. Use a link with ?redirectTo=/checkout&plan=space_100.")
      }

      cacheIntent(intent)
      const result = await signInWithGoogle()
      if (result.error || !result.user) {
        throw new Error(result.error || "Unable to sign in with Google.")
      }
      await completeCheckout(result.user)
    } catch (googleError) {
      redirectingRef.current = false
      setWorking(false)
      setStatus("Ready to retry secure checkout.")
      setError(
        googleError instanceof Error
          ? googleError.message
          : "Unable to sign in with Google."
      )
    }
  }

  return (
    <AuthShell
      title="Secure Checkout"
      description="Sign in with Google to activate your selected ReadyAimGo plan."
      asideTitle="Checkout handoff."
      asideDescription="Your account is prepared first, then Stripe handles subscription payment securely."
      highlights={[
        "Google sign-in creates or updates your portal identity",
        "Stripe Checkout opens immediately after the account is ready",
      ]}
      footer={
        <p className="text-center text-sm text-slate-600">
          Need the standard portal?{" "}
          <Link href="/login" className="font-semibold text-primary hover:opacity-80">
            Sign in normally
          </Link>
        </p>
      }
    >
      <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Checkout Intent
        </p>
        <p className="mt-2 text-sm font-semibold text-slate-900">
          {intent.plan || "No plan selected"}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {intent.redirectTo === "/checkout"
            ? "Dashboard routing will be skipped after sign-in."
            : "ReadyAimGo will continue after sign-in."}
        </p>
      </div>

      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={handleGoogleCheckout}
        disabled={working || authLoading || !intent.plan}
      >
        {working || authLoading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
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
        )}
        {working || authLoading ? "Preparing checkout..." : "Continue with Google"}
      </Button>

      <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        {status}
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {!intent.plan ? (
        <Button type="button" variant="outline" className="w-full" onClick={() => router.push("/")}>
          Return to ReadyAimGo
        </Button>
      ) : null}
    </AuthShell>
  )
}

function AuthCheckoutFallback() {
  return (
    <AuthShell
      title="Secure Checkout"
      description="Preparing the checkout handoff."
      asideTitle="Checkout handoff."
      asideDescription="Loading the sign-in flow..."
      highlights={[
        "Google sign-in creates or updates your portal identity",
        "Stripe Checkout opens immediately after the account is ready",
      ]}
    >
      <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Loading checkout...
      </div>
    </AuthShell>
  )
}

export default function AuthCheckoutPage() {
  return (
    <Suspense fallback={<AuthCheckoutFallback />}>
      <AuthCheckoutPageContent />
    </Suspense>
  )
}
