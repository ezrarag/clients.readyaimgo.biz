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

// POST /api/rag-notes
// Body: { clientEmail, subject, body, type, authorName, authorEmail }
// Writes a RAG team note to Firestore so it appears in the client's dashboard.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { clientEmail, subject, body: noteBody, type, authorName, authorEmail } = body

    if (!clientEmail || !subject || !noteBody) {
      return NextResponse.json(
        { error: "clientEmail, subject, and body are required" },
        { status: 400 }
      )
    }

    const validTypes = ["note", "pulse", "update"]
    const noteType = validTypes.includes(type) ? type : "note"

    const db = getAdminDb()
    const ref = db.collection("ragNotes").doc()

    await ref.set({
      id: ref.id,
      clientEmail: clientEmail.toLowerCase().trim(),
      subject: subject.trim(),
      body: noteBody.trim(),
      type: noteType,
      authorName: authorName || "Readyaimgo Team",
      authorEmail: authorEmail || "",
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Also bump the client doc so their dashboard shows "new" indicator
    await db
      .collection("clients")
      .doc(clientEmail.toLowerCase().trim())
      .set(
        {
          hasUnreadRagNotes: true,
          lastRagNoteAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

    return NextResponse.json({ success: true, noteId: ref.id })
  } catch (error: any) {
    console.error("RAG notes POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// GET /api/rag-notes?clientEmail=xxx
// Returns all RAG notes for a client, newest first.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const clientEmail = searchParams.get("clientEmail")?.toLowerCase().trim()

    if (!clientEmail) {
      return NextResponse.json({ error: "clientEmail required" }, { status: 400 })
    }

    const db = getAdminDb()
    const snap = await db
      .collection("ragNotes")
      .where("clientEmail", "==", clientEmail)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get()

    const notes = snap.docs.map((d) => ({
      ...d.data(),
      id: d.id,
      createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
    }))

    return NextResponse.json({ notes })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/rag-notes — mark a note as read
export async function PATCH(request: NextRequest) {
  try {
    const { noteId, clientEmail } = await request.json()
    if (!noteId) return NextResponse.json({ error: "noteId required" }, { status: 400 })

    const db = getAdminDb()
    await db.collection("ragNotes").doc(noteId).update({
      read: true,
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Check if any unread notes remain for this client
    if (clientEmail) {
      const remaining = await db
        .collection("ragNotes")
        .where("clientEmail", "==", clientEmail.toLowerCase().trim())
        .where("read", "==", false)
        .limit(1)
        .get()

      if (remaining.empty) {
        await db
          .collection("clients")
          .doc(clientEmail.toLowerCase().trim())
          .set({ hasUnreadRagNotes: false }, { merge: true })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
