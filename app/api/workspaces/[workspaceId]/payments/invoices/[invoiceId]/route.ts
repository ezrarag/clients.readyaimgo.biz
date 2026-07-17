import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { assertWorkspaceRole, WorkspaceAuthError } from "@/lib/workspace-auth"
import { createStripeServer, getStripeAppUrl } from "@/lib/stripe-server"
import { renderInvoiceHtml } from "@/lib/invoice-renderer.server"
import { normalizeInvoice } from "@/lib/invoices"

export const dynamic = "force-dynamic"

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string; invoiceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "beam-participant")

    const wsSnap = await db.collection("workspaces").doc(params.workspaceId).get()
    const wsData = wsSnap.exists ? (wsSnap.data() as Record<string, unknown>) : {}
    const clientId =
      typeof wsData.clientId === "string" && wsData.clientId.trim()
        ? wsData.clientId.trim()
        : null

    if (!clientId) {
      return NextResponse.json({ error: "Workspace is not linked to a client." }, { status: 400 })
    }

    const invoiceRef = db.collection("clients").doc(clientId).collection("invoices").doc(params.invoiceId)
    const invoiceSnap = await invoiceRef.get()
    if (!invoiceSnap.exists) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 })
    }

    const invoiceData = invoiceSnap.data() as Record<string, unknown>
    const invoice = normalizeInvoice(invoiceSnap.id, invoiceData)

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const now = new Date().toISOString()
    const patch: Record<string, any> = {
      updatedAt: now,
    }

    // 1. Process billing info changes
    if (body.billTo && typeof body.billTo === "object") {
      const b = body.billTo as Record<string, unknown>
      patch.billTo = {
        name: readString(b.name),
        company: readString(b.company),
        address: readString(b.address),
        email: readString(b.email),
      }
    }

    // Process allocation changes (approvals and notes)
    if ("allocation" in body && body.allocation && typeof body.allocation === "object") {
      const a = body.allocation as Record<string, any>
      patch.allocation = {
        directedTo: readString(a.directedTo) || (invoice.allocation?.directedTo || "as_invoiced"),
        amountCents: typeof a.amountCents === "number" ? a.amountCents : (invoice.allocation?.amountCents || 0),
        allocatedAt: readString(a.allocatedAt) || (invoice.allocation?.allocatedAt || new Date().toISOString()),
        clientNote: "clientNote" in a ? readString(a.clientNote) : (invoice.allocation?.clientNote || null),
        clientFeedbackStatus: readString(a.clientFeedbackStatus) || (invoice.allocation?.clientFeedbackStatus || "pending"),
      }
    }


    // Merged doc for rendering/processing
    const updatedInvoice = {
      ...invoice,
      ...patch,
      billTo: {
        ...invoice.billTo,
        ...(patch.billTo || {}),
      },
    }

    // 2. Process status transition (e.g. Accept & Pay)
    if (body.status === "accepted") {
      if (invoice.status !== "draft" && invoice.status !== "client_review") {
        return NextResponse.json({ error: "Invoice cannot be accepted in its current status." }, { status: 400 })
      }

      patch.status = "accepted"
      patch.acceptedAt = now

      // Generate or update deliverable
      let deliverableId = invoice.deliverableId
      const deliverablesColl = db.collection("clients").doc(clientId).collection("deliverables")

      if (deliverableId) {
        await deliverablesColl.doc(deliverableId).set(
          {
            workspaceId: params.workspaceId,
            title: updatedInvoice.title,
            summary: `Invoice ${updatedInvoice.invoiceNumber}`,
            amount: updatedInvoice.totalCents / 100, // Deliverables are stored in dollars
            invoiceId: updatedInvoice.id,
            updatedAt: now,
          },
          { merge: true }
        )
      } else {
        const delRef = deliverablesColl.doc()
        deliverableId = delRef.id
        await delRef.set({
          clientId,
          workspaceId: params.workspaceId,
          projectId: null,
          title: updatedInvoice.title,
          summary: `Invoice ${updatedInvoice.invoiceNumber}`,
          liveUrl: "",
          screenshotUrls: [],
          amount: updatedInvoice.totalCents / 100,
          status: "pending",
          invoiceId: updatedInvoice.id,
          createdAt: now,
          updatedAt: now,
        })
        patch.deliverableId = deliverableId
      }

      // Generate Stripe session URL
      const stripe = createStripeServer()
      const appUrl = getStripeAppUrl(request)

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: updatedInvoice.totalCents,
              product_data: {
                name: updatedInvoice.title,
                description: `Invoice ${updatedInvoice.invoiceNumber}`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          purpose: "deliverable_payment",
          clientId,
          deliverableId,
          invoiceId: invoice.id,
          workspaceId: params.workspaceId,
        },
        success_url: `${appUrl}/workspace/${encodeURIComponent(params.workspaceId)}?tab=payments&payment=success`,
        cancel_url: `${appUrl}/workspace/${encodeURIComponent(params.workspaceId)}?tab=payments&payment=cancelled`,
      })

      patch.paymentLink = session.url
      patch.stripeSessionId = session.id

      // Sync Stripe session ID back to deliverable
      await deliverablesColl.doc(deliverableId).set(
        {
          stripeSessionId: session.id,
          updatedAt: now,
        },
        { merge: true }
      )
    }

    // Save updates
    await invoiceRef.set(patch, { merge: true })

    // 3. Re-render HTML template and update
    const finalSnap = await invoiceRef.get()
    const finalInvoice = normalizeInvoice(finalSnap.id, finalSnap.data() as Record<string, unknown>)
    
    // Only compile renderedHtml if it's NOT an uploaded external PDF
    if (!finalInvoice.pdfUrl) {
      const renderedHtml = await renderInvoiceHtml(finalInvoice)
      await invoiceRef.set({ renderedHtml }, { merge: true })
      finalInvoice.renderedHtml = renderedHtml
    }

    return NextResponse.json({ success: true, data: finalInvoice })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("PATCH invoice error:", error)
    return NextResponse.json({ error: "Failed to update invoice." }, { status: 500 })
  }
}
