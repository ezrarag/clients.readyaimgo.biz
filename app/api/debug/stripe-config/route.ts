import { NextResponse } from "next/server"

import { getStripeConfigDiagnostics } from "@/lib/stripe-server"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({
    success: true,
    config: getStripeConfigDiagnostics(),
  })
}

