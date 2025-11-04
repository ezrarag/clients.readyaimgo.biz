/**
 * BEAM Coin Ledger API Integration
 * 
 * This utility handles communication with the BEAM Coin Ledger API
 * deployed at beam-coin-ledger.vercel.app
 */

const BEAM_LEDGER_URL = process.env.NEXT_PUBLIC_BEAM_LEDGER_URL || "https://beam-coin-ledger.vercel.app"

export interface BeamTransaction {
  uid: string
  type: "earn" | "spend"
  amount: number
  description: string
}

export interface BeamBalance {
  balance: number
  uid: string
}

/**
 * Get BEAM Coin balance for a user from the ledger
 * @param uid - Firebase user ID
 * @param idToken - Optional Firebase Auth ID token for protected endpoints
 * @returns Promise with balance data
 */
export async function getBeamBalance(uid: string, idToken?: string): Promise<BeamBalance> {
  try {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    }

    // Add auth token if provided
    if (idToken) {
      headers["Authorization"] = `Bearer ${idToken}`
    }

    const response = await fetch(`${BEAM_LEDGER_URL}/api/balance?uid=${uid}`, {
      method: "GET",
      headers,
    })

    if (!response.ok) {
      throw new Error(`BEAM Ledger API error: ${response.statusText}`)
    }

    const data = await response.json()
    return {
      balance: data.balance || 0,
      uid: uid,
    }
  } catch (error) {
    console.error("Error fetching BEAM Coin balance:", error)
    throw error
  }
}

/**
 * Add a transaction to the BEAM Coin Ledger
 * @param uid - Firebase user ID
 * @param type - Transaction type: "earn" or "spend"
 * @param amount - Transaction amount
 * @param description - Transaction description
 * @param idToken - Optional Firebase Auth ID token for protected endpoints
 * @returns Promise with transaction result
 */
export async function addBeamTransaction(
  uid: string,
  type: "earn" | "spend",
  amount: number,
  description: string,
  idToken?: string
): Promise<any> {
  try {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    }

    // Add auth token if provided
    if (idToken) {
      headers["Authorization"] = `Bearer ${idToken}`
    }

    const transaction: BeamTransaction = {
      uid,
      type,
      amount,
      description,
    }

    const response = await fetch(`${BEAM_LEDGER_URL}/api/transactions`, {
      method: "POST",
      headers,
      body: JSON.stringify(transaction),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`BEAM Ledger API error: ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error("Error adding BEAM Coin transaction:", error)
    throw error
  }
}

/**
 * Get transaction history for a user from the ledger
 * @param uid - Firebase user ID
 * @param idToken - Optional Firebase Auth ID token
 * @returns Promise with transaction array
 */
export async function getBeamTransactions(uid: string, idToken?: string): Promise<any[]> {
  try {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    }

    if (idToken) {
      headers["Authorization"] = `Bearer ${idToken}`
    }

    const response = await fetch(`${BEAM_LEDGER_URL}/api/transactions?uid=${uid}`, {
      method: "GET",
      headers,
    })

    if (!response.ok) {
      throw new Error(`BEAM Ledger API error: ${response.statusText}`)
    }

    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error("Error fetching BEAM Coin transactions:", error)
    return []
  }
}

