import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import Stripe from "stripe"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import {
  VALUE_PROFILE_COLLECTION,
  VALUE_PROFILE_STATE_DOC,
} from "@/lib/value-profile"

export const dynamic = "force-dynamic"

let stripeInstance: Stripe | null = null

function getStripe() {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not set.")
    }

    stripeInstance = new Stripe(secretKey, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    })
  }

  return stripeInstance
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") || ""
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : null
}

async function authorizePortalPayment(request: NextRequest, clientId: string) {
  const token = getBearerToken(request)
  if (!token) {
    return { error: NextResponse.json({ error: "Missing authorization token." }, { status: 401 }) }
  }

  const decoded = await getAdminAuth().verifyIdToken(token)
  const email = decoded.email?.toLowerCase().trim()
  if (!email) {
    return { error: NextResponse.json({ error: "Authenticated email required." }, { status: 403 }) }
  }

  const normalizedClientId = clientId.trim().toLowerCase()
  const db = getAdminDb()
  const projectSnapshot = await db
    .collection("projects")
    .where("clientId", "==", normalizedClientId)
    .where("clientPortalEmail", "==", email)
    .limit(1)
    .get()

  if (projectSnapshot.empty) {
    return { error: NextResponse.json({ error: "Project not available for this account." }, { status: 403 }) }
  }

  return {
    db,
    email,
    uid: decoded.uid,
    clientId: normalizedClientId,
    projectId: projectSnapshot.docs[0].id,
    project: projectSnapshot.docs[0].data() as Record<string, unknown>,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const rawClientId = typeof body.clientId === "string" ? body.clientId : ""
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount)
    const amountCents = Math.round(amount * 100)

    if (!rawClientId.trim()) {
      return NextResponse.json({ error: "clientId is required." }, { status: 400 })
    }

    if (!Number.isFinite(amount) || amountCents <= 0) {
      return NextResponse.json({ error: "Enter a payment amount." }, { status: 400 })
    }

    const context = await authorizePortalPayment(request, rawClientId)
    if ("error" in context) return context.error

    const stripe = getStripe()
    const existingCustomers = await stripe.customers.list({
      email: context.email,
      limit: 1,
    })
    const customer =
      existingCustomers.data[0] ??
      (await stripe.customers.create({
        email: context.email,
        metadata: {
          clientId: context.clientId,
          firebaseUid: context.uid,
        },
      }))

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    const clientName =
      typeof context.project.clientName === "string" && context.project.clientName.trim()
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
            product_data: {
              name: `${clientName} value investment`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/portal/${encodeURIComponent(context.clientId)}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/portal/${encodeURIComponent(context.clientId)}?payment=cancelled`,
      metadata,
      payment_intent_data: {
        metadata,
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("Value payment checkout error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start payment." },
      { status: 500 }
    )
  }
}
