import { createHash } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"
export const maxDuration = 60

type AnthropicResponse = {
  content: Array<{ type: "text"; text?: string }>
}

type ZohoInfrastructureDraft = {
  provider?: "Zoho"
  billingCycleType?: "Business Email Tier"
  projectId?: string | null
  domain?: string | null
  mailHost?: string | null
  amount?: number | null
  dueDate?: string | null
  status?: "paid" | "unpaid" | "unknown"
  sourceEmailId?: string | null
  sourceThreadId?: string | null
  evidenceSnippet?: string | null
  confidence?: number
}

type EmailEvidence = {
  id: string
  subject: string
  from: string
  to: string
  date: string
  threadId: string | null
  snippet: string
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function stableId(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 32)
}

function getAnthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.")
  return key
}

function compactText(value: unknown, maxLength = 1200) {
  return readString(value)?.replace(/\s+/g, " ").slice(0, maxLength) ?? ""
}

function emailToEvidence(id: string, data: Record<string, unknown>): EmailEvidence {
  const subject = compactText(data.subject ?? data.title, 240)
  const from = compactText(data.from ?? data.sender, 240)
  const to = Array.isArray(data.to)
    ? data.to.filter((item): item is string => typeof item === "string").join(", ")
    : compactText(data.to ?? data.recipient, 240)
  const body =
    compactText(data.snippet, 500) ||
    compactText(data.text, 900) ||
    compactText(data.body, 900) ||
    compactText(data.html, 900)
  return {
    id,
    subject,
    from,
    to,
    date: compactText(data.date ?? data.createdAt ?? data.syncedAt, 80),
    threadId: readString(data.threadId) ?? readString(data.threadUrl),
    snippet: body,
  }
}

function isZohoRelated(email: EmailEvidence) {
  const raw = [email.subject, email.from, email.to, email.snippet].join(" ").toLowerCase()
  return (
    raw.includes("zoho") ||
    raw.includes("zohomail") ||
    raw.includes("mail.zoho") ||
    raw.includes("business email") ||
    raw.includes("mx record") ||
    raw.includes("mx.zoho")
  )
}

function buildPrompt(params: {
  workspaceId: string
  workspaceName: string
  clientId: string
  emails: EmailEvidence[]
  projectContext: string[]
}) {
  return `You extract Zoho business-email infrastructure facts from client correspondence.

Return ONLY valid JSON matching this schema:
[
  {
    "provider": "Zoho",
    "billingCycleType": "Business Email Tier",
    "projectId": "linked project id or null",
    "domain": "domain being configured or billed, or null",
    "mailHost": "Zoho mail host, MX host, or admin URL if present, or null",
    "amount": 0,
    "dueDate": "ISO date or null",
    "status": "paid | unpaid | unknown",
    "sourceEmailId": "email id from evidence",
    "sourceThreadId": "thread id or null",
    "evidenceSnippet": "short direct evidence phrase from the email",
    "confidence": 0.0
  }
]

Rules:
1. Extract Zoho, Zoho Mail, business email tier, MX, mailbox, and renewal/billing facts only.
2. Do not invent invoices, due dates, domains, or amounts. Use null when absent.
3. Every record must cite sourceEmailId and evidenceSnippet.
4. If an email only proves Zoho is being configured but has no invoice, return amount null and status "unknown".
5. Link projectId only when the project context clearly matches a domain, repository, deployment, or project name.
6. Keep confidence between 0 and 1. Drop records below 0.45.

Workspace: ${params.workspaceName}
Workspace ID: ${params.workspaceId}
Client ID: ${params.clientId}

Project context:
${params.projectContext.length ? params.projectContext.map((item, index) => `${index + 1}. ${item}`).join("\n") : "- No linked project context recorded."}

Email evidence:
${params.emails
  .map(
    (email, index) => `${index + 1}. id=${email.id}
subject=${email.subject || "not recorded"}
from=${email.from || "not recorded"}
to=${email.to || "not recorded"}
date=${email.date || "not recorded"}
thread=${email.threadId || "not recorded"}
snippet=${email.snippet || "not recorded"}`
  )
  .join("\n\n")}`
}

async function analyzeWithClaude(prompt: string): Promise<ZohoInfrastructureDraft[]> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getAnthropicKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      system:
        "You extract source-cited infrastructure accounting facts from emails. Respond with JSON only.",
      messages: [{ role: "user", content: prompt }],
    }),
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null
    throw new Error(body?.error?.message ?? `Anthropic API error ${response.status}`)
  }

  const data = (await response.json()) as AnthropicResponse
  const rawText = data.content.find((block) => block.type === "text")?.text ?? ""
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim()
  const parsed = JSON.parse(cleaned) as unknown
  return Array.isArray(parsed) ? (parsed as ZohoInfrastructureDraft[]) : []
}

async function collectProjectContext(
  db: FirebaseFirestore.Firestore,
  workspaceId: string,
  workspace: Record<string, unknown>
) {
  const context: string[] = []
  const projectsSnap = await db
    .collection("projects")
    .where("workspaceId", "==", workspaceId)
    .limit(30)
    .get()
    .catch(() => null)

  for (const doc of projectsSnap?.docs ?? []) {
    const data = doc.data() as Record<string, unknown>
    context.push(
      `projectId=${doc.id}; title=${readString(data.title) ?? readString(data.name) ?? "not recorded"}; domain=${
        readString(data.liveUrl) ?? readString(data.deployUrl) ?? "not recorded"
      }; repo=${readString(data.githubRepo) ?? readString(data.repoSlug) ?? "not recorded"}`
    )
  }

  const vercelProjects = Array.isArray(workspace.vercelProjects)
    ? (workspace.vercelProjects as Array<Record<string, unknown>>)
    : []
  for (const project of vercelProjects.slice(0, 10)) {
    context.push(
      `vercelProject=${readString(project.name) ?? readString(project.id) ?? "not recorded"}; domains=${
        Array.isArray(project.domains) ? project.domains.join(", ") : readString(project.url) ?? "not recorded"
      }; repo=${readString(project.githubRepo) ?? readString(project.repoSlug) ?? "not recorded"}`
    )
  }

  return context.slice(0, 40)
}

