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
  proposedAmount: number
  pricingCadence: "one-time" | "monthly" | "milestone" | "custom"
  paymentDates: string[]
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

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function summarizeHostingConfig(workspace: Record<string, unknown>) {
  const hosting =
    workspace.hosting && typeof workspace.hosting === "object"
      ? (workspace.hosting as Record<string, unknown>)
      : {}
  const primaryProvider = readString(hosting.primaryProvider) ?? "vercel"
  const domainRegistrars = Array.isArray(hosting.domainRegistrars)
    ? hosting.domainRegistrars.length
    : 0
  const manualDnsTargets = Array.isArray(hosting.manualDnsTargets)
    ? hosting.manualDnsTargets.length
    : 0
  const staticHosts = Array.isArray(hosting.staticHosts) ? hosting.staticHosts.length : 0

  return `${primaryProvider}; DNS targets: ${manualDnsTargets}; registrars: ${domainRegistrars}; static hosts: ${staticHosts}`
}

function estimateDataStructureLines(value: unknown) {
  const serialized = JSON.stringify(value ?? {}, null, 2)
  return Math.max(1, serialized.split("\n").length)
}

function extractRepositoryHandle(value: Record<string, unknown>) {
  const repository =
    value.repository && typeof value.repository === "object"
      ? (value.repository as Record<string, unknown>)
      : null

  return (
    readString(value.githubRepo) ||
    readString(value.repoSlug) ||
    readString(value.fullName) ||
    readString(repository?.fullName)
  )
}

async function fetchGitHubRepoEvidence(fullName: string) {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN || process.env.GITHUB_PAT
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const repoPath = encodeURIComponent(fullName).replace(/%2F/g, "/")
  const [languagesRes, commitsRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${repoPath}/languages`, {
      headers,
      cache: "no-store",
    }).catch(() => null),
    fetch(`https://api.github.com/repos/${repoPath}/commits?per_page=5`, {
      headers,
      cache: "no-store",
    }).catch(() => null),
  ])

  const languages =
    languagesRes?.ok ? ((await languagesRes.json().catch(() => ({}))) as Record<string, number>) : {}
  const commits = commitsRes?.ok
    ? (((await commitsRes.json().catch(() => [])) as Array<Record<string, unknown>>) ?? [])
    : []

  const languageSummary = Object.entries(languages)
    .slice(0, 5)
    .map(([language, lines]) => `${language}: ${lines}`)
    .join(", ")

  const commitSummary = commits
    .slice(0, 5)
    .map((commit) => {
      const commitData =
        commit.commit && typeof commit.commit === "object"
          ? (commit.commit as Record<string, unknown>)
          : {}
      const message = readString(commitData.message)
      const sha = readString(commit.sha)
      return message ? `${sha ? `${sha.slice(0, 8)} ` : ""}${message.split("\n")[0]}` : null
    })
    .filter((item): item is string => Boolean(item))
    .join(" | ")

  const latestSha = readString(commits[0]?.sha)
  const latestStats = latestSha
    ? await fetch(`https://api.github.com/repos/${repoPath}/commits/${latestSha}`, {
        headers,
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) return null
          const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
          const stats =
            payload?.stats && typeof payload.stats === "object"
              ? (payload.stats as Record<string, unknown>)
              : null
          const total = readNumber(stats?.total)
          const additions = readNumber(stats?.additions)
          const deletions = readNumber(stats?.deletions)
          return total !== null || additions !== null || deletions !== null
            ? `Latest commit line-change metric for ${fullName}: ${latestSha.slice(0, 8)} total ${
                total ?? "unknown"
              }, additions ${additions ?? "unknown"}, deletions ${deletions ?? "unknown"}`
            : null
        })
        .catch(() => null)
    : null

  return [
    languageSummary && `GitHub language metric for ${fullName}: ${languageSummary}`,
    commitSummary && `Latest default-branch commits for ${fullName}: ${commitSummary}`,
    latestStats,
  ].filter((item): item is string => Boolean(item))
}

