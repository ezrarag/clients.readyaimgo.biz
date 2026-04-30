import { type NextRequest } from "next/server"

import { handleStripeWebhook } from "@/lib/stripe-value-webhook"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  return handleStripeWebhook(request)
}
