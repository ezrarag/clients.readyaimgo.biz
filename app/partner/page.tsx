"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { Check, Copy, Loader2, LogOut, RefreshCw } from "lucide-react"
import { doc, getDoc } from "firebase/firestore"

import { useAuth } from "@/components/auth/AuthProvider"
import { ReferralLinkGenerator } from "@/components/partner/referral-link-generator"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CLIENT_SERVICE_OPTIONS } from "@/lib/client-onboarding"
import { signOut } from "@/lib/firebase/auth"
import { getDb } from "@/lib/firebase/config"
import {
  conversionRate,
  normalizePartnerRecord,
  type PartnerRecord,
  type PartnerSubClient,
} from "@/lib/partner"
import type { Client } from "@/types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseSubClients(value: unknown): PartnerSubClient[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is PartnerSubClient => {
    return (
      isRecord(item) &&
      typeof item.email === "string" &&
      typeof item.companyName === "string" &&
      typeof item.organizationType === "string" &&
      Array.isArray(item.serviceInterests) &&
      item.serviceInterests.every((service) => typeof service === "string") &&
      typeof item.onboardingStatus === "string" &&
      (typeof item.createdAt === "string" || item.createdAt === null) &&
      typeof item.handoffId === "string"
    )
  })
}

function formatOptionalDate(value: string | null) {
  if (!value) {
    return "N/A"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "N/A"
  }

  return format(date, "MMM d, yyyy")
}

function serviceLabel(serviceId: string) {
  return CLIENT_SERVICE_OPTIONS.find((option) => option.id === serviceId)?.label || serviceId
}