async function collectWorkspaceTechnicalContext(
  db: FirebaseFirestore.Firestore,
  workspaceId: string,
  wsData: Record<string, unknown>
) {
  const context: string[] = []
  const hostingSummary = summarizeHostingConfig(wsData)

  const repos = Array.isArray(wsData.repos)
    ? (wsData.repos as Array<Record<string, unknown>>)
    : []
  for (const repo of repos.slice(0, 6)) {
    const fullName = readString(repo.fullName)
    if (!fullName) continue
    context.push(
      `GitHub repository: ${fullName}; language: ${readString(repo.language) ?? "not recorded"}; URL: ${
        readString(repo.url) ?? "not recorded"
      }; verified metadata lines: ${estimateDataStructureLines(repo)}`
    )
    context.push(...(await fetchGitHubRepoEvidence(fullName)))
  }

  const vercelProjects = Array.isArray(wsData.vercelProjects)
    ? (wsData.vercelProjects as Array<Record<string, unknown>>)
    : []
  for (const project of vercelProjects.slice(0, 10)) {
    const repoHandle = extractRepositoryHandle(project)
    context.push(
      `Vercel deployment: ${readString(project.name) ?? readString(project.id) ?? "unnamed"}; deployment ID: ${
        readString(project.deploymentId) ?? readString(project.id) ?? "not recorded"
      }; repo: ${repoHandle ?? "not mapped"}; framework: ${
        readString(project.framework) ?? "not recorded"
      }; state: ${readString(project.deploymentState) ?? "not recorded"}; domains: ${
        readStringArray(project.domains).join(", ") || readString(project.url) || "not recorded"
      }; hosting platform configuration: ${hostingSummary}; verified metadata lines: ${estimateDataStructureLines(project)}`
    )
  }

  const clientId = readString(wsData.clientId)
  const projectIds = readStringArray(wsData.projectIds)
  const [workspaceProjectSnap, clientProjectSnap, explicitProjectSnaps] = await Promise.all([
    db.collection("projects").where("workspaceId", "==", workspaceId).limit(20).get().catch(() => null),
    clientId
      ? db.collection("projects").where("clientId", "==", clientId).limit(20).get().catch(() => null)
      : Promise.resolve(null),
    Promise.all(
      projectIds.slice(0, 20).map((projectId) => db.collection("projects").doc(projectId).get())
    ).catch(() => []),
  ])

  const projects = new Map<string, Record<string, unknown>>()
  for (const doc of workspaceProjectSnap?.docs ?? []) projects.set(doc.id, doc.data() as Record<string, unknown>)
  for (const doc of clientProjectSnap?.docs ?? []) projects.set(doc.id, doc.data() as Record<string, unknown>)
  for (const doc of explicitProjectSnaps) {
    if (doc.exists) projects.set(doc.id, doc.data() as Record<string, unknown>)
  }

  for (const [projectId, project] of projects) {
    const lineChangeCount =
      readNumber(project.lineChangeCount) ??
      readNumber(project.linesChanged) ??
      readNumber(project.commitLineChanges) ??
      readNumber(project.totalLineChanges)
    const additions = readNumber(project.additions) ?? readNumber(project.linesAdded)
    const deletions = readNumber(project.deletions) ?? readNumber(project.linesDeleted)
    const codeMetric =
      lineChangeCount !== null || additions !== null || deletions !== null
        ? `line-change count: ${lineChangeCount ?? "not recorded"}; additions: ${
            additions ?? "not recorded"
          }; deletions: ${deletions ?? "not recorded"}`
        : "line-change count: not recorded"

    context.push(
      `Workspace project record: ${readString(project.title) ?? readString(project.name) ?? projectId}; type: ${
        readString(project.projectType) ?? "not recorded"
      }; summary: ${
        readString(project.summary) || readString(project.description) || "not recorded"
      }; repo: ${extractRepositoryHandle(project) ?? "not mapped"}; Vercel deployment ID: ${
        readString(project.vercelDeploymentId) ?? readString(project.vercelProjectId) ?? "not recorded"
      }; live URL: ${
        readString(project.liveUrl) || readString(project.deployUrl) || "not recorded"
      }; latest commit: ${
        readString(project.latestCommitMessage) || readString(project.latestCommitSha) || "not recorded"
      }; ${codeMetric}; verified metadata lines: ${estimateDataStructureLines(project)}`
    )
  }

  return Array.from(new Set(context)).slice(0, 40)
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
  technicalContext: string[]
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
    params.technicalContext.length > 0 &&
      `**Exact repository, deployment, and project evidence snapshot:**\n${params.technicalContext
        .map((item, index) => `${index + 1}. ${item}`)
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
  "proposedAmount": 0,
  "pricingCadence": "one-time | monthly | milestone | custom",
  "paymentDates": ["YYYY-MM-DD or descriptive milestone date", "..."],
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
6. Cross-examine the customer text against the exact repository, deployment, project, and line-change evidence snapshot before writing scope, deliverables, assumptions, and payment terms.
7. Reference real repository handles, deployment IDs, line-change counts, project records, modules, or platform configuration only when they appear in the evidence.
8. Purge generic template placeholders and unrelated examples, including pizza, restaurant, or canned sample project language unless the customer explicitly supplied that context.
9. Do not invent codebases, deployment logs, municipal endpoints, financial terms, or client obligations that are not supported by the supplied context.
10. proposedAmount is required and must be a positive numeric estimate in USD. If the customer did not provide a budget, suggest a conservative amount based on the scope and explain the assumption in paymentTerms and legalReviewNotes.
11. paymentTerms must include the proposedAmount, the pricingCadence, who pays, and when each payment is due. paymentDates must contain at least one date or milestone label.

---

PROJECT CONTEXT:

${sections}`
}

