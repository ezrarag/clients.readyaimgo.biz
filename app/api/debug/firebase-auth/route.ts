import { type NextRequest, NextResponse } from "next/server"

import {
  buildFirebaseAuthFailureDiagnostics,
  decodeFirebaseIdTokenForDiagnostics,
  getFirebaseAdminDiagnostics,
} from "@/lib/firebase-diagnostics"
import { getAdminAuth } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const idToken = getBearerToken(request)

  if (!idToken) {
    return NextResponse.json(
      {
        error: "Missing bearer token.",
        admin: getFirebaseAdminDiagnostics(),
      },
      { status: 400 }
    )
  }

  try {
    const verified = await getAdminAuth().verifyIdToken(idToken)
    return NextResponse.json({
      success: true,
      admin: getFirebaseAdminDiagnostics(),
      token: decodeFirebaseIdTokenForDiagnostics(idToken),
      verification: {
        ok: true,
        uid: verified.uid,
        email: verified.email ?? null,
        aud: verified.aud,
        iss: verified.iss,
      },
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      ...buildFirebaseAuthFailureDiagnostics(idToken, error),
    })
  }
}
