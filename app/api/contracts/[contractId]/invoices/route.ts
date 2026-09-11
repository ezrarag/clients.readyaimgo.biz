import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { normalizeInvoice, type ClientInvoice } from "@/lib/invoices"
import { normalizeContract } from "@/lib/contracts"

async function resolveUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  const token = authHeader.split("Bearer ")[1]
  try {
    return await getAdminAuth().verifyIdToken(token)
  } catch {
    return null
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { contractId: string } }
) {
  try {
    const user = await resolveUser(req)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    const db = getAdminDb()
    const cSnap = await db.collection("contracts").doc(params.contractId).get()
    if (!cSnap.exists) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 })
    }

    const contract = normalizeContract(cSnap.id, cSnap.data() as Record<string, unknown>)
    if (!contract.clientId) {
      return NextResponse.json({ invoices: [] })
    }

    const invSnap = await db
      .collection("clients")
      .doc(contract.clientId)
      .collection("invoices")
      .where("contractId", "==", contract.id)
      .get()

    const invoices = invSnap.docs.map((d) =>
      normalizeInvoice(d.id, d.data() as Record<string, unknown>)
    )

    return NextResponse.json({ invoices })
  } catch (err) {
    console.error("GET /api/contracts/[contractId]/invoices error:", err)
    return NextResponse.json(
      { error: "Failed to fetch contract invoices." },
      { status: 500 }
    )
  }
}
