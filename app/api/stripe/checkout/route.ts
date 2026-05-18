import { NextRequest, NextResponse } from "next/server"

import { isClientAllowed, resolvePortalIdentity } from "@/lib/portal-auth"
import { createStripeServer, getStripeAppUrl, stripeRouteError } from "@/lib/stripe-server"

// Lazy initialization to avoid build-time errors
let stripeInstance: ReturnType<typeof createStripeServer> | null = null

const getStripe = () => {
  if (!stripeInstance) {
    stripeInstance = createStripeServer()
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

    const priceId = process.env.STRIPE_PRICE_ID?.trim()
    if (!priceId || priceId === "price_test_default") {
      return NextResponse.json(
        { error: "Stripe subscription price is not configured." },
        { status: 503 }
      )
    }
    const appUrl = getStripeAppUrl(request)

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
  } catch (error: unknown) {
    console.error("Error creating checkout session:", error)
    return stripeRouteError(error, "Failed to create checkout session")
  }
}
