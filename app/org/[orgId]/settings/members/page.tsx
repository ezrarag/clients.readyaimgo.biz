"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore"
import { Loader2, Send, Trash2 } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { OrgShell } from "@/components/org/org-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getDb } from "@/lib/firebase/config"
import {
  listOrgInvites,
  listOrgMembers,
  loadOrgAccessContext,
} from "@/lib/org-client"
import {
  isOrgAdmin,
  isOrgOwner,
  type Organization,
  type OrgInvite,
  type OrgMember,
  type OrgMemberRole,
} from "@/lib/organizations"

interface OrgMembersPageProps {
  params: {
    orgId: string
  }
}

function createInviteToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "")
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

export default function OrgMembersPage({ params }: OrgMembersPageProps) {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [org, setOrg] = useState<Organization | null>(null)
  const [member, setMember] = useState<OrgMember | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [invites, setInvites] = useState<OrgInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState(false)
  const [removingUid, setRemovingUid] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<OrgMemberRole>("viewer")
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!user) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const firestoreDb = getDb()
      const access = await loadOrgAccessContext({
        firestoreDb,
        orgId: params.orgId,
        uid: user.uid,
      })

      if (!access) {
        router.replace("/dashboard")
        return
      }

      const [nextMembers, nextInvites] = await Promise.all([
        listOrgMembers(firestoreDb, params.orgId),
        listOrgInvites(firestoreDb, params.orgId),
      ])

      setOrg(access.org)
      setMember(access.member)
      setMembers(nextMembers)
      setInvites(nextInvites)
    } catch (loadError) {
      console.error(loadError)
      setError("Unable to load organization members.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
      return
    }

    if (!authLoading && user) {
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, params.orgId, router, user])

  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!org || !member || !user || !isOrgAdmin(member) || !email.trim()) {
      return
    }

    setInviting(true)
    setError(null)
    setStatusMessage(null)

    try {
      const normalizedEmail = email.trim().toLowerCase()
      const token = createInviteToken()
      const firestoreDb = getDb()
      const inviteUrl = `${window.location.origin}/join?org=${encodeURIComponent(org.id)}&token=${encodeURIComponent(token)}`

      await setDoc(doc(firestoreDb, "organizations", org.id, "invites", normalizedEmail), {
        email: normalizedEmail,
        role,
        invitedBy: user.uid,
        invitedAt: serverTimestamp(),
        status: "pending",
        token,
      })

      const response = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: org.id,
          orgName: org.name,
          email: normalizedEmail,
          role,
          token,
          inviteUrl,
          invitedBy: user.email || user.displayName || "",
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
            : "Invite was saved, but the email could not be queued."
        throw new Error(message)
      }

      setEmail("")
      setRole("viewer")
      setStatusMessage(`Invite sent to ${normalizedEmail}.`)
      await load()
    } catch (inviteError) {
      console.error(inviteError)
      setError(
        inviteError instanceof Error ? inviteError.message : "Unable to send invite."
      )
    } finally {
      setInviting(false)
    }
  }

  const handleRemoveMember = async (target: OrgMember) => {
    if (!org || !member || !isOrgOwner(member) || target.uid === user?.uid) {
      return
    }

    setRemovingUid(target.uid)
    setError(null)

    try {
      const firestoreDb = getDb()
      await deleteDoc(doc(firestoreDb, "organizations", org.id, "members", target.uid))
      await load()
    } catch (removeError) {
      console.error(removeError)
      setError("Unable to remove member.")
    } finally {
      setRemovingUid(null)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !org || !member) {
    return null
  }

  return (
    <OrgShell
      org={org}
      member={member}
      active="members"
      title="Members"
      description="Invite teammates, review access, and manage organization roles."
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Team access
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500">Members</p>
              <p className="text-2xl font-semibold text-slate-950">{members.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Pending</p>
              <p className="text-2xl font-semibold text-slate-950">
                {invites.filter((invite) => invite.status === "pending").length}
              </p>
            </div>
          </div>
        </div>
      }
    >
      {statusMessage ? (
        <div className="mb-6 rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
          {statusMessage}
        </div>
      ) : null}

      {error ? (
        <div className="mb-6 rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.35fr]">
        <Card>
          <CardHeader>
            <CardTitle>Invite Member</CardTitle>
            <CardDescription>
              Owners and admins can invite people into this shared workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isOrgAdmin(member) ? (
              <form onSubmit={handleInvite} className="space-y-4">
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
                  <label className="text-sm font-semibold text-slate-700">Role</label>
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as OrgMemberRole)}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                    {isOrgOwner(member) ? <option value="owner">Owner</option> : null}
                  </select>
                </div>

                <Button type="submit" disabled={inviting}>
                  {inviting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Invite Member
                </Button>
              </form>
            ) : (
              <p className="text-sm leading-7 text-slate-600">
                Viewers can see members, but cannot invite or remove people.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Current Members</CardTitle>
              <CardDescription>{members.length} people can access this workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {members.map((item) => (
                  <div
                    key={item.uid}
                    className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-white/80 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold text-slate-950">{item.name || item.email}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={item.role === "owner" ? "accent" : "secondary"}>
                        {item.role}
                      </Badge>
                      {isOrgOwner(member) && item.uid !== user.uid && item.role !== "owner" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={removingUid === item.uid}
                          onClick={() => void handleRemoveMember(item)}
                        >
                          {removingUid === item.uid ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pending Invites</CardTitle>
              <CardDescription>Invitation records stored on this organization.</CardDescription>
            </CardHeader>
            <CardContent>
              {invites.length > 0 ? (
                <div className="space-y-3">
                  {invites.map((invite) => (
                    <div
                      key={invite.email}
                      className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-white/80 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-semibold text-slate-950">{invite.email}</p>
                        <p className="mt-1 text-sm text-slate-500">{invite.role}</p>
                      </div>
                      <Badge variant={invite.status === "pending" ? "warning" : "secondary"}>
                        {invite.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-slate-500">
                  No invites have been created yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </OrgShell>
  )
}
