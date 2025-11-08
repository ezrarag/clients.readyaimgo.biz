import { NextRequest, NextResponse } from "next/server"
import { addBeamTransaction, getBeamTransactions } from "@/lib/beamCoin"
import { db } from "@/lib/firebase/config"
import { doc, updateDoc, collection, query, where, getDocs } from "firebase/firestore"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get("clientId")

  if (!clientId) {
    return NextResponse.json({ error: "Client ID required" }, { status: 400 })
  }

  try {
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

    // Post transaction to BEAM Coin Ledger
    const result = await addBeamTransaction(clientId, type, amount, description)

    // Update Firestore cache with new balance (find by uid field)
    try {
      const clientsRef = collection(db, "clients")
      const q = query(clientsRef, where("uid", "==", clientId))
      const snapshot = await getDocs(q)
      
      if (!snapshot.empty) {
        const clientDoc = snapshot.docs[0]
        const currentBalance = clientDoc.data().beamCoinBalance || 0
        const newBalance = type === "earn" 
          ? currentBalance + amount 
          : Math.max(0, currentBalance - amount)

        await updateDoc(doc(db, "clients", clientDoc.id), {
          beamCoinBalance: newBalance,
          beamCoinLastUpdated: new Date(),
        })
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
