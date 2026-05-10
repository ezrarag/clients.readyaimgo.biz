import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

import { isClientAllowed, resolvePortalIdentity } from "@/lib/portal-auth"

// Lazy initialization to avoid build-time errors
let stripeInstance: Stripe | null = null

const getStripe = (): Stripe => {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not set")
    }
    stripeInstance = new Stripe(secretKey, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    })
  }
  return stripeInstance
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { clientId } = body

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 }
      )
    }

    const identity = await resolvePortalIdentity(request, clientId)
    if (!identity || !isClientAllowed(identity, clientId) || !identity.email) {
      return NextResponse.json(
        { error: "Portal access unavailable for this account." },
        { status: 403 }
      )
    }

    // Get Stripe product/price IDs from environment variables
    // Default to test mode product IDs if not set
    const priceId = process.env.STRIPE_PRICE_ID || "price_test_default"
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

    // Create or retrieve Stripe customer
    const stripe = getStripe()
    let customerId: string
    const customers = await stripe.customers.list({
      email: identity.email,
      limit: 1,
    })

    if (customers.data.length > 0) {
      customerId = customers.data[0].id
    } else {
      const customer = await stripe.customers.create({
        email: identity.email,
        metadata: {
          firebase_uid: clientId,
          clientId,
        },
      })
      customerId = customer.id
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${appUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/dashboard?canceled=true`,
      metadata: {
        firebase_uid: clientId,
        clientId,
        email: identity.email,
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    console.error("Error creating checkout session:", error)
    return NextResponse.json(
      { error: error.message || "Failed to create checkout session" },
      { status: 500 }
    )
  }
}
