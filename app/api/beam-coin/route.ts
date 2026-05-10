import { NextRequest, NextResponse } from "next/server"
import { getBeamBalance } from "@/lib/beamCoin"
import { getAdminDb } from "@/lib/firebase-admin"
import { isClientAllowed, resolvePortalIdentity } from "@/lib/portal-auth"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get("clientId")

  if (!clientId) {
    return NextResponse.json({ error: "Client ID required" }, { status: 400 })
  }

  try {
    const identity = await resolvePortalIdentity(request, clientId)
    if (!identity || !isClientAllowed(identity, clientId)) {
      return NextResponse.json({ error: "Portal access unavailable." }, { status: 403 })
    }

    const db = getAdminDb()
    const beamBalance = await getBeamBalance(clientId)

    const clientRef = db.collection("clients").doc(clientId)
    const clientSnapshot = await clientRef.get()

    if (clientSnapshot.exists) {
      await clientRef.set({
        beamCoinBalance: beamBalance.balance,
        beamCoinLastUpdated: new Date(),
      }, { merge: true })
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
      const clientSnapshot = await getAdminDb().collection("clients").doc(clientId).get()

      if (clientSnapshot.exists) {
        const clientData = clientSnapshot.data() as Record<string, unknown>
        return NextResponse.json({
          balance:
            typeof clientData.beamCoinBalance === "number"
              ? clientData.beamCoinBalance
              : 0,
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
