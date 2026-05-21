"use client"

import { useEffect, useState } from "react"
import { onAuthStateChanged, type User } from "firebase/auth"

import { getAuthInstance } from "@/lib/firebase/config"

type DebugState =
  | { status: "loading" }
  | { status: "auth-config-error"; error: string }
  | { status: "signed-out" }
  | {
      status: "complete"
      user: {
        uid: string
        email: string | null
        displayName: string | null
      }
      result: unknown
    }
  | { status: "request-error"; user: Pick<User, "uid" | "email" | "displayName">; error: string }

async function runAuthDiagnostics(user: User) {
  const token = await user.getIdToken(true)
  const response = await fetch("/api/debug/firebase-auth", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  return response.json()
}

export default function FirebaseAuthDebugPage() {
  const [state, setState] = useState<DebugState>({ status: "loading" })

  useEffect(() => {
    let unsubscribe: (() => void) | null = null

    try {
      const auth = getAuthInstance()
      unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          setState({ status: "signed-out" })
          return
        }

        try {
          const result = await runAuthDiagnostics(user)
          setState({
            status: "complete",
            user: {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
            },
            result,
          })
        } catch (error) {
          setState({
            status: "request-error",
            user,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    } catch (error) {
      setState({
        status: "auth-config-error",
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return () => {
      unsubscribe?.()
    }
  }, [])

  return (
    <main style={{ padding: 32, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <h1>Firebase Auth Debug</h1>
      <p>
        This page uses the current signed-in Firebase user, sends a fresh ID token to
        the server, and reports whether Firebase Admin can verify it.
      </p>

      <section style={{ marginTop: 24 }}>
        <h2>Result</h2>
        <pre>{JSON.stringify(state, null, 2)}</pre>
      </section>
    </main>
  )
}

