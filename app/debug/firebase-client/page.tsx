"use client"

import { useEffect, useState } from "react"

type RuntimeConfigResponse = {
  success: boolean
  source: string
  config: Record<string, unknown>
}

const clientBuildConfig = {
  apiKey: {
    present: Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    length: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.length ?? 0,
    isDummy: process.env.NEXT_PUBLIC_FIREBASE_API_KEY === "dummy",
  },
  projectId: {
    value: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
    present: Boolean(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    isDummy: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "dummy",
  },
  authDomain: {
    value: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || null,
    present: Boolean(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    isDummy: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN === "dummy",
  },
  storageBucket: {
    value: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || null,
    present: Boolean(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
  },
  messagingSenderId: {
    value: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || null,
    present: Boolean(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  },
  appId: {
    present: Boolean(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    length: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.length ?? 0,
  },
}

export default function FirebaseClientDebugPage() {
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/debug/firebase-public-config", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as RuntimeConfigResponse
        if (!response.ok) {
          throw new Error("Unable to load server runtime config diagnostics.")
        }
        setRuntimeConfig(payload)
      })
      .catch((fetchError) => {
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
      })
  }, [])

  return (
    <main style={{ padding: 32, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <h1>Firebase Config Debug</h1>
      <p>
        This page does not initialize Firebase. It compares the public Firebase values
        compiled into the browser bundle with values available to the server runtime.
      </p>

      <section style={{ marginTop: 24 }}>
        <h2>Client build bundle</h2>
        <pre>{JSON.stringify(clientBuildConfig, null, 2)}</pre>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Server runtime</h2>
        {error ? <pre>{error}</pre> : <pre>{JSON.stringify(runtimeConfig, null, 2)}</pre>}
      </section>
    </main>
  )
}

