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

function hasBeamAdminRole(value: unknown) {
  return Array.isArray(value) && value.includes("beam-admin")
}

async function isAdminCaller({
  db,
  callerEmail,
}: {
  db: FirebaseFirestore.Firestore
  callerEmail: string
}) {
  if (!callerEmail) {
    return false
  }

  const callerSnap = await db.collection("clients").doc(callerEmail).get()
  const callerData = callerSnap.exists ? callerSnap.data() : null
  const configuredAdminUid = process.env.NEXT_PUBLIC_ADMIN_UID

  if (
    configuredAdminUid &&
    ((typeof callerData?.uid === "string" && callerData.uid === configuredAdminUid) ||
      callerEmail === configuredAdminUid)
  ) {
    return true
  }

  return hasBeamAdminRole(callerData?.roles)
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const email = readString(body.email).toLowerCase()
    const callerEmail = readString(body.callerEmail).toLowerCase()
    const action = body.action

    if (!email || (action !== "grant" && action !== "revoke")) {
      return NextResponse.json(
        { error: "email and action ('grant' or 'revoke') are required." },
        { status: 400 }
      )
    }

    const db = getAdminDb()
    const admin = await isAdminCaller({ db, callerEmail })

    if (!admin) {
      return NextResponse.json({ error: "Only admins can manage partner status." }, { status: 403 })
    }

    const clientRef = db.collection("clients").doc(email)

    if (action === "grant") {
      await clientRef.set(
        {
          partnerTier: "agency",
          partnerSince: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

      const clientSnap = await clientRef.get()
      const clientData = clientSnap.exists ? clientSnap.data() : null
      const companyName =
        typeof clientData?.companyName === "string"
          ? clientData.companyName
          : typeof clientData?.name === "string"
            ? clientData.name
            : ""

      await db.collection("partners").doc(email).set(
        {
          email,
          companyName,
          partnerTier: "agency",
          commissionPct: 10,
          totalReferrals: 0,
          totalConvertedReferrals: 0,
          referralLinks: [],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    } else {
      await clientRef.set(
        {
          partnerTier: null,
        },
        { merge: true }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update partner status."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
