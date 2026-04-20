"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, LogOut, Save } from "lucide-react"
import { doc, getDoc, updateDoc } from "firebase/firestore"

import { useAuth } from "@/components/auth/AuthProvider"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { signOut } from "@/lib/firebase/auth"
import { getDb } from "@/lib/firebase/config"
import { Client } from "@/types"

type SaveState =
  | {
      tone: "success" | "danger"
      text: string
    }
  | null

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [client, setClient] = useState<Client | null>(null)
  const [name, setName] = useState("")
  const [pageLoading, setPageLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
    }
  }, [authLoading, router, user])

  useEffect(() => {
    if (user) {
      loadClientData()
    }
  }, [user])

  const loadClientData = async () => {
    if (!user?.email) return

    try {
      const firestoreDb = getDb()
      const emailKey = user.email.toLowerCase().trim()
      const clientDoc = await getDoc(doc(firestoreDb, "clients", emailKey))

      if (clientDoc.exists()) {
        const docData = clientDoc.data()
        const clientData: Client = {
          uid: docData.uid || user.uid,
          name: docData.name || "",
          email: docData.email || user.email,
          beamCoinBalance: docData.beamCoinBalance || 0,
          housingWalletBalance: docData.housingWalletBalance || 0,
          stripeCustomerId: docData.stripeCustomerId,
          planType: docData.planType,
          createdAt: docData.createdAt?.toDate?.() || docData.createdAt,
        }

        setClient(clientData)
        setName(clientData.name)
      }
    } catch (error) {
      console.error("Error loading client data:", error)
    } finally {
      setPageLoading(false)
    }
  }

  const handleSave = async () => {
    if (!user?.email || !client) return

    setSaving(true)
    setSaveState(null)

    try {
      const firestoreDb = getDb()
      const emailKey = user.email.toLowerCase().trim()
      await updateDoc(doc(firestoreDb, "clients", emailKey), {
        name,
      })
      setClient({ ...client, name })
      setSaveState({
        tone: "success",
        text: "Account settings saved successfully.",
      })
    } catch (error) {
      console.error("Error saving settings:", error)
      setSaveState({
        tone: "danger",
        text: "Unable to save settings right now.",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  if (authLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !client) {
    return null
  }

  return (
    <AppShell
      title="Account settings"
      description="Keep profile details current and manage the account actions that apply across the client workspace."
      eyebrow="Preferences"
      nav={[
        { href: "/dashboard", label: "Dashboard" },
        { href: "/settings", label: "Settings", active: true },
      ]}
      actions={
        <>
          <Badge variant="secondary">{client.email}</Badge>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </>
      }
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Current plan
          </p>
          <p className="mt-3 text-2xl font-semibold text-slate-950">
            {client.planType || "Free Tier"}
          </p>
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

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Update the identity details that appear across your client account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Email</label>
              <Input value={client.email} disabled />
              <p className="text-sm text-slate-500">Email is fixed to your account record.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Full name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Changes
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setName(client.name)
                  setSaveState(null)
                }}
              >
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account actions</CardTitle>
            <CardDescription>
              Sign out securely or return to the dashboard to continue working.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[24px] border border-border/70 bg-muted/35 p-4">
              <p className="text-sm leading-7 text-slate-600">
                Profile changes apply immediately inside the shared Readyaimgo workspace.
              </p>
            </div>
            <Button variant="outline" onClick={() => router.push("/dashboard")} className="w-full">
              Back to Dashboard
            </Button>
            <Button variant="destructive" onClick={handleSignOut} className="w-full">
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