export default function PartnerPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [clientData, setClientData] = useState<Client | null>(null)
  const [partner, setPartner] = useState<PartnerRecord | null>(null)
  const [subClients, setSubClients] = useState<PartnerSubClient[]>([])
  const [pageLoading, setPageLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedHandoffId, setCopiedHandoffId] = useState<string | null>(null)

  const loadPartnerData = useCallback(async () => {
    if (!user?.email) {
      return
    }

    setPageLoading(true)
    setError(null)

    try {
      const firestoreDb = getDb()
      const emailKey = user.email.toLowerCase().trim()
      const clientSnap = await getDoc(doc(firestoreDb, "clients", emailKey))
      const clientDoc = clientSnap.exists() ? (clientSnap.data() as Client) : null

      if (!clientDoc || clientDoc.partnerTier !== "agency") {
        router.replace("/dashboard")
        return
      }

      setClientData(clientDoc)

      const [partnerRes, subClientsRes] = await Promise.all([
        fetch(`/api/partner/referrals?email=${encodeURIComponent(user.email)}`),
        fetch(`/api/partner/sub-clients?email=${encodeURIComponent(user.email)}`),
      ])

      const partnerJson: unknown = await partnerRes.json()
      const subClientsJson: unknown = await subClientsRes.json()

      if (!partnerRes.ok) {
        const message =
          isRecord(partnerJson) && typeof partnerJson.error === "string"
            ? partnerJson.error
            : "Unable to load partner referrals."
        throw new Error(message)
      }

      if (!subClientsRes.ok) {
        const message =
          isRecord(subClientsJson) && typeof subClientsJson.error === "string"
            ? subClientsJson.error
            : "Unable to load partner clients."
        throw new Error(message)
      }

      setPartner(
        normalizePartnerRecord(
          user.email,
          isRecord(partnerJson) ? partnerJson : {}
        )
      )
      setSubClients(
        parseSubClients(
          isRecord(subClientsJson) ? subClientsJson.subClients : []
        )
      )
    } catch (loadError) {
      console.error(loadError)
      setError("Unable to load partner workspace.")
    } finally {
      setPageLoading(false)
    }
  }, [router, user])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
      return
    }

    if (!authLoading && user) {
      void loadPartnerData()
    }
  }, [authLoading, loadPartnerData, router, user])

  const sortedReferralLinks = useMemo(() => {
    return [...(partner?.referralLinks ?? [])].sort((first, second) => {
      return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
    })
  }, [partner?.referralLinks])

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  const handleCopyLink = async (handoffId: string, url: string) => {
    await navigator.clipboard.writeText(url)
    setCopiedHandoffId(handoffId)
    window.setTimeout(() => setCopiedHandoffId(null), 2000)
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

  return (
    <AppShell
      eyebrow="Partner workspace"
      title={`${clientData?.companyName ?? "Partner"} — Agency dashboard`}
      description="Manage the clients you have brought into the RAG ecosystem."
      nav={[
        { href: "/dashboard", label: "My dashboard" },
        { href: "/partner", label: "Partner", active: true },
        { href: "/settings", label: "Settings" },
      ]}
      actions={
        <>
          <Badge variant="secondary">{user.email}</Badge>
          <Button variant="outline" onClick={() => void loadPartnerData()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </>
      }
      intro={
        <div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            Partner snapshot
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "Links sent", value: partner?.totalReferrals ?? 0 },
              { label: "Signed up", value: partner?.totalConvertedReferrals ?? 0 },
              { label: "Conversion", value: `${partner ? conversionRate(partner) : 0}%` },
              { label: "Commission", value: `${partner?.commissionPct ?? 10}%` },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-xs text-slate-500">{stat.label}</p>
                <p className="text-2xl font-semibold text-slate-950">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      }
    >
      {error ? (
        <div className="mb-6 rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Your Clients</CardTitle>
            <CardDescription>
              Businesses that signed up through referral links generated in this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {subClients.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-[820px] w-full text-left text-sm">
                  <thead className="border-b border-border/70 text-xs uppercase tracking-[0.24em] text-slate-500">
                    <tr>
                      <th className="px-2 py-3 font-semibold">Business</th>
                      <th className="px-2 py-3 font-semibold">Type</th>
                      <th className="px-2 py-3 font-semibold">Services</th>
                      <th className="px-2 py-3 font-semibold">Status</th>
                      <th className="px-2 py-3 font-semibold">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subClients.map((client) => (
                      <tr key={`${client.email}-${client.handoffId}`} className="border-b border-border/50 last:border-none">
                        <td className="px-2 py-4">
                          <p className="font-medium text-slate-900">
                            {client.companyName || "N/A"}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{client.email}</p>
                        </td>
                        <td className="px-2 py-4">
                          <Badge variant="secondary">
                            {client.organizationType || "N/A"}
                          </Badge>
                        </td>
                        <td className="px-2 py-4">
                          <div className="flex flex-wrap gap-2">
                            {client.serviceInterests.slice(0, 3).map((service) => (
                              <Badge key={service} variant="secondary">
                                {serviceLabel(service)}
                              </Badge>
                            ))}
                            {client.serviceInterests.length > 3 ? (
                              <Badge variant="secondary">
                                +{client.serviceInterests.length - 3}
                              </Badge>
                            ) : null}
                            {client.serviceInterests.length === 0 ? (
                              <span className="text-xs text-slate-500">N/A</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-4">
                          <Badge
                            variant={
                              client.onboardingStatus === "claimed" ? "accent" : "secondary"
                            }
                          >
                            {client.onboardingStatus || "pending"}
                          </Badge>
                        </td>
                        <td className="px-2 py-4 text-slate-600">
                          {formatOptionalDate(client.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-sm text-slate-500">
                No clients have signed up through your links yet.
              </div>
            )}
          </CardContent>
        </Card>

        <ReferralLinkGenerator
          partnerEmail={user.email ?? ""}
          onLinkGenerated={() => void loadPartnerData()}
        />

        <Card>
          <CardHeader>
            <CardTitle>All Referral Links</CardTitle>
            <CardDescription>
              Track pending and converted handoffs generated for your client pipeline.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sortedReferralLinks.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full text-left text-sm">
                  <thead className="border-b border-border/70 text-xs uppercase tracking-[0.24em] text-slate-500">
                    <tr>
                      <th className="px-2 py-3 font-semibold">Business</th>
                      <th className="px-2 py-3 font-semibold">Type</th>
                      <th className="px-2 py-3 font-semibold">Created</th>
                      <th className="px-2 py-3 font-semibold">Status</th>
                      <th className="px-2 py-3 text-right font-semibold">Copy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedReferralLinks.map((link) => (
                      <tr key={link.handoffId} className="border-b border-border/50 last:border-none">
                        <td className="px-2 py-4">
                          <p className="font-medium text-slate-900">{link.label}</p>
                          {link.notes ? (
                            <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                              {link.notes}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-2 py-4 text-slate-600">
                          {link.businessType || "N/A"}
                        </td>
                        <td className="px-2 py-4 text-slate-600">
                          {formatOptionalDate(link.createdAt)}
                        </td>
                        <td className="px-2 py-4">
                          <Badge variant={link.converted ? "success" : "secondary"}>
                            {link.converted ? "Converted" : "Pending"}
                          </Badge>
                        </td>
                        <td className="px-2 py-4 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title="Copy referral link"
                            onClick={() => void handleCopyLink(link.handoffId, link.url)}
                          >
                            {copiedHandoffId === link.handoffId ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-sm text-slate-500">
                No referral links have been generated yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
