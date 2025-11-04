import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20.acacia",
  typescript: true,
})

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const customerId = searchParams.get("customerId")

  if (!customerId) {
    return NextResponse.json({ error: "Customer ID required" }, { status: 400 })
  }

  try {
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

