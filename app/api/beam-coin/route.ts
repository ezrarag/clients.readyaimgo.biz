import { NextRequest, NextResponse } from "next/server"
import { getBeamBalance } from "@/lib/beamCoin"
import { db } from "@/lib/firebase/config"
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get("clientId")

  if (!clientId) {
    return NextResponse.json({ error: "Client ID required" }, { status: 400 })
  }

  try {
    // Get live balance from BEAM Coin Ledger (uses Firebase UID)
    const beamBalance = await getBeamBalance(clientId)
    
    // Find client document by uid field (documents are keyed by email)
    const clientsRef = collection(db, "clients")
    const q = query(clientsRef, where("uid", "==", clientId))
    const snapshot = await getDocs(q)
    
    if (!snapshot.empty) {
      const clientDoc = snapshot.docs[0]
      await updateDoc(doc(db, "clients", clientDoc.id), {
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
      const clientsRef = collection(db, "clients")
      const q = query(clientsRef, where("uid", "==", clientId))
      const snapshot = await getDocs(q)
      
      if (!snapshot.empty) {
        const clientData = snapshot.docs[0].data()
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
