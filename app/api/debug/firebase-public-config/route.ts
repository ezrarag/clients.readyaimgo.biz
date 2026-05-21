import { NextResponse } from "next/server"

function publicFirebaseConfigDiagnostics() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? ""
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? ""
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? ""
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? ""
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? ""
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? ""

  return {
    apiKey: {
      present: Boolean(apiKey),
      length: apiKey.length,
      isDummy: apiKey === "dummy",
    },
    projectId: {
      value: projectId || null,
      present: Boolean(projectId),
      isDummy: projectId === "dummy",
    },
    authDomain: {
      value: authDomain || null,
      present: Boolean(authDomain),
      isDummy: authDomain === "dummy",
    },
    storageBucket: {
      value: storageBucket || null,
      present: Boolean(storageBucket),
    },
    messagingSenderId: {
      value: messagingSenderId || null,
      present: Boolean(messagingSenderId),
    },
    appId: {
      present: Boolean(appId),
      length: appId.length,
    },
  }
}

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({
    success: true,
    source: "server-runtime",
    config: publicFirebaseConfigDiagnostics(),
  })
}

