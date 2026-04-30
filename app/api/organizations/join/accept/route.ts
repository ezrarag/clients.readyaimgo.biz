import { type NextRequest, NextResponse } from "next/server"
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"

function getAdminDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    })
  }

  return getFirestore()
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const orgId = readString(body.orgId)
    const token = readString(body.token)
    const uid = readString(body.uid)
    const email = readString(body.email).toLowerCase()
    const name = readString(body.name)

    if (!orgId || !token || !uid || !email) {
      return NextResponse.json(
        { error: "orgId, token, uid, and email are required." },
        { status: 400 }
      )
    }

    const db = getAdminDb()
    const orgRef = db.collection("organizations").doc(orgId)
    const orgSnap = await orgRef.get()

    if (!orgSnap.exists) {
      return NextResponse.json({ error: "Organization not found." }, { status: 404 })
    }

    const inviteSnap = await orgRef
      .collection("invites")
      .where("token", "==", token)
      .limit(1)
      .get()

    if (inviteSnap.empty) {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 })
    }

    const inviteDoc = inviteSnap.docs[0]
    const invite = inviteDoc.data()
    const inviteEmail =
      typeof invite.email === "string" ? invite.email.toLowerCase().trim() : inviteDoc.id

    if (inviteEmail !== email) {
      return NextResponse.json(
        { error: "This invite belongs to a different email address." },
        { status: 403 }
      )
    }

    if (invite.status === "revoked") {
      return NextResponse.json({ error: "This invite has been revoked." }, { status: 410 })
    }

    const role =
      invite.role === "owner" || invite.role === "admin" || invite.role === "viewer"
        ? invite.role
        : "viewer"

    await orgRef.collection("members").doc(uid).set(
      {
        uid,
        email,
        name,
        role,
        joinedAt: FieldValue.serverTimestamp(),
        invitedBy: typeof invite.invitedBy === "string" ? invite.invitedBy : null,
      },
      { merge: true }
    )

    await inviteDoc.ref.set(
      {
        status: "accepted",
        acceptedAt: FieldValue.serverTimestamp(),
        acceptedByUid: uid,
      },
      { merge: true }
    )

    await db.collection("clients").doc(email).set(
      {
        orgId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    await orgRef.set({ lastActivityAt: FieldValue.serverTimestamp() }, { merge: true })

    return NextResponse.json({ ok: true, orgId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to accept invite."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
