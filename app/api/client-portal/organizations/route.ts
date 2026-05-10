import { type NextRequest, NextResponse } from "next/server"

import { getAdminDb } from "@/lib/firebase-admin"
import { normalizeOrganization } from "@/lib/organizations"
import { resolvePortalIdentity } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const identity = await resolvePortalIdentity(request)
    if (!identity) {
      return NextResponse.json(
        { error: "Portal access unavailable for this account." },
        { status: 403 }
      )
    }

    const db = getAdminDb()
    const memberSnapshot = await db
      .collectionGroup("members")
      .where("uid", "==", identity.uid)
      .limit(100)
      .get()

    const organizationDocs = await Promise.all(
      memberSnapshot.docs.map(async (memberDoc) => {
        const organizationRef = memberDoc.ref.parent.parent
        return organizationRef ? organizationRef.get() : null
      })
    )

    return NextResponse.json({
      organizations: organizationDocs
        .filter(
          (doc): doc is FirebaseFirestore.DocumentSnapshot =>
            Boolean(doc?.exists)
        )
        .map((doc) =>
          normalizeOrganization(doc.id, doc.data() as Record<string, unknown>)
        ),
    })
  } catch (error) {
    console.error("Client portal organizations error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load organizations.",
      },
      { status: 500 }
    )
  }
}
