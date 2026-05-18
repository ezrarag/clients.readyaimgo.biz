/**
 * POST /api/contracts/draft
 *
 * Generates an AI-assisted scope-of-work draft using the Anthropic Messages
 * API (called server-side via fetch — no browser-exposed key).
 *
 * Authorization:
 *   - Workspace developer / owner for the supplied workspaceId, OR
 *   - beam-admin
 *
 * The generated draft is saved as a contracts/{contractId} Firestore doc with
 *   status: "draft"
 *   aiDraft: true
 * and the full structured content in draftContent.
 *
 * Returns { contractId, draft: { title, summary, scopeOfWork, deliverables,
 *   timeline, assumptions, clientResponsibilities, paymentTerms,
 *   revisionTerms, legalReviewNotes } }
 */

import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"
// Contract drafting involves a multi-second LLM call — extend the default
// function timeout to avoid a premature 504 on slower networks.
export const maxDuration = 60

// ─── Anthropic REST types (minimal — no SDK required) ─────────────────────────

interface AnthropicMessage {
  role: "user" | "assistant"
  content: string
}

interface AnthropicRequest {
  model: string
  max_tokens: number
  system?: string
  messages: AnthropicMessage[]
}

interface AnthropicContentBlock {
  type: "text"
  text: string
}

interface AnthropicResponse {
  id: string
  type: "message"
  role: "assistant"
  content: AnthropicContentBlock[]
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}

interface AnthropicError {
  type: "error"
  error: { type: string; message: string }
}

// ─── Draft structure ──────────────────────────────────────────────────────────

export interface ContractDraft {
  title: string
  summary: string
  scopeOfWork: string
  deliverables: string[]
  timeline: string
  assumptions: string[]
  clientResponsibilities: string[]
  paymentTerms: string
  revisionTerms: string
  legalReviewNotes: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.")
  return key
}

