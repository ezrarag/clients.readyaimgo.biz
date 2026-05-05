import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminDb } from "@/lib/firebase-admin"

// POST /api/rag-notes
// Body: { clientEmail?, orgId?, subject, body, type, authorName, authorEmail }
// Writes a RAG team note to Firestore so it appears in the client's dashboard.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { clientEmail, orgId, subject, body: noteBody, type, authorName, authorEmail } = body

    if ((!clientEmail && !orgId) || !subject || !noteBody) {
      return NextResponse.json(
        { error: "clientEmail or orgId, subject, and body are required" },
        { status: 400 }
      )
    }

    const validTypes = ["note", "pulse", "update"]
    const noteType = validTypes.includes(type) ? type : "note"

    const db = getAdminDb()
    const ref = db.collection("ragNotes").doc()

    await ref.set({
      id: ref.id,
      clientEmail: clientEmail ? clientEmail.toLowerCase().trim() : null,
      orgId: typeof orgId === "string" && orgId.trim() ? orgId.trim() : null,
      subject: subject.trim(),
      body: noteBody.trim(),
      type: noteType,
      authorName: authorName || "Readyaimgo Team",
      authorEmail: authorEmail || "",
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    if (clientEmail) {
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
    }

    if (typeof orgId === "string" && orgId.trim()) {
      await db
        .collection("organizations")
        .doc(orgId.trim())
        .set(
          {
            hasUnreadRagNotes: true,
            lastRagNoteAt: FieldValue.serverTimestamp(),
            lastActivityAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
    }

    return NextResponse.json({ success: true, noteId: ref.id })
  } catch (error: any) {
    console.error("RAG notes POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// GET /api/rag-notes?clientEmail=xxx or /api/rag-notes?orgId=xxx
// Returns all RAG notes for a client/org, newest first.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const clientEmail = searchParams.get("clientEmail")?.toLowerCase().trim()
    const orgId = searchParams.get("orgId")?.trim()

    if (!clientEmail && !orgId) {
      return NextResponse.json({ error: "clientEmail or orgId required" }, { status: 400 })
    }

    const db = getAdminDb()
    const baseQuery = db.collection("ragNotes")
    const snap = orgId
      ? await baseQuery
          .where("orgId", "==", orgId)
          .orderBy("createdAt", "desc")
          .limit(20)
          .get()
      : await baseQuery
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
    const { noteId, clientEmail, orgId } = await request.json()
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

    if (orgId) {
      const remaining = await db
        .collection("ragNotes")
        .where("orgId", "==", orgId)
        .where("read", "==", false)
        .limit(1)
        .get()

      if (remaining.empty) {
        await db
          .collection("organizations")
          .doc(orgId)
          .set({ hasUnreadRagNotes: false }, { merge: true })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
