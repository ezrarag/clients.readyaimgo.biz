import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/firebase/config"
import { doc, getDoc } from "firebase/firestore"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get("clientId")

  if (!clientId) {
    return NextResponse.json({ error: "Client ID required" }, { status: 400 })
  }

  try {
    // Get client data
    const clientDoc = await getDoc(doc(db, "clients", clientId))
    
    if (!clientDoc.exists()) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const clientData = clientDoc.data()
    
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

