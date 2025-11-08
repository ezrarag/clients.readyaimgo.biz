import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const customerId = searchParams.get("customerId")

  if (!customerId) {
    return NextResponse.json({ error: "Customer ID required" }, { status: 400 })
  }

  try {
    const stripe = getStripe()
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    })

    if (subscriptions.data.length === 0) {
      return NextResponse.json({ error: "No active subscription" }, { status: 404 })
    }

    const subscription = subscriptions.data[0]
    const price = subscription.items.data[0]?.price

    return NextResponse.json({
      planName: price?.nickname || price?.product || "Standard Plan",
      renewalDate: new Date(subscription.current_period_end * 1000).toISOString(),
      amount: (price?.unit_amount || 0) / 100,
      status: subscription.status,
      stripeCustomerId: customerId,
    })
  } catch (error: any) {
    console.error("Error fetching subscription:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

