import { NextResponse, type NextRequest } from "next/server"
import Stripe from "stripe"

export class StripeConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StripeConfigurationError"
  }
}

function readUsableStripeSecret() {
  const candidates = [
    process.env.STRIPE_SECRET_KEY,
    process.env.STRIPE_LIVE_SECRET_KEY,
    process.env.STRIPE_TEST_SECRET_KEY,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))

  const secretKey = candidates.find(
    (value) => /^sk_(test|live)_/.test(value) && !value.includes("...")
  )
  if (!secretKey) {
    throw new StripeConfigurationError(
      "Stripe secret key is not configured with a usable sk_test_ or sk_live_ value."
    )
  }
  return secretKey
}

function keyDiagnostics(name: string, expectedPattern: RegExp) {
  const value = process.env[name]?.trim() ?? ""
  return {
    name,
    present: Boolean(value),
    length: value.length,
    prefix: value ? value.slice(0, 8) : null,
    usable: expectedPattern.test(value) && !value.includes("..."),
  }
}

export function getStripeConfigDiagnostics() {
  return {
    secretKeys: [
      keyDiagnostics("STRIPE_SECRET_KEY", /^sk_(test|live)_/),
      keyDiagnostics("STRIPE_LIVE_SECRET_KEY", /^sk_live_/),
      keyDiagnostics("STRIPE_TEST_SECRET_KEY", /^sk_test_/),
    ],
    publishableKeys: [
      keyDiagnostics("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", /^pk_(test|live)_/),
      keyDiagnostics("STRIPE_PUBLISHABLE_KEY", /^pk_(test|live)_/),
      keyDiagnostics("STRIPE_LIVE_PUBLISHABLE_KEY", /^pk_live_/),
      keyDiagnostics("STRIPE_TEST_PUBLISHABLE_KEY", /^pk_test_/),
    ],
    webhookSecret: keyDiagnostics("STRIPE_WEBHOOK_SECRET", /^whsec_/),
  }
}

export function getStripePublishableKey() {
  const candidates = [
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    process.env.STRIPE_PUBLISHABLE_KEY,
    process.env.STRIPE_LIVE_PUBLISHABLE_KEY,
    process.env.STRIPE_TEST_PUBLISHABLE_KEY,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))

  const publishableKey = candidates.find(
    (value) => /^pk_(test|live)_/.test(value) && !value.includes("...")
  )
  if (!publishableKey) {
    throw new StripeConfigurationError(
      "Stripe publishable key is not configured with a usable pk_test_ or pk_live_ value."
    )
  }
  return publishableKey
}

export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!secret || !secret.startsWith("whsec_") || secret.includes("...")) {
    throw new StripeConfigurationError(
      "Stripe webhook secret is not configured with a usable whsec_ value."
    )
  }
  return secret
}

export function createStripeServer() {
  getStripePublishableKey()
  return new Stripe(readUsableStripeSecret(), {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  })
}

export function getStripeAppUrl(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) {
    try {
      const url = new URL(configured)
      if (url.protocol === "https:" || url.hostname === "localhost") {
        return url.origin.replace(/\/$/, "")
      }
    } catch {
      // Fall through to request origin.
    }
  }
  return request.nextUrl.origin.replace(/\/$/, "")
}

export function stripeRouteError(error: unknown, fallback: string) {
  if (error instanceof StripeConfigurationError) {
    return NextResponse.json({ error: error.message }, { status: 503 })
  }

  if (error instanceof Stripe.errors.StripeError) {
    if (error.type === "StripeSignatureVerificationError") {
      return NextResponse.json({ error: error.message || fallback }, { status: 400 })
    }
    return NextResponse.json(
      { error: error.message || fallback },
      { status: error.statusCode && error.statusCode >= 400 ? error.statusCode : 502 }
    )
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 502 }
  )
}
