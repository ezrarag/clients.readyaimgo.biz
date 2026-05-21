"use client"

import { useEffect, useState } from "react"

type StripeDebugResponse = {
  success: boolean
  config: unknown
}

export default function StripeDebugPage() {
  const [result, setResult] = useState<StripeDebugResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/debug/stripe-config", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as StripeDebugResponse
        if (!response.ok) throw new Error("Unable to load Stripe diagnostics.")
        setResult(payload)
      })
      .catch((fetchError) => {
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
      })
  }, [])

  return (
    <main style={{ padding: 32, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <h1>Stripe Config Debug</h1>
      <p>
        This page reports whether Stripe keys are present and structurally usable.
        It never prints full secret values.
      </p>
      <pre style={{ marginTop: 24 }}>{error ?? JSON.stringify(result, null, 2)}</pre>
    </main>
  )
}