async function isBeamAdmin(uid: string): Promise<boolean> {
  const db = getAdminDb()
  const snap = await db.collection("users").doc(uid).get()
  if (!snap.exists) return false
  const roles = (snap.data() as Record<string, unknown>).roles
  return Array.isArray(roles) && roles.includes("beam-admin")
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(params: {
  workspaceName: string
  clientId: string | null
  projectDescription: string
  completedWork: string
  upcomingWork: string
  paymentTerms: string
  constraints: string
  revisionRequest: string
  sourceDocuments: string[]
  adminRules: string[]
}): string {
  const sections = [
    `**Workspace / Client:** ${params.workspaceName}${params.clientId ? ` (client ID: ${params.clientId})` : ""}`,
    `**Project description:** ${params.projectDescription}`,
    params.completedWork && `**Work already completed:** ${params.completedWork}`,
    params.upcomingWork && `**Upcoming / planned work:** ${params.upcomingWork}`,
    params.paymentTerms && `**Payment terms / budget context:** ${params.paymentTerms}`,
    params.constraints && `**Constraints / notes:** ${params.constraints}`,
    params.revisionRequest && `**Client revision request:** ${params.revisionRequest}`,
    params.sourceDocuments.length > 0 &&
      `**Referenced workspace documents:**\n${params.sourceDocuments
        .map((name) => `- ${name}`)
        .join("\n")}`,
    params.adminRules.length > 0 &&
      `**Admin-provided drafting rules, rulesets, and boilerplate guidance:**\n${params.adminRules
        .map((rule, index) => `${index + 1}. ${rule}`)
        .join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n")

  return `You are a professional contract drafter assisting a technology services firm.

Using the project context below, produce a structured scope-of-work draft in **valid JSON** matching exactly this schema — no prose before or after the JSON:

\`\`\`json
{
  "title": "string — concise agreement title",
  "summary": "string — 2-4 sentence executive summary",
  "scopeOfWork": "string — detailed markdown description of the engagement scope",
  "deliverables": ["string", "..."],
  "timeline": "string — proposed schedule or milestone structure",
  "assumptions": ["string", "..."],
  "clientResponsibilities": ["string", "..."],
  "paymentTerms": "string — structured payment schedule",
  "revisionTerms": "string — revision / change-order policy",
  "legalReviewNotes": "string — flags for legal review; note that this AI draft is not legal advice"
}
\`\`\`

IMPORTANT RULES:
1. Output ONLY the JSON object — no explanation, no markdown code fence in the final output.
2. Arrays must contain at least one element.
3. Always include in legalReviewNotes: "This AI-generated draft is not legal advice and requires review by qualified legal counsel before execution."
4. Keep language professional and specific to the provided context.
5. Treat admin-provided drafting rules as binding context. If a client revision conflicts with those rules, preserve the rule and flag the conflict in legalReviewNotes.

---

PROJECT CONTEXT:

${sections}`
}

// ─── Anthropic API call ───────────────────────────────────────────────────────

async function generateDraft(prompt: string): Promise<ContractDraft> {
  const apiKey = getAnthropicKey()

  const reqBody: AnthropicRequest = {
    model: "claude-opus-4-5",
    max_tokens: 4096,
    system:
      "You are a precise contract-drafting assistant. Always respond with valid JSON only — no surrounding text.",
    messages: [{ role: "user", content: prompt }],
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(reqBody),
  })

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as AnthropicError | null
    const msg = errBody?.error?.message ?? `Anthropic API error ${res.status}`
    throw new Error(msg)
  }

  const data = (await res.json()) as AnthropicResponse
  const rawText = data.content.find((b) => b.type === "text")?.text ?? ""

  // Strip accidental markdown code fences if the model adds them
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()

  let draft: ContractDraft
  try {
    draft = JSON.parse(cleaned) as ContractDraft
  } catch {
    throw new Error("AI returned malformed JSON. Please try again.")
  }

  // Ensure required fields are present with sensible fallbacks
  return {
    title: typeof draft.title === "string" ? draft.title : "Untitled Agreement",
    summary: typeof draft.summary === "string" ? draft.summary : "",
    scopeOfWork: typeof draft.scopeOfWork === "string" ? draft.scopeOfWork : "",
    deliverables: Array.isArray(draft.deliverables) ? draft.deliverables : [],
    timeline: typeof draft.timeline === "string" ? draft.timeline : "",
    assumptions: Array.isArray(draft.assumptions) ? draft.assumptions : [],
    clientResponsibilities: Array.isArray(draft.clientResponsibilities)
      ? draft.clientResponsibilities
      : [],
    paymentTerms: typeof draft.paymentTerms === "string" ? draft.paymentTerms : "",
    revisionTerms: typeof draft.revisionTerms === "string" ? draft.revisionTerms : "",
    legalReviewNotes:
      typeof draft.legalReviewNotes === "string"
        ? draft.legalReviewNotes
        : "This AI-generated draft is not legal advice and requires review by qualified legal counsel before execution.",
  }
}

