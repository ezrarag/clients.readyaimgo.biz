/**
 * Admin Dashboard Utilities
 * 
 * Handles communication with BEAM Coin Ledger admin endpoints
 * and provides admin dashboard data fetching functions
 */

const BEAM_LEDGER_ADMIN_URL = process.env.NEXT_PUBLIC_BEAM_LEDGER_ADMIN_URL || process.env.NEXT_PUBLIC_BEAM_LEDGER_URL || "https://beam-coin-ledger.vercel.app"

export interface AdminClient {
  uid: string
  name?: string
  email?: string
  planType?: string
  beamCoinBalance: number
  housingWalletBalance: number
  stripeCustomerId?: string
  lastActive?: string
  createdAt?: string
}

export interface AdminTransaction {
  uid: string
  type: "earn" | "spend"
  amount: number
  description: string
  timestamp: string
  id?: string
}

export interface AdminStats {
  totalBeamCoins: number
  totalClients: number
  totalUsdSubscriptions: number
  monthlyActivity?: Array<{ month: string; earn: number; spend: number }>
}

/**
 * Fetch all clients from BEAM Ledger admin endpoint
 * Falls back to Firestore if endpoint is not available
 */
export async function getAdminClients(idToken?: string): Promise<AdminClient[]> {
  try {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    }

    if (idToken) {
      headers["Authorization"] = `Bearer ${idToken}`
    }

    const response = await fetch(`${BEAM_LEDGER_ADMIN_URL}/api/admin/clients`, {
      method: "GET",
      headers,
    })

    if (response.ok) {
      const data = await response.json()
      return Array.isArray(data) ? data : []
    } else {
      // If endpoint doesn't exist yet, return empty array
      // The component will fall back to Firestore
      console.warn("BEAM Ledger admin clients endpoint not available, falling back to Firestore")
      return []
    }
  } catch (error) {
    console.error("Error fetching admin clients:", error)
    return []
  }
}

/**
 * Fetch all transactions from BEAM Ledger admin endpoint
 */
export async function getAdminTransactions(
  limit: number = 100,
  idToken?: string
): Promise<AdminTransaction[]> {
  try {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    }

    if (idToken) {
      headers["Authorization"] = `Bearer ${idToken}`
    }

    const response = await fetch(
      `${BEAM_LEDGER_ADMIN_URL}/api/admin/transactions?limit=${limit}`,
      {
        method: "GET",
        headers,
      }
    )

    if (response.ok) {
      const data = await response.json()
      return Array.isArray(data) ? data : []
    } else {
      console.warn("BEAM Ledger admin transactions endpoint not available")
      return []
    }
  } catch (error) {
    console.error("Error fetching admin transactions:", error)
    return []
  }
}

/**
 * Fetch admin statistics (overview KPIs)
 */
export async function getAdminStats(idToken?: string): Promise<AdminStats> {
  try {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    }

    if (idToken) {
      headers["Authorization"] = `Bearer ${idToken}`
    }

    const response = await fetch(`${BEAM_LEDGER_ADMIN_URL}/api/admin/stats`, {
      method: "GET",
      headers,
    })

    if (response.ok) {
      return await response.json()
    } else {
      // Return default stats if endpoint doesn't exist
      return {
        totalBeamCoins: 0,
        totalClients: 0,
        totalUsdSubscriptions: 0,
      }
    }
  } catch (error) {
    console.error("Error fetching admin stats:", error)
    return {
      totalBeamCoins: 0,
      totalClients: 0,
      totalUsdSubscriptions: 0,
    }
  }
}

/**
 * Export transactions to CSV format
 */
export function exportTransactionsToCSV(transactions: AdminTransaction[]): string {
  const headers = ["UID", "Type", "Amount", "Description", "Timestamp"]
  const rows = transactions.map((t) => [
    t.uid,
    t.type,
    t.amount.toString(),
    t.description,
    t.timestamp,
  ])

  return [headers, ...rows].map((row) => row.join(",")).join("\n")
}

/**
 * Export clients to CSV format
 */
export function exportClientsToCSV(clients: AdminClient[]): string {
  const headers = ["UID", "Name", "Email", "Plan", "BEAM Balance", "Housing Wallet", "Last Active"]
  const rows = clients.map((c) => [
    c.uid,
    c.name || "",
    c.email || "",
    c.planType || "None",
    c.beamCoinBalance.toString(),
    c.housingWalletBalance.toString(),
    c.lastActive || "",
  ])

  return [headers, ...rows].map((row) => row.join(",")).join("\n")
}

/**
 * Download CSV file
 */
export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", filename)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}


