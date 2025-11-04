"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth/AuthProvider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { collection, getDocs } from "firebase/firestore"
import { db } from "@/lib/firebase/config"
import { Client } from "@/types"
import { Loader2, LogOut } from "lucide-react"
import { signOut } from "@/lib/firebase/auth"

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
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
      loadClients()
    }
  }, [user, adminUid])

  const loadClients = async () => {
    try {
      const snapshot = await getDocs(collection(db, "clients"))
      const clientsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Client[]
      setClients(clientsData)
    } catch (error) {
      console.error("Error loading clients:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
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
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardHeader>
            <CardTitle>All Clients</CardTitle>
            <CardDescription>View all registered clients and their balances</CardDescription>
          </CardHeader>
          <CardContent>
            {clients.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Email</th>
                      <th className="text-left p-2">Plan</th>
                      <th className="text-right p-2">BEAM Coin</th>
                      <th className="text-right p-2">Housing Wallet</th>
                      <th className="text-left p-2">Stripe ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client) => (
                      <tr key={client.uid} className="border-b">
                        <td className="p-2 font-medium">{client.name}</td>
                        <td className="p-2 text-sm">{client.email}</td>
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
                        <td className="p-2 text-xs text-muted-foreground font-mono">
                          {client.stripeCustomerId?.substring(0, 20) || "N/A"}...
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No clients found
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

