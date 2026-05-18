import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { normalizeClientDeliverableDocument } from "@/lib/deliverables"
import { isClientAllowed, getBearerToken, resolvePortalIdentity } from "@/lib/portal-auth"
import { createStripeServer, getStripeAppUrl, stripeRouteError } from "@/lib/stripe-server"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

let stripeInstance: ReturnType<typeof createStripeServer> | null = null

function getStripe() {
  if (!stripeInstance) {
    stripeInstance = createStripeServer()
  }
  return stripeInstance
}

// ─── Workspace-first auth ─────────────────────────────────────────────────────

async function authorizeWorkspaceDeliverablePayment(
  request: NextRequest,
  workspaceId: string
) {
  const token = getBearerToken(request)
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) }
  }

  let decoded: Awaited<ReturnType<ReturnType<typeof getAdminAuth>["verifyIdToken"]>>
  try {
    decoded = await getAdminAuth().verifyIdToken(token)
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) }
  }

  const db = getAdminDb()

  try {
    await assertWorkspaceRole(db, workspaceId, decoded.uid, "beam-participant")
  } catch (err) {
    if (err instanceof WorkspaceAuthError) {
      return { error: NextResponse.json({ error: err.message }, { status: err.status }) }
    }
    throw err
  }

  const wsSnap = await db.collection("workspaces").doc(workspaceId).get()
  const wsData = wsSnap.exists ? (wsSnap.data() as Record<string, unknown>) : {}
  const clientId =
    typeof wsData.clientId === "string" && wsData.clientId.trim()
      ? wsData.clientId.trim().toLowerCase()
      : null

  if (!clientId) {
    return {
      error: NextResponse.json(
        { error: "Workspace has no linked client account." },
        { status: 400 }
      ),
    }
  }

  const email = (decoded.email ?? "").toLowerCase().trim()
  if (!email) {
    return {
      error: NextResponse.json({ error: "Authenticated email required." }, { status: 403 }),
    }
  }

  return { db, uid: decoded.uid, email, clientId, workspaceId }
}

// ─── Legacy portal auth (unchanged) ──────────────────────────────────────────

async function authorizeDeliverablePayment(request: NextRequest, clientId: string) {
  const normalizedClientId = clientId.trim().toLowerCase()
  const identity = await resolvePortalIdentity(request, normalizedClientId)
  if (!identity || !isClientAllowed(identity, normalizedClientId)) {
    return {
      error: NextResponse.json(
        { error: "Project not available for this account." },
        { status: 403 }
      ),
    }
  }
  if (!identity.email) {
    return {
      error: NextResponse.json({ error: "Authenticated email required." }, { status: 403 }),
    }
  }

  const db = getAdminDb()
  const projectSnapshot = await db
    .collection("projects")
    .where("clientId", "==", normalizedClientId)
    .limit(1)
    .get()

  if (projectSnapshot.empty) {
    return {
      error: NextResponse.json(
        { error: "Project not available for this account." },
        { status: 403 }
      ),
    }
  }

  return {
    db,
    email: identity.email,
    uid: identity.uid,
    clientId: normalizedClientId,
    workspaceId: null as string | null,
    projectId: projectSnapshot.docs[0].id,
    project: projectSnapshot.docs[0].data() as Record<string, unknown>,
  }
}

