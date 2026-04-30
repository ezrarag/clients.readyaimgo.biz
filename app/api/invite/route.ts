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
    const email = readString(body.email).toLowerCase()
    const orgName = readString(body.orgName)
    const invitedBy = readString(body.invitedBy)
    const inviteUrl = readString(body.inviteUrl)

    if (!email || !orgName || !inviteUrl) {
      return NextResponse.json(
        { error: "email, orgName, and inviteUrl are required." },
        { status: 400 }
      )
    }

    const db = getAdminDb()
    const ref = db.collection("mail").doc()

    await ref.set({
      to: email,
      message: {
        subject: `Join ${orgName} on Readyaimgo`,
        text: `${invitedBy || "A teammate"} invited you to ${orgName} on Readyaimgo.\n\nJoin here: ${inviteUrl}`,
        html: `<p>${invitedBy || "A teammate"} invited you to <strong>${orgName}</strong> on Readyaimgo.</p><p><a href="${inviteUrl}">Join the workspace</a></p>`,
      },
      createdAt: FieldValue.serverTimestamp(),
      status: "queued",
    })

    return NextResponse.json({ ok: true, mailId: ref.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to queue invite email."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
