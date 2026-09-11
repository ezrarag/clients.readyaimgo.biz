import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { normalizeInvoice, type InvoiceStatus } from "@/lib/invoices"
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

async function isAdmin(uid: string): Promise<boolean> {
  const db = getAdminDb()
  const snap = await db.collection("users").doc(uid).get()
  if (!snap.exists) return false
  const roles = snap.data()?.roles
  return Array.isArray(roles) && roles.includes("admin")
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { contractId: string; invoiceId: string } }
) {
  try {
    const user = await resolveUser(req)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    if (!(await isAdmin(user.uid))) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 })
    }

    const db = getAdminDb()
    const cSnap = await db.collection("contracts").doc(params.contractId).get()
    if (!cSnap.exists) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 })
    }

    const contract = normalizeContract(cSnap.id, cSnap.data() as Record<string, unknown>)
    if (!contract.clientId) {
      return NextResponse.json({ error: "Contract missing clientId." }, { status: 400 })
    }

    const invRef = db
      .collection("clients")
      .doc(contract.clientId)
      .collection("invoices")
      .doc(params.invoiceId)

    const invSnap = await invRef.get()
    if (!invSnap.exists) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 })
    }

    const body = (await req.json()) as { status?: InvoiceStatus }
    const nowIso = new Date().toISOString()

    const updatePayload: Record<string, unknown> = {
      updatedAt: nowIso,
    }

    if (body.status) {
      updatePayload.status = body.status
      if (body.status === "paid") {
        updatePayload.paidAt = nowIso
      }
    }

    await invRef.update(updatePayload)

    const updatedSnap = await invRef.get()
    const updatedInvoice = normalizeInvoice(
      updatedSnap.id,
      updatedSnap.data() as Record<string, unknown>
    )

    return NextResponse.json({ success: true, invoice: updatedInvoice })
  } catch (err) {
    console.error("PATCH /api/contracts/[contractId]/invoices/[invoiceId] error:", err)
    return NextResponse.json(
      { error: "Failed to update contract invoice." },
      { status: 500 }
    )
  }
}
