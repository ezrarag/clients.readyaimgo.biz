import { NextRequest, NextResponse } from "next/server"
import { createStripeServer, stripeRouteError } from "@/lib/stripe-server"

// Lazy initialization to avoid build-time errors
let stripeInstance: ReturnType<typeof createStripeServer> | null = null

const getStripe = () => {
  if (!stripeInstance) {
    stripeInstance = createStripeServer()
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
  } catch (error: unknown) {
    console.error("Error fetching subscription:", error)
    return stripeRouteError(error, "Unable to fetch subscription.")
  }
}
