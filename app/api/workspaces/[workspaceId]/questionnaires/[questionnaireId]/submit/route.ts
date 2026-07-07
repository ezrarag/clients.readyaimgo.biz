import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import type { Answer, Question } from "@/lib/questionnaires"
import { normalizeQuestionnaire } from "@/lib/questionnaires"

export const dynamic = "force-dynamic"

function isEmptyAnswer(value: Answer["value"]) {
  if (value == null) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function normalizeAnswerInput(value: unknown): Answer | null {
  if (!value || typeof value !== "object") return null
  const data = value as Record<string, unknown>
  const questionId = typeof data.questionId === "string" ? data.questionId.trim() : ""
  const questionText = typeof data.questionText === "string" ? data.questionText.trim() : ""
  const type = data.type
  const rawValue = data.value
  if (!questionId || !questionText) return null
  if (type !== "short" && type !== "long" && type !== "choice" && type !== "multi" && type !== "scale") {
    return null
  }
  return {
    questionId,
    questionText,
    type,
    value:
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      rawValue === null ||
      (Array.isArray(rawValue) && rawValue.every((item) => typeof item === "string"))
        ? rawValue
        : null,
  }
}

function validateRequiredQuestions(questions: Question[], answers: Answer[]) {
  const byQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]))
  const missing = questions.filter((question) => {
    if (!question.required) return false
    return isEmptyAnswer(byQuestionId.get(question.id)?.value ?? null)
  })
  return missing
}

async function notifySlack(params: {
  workspaceName: string
  clientLabel: string | null
  questionnaireTitle: string
  answerCount: number
}) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim()
  if (!webhookUrl) return

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: [
          "*Questionnaire Completed*",
          `*Client:* ${params.clientLabel || "Workspace member"}`,
          `*Workspace:* ${params.workspaceName}`,
          `*Form:* ${params.questionnaireTitle}`,
          `*Answers:* ${params.answerCount} responses submitted`,
          "_Open admin panel to view responses._",
        ].join("\n"),
      }),
    })
  } catch (error) {
    console.warn("Questionnaire Slack notification failed:", error)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string; questionnaireId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "beam-participant")

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const answers = Array.isArray(body.answers)
      ? body.answers
          .map((answer) => normalizeAnswerInput(answer))
          .filter((answer): answer is Answer => Boolean(answer))
      : []

    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const questionnaireRef = workspaceRef.collection("questionnaires").doc(params.questionnaireId)
    const [workspaceSnap, questionnaireSnap] = await Promise.all([
      workspaceRef.get(),
      questionnaireRef.get(),
    ])

    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }
    if (!questionnaireSnap.exists) {
      return NextResponse.json({ error: "Questionnaire not found." }, { status: 404 })
    }

    const questionnaire = normalizeQuestionnaire(
      questionnaireSnap.id,
      questionnaireSnap.data() as Record<string, unknown>
    )
    if (questionnaire.status !== "active" || questionnaire.completedAt) {
      return NextResponse.json({ error: "This intake form is not open." }, { status: 400 })
    }

    const missing = validateRequiredQuestions(questionnaire.questions, answers)
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Required questions missing: ${missing.map((question) => question.text).join(", ")}` },
        { status: 400 }
      )
    }

    const now = FieldValue.serverTimestamp()
    const responseRef = questionnaireRef.collection("responses").doc()
    await db.runTransaction(async (transaction) => {
      transaction.set(responseRef, {
        id: responseRef.id,
        questionnaireId: params.questionnaireId,
        workspaceId: params.workspaceId,
        submittedByUid: decoded.uid,
        submittedByEmail: (decoded.email ?? "").toLowerCase() || null,
        submittedAt: now,
        answers,
      })
      transaction.update(questionnaireRef, {
        completedAt: now,
        completedByUid: decoded.uid,
        status: "closed",
      })
    })

    const workspace = workspaceSnap.data() as Record<string, unknown>
    const workspaceName =
      (typeof workspace.name === "string" && workspace.name.trim()) ||
      (typeof workspace.workspaceName === "string" && workspace.workspaceName.trim()) ||
      params.workspaceId

    await notifySlack({
      workspaceName,
      clientLabel: questionnaire.clientLabel,
      questionnaireTitle: questionnaire.title,
      answerCount: answers.length,
    })

    return NextResponse.json({ success: true, responseId: responseRef.id })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /questionnaires/[questionnaireId]/submit error:", error)
    return NextResponse.json({ error: "Unable to submit intake form." }, { status: 500 })
  }
}