function normalizeCadence(value: unknown): ContractDraft["pricingCadence"] {
  return value === "monthly" ||
    value === "milestone" ||
    value === "custom" ||
    value === "one-time"
    ? value
    : "custom"
}

function extractFirstUsdAmount(...values: string[]) {
  for (const value of values) {
    const match = value.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/)
    if (!match) continue
    const parsed = Number(match[1].replace(/,/g, ""))
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

function inferTermMonths(draft: ContractDraft) {
  const text = `${draft.paymentTerms} ${draft.timeline}`.toLowerCase()
  const monthMatch = text.match(/(\d+)\s*month/)
  if (monthMatch) {
    const parsed = Number(monthMatch[1])
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  if (draft.pricingCadence === "monthly") return 1
  return 0
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

  const proposedAmount =
    typeof draft.proposedAmount === "number" && Number.isFinite(draft.proposedAmount)
      ? draft.proposedAmount
      : extractFirstUsdAmount(draft.paymentTerms, draft.summary, draft.scopeOfWork)

  if (proposedAmount <= 0) {
    throw new Error("AI did not return a monetary amount. Add budget context and try again.")
  }

  // Ensure required fields are present with sensible fallbacks
  const normalizedDraft: ContractDraft = {
    title: typeof draft.title === "string" ? draft.title : "Untitled Agreement",
    summary: typeof draft.summary === "string" ? draft.summary : "",
    scopeOfWork: typeof draft.scopeOfWork === "string" ? draft.scopeOfWork : "",
    deliverables: Array.isArray(draft.deliverables) ? draft.deliverables : [],
    timeline: typeof draft.timeline === "string" ? draft.timeline : "",
    assumptions: Array.isArray(draft.assumptions) ? draft.assumptions : [],
    clientResponsibilities: Array.isArray(draft.clientResponsibilities)
      ? draft.clientResponsibilities
      : [],
    proposedAmount,
    pricingCadence: normalizeCadence(draft.pricingCadence),
    paymentDates: Array.isArray(draft.paymentDates)
      ? draft.paymentDates.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : ["Due on agreement approval"],
    paymentTerms: typeof draft.paymentTerms === "string" ? draft.paymentTerms : "",
    revisionTerms: typeof draft.revisionTerms === "string" ? draft.revisionTerms : "",
    legalReviewNotes:
      typeof draft.legalReviewNotes === "string"
        ? draft.legalReviewNotes
        : "This AI-generated draft is not legal advice and requires review by qualified legal counsel before execution.",
  }

  if (!normalizedDraft.paymentTerms.includes(String(normalizedDraft.proposedAmount))) {
    normalizedDraft.paymentTerms = `${normalizedDraft.paymentTerms}\n\nProposed amount: $${normalizedDraft.proposedAmount.toLocaleString("en-US")} (${normalizedDraft.pricingCadence}).`.trim()
  }

  return normalizedDraft
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
    const adminRules = collectAdminContractRules(wsData)
    const technicalContext = await collectWorkspaceTechnicalContext(db, workspaceId, wsData)
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
      adminRules,
      technicalContext,
    })

    const draft = await generateDraft(prompt)
    const monthlyValue =
      draft.pricingCadence === "monthly" ? draft.proposedAmount : 0
    const termMonths = inferTermMonths(draft)

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
      monthlyValue,
      termMonths,
      proposedAmount: draft.proposedAmount,
      pricingCadence: draft.pricingCadence,
      paymentDates: draft.paymentDates,
      startDate: null,
      endDate: null,
      documentUrl: null,
      beamNgos: [],
      // AI-draft metadata — not in BeamContract type but stored in Firestore
      aiDraft: true,
      draftContent: draft,
      sourceDocumentIds: sourceDocumentIds.slice(0, 10),
      revisionRequest: revisionRequest || null,
      adminRulesApplied: adminRules,
      repoContextApplied: technicalContext,
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
        repoContextApplied: technicalContext.length,
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
