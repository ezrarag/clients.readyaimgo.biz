import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/firebase/config"
import { doc, updateDoc, addDoc, collection, query, where, getDocs } from "firebase/firestore"
import { addBeamTransaction } from "@/lib/beamCoin"

export async function POST(request: NextRequest) {
  try {
    const { clientId, credits, description } = await request.json()

    if (!clientId || credits === undefined || credits <= 0) {
      return NextResponse.json(
        { error: "Missing required fields: clientId, credits" },
        { status: 400 }
      )
    }

    // Find client document by uid field (documents are keyed by email)
    const clientsRef = collection(db, "clients")
    const q = query(clientsRef, where("uid", "==", clientId))
    const snapshot = await getDocs(q)
    
    if (snapshot.empty) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const clientDoc = snapshot.docs[0]
    const clientData = clientDoc.data()
    const currentCredits = clientData.housingWalletBalance || 0

    if (currentCredits < credits) {
      return NextResponse.json(
        { error: "Insufficient housing wallet credits" },
        { status: 400 }
      )
    }

    // Update housing wallet balance (use email as document ID)
    const newBalance = currentCredits - credits
    await updateDoc(doc(db, "clients", clientDoc.id), {
      housingWalletBalance: newBalance,
    })

    // Create transaction record
    await addDoc(collection(db, "transactions"), {
      clientId,
      type: "redemption",
      amount: credits * 1.5, // $1.50 per credit
      timestamp: new Date(),
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

