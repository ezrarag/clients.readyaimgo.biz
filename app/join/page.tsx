"use client"

import { Suspense, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, LogIn, UserPlus } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { AuthShell } from "@/components/site/auth-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ensureBeamUserRecord } from "@/lib/beam-users-client"
import { signInWithGoogle, signUp } from "@/lib/firebase/auth"
import { getDb } from "@/lib/firebase/config"

interface InvitePreview {
  orgId: string
  orgName: string
  email: string
  role: "owner" | "admin" | "viewer"
  status: "pending" | "accepted" | "revoked"
}

function isInvitePreview(value: unknown): value is InvitePreview {
  return (
    typeof value === "object" &&
    value !== null &&
    "orgId" in value &&
    typeof value.orgId === "string" &&
    "orgName" in value &&
    typeof value.orgName === "string" &&
    "email" in value &&
    typeof value.email === "string" &&
    "role" in value &&
    (value.role === "owner" || value.role === "admin" || value.role === "viewer") &&
    "status" in value &&
    (value.status === "pending" || value.status === "accepted" || value.status === "revoked")
  )
}

function errorFromPayload(payload: unknown, fallback: string) {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
      ? payload.error
      : fallback
  )
}

function JoinPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const orgId = searchParams.get("org") || ""
  const token = searchParams.get("token") || ""

  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    const loadInvite = async () => {
      if (!orgId || !token) {
        setError("This invite link is missing required information.")
        setLoading(false)
        return
      }

      try {
        const response = await fetch(
          `/api/organizations/join/preview?org=${encodeURIComponent(orgId)}&token=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        )
        const payload: unknown = await response.json()

        if (!response.ok) {
          throw new Error(errorFromPayload(payload, "Unable to load invite."))
        }

        if (!isInvitePreview(payload)) {
          throw new Error("Invite response was invalid.")
        }

        if (!cancelled) {
          setPreview(payload)
          setEmail(payload.email)
        }
      } catch (inviteError) {
        if (!cancelled) {
          setError(inviteError instanceof Error ? inviteError.message : "Unable to load invite.")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadInvite()

    return () => {
      cancelled = true
    }
  }, [orgId, token])

  useEffect(() => {
    if (user?.displayName) {
      setName((current) => current || user.displayName || "")
    }
  }, [user])

  const acceptInvite = async (acceptedUser: NonNullable<typeof user>) => {
    if (!preview) {
      return
    }

    setAccepting(true)
    setError("")

    try {
      await ensureBeamUserRecord({
        firestoreDb: getDb(),
        user: acceptedUser,
      })

      const response = await fetch("/api/organizations/join/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: preview.orgId,
          token,
          uid: acceptedUser.uid,
          email: acceptedUser.email,
          name: acceptedUser.displayName || name,
        }),
      })
      const payload: unknown = await response.json()

      if (!response.ok) {
        throw new Error(errorFromPayload(payload, "Unable to accept invite."))
      }

      router.push(`/org/${preview.orgId}/dashboard`)
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Unable to accept invite.")
      setAccepting(false)
    }
  }

  const handleCreateAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setAccepting(true)

    try {
      const result = await signUp(email, password, name)

      if (result.error || !result.user) {
        throw new Error(result.error || "Unable to create account.")
      }

      await acceptInvite(result.user)
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : "Unable to create account.")
      setAccepting(false)
    }
  }

  const handleGoogle = async () => {
    setError("")
    setAccepting(true)

    try {
      const result = await signInWithGoogle()

      if (result.error || !result.user) {
        throw new Error(result.error || "Unable to sign in with Google.")
      }

      await acceptInvite(result.user)
    } catch (googleError) {
      setError(googleError instanceof Error ? googleError.message : "Unable to sign in with Google.")
      setAccepting(false)
    }
  }

  return (
    <AuthShell
      title="Join workspace"
      description="Accept your organization invite and enter the shared Readyaimgo client workspace."
      asideTitle="Team access now lives at the organization level."
      asideDescription="Every invited member gets their own login while sharing projects, files, tasks, and RAG notes with the company workspace."
      highlights={[
        "Join as owner, admin, or viewer",
        "Use email/password or Google sign-in",
        "Access lands directly in the organization dashboard",
      ]}
      footer={
        <p className="text-center text-sm text-slate-600">
          Already have a different account?{" "}
          <Link href="/login" className="font-semibold text-primary hover:opacity-80">
            Sign in
          </Link>
        </p>
      }
    >
      {loading || authLoading ? (
        <div className="flex items-center gap-2 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading invite...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {preview && !loading && !authLoading ? (
        <div className="space-y-5">
          <div className="rounded-[24px] border border-border/70 bg-white/80 p-5">
            <p className="text-sm text-slate-500">Workspace</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{preview.orgName}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="accent">{preview.role}</Badge>
              <Badge variant={preview.status === "pending" ? "warning" : "secondary"}>
                {preview.status}
              </Badge>
            </div>
          </div>

          {user ? (
            <div className="space-y-4">
              <p className="text-sm leading-7 text-slate-600">
                You are signed in as <span className="font-semibold">{user.email}</span>.
              </p>
              <Button
                onClick={() => void acceptInvite(user)}
                disabled={accepting || preview.status !== "pending"}
                className="w-full"
              >
                {accepting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="mr-2 h-4 w-4" />
                )}
                Join {preview.orgName}
              </Button>
            </div>
          ) : (
            <>
              <form onSubmit={handleCreateAccount} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Full name</label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Email</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Password</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" disabled={accepting || preview.status !== "pending"} className="w-full">
                  {accepting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="mr-2 h-4 w-4" />
                  )}
                  Create Account and Join
                </Button>
              </form>

              <Button
                type="button"
                variant="outline"
                onClick={() => void handleGoogle()}
                disabled={accepting || preview.status !== "pending"}
                className="w-full"
              >
                Continue with Google
              </Button>
            </>
          )}
        </div>
      ) : null}
    </AuthShell>
  )
}

function JoinFallback() {
  return (
    <AuthShell
      title="Join workspace"
      description="Accept your organization invite and enter the shared Readyaimgo client workspace."
      asideTitle="Team access now lives at the organization level."
      asideDescription="Loading invite..."
      highlights={["Shared workspace access", "Role-based membership", "Project and file visibility"]}
    >
      <div className="flex items-center gap-2 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading invite...
      </div>
    </AuthShell>
  )
}

export default function JoinPage() {
  return (
    <Suspense fallback={<JoinFallback />}>
      <JoinPageContent />
    </Suspense>
  )
}
