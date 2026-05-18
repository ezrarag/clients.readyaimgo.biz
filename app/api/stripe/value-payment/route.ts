import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { isClientAllowed, getBearerToken, resolvePortalIdentity } from "@/lib/portal-auth"
import { createStripeServer, getStripeAppUrl, stripeRouteError } from "@/lib/stripe-server"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import {
  VALUE_PROFILE_COLLECTION,
  VALUE_PROFILE_STATE_DOC,
} from "@/lib/value-profile"

export const dynamic = "force-dynamic"

let stripeInstance: ReturnType<typeof createStripeServer> | null = null

function getStripe() {
  if (!stripeInstance) {
    stripeInstance = createStripeServer()
  }
  return stripeInstance
}

// ─── Workspace-first auth ─────────────────────────────────────────────────────
// Validates workspace membership via assertWorkspaceRole (no ragAllowlist
// or project required). Resolves clientId from the workspace bridge field.

async function authorizeWorkspacePayment(request: NextRequest, workspaceId: string) {
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
      error: NextResponse.json(
        { error: "Authenticated email required." },
        { status: 403 }
      ),
    }
  }

  return { db, uid: decoded.uid, email, clientId, workspaceId }
}

// ─── Legacy portal auth (unchanged) ──────────────────────────────────────────

async function authorizePortalPayment(request: NextRequest, clientId: string) {
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

// ─── POST /api/stripe/value-payment ──────────────────────────────────────────
//
// Accepts either:
//   { workspaceId, amount }           → workspace-first auth path
//   { clientId, amount }              → legacy portal auth path (unchanged)

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const rawWorkspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId.trim() : ""
    const rawClientId = typeof body.clientId === "string" ? body.clientId : ""
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount)
    const amountCents = Math.round(amount * 100)

    if (!Number.isFinite(amount) || amountCents <= 0) {
      return NextResponse.json({ error: "Enter a payment amount." }, { status: 400 })
    }

    const appUrl = getStripeAppUrl(request)
    const stripe = getStripe()

    // ── Workspace path ────────────────────────────────────────────────────────
    if (rawWorkspaceId) {
      const ctx = await authorizeWorkspacePayment(request, rawWorkspaceId)
      if ("error" in ctx) return ctx.error

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
        purpose: "value_profile_payment",
        clientId: ctx.clientId,
        workspaceId: ctx.workspaceId,
        clientEmail: ctx.email,
      }

      // Cache stripeCustomerId on the value-profile state doc
      await ctx.db
        .collection("clients")
        .doc(ctx.clientId)
        .collection(VALUE_PROFILE_COLLECTION)
        .doc(VALUE_PROFILE_STATE_DOC)
        .set(
          {
            clientId: ctx.clientId,
            currency: "usd",
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
              currency: "usd",
              product_data: { name: `${ctx.clientId} value investment` },
              unit_amount: amountCents,
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
    if (!rawClientId.trim()) {
      return NextResponse.json(
        { error: "workspaceId or clientId is required." },
        { status: 400 }
      )
    }

    const context = await authorizePortalPayment(request, rawClientId)
    if ("error" in context) return context.error

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

    const clientName =
      typeof context.project?.clientName === "string" && context.project.clientName.trim()
        ? context.project.clientName.trim()
        : context.clientId

    const metadata = {
      purpose: "value_profile_payment",
      clientId: context.clientId,
      projectId: context.projectId,
      clientEmail: context.email,
    }

    await context.db
      .collection("clients")
      .doc(context.clientId)
      .collection(VALUE_PROFILE_COLLECTION)
      .doc(VALUE_PROFILE_STATE_DOC)
      .set(
        {
          clientId: context.clientId,
          currency: "usd",
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
            currency: "usd",
            product_data: { name: `${clientName} value investment` },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/portal/${encodeURIComponent(context.clientId)}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/portal/${encodeURIComponent(context.clientId)}?payment=cancelled`,
      metadata,
      payment_intent_data: { metadata },
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("Value payment checkout error:", error)
    return stripeRouteError(error, "Unable to start payment.")
  }
}