// ─── POST /api/stripe/deliverable-payment ─────────────────────────────────────
//
// Accepts either:
//   { workspaceId, clientId, deliverableId }   → workspace-first auth path
//   { clientId, deliverableId }                → legacy portal auth path

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const rawWorkspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId.trim() : ""
    const rawClientId =
      typeof body.clientId === "string" ? body.clientId.trim().toLowerCase() : ""
    const deliverableId =
      typeof body.deliverableId === "string" ? body.deliverableId.trim() : ""

    if (!deliverableId) {
      return NextResponse.json({ error: "deliverableId is required." }, { status: 400 })
    }

    const appUrl = getStripeAppUrl(request)
    const stripe = getStripe()

    // ── Workspace path ────────────────────────────────────────────────────────
    if (rawWorkspaceId) {
      const ctx = await authorizeWorkspaceDeliverablePayment(request, rawWorkspaceId)
      if ("error" in ctx) return ctx.error

      // Deliverables live at clients/{clientId}/deliverables/{id}
      const deliverableRef = ctx.db
        .collection("clients")
        .doc(ctx.clientId)
        .collection("deliverables")
        .doc(deliverableId)
      const deliverableSnapshot = await deliverableRef.get()

      if (!deliverableSnapshot.exists) {
        return NextResponse.json({ error: "Deliverable not found." }, { status: 404 })
      }

      const deliverable = normalizeClientDeliverableDocument(
        deliverableSnapshot.id,
        deliverableSnapshot.data() as Record<string, unknown>,
        ctx.clientId
      )

      if (deliverable.status === "paid") {
        return NextResponse.json(
          { error: "This deliverable is already paid." },
          { status: 409 }
        )
      }
      if (deliverable.amount <= 0) {
        return NextResponse.json(
          { error: "Deliverable amount is not configured." },
          { status: 400 }
        )
      }

      const existingCustomers = await stripe.customers.list({
        email: ctx.email,
        limit: 1,
      })
      const customer =
        existingCustomers.data[0] ??
        (await stripe.customers.create({
          email: ctx.email,
          metadata: {
            clientId: ctx.clientId,
            workspaceId: ctx.workspaceId,
            firebaseUid: ctx.uid,
          },
        }))

      const metadata = {
        purpose: "deliverable_payment",
        clientId: ctx.clientId,
        workspaceId: ctx.workspaceId,
        deliverableId: deliverable.id,
        clientEmail: ctx.email,
      }

      await deliverableRef.set(
        {
          workspaceId: ctx.workspaceId,
          stripeCustomerId: customer.id,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: deliverable.currency || "usd",
              product_data: {
                name: deliverable.title,
                description: deliverable.description.slice(0, 1000),
              },
              unit_amount: Math.round(deliverable.amount * 100),
            },
            quantity: 1,
          },
        ],
        success_url: `${appUrl}/workspace/${encodeURIComponent(ctx.workspaceId)}?tab=payments&payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/workspace/${encodeURIComponent(ctx.workspaceId)}?tab=payments&payment=cancelled`,
        metadata,
        payment_intent_data: { metadata },
      })

      return NextResponse.json({ url: session.url })
    }

    // ── Legacy portal path ────────────────────────────────────────────────────
    if (!rawClientId) {
      return NextResponse.json(
        { error: "workspaceId or clientId is required." },
        { status: 400 }
      )
    }

    const context = await authorizeDeliverablePayment(request, rawClientId)
    if ("error" in context) return context.error

    const deliverableRef = context.db
      .collection("clients")
      .doc(context.clientId)
      .collection("deliverables")
      .doc(deliverableId)
    const deliverableSnapshot = await deliverableRef.get()

    if (!deliverableSnapshot.exists) {
      return NextResponse.json({ error: "Deliverable not found." }, { status: 404 })
    }

    const deliverable = normalizeClientDeliverableDocument(
      deliverableSnapshot.id,
      deliverableSnapshot.data() as Record<string, unknown>,
      context.clientId
    )

    if (deliverable.status === "paid") {
      return NextResponse.json({ error: "This deliverable is already paid." }, { status: 409 })
    }
    if (deliverable.amount <= 0) {
      return NextResponse.json(
        { error: "Deliverable amount is not configured." },
        { status: 400 }
      )
    }

    const existingCustomers = await stripe.customers.list({
      email: context.email,
      limit: 1,
    })
    const customer =
      existingCustomers.data[0] ??
      (await stripe.customers.create({
        email: context.email,
        metadata: { clientId: context.clientId, firebaseUid: context.uid },
      }))

    const metadata = {
      purpose: "deliverable_payment",
      clientId: context.clientId,
      projectId: context.projectId,
      deliverableId: deliverable.id,
      clientEmail: context.email,
    }

    await deliverableRef.set(
      { stripeCustomerId: customer.id, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    )

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: deliverable.currency || "usd",
            product_data: {
              name: deliverable.title,
              description: deliverable.description.slice(0, 1000),
            },
            unit_amount: Math.round(deliverable.amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/portal/${encodeURIComponent(context.clientId)}?deliverable=paid&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/portal/${encodeURIComponent(context.clientId)}?deliverable=cancelled`,
      metadata,
      payment_intent_data: { metadata },
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("Deliverable payment checkout error:", error)
    return stripeRouteError(error, "Unable to start payment.")
  }
}
