"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  ArrowUpDown,
  Coins,
  DollarSign,
  Download,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
} from "lucide-react"
import { collection, getDocs } from "firebase/firestore"

import { useAuth } from "@/components/auth/AuthProvider"
import { AppShell } from "@/components/site/app-shell"
import { MetricCard } from "@/components/site/metric-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getDb } from "@/lib/firebase/config"
import { signOut } from "@/lib/firebase/auth"
import {
  downloadCSV,
  exportClientsToCSV,
  exportTransactionsToCSV,
  getAdminClients,
  getAdminStats,
  getAdminTransactions,
  type AdminClient,
  type AdminStats,
  type AdminTransaction,
} from "@/lib/admin"

type TabValue = "overview" | "clients" | "transactions" | "reports"

export default function AdminPage() {
  const { user, effectiveRoles, loading: authLoading } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabValue>("overview")
  const [clients, setClients] = useState<AdminClient[]>([])
  const [transactions, setTransactions] = useState<AdminTransaction[]>([])
  const [stats, setStats] = useState<AdminStats>({
    totalBeamCoins: 0,
    totalClients: 0,
    totalUsdSubscriptions: 0,
  })
  const [pageLoading, setPageLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [planTypeFilter, setPlanTypeFilter] = useState<string>("all")
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<"all" | "earn" | "spend">("all")
  const [sortField, setSortField] = useState<string>("")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  const isBeamAdmin = effectiveRoles.includes("beam-admin")

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
      return
    }

    if (user && !isBeamAdmin) {
      router.push("/dashboard")
    }
  }, [authLoading, isBeamAdmin, router, user])

  // Quick nav link to impersonation page
  // Accessible from the admin tab bar below

  useEffect(() => {
    if (user && isBeamAdmin) {
      loadAdminData()
    }
  }, [isBeamAdmin, user])

  const loadAdminData = async () => {
    try {
      setPageLoading(true)
      const idToken = user ? await user.getIdToken() : undefined
      const adminStats = await getAdminStats(idToken)
      setStats(adminStats)

      let adminClients = await getAdminClients(idToken)
      if (adminClients.length === 0) {
        try {
          const firestoreDb = getDb()
          const snapshot = await getDocs(collection(firestoreDb, "clients"))
          adminClients = snapshot.docs.map((clientDoc) => {
            const data = clientDoc.data()
            const uid = data.uid || clientDoc.id

            return {
              uid,
              name: data.name || "",
              email: data.email || "",
              planType: data.planType || "",
              beamCoinBalance: data.beamCoinBalance || 0,
              housingWalletBalance: data.housingWalletBalance || 0,
              stripeCustomerId: data.stripeCustomerId || "",
              createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || "",
            }
          }) as AdminClient[]

          if (adminStats.totalClients === 0) {
            setStats({
              ...adminStats,
              totalClients: adminClients.length,
              totalBeamCoins: adminClients.reduce(
                (sum, currentClient) => sum + (currentClient.beamCoinBalance || 0),
                0
              ),
            })
          }
        } catch (firestoreError) {
          console.error("Error loading clients from Firestore:", firestoreError)
          adminClients = []
        }
      }

      const adminTransactions = await getAdminTransactions(100, idToken)
      setClients(adminClients)
      setTransactions(adminTransactions)
      setLastLoadedAt(new Date())
    } catch (error) {
      console.error("Error loading admin data:", error)
      setClients([])
      setTransactions([])
    } finally {
      setPageLoading(false)
    }
  }

  const filteredAndSortedClients = useMemo(() => {
    const filtered = clients.filter((client) => {
      if (planTypeFilter !== "all") {
        const clientPlanType = (client.planType || "").toLowerCase()
        const filterPlanType = planTypeFilter.toLowerCase()

        if (filterPlanType === "c suite" || filterPlanType === "c-suite") {
          if (
            !clientPlanType.includes("suite") &&
            !clientPlanType.includes("c-suite") &&
            !clientPlanType.includes("csuite")
          ) {
            return false
          }
        } else if (clientPlanType !== filterPlanType) {
          return false
        }
      }

      const query = searchQuery.toLowerCase()
      if (!query) return true

      return (
        client.name?.toLowerCase().includes(query) ||
        client.email?.toLowerCase().includes(query) ||
        client.uid.toLowerCase().includes(query)
      )
    })

    if (!sortField) {
      return filtered
    }

    return [...filtered].sort((a, b) => {
      let aVal: any = a[sortField as keyof AdminClient]
      let bVal: any = b[sortField as keyof AdminClient]

      if (typeof aVal === "string") {
        aVal = aVal.toLowerCase()
        bVal = (bVal || "").toLowerCase()
      }

      if (sortDirection === "asc") {
        return aVal > bVal ? 1 : -1
      }

      return aVal < bVal ? 1 : -1
    })
  }, [clients, planTypeFilter, searchQuery, sortDirection, sortField])

  const filteredTransactions = useMemo(() => {
    let filtered = transactions
    if (transactionTypeFilter !== "all") {
      filtered = filtered.filter((transaction) => transaction.type === transactionTypeFilter)
    }

    return [...filtered].sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime()
      const bTime = new Date(b.timestamp).getTime()
      return bTime - aTime
    })
  }, [transactionTypeFilter, transactions])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
      return
    }

    setSortField(field)
    setSortDirection("asc")
  }

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  const handleExportTransactions = () => {
    const csv = exportTransactionsToCSV(filteredTransactions)
    downloadCSV(csv, `beam-transactions-${format(new Date(), "yyyy-MM-dd")}.csv`)
  }

  const handleExportClients = () => {
    const csv = exportClientsToCSV(filteredAndSortedClients)
    downloadCSV(csv, `beam-clients-${format(new Date(), "yyyy-MM-dd")}.csv`)
  }

  if (authLoading || pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !isBeamAdmin) {
    return null
  }

  return (
    <AppShell
      title="Admin control panel"
      description="Monitor BEAM Coin activity, client growth, subscriptions, and exports inside the same system used across the rest of the platform."
      eyebrow="Operations"
      nav={[
        { href: "/admin", label: "Admin", active: true },
        { href: "/admin/projects", label: "Projects" },
      ]}
      actions={
        <>
          {lastLoadedAt ? (
            <Badge variant="secondary">Updated {format(lastLoadedAt, "MMM d, yyyy h:mm a")}</Badge>
          ) : null}
          <Button onClick={() => router.push("/admin/projects")}>
            Projects
          </Button>
          <Button variant="outline" onClick={loadAdminData}>
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
            Reporting scope
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="accent">{stats.totalClients.toLocaleString()} clients</Badge>
            <Badge variant="secondary">{stats.totalBeamCoins.toLocaleString()} BEAM</Badge>
            <Badge>{`$${stats.totalUsdSubscriptions.toLocaleString()} MRR`}</Badge>
          </div>
        </div>
      }
    >
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabValue)}>
        <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              icon={Coins}
              label="Total BEAM Coins"
              value={stats.totalBeamCoins.toLocaleString()}
              detail="Current credits tracked across the platform."
              tone="brand"
            />
            <MetricCard
              icon={Users}
              label="Total Clients"
              value={stats.totalClients.toLocaleString()}
              detail="Client accounts connected to the system."
              tone="cool"
            />
            <MetricCard
              icon={DollarSign}
              label="Monthly Revenue"
              value={`$${stats.totalUsdSubscriptions.toLocaleString()}`}
              detail="Recurring subscription value reported by the platform."
              tone="success"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Monthly BEAM Activity</CardTitle>
              <CardDescription>
                Earn versus spend behavior over time, styled in the same reporting surface as the
                rest of the app.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stats.monthlyActivity && stats.monthlyActivity.length > 0 ? (
                <div className="space-y-4">
                  {stats.monthlyActivity.map((month) => {
                    const total = month.earn + month.spend
                    const earnWidth = total ? `${(month.earn / total) * 100}%` : "0%"
                    const spendWidth = total ? `${(month.spend / total) * 100}%` : "0%"

                    return (
                      <div key={month.month} className="space-y-2">
                        <div className="flex items-center justify-between gap-4">
                          <p className="font-semibold text-slate-900">{month.month}</p>
                          <p className="text-sm text-slate-500">
                            +{month.earn} / -{month.spend}
                          </p>
                        </div>
                        <div className="flex overflow-hidden rounded-full bg-muted/60">
                          <div
                            className="flex h-9 items-center justify-end bg-emerald-500 px-3 text-xs font-semibold text-white"
                            style={{ width: earnWidth }}
                          >
                            {month.earn > 0 ? `+${month.earn}` : ""}
                          </div>
                          <div
                            className="flex h-9 items-center bg-rose-500 px-3 text-xs font-semibold text-white"
                            style={{ width: spendWidth }}
                          >
                            {month.spend > 0 ? `-${month.spend}` : ""}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="py-12 text-center text-slate-500">
                  <TrendingUp className="mx-auto mb-3 h-12 w-12 opacity-40" />
                  <p className="font-medium text-slate-700">Monthly activity will appear here.</p>
                  <p className="mt-2 text-sm">
                    Once the admin stats endpoint exposes historical trends, this card is ready.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clients" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <CardTitle>Client Directory</CardTitle>
                  <CardDescription>
                    {filteredAndSortedClients.length} of {clients.length} clients shown.
                  </CardDescription>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Select value={planTypeFilter} onValueChange={setPlanTypeFilter}>
                    <SelectTrigger className="w-full sm:w-44">
                      <SelectValue placeholder="Filter by plan" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Plans</SelectItem>
                      <SelectItem value="c suite">C Suite</SelectItem>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="premium">Premium</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="Search clients..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-11"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredAndSortedClients.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-[820px] w-full text-left text-sm">
                    <thead className="border-b border-border/70 text-xs uppercase tracking-[0.24em] text-slate-500">
                      <tr>
                        <th className="px-2 py-3 font-semibold">
                          <button className="flex items-center gap-1" onClick={() => handleSort("name")}>
                            Name
                            <ArrowUpDown className="h-3.5 w-3.5" />
                          </button>
                        </th>
                        <th className="px-2 py-3 font-semibold">
                          <button className="flex items-center gap-1" onClick={() => handleSort("email")}>
                            Email
                            <ArrowUpDown className="h-3.5 w-3.5" />
                          </button>
                        </th>
                        <th className="px-2 py-3 font-semibold">Plan</th>
                        <th className="px-2 py-3 text-right font-semibold">
                          <button
                            className="ml-auto flex items-center gap-1"
                            onClick={() => handleSort("beamCoinBalance")}
                          >
                            BEAM Balance
                            <ArrowUpDown className="h-3.5 w-3.5" />
                          </button>
                        </th>
                        <th className="px-2 py-3 text-right font-semibold">Housing Wallet</th>
                        <th className="px-2 py-3 font-semibold">Last Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSortedClients.map((client) => (
                        <tr key={client.uid} className="border-b border-border/50 last:border-none">
                          <td className="px-2 py-4 font-medium text-slate-900">
                            {client.name || "N/A"}
                          </td>
                          <td className="px-2 py-4 text-slate-600">{client.email || "N/A"}</td>
                          <td className="px-2 py-4">
                            <Badge variant="secondary">{client.planType || "None"}</Badge>
                          </td>
                          <td className="px-2 py-4 text-right font-semibold text-slate-950">
                            {client.beamCoinBalance || 0}
                          </td>
                          <td className="px-2 py-4 text-right font-semibold text-slate-950">
                            ${((client.housingWalletBalance || 0) * 1.5).toFixed(2)}
                          </td>
                          <td className="px-2 py-4 text-slate-600">
                            {client.lastActive
                              ? format(new Date(client.lastActive), "MMM d, yyyy")
                              : client.createdAt
                                ? format(new Date(client.createdAt), "MMM d, yyyy")
                                : "N/A"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-slate-500">No clients found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <CardTitle>Recent Transactions</CardTitle>
                  <CardDescription>
                    {filteredTransactions.length} transactions currently visible.
                  </CardDescription>
                </div>
                <Select
                  value={transactionTypeFilter}
                  onValueChange={(value) =>
                    setTransactionTypeFilter(value as "all" | "earn" | "spend")
                  }
                >
                  <SelectTrigger className="w-full sm:w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="earn">Earn Only</SelectItem>
                    <SelectItem value="spend">Spend Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {filteredTransactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-[760px] w-full text-left text-sm">
                    <thead className="border-b border-border/70 text-xs uppercase tracking-[0.24em] text-slate-500">
                      <tr>
                        <th className="px-2 py-3 font-semibold">UID</th>
                        <th className="px-2 py-3 font-semibold">Type</th>
                        <th className="px-2 py-3 text-right font-semibold">Amount</th>
                        <th className="px-2 py-3 font-semibold">Description</th>
                        <th className="px-2 py-3 font-semibold">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.map((transaction, index) => (
                        <tr
                          key={transaction.id || `${transaction.uid}-${index}`}
                          className="border-b border-border/50 last:border-none"
                        >
                          <td className="px-2 py-4 font-mono text-xs text-slate-500">
                            {transaction.uid.substring(0, 8)}...
                          </td>
                          <td className="px-2 py-4">
                            <Badge variant={transaction.type === "earn" ? "success" : "danger"}>
                              {transaction.type === "earn" ? "Earn" : "Spend"}
                            </Badge>
                          </td>
                          <td
                            className={`px-2 py-4 text-right font-semibold ${
                              transaction.type === "earn" ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {transaction.type === "earn" ? "+" : "-"}
                            {transaction.amount}
                          </td>
                          <td className="px-2 py-4 text-slate-700">{transaction.description}</td>
                          <td className="px-2 py-4 text-slate-600">
                            {format(new Date(transaction.timestamp), "MMM d, yyyy h:mm a")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-slate-500">No transactions found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Export Data</CardTitle>
                <CardDescription>
                  Download transaction and client records for offline analysis.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-[24px] border border-border/70 bg-muted/35 p-5">
                  <h3 className="text-lg font-semibold text-slate-950">Transactions CSV</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    Export UID, type, amount, description, and timestamp for the current
                    transaction set.
                  </p>
                  <Button onClick={handleExportTransactions} className="mt-4 w-full">
                    <Download className="mr-2 h-4 w-4" />
                    Download Transactions CSV
                  </Button>
                </div>

                <div className="rounded-[24px] border border-border/70 bg-white/80 p-5">
                  <h3 className="text-lg font-semibold text-slate-950">Client Balances CSV</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    Export client names, plans, balances, and housing wallet values.
                  </p>
                  <Button onClick={handleExportClients} variant="outline" className="mt-4 w-full">
                    <Download className="mr-2 h-4 w-4" />
                    Download Client Balances CSV
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Partner Reporting</CardTitle>
                <CardDescription>
                  Reserved cards for branded impact reporting and donor-ready exports.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  "Marriott Impact Report",
                  "Home Depot Impact Report",
                  "PDF Receipt Generator",
                ].map((item) => (
                  <div key={item} className="rounded-[24px] border border-border/70 bg-white/80 p-5">
                    <h3 className="text-lg font-semibold text-slate-950">{item}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600">
                      Shared reporting surface prepared for future partner-specific deliverables.
                    </p>
                    <Button disabled variant="outline" className="mt-4 w-full">
                      Coming Soon
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-slate-900">Projects</p>
            <p className="text-sm text-slate-500 mt-0.5">
              Create project records, review status badges, and open project detail pages.
            </p>
          </div>
          <Button onClick={() => router.push("/admin/projects")} className="flex-shrink-0">
            Open Projects
          </Button>
        </div>

        {/* ── Client impersonation quick link ─────────────────────────── */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-slate-900">Client view & RAG notes</p>
          <p className="text-sm text-slate-500 mt-0.5">
            View any client's dashboard as they see it and send pulse summaries or team notes directly into their portal.
          </p>
        </div>
        <Button onClick={() => router.push("/admin/impersonate")} className="flex-shrink-0">
          Open Client View
        </Button>
        </div>
      </div>
    </AppShell>
  )
}
