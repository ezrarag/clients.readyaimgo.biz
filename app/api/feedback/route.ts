import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminDb } from "@/lib/firebase-admin"

// POST /api/feedback
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      projectId,
      clientEmail,
      clientName,
      rawText,
      summary,
      category,
      urgency,
      loomUrl,
      pageUrl,
      elementSelector,
    } = body
    const feedbackText =
      typeof rawText === "string" && rawText.trim()
        ? rawText.trim()
        : typeof summary === "string" && summary.trim()
          ? summary.trim()
          : ""
    const normalizedCategory =
      typeof category === "string" && category.trim() ? category.trim() : "general"
    const normalizedUrgency =
      urgency === "low" || urgency === "medium" || urgency === "high"
        ? urgency
        : "medium"

    if (!projectId || (!feedbackText && !loomUrl)) {
      return NextResponse.json({ error: "projectId and either summary/rawText or loomUrl required" }, { status: 400 })
    }

    let aiInterpretation = {
      summary: feedbackText || "Video feedback submitted",
      category: normalizedCategory,
      urgency: normalizedUrgency as "low" | "medium" | "high",
      actionable: !!feedbackText,
      suggestedAction: "",
      pulseScore: 5,
    }

    if (feedbackText && process.env.OPENAI_API_KEY && !category && !urgency) {
      try {
        const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 400,
            messages: [
              {
                role: "system",
                content: `You analyze client feedback for a web dev agency. Return ONLY a JSON object with:
- summary: one sentence plain-English summary
- category: "bug" | "design" | "content" | "feature" | "performance" | "question" | "approval" | "general"
- urgency: "low" | "medium" | "high"
- actionable: boolean
- suggestedAction: brief next step or empty string
- pulseScore: 1-10 priority impact (10=broken, 1=minor)`,
              },
              {
                role: "user",
                content: `Client feedback: "${feedbackText}"${pageUrl ? `\nPage: ${pageUrl}` : ""}`,
              },
            ],
          }),
        })
        if (aiRes.ok) {
          const aiData = await aiRes.json()
          const raw = aiData.choices?.[0]?.message?.content ?? "{}"
          const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim())
          aiInterpretation = { ...aiInterpretation, ...parsed }
        }
      } catch (e) {
        console.error("AI interpretation failed:", e)
      }
    }

    const db = getAdminDb()
    const ref = db.collection("clientFeedback").doc()

    await ref.set({
      id: ref.id,
      projectId,
      clientEmail: clientEmail || null,
      clientName: clientName || "Anonymous",
      rawText: feedbackText || null,
      loomUrl: loomUrl || null,
      pageUrl: pageUrl || null,
      elementSelector: elementSelector || null,
      ...aiInterpretation,
      status: "open",
      resolvedAt: null,
      resolvedNote: null,
      source: loomUrl && !rawText ? "loom" : pageUrl ? "extension" : "portal",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    try {
      await db.collection("ragProjects").doc(projectId).set(
        { lastClientActivity: FieldValue.serverTimestamp(), openFeedbackCount: FieldValue.increment(1) },
        { merge: true }
      )
    } catch {}

    return NextResponse.json({ success: true, feedbackId: ref.id, interpretation: aiInterpretation })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// GET /api/feedback?projectId=xxx
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId")
    const status = searchParams.get("status")
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 })

    const db = getAdminDb()
    let q = db.collection("clientFeedback").where("projectId", "==", projectId).orderBy("createdAt", "desc").limit(50)
    if (status) q = db.collection("clientFeedback").where("projectId", "==", projectId).where("status", "==", status).orderBy("createdAt", "desc").limit(50)

    const snap = await q.get()
    const feedback = snap.docs.map((d) => ({
      ...d.data(),
      id: d.id,
      createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: d.data().updatedAt?.toDate?.()?.toISOString() ?? null,
    }))
    return NextResponse.json({ feedback })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/feedback — resolve or acknowledge
export async function PATCH(request: NextRequest) {
  try {
    const { feedbackId, status, resolvedNote } = await request.json()
    if (!feedbackId || !status) return NextResponse.json({ error: "feedbackId and status required" }, { status: 400 })

    const db = getAdminDb()
    const ref = db.collection("clientFeedback").doc(feedbackId)
    const update: Record<string, any> = { status, updatedAt: FieldValue.serverTimestamp() }
    if (status === "resolved") {
      update.resolvedAt = FieldValue.serverTimestamp()
      update.resolvedNote = resolvedNote || null
      const doc = await ref.get()
      const pid = doc.data()?.projectId
      if (pid) await db.collection("ragProjects").doc(pid).set({ openFeedbackCount: FieldValue.increment(-1) }, { merge: true })
    }
    await ref.update(update)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
