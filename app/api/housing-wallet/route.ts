import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/firebase/config"
import { collection, query, where, getDocs } from "firebase/firestore"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get("clientId")

  if (!clientId) {
    return NextResponse.json({ error: "Client ID required" }, { status: 400 })
  }

  try {
    // Find client document by uid field (documents are keyed by email)
    const clientsRef = collection(db, "clients")
    const q = query(clientsRef, where("uid", "==", clientId))
    const snapshot = await getDocs(q)
    
    if (snapshot.empty) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const clientData = snapshot.docs[0].data()
    
    // Mock housing wallet data - in production, fetch from BEAM Coin API
    const housingWallet = {
      credits: clientData.housingWalletBalance || 300,
      value: (clientData.housingWalletBalance || 300) * 1.5, // $1.50 per credit
      description: "Housing credits available for hotel redemptions",
    }

    return NextResponse.json(housingWallet)
  } catch (error: any) {
    console.error("Error fetching housing wallet:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

