"use client"

import { type FormEvent, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Building2,
  CheckCircle2,
  Loader2,
  LogOut,
  Search,
  Send,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { signOut } from "@/lib/firebase/auth"

type ClaimWorkspaceOption = {
  workspaceId: string
  clientId: string
  name: string
  clientEmail?: string
  source?: string
}

type ClaimRequest = {
  id: string
  requestedWorkspaceId: string
  requestedWorkspaceName: string
  requestedClientId: string
  requestedClientName: string
  requestedProjectId: string
  requestedProjectName: string
  evidenceNotes: string
  status: string
}

function requestMatchesOption(request: ClaimRequest, option: ClaimWorkspaceOption) {
  return Boolean(
    (option.workspaceId && request.requestedWorkspaceId === option.workspaceId) ||
      (option.clientId && request.requestedClientId === option.clientId)
  )
}

function statusBadgeVariant(status: string) {
  if (status === "approved") return "success" as const
  if (status === "rejected") return "danger" as const
  return "warning" as const
}

async function loadClaimRequests(user: { getIdToken: () => Promise<string> }) {
  const token = await user.getIdToken()
  const res = await fetch("/api/client-portal/claim-requests", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  const payload = (await res.json()) as { requests?: ClaimRequest[]; error?: string }
  if (!res.ok) throw new Error(payload.error ?? "Unable to load claim requests.")
  return payload.requests ?? []
}

async function searchWorkspaces(
  user: { getIdToken: () => Promise<string> },
  query: string
) {
  const token = await user.getIdToken()
  const res = await fetch(
    `/api/client-portal/claim-requests?search=${encodeURIComponent(query)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  )
  const payload = (await res.json()) as {
    workspaces?: ClaimWorkspaceOption[]
    matches?: ClaimWorkspaceOption[]
    error?: string
  }
  if (!res.ok) throw new Error(payload.error ?? "Unable to search workspaces.")
  return payload.workspaces ?? payload.matches ?? []
}

async function submitClaimRequest({
  user,
  option,
  evidenceNotes,
}: {
  user: { getIdToken: () => Promise<string> }
  option: ClaimWorkspaceOption
  evidenceNotes: string
}) {
  const token = await user.getIdToken()
  const res = await fetch("/api/client-portal/claim-requests", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requestedWorkspaceId: option.workspaceId || undefined,
      requestedClientId: option.clientId || undefined,
      evidenceNotes,
    }),
  })
  const payload = (await res.json()) as {
    request?: ClaimRequest
    duplicate?: boolean
    error?: string
  }
  if (!res.ok) throw new Error(payload.error ?? "Unable to submit claim request.")
  if (!payload.request) throw new Error("Claim request did not return a request record.")
  return payload.request
}

export default function ClaimWorkspacePage() {
  const router = useRouter()
  const { user, workspaceIds, loading: authLoading } = useAuth()

  const [query, setQuery] = useState("")
  const [notes, setNotes] = useState("")
  const [requests, setRequests] = useState<ClaimRequest[]>([])
  const [options, setOptions] = useState<ClaimWorkspaceOption[]>([])
  const [loadingRequests, setLoadingRequests] = useState(true)
  const [searching, setSearching] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pendingRequests = useMemo(
    () =>
      requests.filter(
        (request) => request.status === "pending" || request.status === "approved"
      ),
    [requests]
  )

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      router.replace("/login?redirect=/claim-workspace")
      return
    }

    if (workspaceIds.length > 0) {
      router.replace("/dashboard")
      return
    }

    let cancelled = false

    setLoadingRequests(true)
    loadClaimRequests(user)
      .then((nextRequests) => {
        if (!cancelled) setRequests(nextRequests)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load claim requests.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRequests(false)
      })

    return () => {
      cancelled = true
    }
  }, [authLoading, router, user, workspaceIds.length])

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user || query.trim().length < 2) return

    setSearching(true)
    setError(null)
    setMessage(null)

    try {
      const results = await searchWorkspaces(user, query.trim())
      setOptions(results)
      if (results.length === 0) {
        setMessage("No matching workspace was found. Try a client, organization, or project name.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to search workspaces.")
    } finally {
      setSearching(false)
    }
  }

  const handleClaim = async (option: ClaimWorkspaceOption) => {
    if (!user) return

    const optionId = option.workspaceId || option.clientId
    setClaimingId(optionId)
    setError(null)
    setMessage(null)

    try {
      const request = await submitClaimRequest({
        user,
        option,
        evidenceNotes: notes.trim(),
      })
      setRequests((previous) => {
        const withoutDuplicate = previous.filter((item) => item.id !== request.id)
        return [request, ...withoutDuplicate]
      })
      setMessage("Access request submitted. Readyaimgo can approve it from the admin side.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit claim request.")
    } finally {
      setClaimingId(null)
    }
  }

  if (authLoading || loadingRequests) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || workspaceIds.length > 0) return null

  return (
    <AppShell
      eyebrow="Workspace Access"
      title="Claim your client workspace"
      description="Search for the organization or project Readyaimgo already has on file, then request access for this signed-in account."
      nav={[
        { href: "/claim-workspace", label: "Claim Workspace", active: true },
        { href: "/dashboard", label: "Dashboard" },
      ]}
      actions={
        <Button
          variant="outline"
          onClick={async () => {
            await signOut()
            router.replace("/login")
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Find Workspace</CardTitle>
              <CardDescription>
                Search by client, organization, project, or workspace name.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Southern Strings Sinfonia"
                  className="h-12"
                />
                <Button
                  type="submit"
                  size="lg"
                  disabled={searching || query.trim().length < 2}
                  className="sm:min-w-36"
                >
                  {searching ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  Search
                </Button>
              </form>

              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional note for the Readyaimgo team, such as your role or the email address the client expects."
              />

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              {message ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {message}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {options.length > 0 ? (
            <div className="grid gap-4">
              {options.map((option) => {
                const existingRequest = requests.find((request) =>
                  requestMatchesOption(request, option)
                )
                const optionId = option.workspaceId || option.clientId
                const isClaiming = claimingId === optionId

                return (
                  <Card key={`${option.source ?? "workspace"}:${optionId}`}>
                    <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-lg font-semibold text-slate-950">
                              {option.name}
                            </p>
                            <p className="truncate text-sm text-slate-500">
                              {option.clientEmail || option.clientId || option.workspaceId}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            {option.source || "workspace"}
                          </Badge>
                          {option.workspaceId ? (
                            <Badge variant="default">{option.workspaceId}</Badge>
                          ) : null}
                        </div>
                      </div>

                      {existingRequest ? (
                        <Badge variant={statusBadgeVariant(existingRequest.status)}>
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          {existingRequest.status}
                        </Badge>
                      ) : (
                        <Button
                          onClick={() => void handleClaim(option)}
                          disabled={isClaiming}
                          className="sm:min-w-40"
                        >
                          {isClaiming ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="mr-2 h-4 w-4" />
                          )}
                          Request Access
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-xl">Your Requests</CardTitle>
            <CardDescription>
              Submitted claims stay here until a Readyaimgo admin reviews them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-white/60 p-5 text-sm leading-6 text-slate-600">
                No active access requests yet.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="rounded-2xl border border-border/70 bg-white/70 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-950">
                          {request.requestedWorkspaceName ||
                            request.requestedClientName ||
                            request.requestedClientId}
                        </p>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {request.requestedWorkspaceId || request.requestedClientId}
                        </p>
                      </div>
                      <Badge variant={statusBadgeVariant(request.status)}>
                        {request.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
