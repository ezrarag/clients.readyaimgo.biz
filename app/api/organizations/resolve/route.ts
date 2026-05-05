import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import {
  generateReadableId,
  mapClientPlanToOrgPlan,
  slugifyOrgName,
} from "@/lib/organizations"
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

    const memberSnap = await db
      .collectionGroup("members")
      .where("email", "==", email)
      .limit(1)
      .get()

    if (!memberSnap.empty) {
      const memberDoc = memberSnap.docs[0]
      const orgRef = memberDoc.ref.parent.parent

      if (orgRef) {
        return NextResponse.json({
          orgId: orgRef.id,
          created: false,
        })
      }
    }

    const clientRef = db.collection("clients").doc(email)
    const clientSnap = await clientRef.get()

    if (!clientSnap.exists) {
      return NextResponse.json({ orgId: null, created: false })
    }

    const clientData = clientSnap.data() as Record<string, unknown>
    const existingOrgId = readString(clientData.orgId)

    if (existingOrgId) {
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
      }

      return NextResponse.json({
        orgId: existingOrgId,
        created: false,
      })
    }

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

    await clientRef.set(
      {
        orgId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    return NextResponse.json({
      orgId,
      created: true,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to resolve organization."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
