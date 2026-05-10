import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminDb } from "@/lib/firebase-admin"

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeEmail(value: unknown) {
  return readString(value).toLowerCase()
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const uid = readString(body.uid)
    const email = normalizeEmail(body.email)
    const fallbackName = readString(body.name)

    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 })
    }

    const db = getAdminDb()

    // PRIMARY: Check users/{uid} for a cached orgId. This is the identity
    // contract — users/{uid} is the authoritative record.
    if (uid) {
      const userSnap = await db.collection("users").doc(uid).get()
      if (userSnap.exists) {
        const userData = userSnap.data() as Record<string, unknown>
        const cachedOrgId = readString(userData.orgId)
        if (cachedOrgId) {
          return NextResponse.json({ orgId: cachedOrgId, created: false })
        }

      }
    }

    // SECONDARY: collectionGroup query on organizations/members.
    try {
      const memberSnap = await db
        .collectionGroup("members")
        .where("email", "==", email)
        .limit(1)
        .get()

      if (!memberSnap.empty) {
        const memberDoc = memberSnap.docs[0]
        const orgRef = memberDoc.ref.parent.parent

        if (orgRef) {
          // Cache orgId on users/{uid} so future lookups hit the primary path.
          if (uid) {
            await db.collection("users").doc(uid).set(
              { orgId: orgRef.id, updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            )
          }
          return NextResponse.json({ orgId: orgRef.id, created: false })
        }
      }
    } catch (indexError) {
      console.warn("organizations/resolve: collectionGroup query failed, falling through:", indexError)
    }

    return NextResponse.json({
      orgId: null,
      created: false,
      name: fallbackName || null,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to resolve organization."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
