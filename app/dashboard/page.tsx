"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth/AuthProvider"
import { signOut } from "@/lib/firebase/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { doc, getDoc, collection, query, where, orderBy, getDocs } from "firebase/firestore"
import { db } from "@/lib/firebase/config"
import { Client, Transaction, Subscription, HousingWallet } from "@/types"
import { format } from "date-fns"
import { Loader2, LogOut, Wallet, Coins, CreditCard, Calendar, RefreshCw, AlertCircle } from "lucide-react"

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [client, setClient] = useState<Client | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [housingWallet, setHousingWallet] = useState<HousingWallet | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [beamCoinBalance, setBeamCoinBalance] = useState<number | null>(null)
  const [beamCoinTransactions, setBeamCoinTransactions] = useState<any[]>([])
  const [beamCoinLoading, setBeamCoinLoading] = useState(false)
  const [beamCoinError, setBeamCoinError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login")
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (user) {
      loadDashboardData()
    }
  }, [user])

  const loadDashboardData = async () => {
    if (!user) return

    try {
      // Load client data
      const clientDoc = await getDoc(doc(db, "clients", user.uid))
      if (clientDoc.exists()) {
        const clientData = { id: clientDoc.id, ...clientDoc.data() } as Client
        setClient(clientData)

        // Load subscription if Stripe customer ID exists
        if (clientData.stripeCustomerId) {
          const subRes = await fetch(`/api/stripe/subscription?customerId=${clientData.stripeCustomerId}`)
          if (subRes.ok) {
            const subData = await subRes.json()
            setSubscription(subData)
          }
        }

        // Load housing wallet
        const walletRes = await fetch(`/api/housing-wallet?clientId=${user.uid}`)
        if (walletRes.ok) {
          const walletData = await walletRes.json()
          setHousingWallet(walletData)
        }

        // Load transactions
        const transactionsQuery = query(
          collection(db, "transactions"),
          where("clientId", "==", user.uid),
          orderBy("timestamp", "desc")
        )
        const transactionsSnapshot = await getDocs(transactionsQuery)
        const transactionsData = transactionsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp?.toDate?.() || doc.data().timestamp,
        })) as Transaction[]
        setTransactions(transactionsData)

        // Load BEAM Coin balance
        await loadBeamCoinBalance(user.uid)
      }
    } catch (error) {
      console.error("Error loading dashboard data:", error)
    } finally {
      setLoading(false)
    }
  }

  const loadBeamCoinBalance = async (uid: string) => {
    setBeamCoinLoading(true)
    setBeamCoinError(null)
    
    try {
      // Fetch live balance from BEAM Coin Ledger API
      const balanceRes = await fetch(`/api/beam-coin?clientId=${uid}`)
      if (balanceRes.ok) {
        const balanceData = await balanceRes.json()
        setBeamCoinBalance(balanceData.balance || 0)
        
        // Update client state with new balance
        if (client) {
          setClient({ ...client, beamCoinBalance: balanceData.balance || 0 })
        }
      } else {
        throw new Error("Failed to fetch BEAM Coin balance")
      }

      // Fetch BEAM Coin transactions
      const transactionsRes = await fetch(`/api/beam-coin/transactions?clientId=${uid}`)
      if (transactionsRes.ok) {
        const transactionsData = await transactionsRes.json()
        setBeamCoinTransactions(Array.isArray(transactionsData) ? transactionsData.slice(0, 5) : [])
      }
    } catch (error: any) {
      console.error("Error loading BEAM Coin data:", error)
      setBeamCoinError("Ledger unavailable, showing cached balance")
      // Fallback to cached balance
      if (client) {
        setBeamCoinBalance(client.beamCoinBalance || 0)
      }
    } finally {
      setBeamCoinLoading(false)
    }
  }

  const handleRefreshBeamCoin = () => {
    if (user) {
      loadBeamCoinBalance(user.uid)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  const handleManageSubscription = async () => {
    if (!client?.stripeCustomerId) return

    try {
      const res = await fetch("/api/stripe/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: client.stripeCustomerId }),
      })
      const { url } = await res.json()
      if (url) {
        window.location.href = url
      }
    } catch (error) {
      console.error("Error creating portal session:", error)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !client) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-readyaimgo bg-clip-text text-transparent">
              Readyaimgo Client Hub
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">Welcome, {client.name}</span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Card */}
        <Card className="mb-8 bg-gradient-readyaimgo text-white border-0">
          <CardHeader>
            <CardTitle className="text-3xl">Welcome back, {client.name}!</CardTitle>
            <CardDescription className="text-white/80">
              {subscription ? `Current Plan: ${subscription.planName}` : "Get started with a subscription"}
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Subscription Overview */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                <CardTitle>Subscription</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {subscription ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-2xl font-bold">{subscription.planName}</p>
                    <p className="text-sm text-muted-foreground">${subscription.amount}/month</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>Renews {format(new Date(subscription.renewalDate), "MMM d, yyyy")}</span>
                  </div>
                  <Button className="w-full" onClick={handleManageSubscription}>
                    Manage Subscription
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-muted-foreground">No active subscription</p>
                  <Button className="w-full" variant="outline">
                    View Plans
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Housing Wallet */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                <CardTitle>Housing Wallet</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {housingWallet ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-2xl font-bold">{housingWallet.credits} credits</p>
                    <p className="text-sm text-muted-foreground">${housingWallet.value} value</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{housingWallet.description}</p>
                  <Button 
                    className="w-full" 
                    variant="outline"
                    onClick={async () => {
                      if (!user || !housingWallet) return
                      const credits = prompt("How many credits would you like to redeem?")
                      if (credits && parseInt(credits) > 0) {
                        try {
                          const res = await fetch("/api/housing-wallet-redeem", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              clientId: user.uid,
                              credits: parseInt(credits),
                              description: `Redeemed ${credits} housing credits`,
                            }),
                          })
                          const data = await res.json()
                          if (res.ok) {
                            alert(`Successfully redeemed ${credits} credits!`)
                            loadDashboardData()
                          } else {
                            alert(`Error: ${data.error}`)
                          }
                        } catch (error) {
                          alert("Error processing redemption")
                        }
                      }
                    }}
                  >
                    Redeem Nights
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    Powered by BEAM Think Tank Housing Wallet Program
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-muted-foreground">Loading wallet data...</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* BEAM Coin Wallet */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Coins className="h-5 w-5 text-primary" />
                  <CardTitle>BEAM Coin Wallet</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRefreshBeamCoin}
                  disabled={beamCoinLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${beamCoinLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="text-2xl font-bold">
                    {beamCoinLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin inline" />
                    ) : (
                      beamCoinBalance !== null ? beamCoinBalance : client.beamCoinBalance || 0
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Earn, spend, and track your community impact credits
                  </p>
                  {beamCoinError && (
                    <div className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                      <AlertCircle className="h-3 w-3" />
                      <span>{beamCoinError}</span>
                    </div>
                  )}
                </div>
                {beamCoinTransactions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Recent Activity</p>
                    <div className="space-y-1">
                      {beamCoinTransactions.slice(0, 3).map((tx: any, idx: number) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-muted-foreground truncate">
                            {tx.type === "earn" ? "Earned" : "Spent"}
                          </span>
                          <span className={`font-medium ${tx.type === "earn" ? "text-green-600" : "text-red-600"}`}>
                            {tx.type === "earn" ? "+" : "-"}{tx.amount || 0}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* BEAM Coin Transactions */}
        {beamCoinTransactions.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>BEAM Coin Transactions</CardTitle>
              <CardDescription>Your latest BEAM Coin activity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Description</th>
                      <th className="text-right p-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {beamCoinTransactions.map((tx: any, idx: number) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            tx.type === "earn" 
                              ? "bg-green-100 text-green-700" 
                              : "bg-red-100 text-red-700"
                          }`}>
                            {tx.type === "earn" ? "Earned" : "Spent"}
                          </span>
                        </td>
                        <td className="p-2 text-sm">{tx.description || "BEAM Coin transaction"}</td>
                        <td className={`p-2 text-right font-medium ${
                          tx.type === "earn" ? "text-green-600" : "text-red-600"
                        }`}>
                          {tx.type === "earn" ? "+" : "-"}{tx.amount || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Transactions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
            <CardDescription>Your payment and redemption history</CardDescription>
          </CardHeader>
          <CardContent>
            {transactions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Date</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Description</th>
                      <th className="text-right p-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => (
                      <tr key={transaction.id} className="border-b">
                        <td className="p-2 text-sm">
                          {format(
                            new Date(transaction.timestamp),
                            "MMM d, yyyy"
                          )}
                        </td>
                        <td className="p-2">
                          <span className="px-2 py-1 text-xs rounded-full bg-secondary">
                            {transaction.type}
                          </span>
                        </td>
                        <td className="p-2 text-sm">{transaction.description}</td>
                        <td className="p-2 text-right font-medium">
                          ${transaction.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No transactions yet
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

