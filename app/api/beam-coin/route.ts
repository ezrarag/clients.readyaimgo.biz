import { NextRequest, NextResponse } from "next/server"
import { getBeamBalance } from "@/lib/beamCoin"
import { db } from "@/lib/firebase/config"
import { doc, getDoc, updateDoc } from "firebase/firestore"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get("clientId")

  if (!clientId) {
    return NextResponse.json({ error: "Client ID required" }, { status: 400 })
  }

  try {
    // Get live balance from BEAM Coin Ledger
    const beamBalance = await getBeamBalance(clientId)
    
    // Update Firestore cache
    const clientDoc = await getDoc(doc(db, "clients", clientId))
    if (clientDoc.exists()) {
      await updateDoc(doc(db, "clients", clientId), {
        beamCoinBalance: beamBalance.balance,
        beamCoinLastUpdated: new Date(),
      })
    }

    return NextResponse.json({
      balance: beamBalance.balance,
      uid: beamBalance.uid,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error("Error fetching BEAM Coin balance:", error)
    
    // Fallback to cached balance if ledger is unavailable
    try {
      const clientDoc = await getDoc(doc(db, "clients", clientId))
      if (clientDoc.exists()) {
        const clientData = clientDoc.data()
        return NextResponse.json({
          balance: clientData.beamCoinBalance || 0,
          uid: clientId,
          cached: true,
          error: "Ledger unavailable, showing cached balance",
        })
      }
    } catch (fallbackError) {
      // Ignore fallback errors
    }
    
    return NextResponse.json(
      { error: error.message || "Failed to fetch BEAM Coin balance" },
      { status: 500 }
    )
  }
}
