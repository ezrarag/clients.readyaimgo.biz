import { NextRequest, NextResponse } from "next/server"

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

    const clientSnapshot = await getAdminDb().collection("clients").doc(clientId).get()

    if (!clientSnapshot.exists) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const clientData = clientSnapshot.data() as Record<string, unknown>
    
    const housingWallet = {
      credits:
        typeof clientData.housingWalletBalance === "number"
          ? clientData.housingWalletBalance
          : 300,
      value:
        (typeof clientData.housingWalletBalance === "number"
          ? clientData.housingWalletBalance
          : 300) * 1.5,
      description: "Housing credits available for hotel redemptions",
    }

    return NextResponse.json(housingWallet)
  } catch (error: any) {
    console.error("Error fetching housing wallet:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
