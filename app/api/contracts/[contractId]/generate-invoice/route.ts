import { NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { normalizeContract, type BeamContract } from "@/lib/contracts"
import { normalizeInvoice, type ClientInvoice } from "@/lib/invoices"
import { renderInvoiceHtml } from "@/lib/invoice-renderer.server"

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

export async function POST(
  req: NextRequest,
  { params }: { params: { contractId: string } }
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
      return NextResponse.json(
        { error: "Contract must have a valid clientId to generate invoices." },
        { status: 400 }
      )
    }

    const milestones = contract.paymentDates || []
    if (milestones.length === 0) {
      return NextResponse.json(
        { error: "Contract has no milestones (paymentDates) configured." },
        { status: 400 }
      )
    }

    // Query existing invoices for this contract
    const invSnap = await db
      .collection("clients")
      .doc(contract.clientId)
      .collection("invoices")
      .where("contractId", "==", contract.id)
      .get()

    const existingInvoices = invSnap.docs.map((d) =>
      normalizeInvoice(d.id, d.data() as Record<string, unknown>)
    )

    const existingIndexes = new Set(
      existingInvoices
        .map((i) => i.installmentIndex)
        .filter((idx): idx is number => typeof idx === "number")
    )

    // Find first uninvoiced milestone index
    let nextIndex = -1
    for (let i = 0; i < milestones.length; i++) {
      if (!existingIndexes.has(i)) {
        nextIndex = i
        break
      }
    }

    if (nextIndex === -1) {
      return NextResponse.json(
        { error: "All milestones for this contract have already been invoiced." },
        { status: 400 }
      )
    }

    const milestoneLabel = milestones[nextIndex]
    const milestoneAmountCents =
      contract.milestoneAmountsCents?.[nextIndex] ??
      (contract.totalContractValueCents
        ? Math.round(contract.totalContractValueCents / milestones.length)
        : contract.monthlyValue
        ? Math.round(contract.monthlyValue * 100)
        : 0)

    const totalContractValueCents =
      contract.totalContractValueCents ??
      (contract.monthlyValue
        ? Math.round(contract.monthlyValue * 100 * (contract.termMonths || 1))
        : milestoneAmountCents * milestones.length)

    const paidToDateCents = existingInvoices
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + i.totalCents, 0)

    // Short client code for invoice number
    const cleanClientCode = (contract.clientId || contract.clientName)
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 4)
      .toUpperCase() || "CLI"

    const invoiceNumber = `RAG-${cleanClientCode}-MW${nextIndex + 1}`

    const invoiceRef = db
      .collection("clients")
      .doc(contract.clientId)
      .collection("invoices")
      .doc()

    const nowIso = new Date().toISOString()

    const invoiceData = {
      clientId: contract.clientId,
      workspaceId: contract.workspaceId || null,
      contractId: contract.id,
      deliverableId: null,
      templateId: "client_milestone",
      invoiceNumber,
      title: `${contract.title} — ${milestoneLabel}`,
      status: "draft" as const,
      issueDate: nowIso,
      dueDate: "Upon receipt",
      billingPeriod: milestoneLabel,
      from: {
        name: "ReadyAimGo",
        company: "Ezra Haugabrooks, sole operator",
        address: "Milwaukee, WI",
        email: "support@readyaimgo.biz",
      },
      billTo: {
        name: contract.clientName || "Valued Client",
        company: contract.clientName || "",
        address: "",
        email: contract.clientEmail || "",
      },
      lineItems: [
        {
          description: milestoneLabel,
          period: "",
          quantity: 1,
          rateCents: milestoneAmountCents,
          amountCents: milestoneAmountCents,
        },
      ],
      subtotalCents: milestoneAmountCents,
      taxLabel: "Sales tax",
      taxCents: 0,
      totalCents: milestoneAmountCents,
      installmentIndex: nextIndex,
      milestoneLabel,
      totalContractValueCents,
      paidToDateCents,
      paymentMethods: { stripe: true, manual: true },
      paymentLink: null,
      pdfUrl: null,
      renderedHtml: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    await invoiceRef.set(invoiceData)

    const createdInvoice = normalizeInvoice(invoiceRef.id, {
      ...invoiceData,
      id: invoiceRef.id,
    })

    // Render HTML immediately
    const renderedHtml = await renderInvoiceHtml(createdInvoice, contract)
    await invoiceRef.set({ renderedHtml }, { merge: true })
    createdInvoice.renderedHtml = renderedHtml

    return NextResponse.json({ success: true, invoice: createdInvoice }, { status: 201 })
  } catch (err) {
    console.error("POST /api/contracts/[contractId]/generate-invoice error:", err)
    return NextResponse.json({ error: "Failed to generate milestone invoice." }, { status: 500 })
  }
}
