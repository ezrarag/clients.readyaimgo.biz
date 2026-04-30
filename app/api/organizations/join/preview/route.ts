import { type NextRequest, NextResponse } from "next/server"
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

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

export async function GET(request: NextRequest) {
  try {
    const orgId = request.nextUrl.searchParams.get("org")?.trim()
    const token = request.nextUrl.searchParams.get("token")?.trim()

    if (!orgId || !token) {
      return NextResponse.json({ error: "org and token are required." }, { status: 400 })
    }

    const db = getAdminDb()
    const orgSnap = await db.collection("organizations").doc(orgId).get()

    if (!orgSnap.exists) {
      return NextResponse.json({ error: "Organization not found." }, { status: 404 })
    }

    const inviteSnap = await db
      .collection("organizations")
      .doc(orgId)
      .collection("invites")
      .where("token", "==", token)
      .limit(1)
      .get()

    if (inviteSnap.empty) {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 })
    }

    const invite = inviteSnap.docs[0].data()

    return NextResponse.json({
      orgId,
      orgName:
        typeof orgSnap.data()?.name === "string" ? orgSnap.data()?.name : "Organization",
      email: typeof invite.email === "string" ? invite.email : inviteSnap.docs[0].id,
      role:
        invite.role === "owner" || invite.role === "admin" || invite.role === "viewer"
          ? invite.role
          : "viewer",
      status: invite.status === "accepted" || invite.status === "revoked" ? invite.status : "pending",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load invite."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
