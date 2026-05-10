import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminDb } from "@/lib/firebase-admin"
import { addBeamTransaction } from "@/lib/beamCoin"
import { isClientAllowed, resolvePortalIdentity } from "@/lib/portal-auth"

export async function POST(request: NextRequest) {
  try {
    const { clientId, credits, description } = await request.json()

    if (!clientId || credits === undefined || credits <= 0) {
      return NextResponse.json(
        { error: "Missing required fields: clientId, credits" },
        { status: 400 }
      )
    }

    const identity = await resolvePortalIdentity(request, clientId)
    if (!identity || !isClientAllowed(identity, clientId)) {
      return NextResponse.json({ error: "Portal access unavailable." }, { status: 403 })
    }

    const db = getAdminDb()
    const clientRef = db.collection("clients").doc(clientId)
    const clientSnapshot = await clientRef.get()

    if (!clientSnapshot.exists) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const clientData = clientSnapshot.data() as Record<string, unknown>
    const currentCredits =
      typeof clientData.housingWalletBalance === "number"
        ? clientData.housingWalletBalance
        : 0

    if (currentCredits < credits) {
      return NextResponse.json(
        { error: "Insufficient housing wallet credits" },
        { status: 400 }
      )
    }

    const newBalance = currentCredits - credits
    await clientRef.set({
      housingWalletBalance: newBalance,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    await db.collection("transactions").add({
      clientId,
      type: "redemption",
      amount: credits * 1.5, // $1.50 per credit
      timestamp: FieldValue.serverTimestamp(),
      description: description || `Housing redemption - ${credits} credits`,
    })

    // Add BEAM Coin transaction to ledger (spend for redemption)
    try {
      await addBeamTransaction(
        clientId,
        "spend",
        credits,
        description || `Redeemed ${credits} housing credits`
      )
    } catch (beamError) {
      console.error("Error adding BEAM Coin transaction:", beamError)
      // Continue even if BEAM Coin API is unavailable
    }

    return NextResponse.json({
      success: true,
      message: "Housing credits redeemed successfully",
      newBalance,
      redeemed: credits,
    })
  } catch (error: any) {
    console.error("Error processing housing wallet redemption:", error)
    return NextResponse.json(
      { error: error.message || "Failed to process redemption" },
      { status: 500 }
    )
  }
}
