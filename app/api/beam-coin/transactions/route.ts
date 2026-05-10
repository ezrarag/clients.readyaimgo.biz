import { NextRequest, NextResponse } from "next/server"
import { addBeamTransaction, getBeamTransactions } from "@/lib/beamCoin"
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

    const transactions = await getBeamTransactions(clientId)
    return NextResponse.json(transactions)
  } catch (error: any) {
    console.error("Error fetching BEAM Coin transactions:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { clientId, type, amount, description } = await request.json()

    if (!clientId || !type || amount === undefined || !description) {
      return NextResponse.json(
        { error: "Missing required fields: clientId, type, amount, description" },
        { status: 400 }
      )
    }

    if (type !== "earn" && type !== "spend") {
      return NextResponse.json(
        { error: "Type must be 'earn' or 'spend'" },
        { status: 400 }
      )
    }

    const identity = await resolvePortalIdentity(request, clientId)
    if (!identity || !isClientAllowed(identity, clientId)) {
      return NextResponse.json({ error: "Portal access unavailable." }, { status: 403 })
    }

    // Post transaction to BEAM Coin Ledger
    const result = await addBeamTransaction(clientId, type, amount, description)

    // Update Firestore cache with new balance.
    try {
      const clientRef = getAdminDb().collection("clients").doc(clientId)
      const clientSnapshot = await clientRef.get()

      if (clientSnapshot.exists) {
        const clientData = clientSnapshot.data() as Record<string, unknown>
        const currentBalance =
          typeof clientData.beamCoinBalance === "number"
            ? clientData.beamCoinBalance
            : 0
        const newBalance = type === "earn" 
          ? currentBalance + amount 
          : Math.max(0, currentBalance - amount)

        await clientRef.set({
          beamCoinBalance: newBalance,
          beamCoinLastUpdated: new Date(),
        }, { merge: true })
      }
    } catch (updateError) {
      console.error("Error updating Firestore cache:", updateError)
      // Continue even if cache update fails
    }

    return NextResponse.json({
      success: true,
      message: "BEAM Coin transaction recorded",
      transaction: result,
    })
  } catch (error: any) {
    console.error("Error processing BEAM Coin transaction:", error)
    return NextResponse.json(
      { error: error.message || "Failed to process transaction" },
      { status: 500 }
    )
  }
}