function collectAdminContractRules(wsData: Record<string, unknown>): string[] {
  const candidates = [
    wsData.contractSystemRules,
    wsData.contractRules,
    wsData.contractRulesets,
    wsData.boilerplateGuidelines,
    wsData.aiAssistantRules,
    wsData.adminSystemRules,
    wsData.workspaceProperties,
  ]

  const rules: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      rules.push(value.trim())
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>
      for (const key of [
        "contractRules",
        "contractRulesets",
        "rulesets",
        "boilerplateGuidelines",
        "systemRules",
        "aiAssistantRules",
        "agreementBoilerplate",
      ]) {
        if (key in obj) visit(obj[key])
      }
    }
  }

  candidates.forEach(visit)
  return Array.from(new Set(rules)).slice(0, 20)
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const idToken = getBearerToken(request)
    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    let decoded: Awaited<ReturnType<ReturnType<typeof getAdminAuth>["verifyIdToken"]>>
    try {
      decoded = await getAdminAuth().verifyIdToken(idToken)
    } catch {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    const body = (await request.json()) as Record<string, unknown>

    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId.trim() : ""
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 })
    }

    const projectDescription =
      typeof body.projectDescription === "string" ? body.projectDescription.trim() : ""
    if (!projectDescription) {
      return NextResponse.json(
        { error: "projectDescription is required." },
        { status: 400 }
      )
    }

    const db = getAdminDb()
    const admin = await isBeamAdmin(decoded.uid)

    if (!admin) {
      // Require developer+ role for non-admins
      try {
        await assertWorkspaceRole(db, workspaceId, decoded.uid, "developer")
      } catch (err) {
        if (err instanceof WorkspaceAuthError) {
          return NextResponse.json({ error: err.message }, { status: err.status })
        }
        throw err
      }
    }

    // ── Resolve workspace context ────────────────────────────────────────────
    const wsSnap = await db.collection("workspaces").doc(workspaceId).get()
    if (!wsSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }
    const wsData = wsSnap.data() as Record<string, unknown>
    const workspaceName =
      typeof wsData.name === "string" && wsData.name.trim()
        ? wsData.name.trim()
        : workspaceId
    const clientId =
      typeof wsData.clientId === "string" && wsData.clientId.trim()
        ? wsData.clientId.trim().toLowerCase()
        : null

    // ── Optional body fields ─────────────────────────────────────────────────
    const completedWork =
      typeof body.completedWork === "string" ? body.completedWork.trim() : ""
    const upcomingWork =
      typeof body.upcomingWork === "string" ? body.upcomingWork.trim() : ""
    const paymentTermsInput =
      typeof body.paymentTerms === "string" ? body.paymentTerms.trim() : ""
    const constraints =
      typeof body.constraints === "string" ? body.constraints.trim() : ""
    const revisionRequest =
      typeof body.revisionRequest === "string" ? body.revisionRequest.trim() : ""
    const sourceDocumentIds = Array.isArray(body.sourceDocumentIds)
      ? body.sourceDocumentIds.filter((id): id is string => typeof id === "string")
      : []

    let sourceDocuments: string[] = []
    if (sourceDocumentIds.length > 0) {
      const fileSnaps = await Promise.all(
        sourceDocumentIds.slice(0, 10).map((id) =>
          db
            .collection("workspaces")
            .doc(workspaceId)
            .collection("files")
            .doc(id)
            .get()
        )
      )
      sourceDocuments = fileSnaps
        .filter((snap) => snap.exists)
        .map((snap) => {
          const fileData = snap.data() as Record<string, unknown>
          return typeof fileData.name === "string" ? fileData.name : snap.id
        })
    }

    // ── Generate draft ───────────────────────────────────────────────────────
    const prompt = buildPrompt({
      workspaceName,
      clientId,
      projectDescription,
      completedWork,
      upcomingWork,
      paymentTerms: paymentTermsInput,
      constraints,
      revisionRequest,
      sourceDocuments,
      adminRules: collectAdminContractRules(wsData),
    })

    const draft = await generateDraft(prompt)

    // ── Persist to Firestore ─────────────────────────────────────────────────
    const now = FieldValue.serverTimestamp()
    const contractRef = db.collection("contracts").doc()
    await contractRef.set({
      // Standard BeamContract fields
      workspaceId,
      clientId: clientId ?? "",
      clientName: workspaceName,
      clientEmail:
        typeof wsData.clientEmail === "string" && wsData.clientEmail.trim()
          ? wsData.clientEmail.trim().toLowerCase()
          : (decoded.email ?? "").toLowerCase(),
      contractType: "mou" as const,
      status: "draft" as const,
      title: draft.title,
      summary: draft.summary,
      // Pack the extended prose into notes for display in ContractDetailModal
      notes: [
        draft.scopeOfWork && `## Scope of Work\n\n${draft.scopeOfWork}`,
        draft.timeline && `## Timeline\n\n${draft.timeline}`,
        draft.paymentTerms && `## Payment Terms\n\n${draft.paymentTerms}`,
        draft.revisionTerms && `## Revision Terms\n\n${draft.revisionTerms}`,
        draft.legalReviewNotes && `## Legal Review Notes\n\n${draft.legalReviewNotes}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      monthlyValue: 0,
      termMonths: 0,
      startDate: null,
      endDate: null,
      documentUrl: null,
      beamNgos: [],
      // AI-draft metadata — not in BeamContract type but stored in Firestore
      aiDraft: true,
      draftContent: draft,
      sourceDocumentIds: sourceDocumentIds.slice(0, 10),
      revisionRequest: revisionRequest || null,
      adminRulesApplied: collectAdminContractRules(wsData),
      createdBy: decoded.uid,
      createdAt: now,
      updatedAt: now,
    })

    await db
      .collection("workspaces")
      .doc(workspaceId)
      .set(
        {
          contractIds: FieldValue.arrayUnion(contractRef.id),
          updatedAt: now,
        },
        { merge: true }
      )

    return NextResponse.json(
      {
        success: true,
        contractId: contractRef.id,
        draft,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /api/contracts/draft error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to generate contract draft.",
      },
      { status: 500 }
    )
  }
}
