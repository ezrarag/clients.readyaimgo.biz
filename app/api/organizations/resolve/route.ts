import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import {
  generateReadableId,
  mapClientPlanToOrgPlan,
  slugifyOrgName,
} from "@/lib/organizations"
import { getFirebaseAdminDiagnostics } from "@/lib/firebase-diagnostics"
import { getAdminDb } from "@/lib/firebase-admin"

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeEmail(value: unknown) {
  return readString(value).toLowerCase()
}

/** Cache orgId on users/{uid} so the next sign-in hits the fast path. */
async function cacheOrgIdOnUser(
  db: FirebaseFirestore.Firestore,
  uid: string,
  orgId: string
) {
  try {
    await db
      .collection("users")
      .doc(uid)
      .set({ orgId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  } catch {
    // Non-fatal — the cache is just an optimisation
  }
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

    // PRIMARY: users/{uid}.orgId — fast cached path written after first lookup.
    if (uid) {
      const userSnap = await db.collection("users").doc(uid).get()
      if (userSnap.exists) {
        const cachedOrgId = readString(
          (userSnap.data() as Record<string, unknown>).orgId
        )
        if (cachedOrgId) {
          return NextResponse.json({ orgId: cachedOrgId, created: false })
        }
      }
    }

    // SECONDARY: collectionGroup query on organizations/*/members — requires a
    // Firestore collection-group index on members.email. Wrapped in try/catch so
    // a missing index silently falls through to the creation path below.
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
          if (uid) await cacheOrgIdOnUser(db, uid, orgRef.id)
          return NextResponse.json({ orgId: orgRef.id, created: false })
        }
      }
    } catch (indexError) {
      console.warn(
        "organizations/resolve: collectionGroup query failed, falling through:",
        indexError
      )
    }

    // TERTIARY: clients/{email} — look for an existing org link or create one.
    const clientRef = db.collection("clients").doc(email)
    const clientSnap = await clientRef.get()

    if (!clientSnap.exists) {
      // No client record at all — nothing to build an org from.
      return NextResponse.json({ orgId: null, created: false })
    }

    const clientData = clientSnap.data() as Record<string, unknown>
    const existingOrgId = readString(clientData.orgId)

    if (existingOrgId) {
      // Org already created; ensure the requesting user is a member.
      if (uid) {
        const memberRef = db
          .collection("organizations")
          .doc(existingOrgId)
          .collection("members")
          .doc(uid)
        const memberDoc = await memberRef.get()
        if (!memberDoc.exists) {
          await memberRef.set(
            {
              uid,
              email,
              name: readString(clientData.name) || fallbackName,
              role: "owner",
              joinedAt: FieldValue.serverTimestamp(),
              invitedBy: null,
            },
            { merge: true }
          )
        }
        await cacheOrgIdOnUser(db, uid, existingOrgId)
      }
      return NextResponse.json({ orgId: existingOrgId, created: false })
    }

    // No org yet — create one from the client record.
    if (!uid) {
      return NextResponse.json({
        orgId: null,
        created: false,
        error: "uid is required to create an organization.",
      })
    }

    const companyName =
      readString(clientData.companyName) ||
      readString(clientData.claimedClientName) ||
      readString(clientData.name) ||
      fallbackName ||
      email

    const orgId = generateReadableId("org")
    const slug = slugifyOrgName(companyName) || orgId
    const orgRef = db.collection("organizations").doc(orgId)

    await orgRef.set({
      id: orgId,
      name: companyName,
      slug,
      plan: mapClientPlanToOrgPlan(readString(clientData.planType)),
      stripeCustomerId: readString(clientData.stripeCustomerId) || null,
      subscriptionId: readString(clientData.subscriptionId) || null,
      status: "trial",
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: uid,
      city: readString(clientData.city),
      website: readString(clientData.website),
      logoUrl: readString(clientData.logoUrl) || null,
      onboardingNotes: readString(clientData.onboardingNotes),
      lastActivityAt: FieldValue.serverTimestamp(),
    })

    await orgRef.collection("members").doc(uid).set({
      uid,
      email,
      name: readString(clientData.name) || fallbackName,
      role: "owner",
      joinedAt: FieldValue.serverTimestamp(),
      invitedBy: null,
    })

    // Write orgId back to both clients/{email} and users/{uid}.
    await clientRef.set(
      { orgId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    )
    await cacheOrgIdOnUser(db, uid, orgId)

    return NextResponse.json({ orgId, created: true })
  } catch (error) {
    console.error("organizations/resolve error:", {
      admin: getFirebaseAdminDiagnostics(),
      message: error instanceof Error ? error.message : String(error),
    })
    const message =
      error instanceof Error ? error.message : "Unable to resolve organization."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
