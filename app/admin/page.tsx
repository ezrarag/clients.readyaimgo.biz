"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth/AuthProvider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { collection, getDocs } from "firebase/firestore"
import { db } from "@/lib/firebase/config"
import { Client } from "@/types"
import {
  Loader2,
  LogOut,
  Search,
  TrendingUp,
  Users,
  DollarSign,
  Download,
  ArrowUpDown,
  Coins,
} from "lucide-react"
import { signOut } from "@/lib/firebase/auth"
import { format } from "date-fns"
import {
  getAdminClients,
  getAdminTransactions,
  getAdminStats,
  exportTransactionsToCSV,
  exportClientsToCSV,
  downloadCSV,
  type AdminClient,
  type AdminTransaction,
  type AdminStats,
} from "@/lib/admin"

type TabValue = "overview" | "clients" | "transactions" | "reports"

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabValue>("overview")
  const [clients, setClients] = useState<AdminClient[]>([])
  const [transactions, setTransactions] = useState<AdminTransaction[]>([])
  const [stats, setStats] = useState<AdminStats>({
    totalBeamCoins: 0,
    totalClients: 0,
    totalUsdSubscriptions: 0,
  })
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<"all" | "earn" | "spend">("all")
  const [sortField, setSortField] = useState<string>("")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")
  const adminUid = process.env.NEXT_PUBLIC_ADMIN_UID || ""

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
    } else if (user && user.uid !== adminUid) {
      router.push("/dashboard")
    }
  }, [user, authLoading, router, adminUid])

  useEffect(() => {
    if (user && user.uid === adminUid) {
      loadAdminData()
    }
  }, [user, adminUid])

  const loadAdminData = async () => {
    try {
      setLoading(true)

      // Get Firebase ID token for admin API calls
      const idToken = user ? await user.getIdToken() : undefined

      // Load stats (overview)
      const adminStats = await getAdminStats(idToken)
      setStats(adminStats)

      // Load clients from BEAM Ledger admin endpoint, fallback to Firestore
      let adminClients = await getAdminClients(idToken)
      if (adminClients.length === 0) {
        // Fallback to Firestore
        const snapshot = await getDocs(collection(db, "clients"))
        adminClients = snapshot.docs.map((doc) => ({
          uid: doc.id,
          name: doc.data().name || "",
          email: doc.data().email || "",
          planType: doc.data().planType || "",
          beamCoinBalance: doc.data().beamCoinBalance || 0,
          housingWalletBalance: doc.data().housingWalletBalance || 0,
          stripeCustomerId: doc.data().stripeCustomerId || "",
          createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || "",
        })) as AdminClient[]

        // Update stats from Firestore data if not available from API
        if (adminStats.totalClients === 0) {
          setStats({
            ...adminStats,
            totalClients: adminClients.length,
            totalBeamCoins: adminClients.reduce((sum, c) => sum + (c.beamCoinBalance || 0), 0),
          })
        }
      }
      setClients(adminClients)

      // Load transactions from BEAM Ledger admin endpoint
      const adminTransactions = await getAdminTransactions(100, idToken)
      setTransactions(adminTransactions)
    } catch (error) {
      console.error("Error loading admin data:", error)
    } finally {
      setLoading(false)
    }
  }

  // Filter and sort clients
  const filteredAndSortedClients = useMemo(() => {
    let filtered = clients.filter((client) => {
      const query = searchQuery.toLowerCase()
      return (
        client.name?.toLowerCase().includes(query) ||
        client.email?.toLowerCase().includes(query) ||
        client.uid.toLowerCase().includes(query)
      )
    })

    if (sortField) {
      filtered.sort((a, b) => {
        let aVal: any = a[sortField as keyof AdminClient]
        let bVal: any = b[sortField as keyof AdminClient]
        if (typeof aVal === "string") {
          aVal = aVal.toLowerCase()
          bVal = (bVal || "").toLowerCase()
        }
        if (sortDirection === "asc") {
          return aVal > bVal ? 1 : -1
        } else {
          return aVal < bVal ? 1 : -1
        }
      })
    }

    return filtered
  }, [clients, searchQuery, sortField, sortDirection])

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    let filtered = transactions

    if (transactionTypeFilter !== "all") {
      filtered = filtered.filter((t) => t.type === transactionTypeFilter)
    }

    return filtered.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime()
      const bTime = new Date(b.timestamp).getTime()
      return bTime - aTime // Most recent first
    })
  }, [transactions, transactionTypeFilter])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("asc")
    }
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

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || user.uid !== adminUid) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-readyaimgo bg-clip-text text-transparent">
              Admin Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              BEAM Coin & Readyaimgo Client Management
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="clients">Clients</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total BEAM Coins</CardTitle>
                  <Coins className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.totalBeamCoins.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">In circulation</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.totalClients.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">Active accounts</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Subscriptions</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    ${stats.totalUsdSubscriptions.toLocaleString()}
                  </div>
                  <p className="text-xs text-muted-foreground">Monthly recurring revenue</p>
                </CardContent>
              </Card>
            </div>

            {/* Monthly Activity Chart Placeholder */}
            <Card>
              <CardHeader>
                <CardTitle>Monthly BEAM Activity</CardTitle>
                <CardDescription>Earn vs Spend trends over time</CardDescription>
              </CardHeader>
              <CardContent>
                {stats.monthlyActivity && stats.monthlyActivity.length > 0 ? (
                  <div className="space-y-4">
                    {stats.monthlyActivity.map((month, idx) => (
                      <div key={idx} className="flex items-center gap-4">
                        <div className="w-24 text-sm text-muted-foreground">{month.month}</div>
                        <div className="flex-1 flex gap-2">
                          <div
                            className="bg-green-500 h-8 flex items-center justify-end pr-2 text-white text-sm rounded"
                            style={{ width: `${(month.earn / (month.earn + month.spend)) * 100}%` }}
                          >
                            {month.earn > 0 && `+${month.earn}`}
                          </div>
                          <div
                            className="bg-red-500 h-8 flex items-center pl-2 text-white text-sm rounded"
                            style={{ width: `${(month.spend / (month.earn + month.spend)) * 100}%` }}
                          >
                            {month.spend > 0 && `-${month.spend}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <TrendingUp className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Monthly activity data will appear here</p>
                    <p className="text-xs mt-1">
                      Once the BEAM Ledger admin stats endpoint includes monthly activity
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Clients Tab */}
          <TabsContent value="clients" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>All Clients</CardTitle>
                    <CardDescription>
                      {filteredAndSortedClients.length} of {clients.length} clients
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search clients..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 w-64"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredAndSortedClients.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th
                            className="text-left p-2 cursor-pointer hover:bg-muted"
                            onClick={() => handleSort("name")}
                          >
                            <div className="flex items-center gap-1">
                              Name
                              <ArrowUpDown className="h-3 w-3" />
                            </div>
                          </th>
                          <th
                            className="text-left p-2 cursor-pointer hover:bg-muted"
                            onClick={() => handleSort("email")}
                          >
                            <div className="flex items-center gap-1">
                              Email
                              <ArrowUpDown className="h-3 w-3" />
                            </div>
                          </th>
                          <th className="text-left p-2">Plan</th>
                          <th
                            className="text-right p-2 cursor-pointer hover:bg-muted"
                            onClick={() => handleSort("beamCoinBalance")}
                          >
                            <div className="flex items-center justify-end gap-1">
                              BEAM Balance
                              <ArrowUpDown className="h-3 w-3" />
                            </div>
                          </th>
                          <th className="text-right p-2">Housing Wallet</th>
                          <th className="text-left p-2">Last Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAndSortedClients.map((client) => (
                          <tr key={client.uid} className="border-b hover:bg-muted/50">
                            <td className="p-2 font-medium">{client.name || "N/A"}</td>
                            <td className="p-2 text-sm">{client.email || "N/A"}</td>
                            <td className="p-2">
                              <span className="px-2 py-1 text-xs rounded-full bg-secondary">
                                {client.planType || "None"}
                              </span>
                            </td>
                            <td className="p-2 text-right font-medium">
                              {client.beamCoinBalance || 0}
                            </td>
                            <td className="p-2 text-right font-medium">
                              ${((client.housingWalletBalance || 0) * 1.5).toFixed(2)}
                            </td>
                            <td className="p-2 text-sm text-muted-foreground">
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
                  <p className="text-center text-muted-foreground py-8">No clients found</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Transactions Tab */}
          <TabsContent value="transactions" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Recent Transactions</CardTitle>
                    <CardDescription>
                      {filteredTransactions.length} transactions
                    </CardDescription>
                  </div>
                  <Select
                    value={transactionTypeFilter}
                    onValueChange={(v) => setTransactionTypeFilter(v as any)}
                  >
                    <SelectTrigger className="w-40">
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
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">UID</th>
                          <th className="text-left p-2">Type</th>
                          <th className="text-right p-2">Amount</th>
                          <th className="text-left p-2">Description</th>
                          <th className="text-left p-2">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTransactions.map((transaction, idx) => (
                          <tr key={transaction.id || idx} className="border-b hover:bg-muted/50">
                            <td className="p-2 text-xs font-mono text-muted-foreground">
                              {transaction.uid.substring(0, 8)}...
                            </td>
                            <td className="p-2">
                              <span
                                className={`px-2 py-1 text-xs rounded-full font-medium ${
                                  transaction.type === "earn"
                                    ? "bg-green-100 text-green-800"
                                    : "bg-red-100 text-red-800"
                                }`}
                              >
                                {transaction.type === "earn" ? "Earn" : "Spend"}
                              </span>
                            </td>
                            <td
                              className={`p-2 text-right font-medium ${
                                transaction.type === "earn" ? "text-green-600" : "text-red-600"
                              }`}
                            >
                              {transaction.type === "earn" ? "+" : "-"}
                              {transaction.amount}
                            </td>
                            <td className="p-2 text-sm">{transaction.description}</td>
                            <td className="p-2 text-sm text-muted-foreground">
                              {format(new Date(transaction.timestamp), "MMM d, yyyy HH:mm")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No transactions found</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Export Data</CardTitle>
                  <CardDescription>Download CSV reports for analysis</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium mb-2">Transactions Export</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Export all transaction data including UID, type, amount, description, and
                      timestamp.
                    </p>
                    <Button onClick={handleExportTransactions} className="w-full">
                      <Download className="h-4 w-4 mr-2" />
                      Download Transactions CSV
                    </Button>
                  </div>

                  <div className="border-t pt-4">
                    <h3 className="text-sm font-medium mb-2">Client Balances Export</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Export all client data including balances, plans, and account information.
                    </p>
                    <Button onClick={handleExportClients} className="w-full" variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Download Client Balances CSV
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Impact Reports</CardTitle>
                  <CardDescription>Partner and donor reports (Coming Soon)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 border rounded-lg">
                      <h3 className="text-sm font-medium mb-2">Marriott Impact Report</h3>
                      <p className="text-xs text-muted-foreground mb-4">
                        Monthly summary of BEAM Coin activity for Marriott partners.
                      </p>
                      <Button disabled variant="outline" className="w-full">
                        Coming Soon
                      </Button>
                    </div>

                    <div className="p-4 border rounded-lg">
                      <h3 className="text-sm font-medium mb-2">Home Depot Impact Report</h3>
                      <p className="text-xs text-muted-foreground mb-4">
                        Monthly summary of BEAM Coin activity for Home Depot partners.
                      </p>
                      <Button disabled variant="outline" className="w-full">
                        Coming Soon
                      </Button>
                    </div>

                    <div className="p-4 border rounded-lg">
                      <h3 className="text-sm font-medium mb-2">PDF Receipt Generator</h3>
                      <p className="text-xs text-muted-foreground mb-4">
                        Generate PDF receipts for donors and partners.
                      </p>
                      <Button disabled variant="outline" className="w-full">
                        Coming Soon
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
