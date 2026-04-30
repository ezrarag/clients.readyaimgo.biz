"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { doc, updateDoc } from "firebase/firestore"
import { Loader2, Save, Users } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { OrgShell } from "@/components/org/org-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { getDb } from "@/lib/firebase/config"
import { listOrgMembers, loadOrgAccessContext } from "@/lib/org-client"
import {
  isOrgAdmin,
  type Organization,
  type OrgMember,
  type OrgPlan,
  type OrgStatus,
} from "@/lib/organizations"

interface OrgSettingsPageProps {
  params: {
    orgId: string
  }
}

type SaveState =
  | {
      tone: "success" | "danger"
      text: string
    }
  | null

export default function OrgSettingsPage({ params }: OrgSettingsPageProps) {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [org, setOrg] = useState<Organization | null>(null)
  const [member, setMember] = useState<OrgMember | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>(null)
  const [name, setName] = useState("")
  const [plan, setPlan] = useState<OrgPlan>("starter")
  const [status, setStatus] = useState<OrgStatus>("trial")
  const [city, setCity] = useState("")
  const [website, setWebsite] = useState("")
  const [logoUrl, setLogoUrl] = useState("")
  const [onboardingNotes, setOnboardingNotes] = useState("")

  const load = async () => {
    if (!user) {
      return
    }

    setLoading(true)

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

      const nextMembers = await listOrgMembers(firestoreDb, params.orgId)

      setOrg(access.org)
      setMember(access.member)
      setMembers(nextMembers)
      setName(access.org.name)
      setPlan(access.org.plan)
      setStatus(access.org.status)
      setCity(access.org.city)
      setWebsite(access.org.website)
      setLogoUrl(access.org.logoUrl ?? "")
      setOnboardingNotes(access.org.onboardingNotes)
    } catch (loadError) {
      console.error(loadError)
      setSaveState({ tone: "danger", text: "Unable to load organization settings." })
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

  const handleSave = async () => {
    if (!org || !member || !isOrgAdmin(member)) {
      return
    }

    setSaving(true)
    setSaveState(null)

    try {
      const firestoreDb = getDb()
      await updateDoc(doc(firestoreDb, "organizations", org.id), {
        name: name.trim(),
        plan,
        status,
        city: city.trim(),
        website: website.trim(),
        logoUrl: logoUrl.trim() || null,
        onboardingNotes: onboardingNotes.trim(),
      })

      setOrg({
        ...org,
        name: name.trim(),
        plan,
        status,
        city: city.trim(),
        website: website.trim(),
        logoUrl: logoUrl.trim() || null,
        onboardingNotes: onboardingNotes.trim(),
      })
      setSaveState({ tone: "success", text: "Organization settings saved." })
    } catch (saveError) {
      console.error(saveError)
      setSaveState({ tone: "danger", text: "Unable to save organization settings." })
    } finally {
      setSaving(false)
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
      active="settings"
      title="Organization Settings"
      description="Manage company profile, plan, billing identifiers, and workspace membership."
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Access
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="accent">{member.role}</Badge>
            <Badge variant="secondary">{members.length} members</Badge>
            <Badge>{org.plan}</Badge>
          </div>
        </div>
      }
    >
      {saveState ? (
        <div
          className={`mb-6 rounded-[24px] border px-5 py-4 text-sm ${
            saveState.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {saveState.text}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Company Profile</CardTitle>
            <CardDescription>
              These fields define the shared workspace for every member.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Name</label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!isOrgAdmin(member)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">City</label>
                <Input
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  disabled={!isOrgAdmin(member)}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Plan</label>
                <select
                  value={plan}
                  onChange={(event) => setPlan(event.target.value as OrgPlan)}
                  disabled={!isOrgAdmin(member)}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                >
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Status</label>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as OrgStatus)}
                  disabled={!isOrgAdmin(member)}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                >
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="paused">Paused</option>
                  <option value="churned">Churned</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Website</label>
              <Input
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                disabled={!isOrgAdmin(member)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Logo URL</label>
              <Input
                value={logoUrl}
                onChange={(event) => setLogoUrl(event.target.value)}
                disabled={!isOrgAdmin(member)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Onboarding notes</label>
              <Textarea
                value={onboardingNotes}
                onChange={(event) => setOnboardingNotes(event.target.value)}
                disabled={!isOrgAdmin(member)}
              />
            </div>

            {isOrgAdmin(member) ? (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Settings
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Members & Billing</CardTitle>
            <CardDescription>Manage teammates and subscription identifiers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[24px] border border-border/70 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Stripe customer</p>
              <p className="mt-1 break-all text-sm font-semibold text-slate-950">
                {org.stripeCustomerId || "Not connected"}
              </p>
            </div>
            <div className="rounded-[24px] border border-border/70 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Subscription</p>
              <p className="mt-1 break-all text-sm font-semibold text-slate-950">
                {org.subscriptionId || "Not connected"}
              </p>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href={`/org/${org.id}/settings/members`}>
                <Users className="mr-2 h-4 w-4" />
                Manage Members
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </OrgShell>
  )
}