function normalizeDraft(draft: ZohoInfrastructureDraft, emails: EmailEvidence[]) {
  const confidence = Math.max(0, Math.min(1, readNumber(draft.confidence) ?? 0))
  if (confidence < 0.45) return null
  const sourceEmailId = readString(draft.sourceEmailId)
  const sourceEmail = emails.find((email) => email.id === sourceEmailId)
  if (!sourceEmailId || !sourceEmail) return null

  const amount = readNumber(draft.amount)
  const dueDate = readString(draft.dueDate)
  const status =
    draft.status === "paid" || draft.status === "unpaid" || draft.status === "unknown"
      ? draft.status
      : "unknown"
  const domain = readString(draft.domain)
  const mailHost = readString(draft.mailHost)
  const evidenceSnippet = readString(draft.evidenceSnippet) ?? sourceEmail.snippet.slice(0, 240)

  return {
    provider: "Zoho" as const,
    billingCycleType: "Business Email Tier" as const,
    projectId: readString(draft.projectId),
    domain,
    mailHost,
    amount,
    dueDate,
    status,
    sourceEmailId,
    sourceThreadId: readString(draft.sourceThreadId) ?? sourceEmail.threadId,
    evidenceSnippet,
    confidence,
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()
    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "developer")

    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const workspaceSnap = await workspaceRef.get()
    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }

    const workspace = workspaceSnap.data() as Record<string, unknown>
    const clientId = readString(workspace.clientId)
    if (!clientId) {
      return NextResponse.json({
        success: true,
        records: [],
        message: "No client communication record is linked to this workspace.",
      })
    }

    const emailsSnap = await db
      .collection("clientComms")
      .doc(clientId)
      .collection("emails")
      .limit(75)
      .get()

    const emails = emailsSnap.docs
      .map((doc) => emailToEvidence(doc.id, doc.data() as Record<string, unknown>))
      .filter(isZohoRelated)
      .slice(0, 25)

    if (emails.length === 0) {
      return NextResponse.json({
        success: true,
        records: [],
        message: "No Zoho-related email evidence was found in synced correspondence.",
      })
    }

    const workspaceName =
      readString(workspace.workspaceName) ||
      readString(workspace.businessName) ||
      readString(workspace.clientBusinessName) ||
      readString(workspace.name) ||
      params.workspaceId
    const projectContext = await collectProjectContext(db, params.workspaceId, workspace)
    const drafts = await analyzeWithClaude(
      buildPrompt({
        workspaceId: params.workspaceId,
        workspaceName,
        clientId,
        emails,
        projectContext,
      })
    )
    const records = drafts
      .map((draft) => normalizeDraft(draft, emails))
      .filter((record): record is NonNullable<typeof record> => Boolean(record))

    if (records.length === 0) {
      return NextResponse.json({
        success: true,
        records: [],
        message: "Zoho email analysis did not produce source-backed records.",
      })
    }

    const batch = db.batch()
    const created: Array<Record<string, unknown>> = []

    for (const record of records.slice(0, 10)) {
      const fingerprint = stableId(
        [
          params.workspaceId,
          record.sourceEmailId,
          record.domain,
          record.mailHost,
          record.amount,
          record.dueDate,
          record.evidenceSnippet,
        ].join("|")
      )
      const linkRef = workspaceRef.collection("infrastructureLinks").doc(`zoho_${fingerprint}`)
      batch.set(
        linkRef,
        {
          ...record,
          sourceSystem: "zoho-email-analysis",
          sourceProvider: "Zoho",
          sourceRef: record.sourceEmailId,
          createdByUid: decoded.uid,
          createdByEmail: decoded.email ?? null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

      if (record.amount && record.amount > 0 && record.status !== "paid") {
        const expenseRef = workspaceRef.collection("expenses").doc(`zoho_${fingerprint}`)
        batch.set(
          expenseRef,
          {
            source: "Zoho Mail System",
            description:
              record.evidenceSnippet ||
              `Zoho business email tier${record.domain ? ` for ${record.domain}` : ""}`,
            amount: record.amount,
            status: record.status === "unknown" ? "unpaid" : record.status,
            serviceProvider: "Zoho",
            billingCycleType: "Business Email Tier",
            dueDate: record.dueDate,
            vendor: "Zoho",
            category: "business-email",
            projectId: record.projectId,
            domain: record.domain,
            mailHost: record.mailHost,
            sourceEmailId: record.sourceEmailId,
            sourceThreadId: record.sourceThreadId,
            evidenceSnippet: record.evidenceSnippet,
            confidence: record.confidence,
            contractAppendageReady: true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
      }

      created.push({ id: linkRef.id, ...record })
    }

    batch.set(workspaceRef, { updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    await batch.commit()

    return NextResponse.json({
      success: true,
      records: created,
      analyzedEmails: emails.length,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /workspaces/[workspaceId]/infrastructure/analyze-zoho-emails error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to analyze Zoho emails." },
      { status: 500 }
    )
  }
}
