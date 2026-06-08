import { NextRequest, NextResponse } from "next/server"

import { getAdminAuth } from "@/lib/firebase-admin"
import { getBearerToken, isClientAllowed, resolvePortalIdentity } from "@/lib/portal-auth"
import { createStripeServer, getStripeAppUrl, stripeRouteError } from "@/lib/stripe-server"

// Lazy initialization to avoid build-time errors
let stripeInstance: ReturnType<typeof createStripeServer> | null = null

const getStripe = () => {
  if (!stripeInstance) {
    stripeInstance = createStripeServer()
  }
  return stripeInstance
}

const CHECKOUT_PLAN_PRICE_ENV: Record<string, string> = {
  space_100: "STRIPE_PRICE_SPACE_100",
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readPlanPriceId(plan: string) {
  const envName = CHECKOUT_PLAN_PRICE_ENV[plan]
  if (!envName) {
    return {
      error: `Unsupported checkout plan: ${plan || "missing"}.`,
      priceId: null,
      status: 400,
    }
  }

  const priceId = process.env[envName]?.trim() ?? ""
  if (!/^price_/.test(priceId) || priceId.includes("...")) {
    return {
      error: `${envName} is not configured with a usable Stripe Price ID.`,
      priceId: null,
      status: 503,
    }
  }

  return { error: null, priceId, status: 200 }
}

async function getOrCreateCustomerByEmail({
  email,
  metadata,
}: {
  email: string
  metadata: Record<string, string>
}) {
  const stripe = getStripe()
  const customers = await stripe.customers.list({
    email,
    limit: 1,
  })

  if (customers.data.length > 0) {
    return customers.data[0].id
  }

  const customer = await stripe.customers.create({
    email,
    metadata,
  })
  return customer.id
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = readString(body.clientId)
    const plan = readString(body.plan)
    const redirectTo = readString(body.redirectTo) || "/checkout"

    if (plan) {
      const token = getBearerToken(request)
      if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
      }

      const decoded = await getAdminAuth().verifyIdToken(token)
      const email = decoded.email?.trim().toLowerCase()
      if (!email) {
        return NextResponse.json(
          { error: "A verified email is required for checkout." },
          { status: 400 }
        )
      }

      const priceConfig = readPlanPriceId(plan)
      if (!priceConfig.priceId) {
        return NextResponse.json(
          { error: priceConfig.error },
          { status: priceConfig.status }
        )
      }

      const appUrl = getStripeAppUrl(request)
      const customerId = await getOrCreateCustomerByEmail({
        email,
        metadata: {
          firebase_uid: decoded.uid,
          clientId: email,
          source: "clients.readyaimgo.biz/auth",
        },
      })

      const safeRedirectTo = redirectTo.startsWith("/") ? redirectTo : "/checkout"
      const successUrl = `${appUrl}/dashboard?checkout=success&plan=${encodeURIComponent(
        plan
      )}&session_id={CHECKOUT_SESSION_ID}`

      const cancelUrl = new URL("/auth", appUrl)
      cancelUrl.searchParams.set("redirectTo", safeRedirectTo)
      cancelUrl.searchParams.set("plan", plan)
      cancelUrl.searchParams.set("checkout", "cancelled")

      const stripe = getStripe()
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        line_items: [
          {
            price: priceConfig.priceId,
            quantity: 1,
          },
        ],
        mode: "subscription",
        success_url: successUrl,
        cancel_url: cancelUrl.toString(),
        metadata: {
          firebase_uid: decoded.uid,
          clientId: email,
          email,
          plan,
          source_route: "/auth",
          redirectTo: safeRedirectTo,
        },
        subscription_data: {
          metadata: {
            firebase_uid: decoded.uid,
            clientId: email,
            email,
            plan,
            source_route: "/auth",
          },
        },
      })

      return NextResponse.json({ url: session.url })
    }

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
