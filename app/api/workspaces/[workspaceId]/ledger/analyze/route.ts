import { createHash } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"
export const maxDuration = 60

type AnthropicRequest = {
  model: string
  max_tokens: number
  system: string
  messages: Array<{ role: "user"; content: string }>
}

type AnthropicResponse = {
  content: Array<{ type: "text"; text?: string }>
}

type CommitSignal = {
  source: "github" | "vercel" | "project" | "webhook"
  repository: string | null
  commitSha: string | null
  branchDepth: string | null
  vercelDeploymentId: string | null
  hostingPlatformConfiguration: string | null
  verifiedDataStructureLines: number
  municipalEndpointMaps: string[]
  message: string
  url: string | null
  updatedAt: string | null
}

type LedgerReceiptDraft = {
  description?: string
  actorRole?: string
  deductionAmount?: number
  valueAllocationAmount?: number
  benchmarkCategory?: string
  sourceCommitSha?: string | null
  sourceRepository?: string | null
  sourceBranchDepth?: string | null
  vercelDeploymentId?: string | null
  hostingPlatformConfiguration?: string | null
  verifiedDataStructureLines?: number
  municipalEndpointMaps?: string[]
}

const BENCHMARKS = [
  {
    category: "Enterprise Product Discovery & Data Engineering Sprint",
    floorValue: 12500,
  },
  {
    category: "Custom Multi-Tenant Next.js Software Architecture",
    floorValue: 8500,
  },
  {
    category: "Real-Time Open Data Data Pipeline Integration",
    floorValue: 6000,
  },
]

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
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

function inferMunicipalEndpointMaps(text: string) {
  const endpoints = text.match(/https?:\/\/[^\s),]+/gi) ?? []
  const municipalHints = [
    "Milwaukee Open Data JSON arrays",
    "municipal permits endpoint maps",
    "open data application and permit records",
  ]
  return Array.from(new Set([...endpoints, ...municipalHints.filter((hint) => text.toLowerCase().includes("data"))]))
}

function stableId(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 32)
}

function getAnthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.")
  return key
}

function getWebhookSecret() {
  return (
    process.env.RACOMMAND_LEDGER_WEBHOOK_SECRET?.trim() ||
    process.env.RA_COMMAND_WEBHOOK_SECRET?.trim() ||
    process.env.LEDGER_ANALYZE_WEBHOOK_SECRET?.trim() ||
    ""
  )
}

async function authenticate(request: NextRequest, workspaceId: string) {
  const webhookSecret = getWebhookSecret()
  const suppliedSecret =
    request.headers.get("x-racommand-secret")?.trim() ||
    request.headers.get("x-ledger-webhook-secret")?.trim() ||
    ""

  if (webhookSecret && suppliedSecret && suppliedSecret === webhookSecret) {
    return { mode: "webhook" as const, uid: null, email: null, role: "AI Ingestion Engine" }
  }

  const idToken = getBearerToken(request)
  if (!idToken) throw new WorkspaceAuthError("Unauthorized.", 401)

  const decoded = await getAdminAuth().verifyIdToken(idToken)
  const role = await assertWorkspaceRole(getAdminDb(), workspaceId, decoded.uid, "developer")
  return {
    mode: "user" as const,
    uid: decoded.uid,
    email: decoded.email ?? null,
    role,
  }
}

function normalizeWebhookSignals(body: Record<string, unknown>): CommitSignal[] {
  const incoming = Array.isArray(body.commitLogs)
    ? body.commitLogs
    : Array.isArray(body.commits)
      ? body.commits
      : []

  return incoming
    .map((entry): CommitSignal | null => {
      if (!entry || typeof entry !== "object") return null
      const value = entry as Record<string, unknown>
      const message =
        readString(value.message) ||
        readString(value.commitMessage) ||
        readString(value.summary) ||
        null
      if (!message) return null
      return {
        source: "webhook",
        repository: readString(value.repository) || readString(value.repo) || null,
        commitSha: readString(value.sha) || readString(value.commitSha) || null,
        branchDepth:
          readString(value.branchDepth) ||
          readString(value.branch) ||
          "Webhook supplied commit window",
        vercelDeploymentId:
          readString(value.vercelDeploymentId) || readString(value.deploymentId) || null,
        hostingPlatformConfiguration: readString(value.hostingPlatformConfiguration),
        verifiedDataStructureLines:
          readNumber(value.verifiedDataStructureLines) ?? estimateDataStructureLines(value),
        municipalEndpointMaps: readStringArray(value.municipalEndpointMaps),
        message,
        url: readString(value.url) || readString(value.htmlUrl) || null,
        updatedAt: readString(value.timestamp) || readString(value.updatedAt) || null,
      }
    })
    .filter((signal): signal is CommitSignal => Boolean(signal))
}

async function fetchGitHubCommitSignals(fullName: string): Promise<CommitSignal[]> {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN || process.env.GITHUB_PAT
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(fullName).replace(/%2F/g, "/")}/commits?per_page=5`,
    { headers, cache: "no-store" }
  )

  if (!response.ok) return []

  const commits = (await response.json()) as Array<Record<string, unknown>>
  return commits
    .map((commit): CommitSignal | null => {
      const commitData =
        commit.commit && typeof commit.commit === "object"
          ? (commit.commit as Record<string, unknown>)
          : {}
      const message = readString(commitData.message)
      if (!message) return null
      const author =
        commitData.author && typeof commitData.author === "object"
          ? (commitData.author as Record<string, unknown>)
          : {}
      return {
        source: "github",
        repository: fullName,
        commitSha: readString(commit.sha),
        branchDepth: "Latest 5 commits from the repository default branch",
        vercelDeploymentId: null,
        hostingPlatformConfiguration: null,
        verifiedDataStructureLines: estimateDataStructureLines(commit),
        municipalEndpointMaps: inferMunicipalEndpointMaps(message),
        message,
        url: readString(commit.html_url),
        updatedAt: readString(author.date),
      }
    })
    .filter((signal): signal is CommitSignal => Boolean(signal))
}

async function collectWorkspaceSignals(
  db: FirebaseFirestore.Firestore,
  workspaceId: string,
  workspace: Record<string, unknown>,
  body: Record<string, unknown>
) {
  const signals: CommitSignal[] = normalizeWebhookSignals(body)

  const repos = Array.isArray(workspace.repos)
    ? (workspace.repos as Array<Record<string, unknown>>)
    : []
  const vercelProjects = Array.isArray(workspace.vercelProjects)
    ? (workspace.vercelProjects as Array<Record<string, unknown>>)
    : []

  const githubSignals = await Promise.all(
    repos
      .slice(0, 4)
      .map((repo) => readString(repo.fullName))
      .filter((fullName): fullName is string => Boolean(fullName))
      .map((fullName) => fetchGitHubCommitSignals(fullName))
  )
  signals.push(...githubSignals.flat())
  const hostingPlatformConfiguration = summarizeHostingConfig(workspace)

  for (const project of vercelProjects.slice(0, 10)) {
    const message =
      readString(project.latestCommitMessage) ||
      readString(project.deploymentState) ||
      readString(project.name)
    if (!message) continue
    const repository =
      readString(project.githubRepo) ||
      readString(project.repoSlug) ||
      (project.repository && typeof project.repository === "object"
        ? readString((project.repository as Record<string, unknown>).fullName)
        : null)
    signals.push({
      source: "vercel",
      repository,
      commitSha: readString(project.latestCommitSha),
      branchDepth: readString(project.branch) || "Vercel deployment metadata branch context",
      vercelDeploymentId: readString(project.deploymentId) || readString(project.id),
      hostingPlatformConfiguration,
      verifiedDataStructureLines: estimateDataStructureLines(project),
      municipalEndpointMaps: inferMunicipalEndpointMaps(message),
      message,
      url: readString(project.url) || readString(project.deployUrl),
      updatedAt: readString(project.updatedAt),
    })
  }

  const projectSnap = await db
    .collection("projects")
    .where("workspaceId", "==", workspaceId)
    .limit(20)
    .get()
    .catch(() => null)

  for (const projectDoc of projectSnap?.docs ?? []) {
    const project = projectDoc.data() as Record<string, unknown>
    const message =
      readString(project.latestCommitMessage) ||
      readString(project.summary) ||
      readString(project.description) ||
      readString(project.title) ||
      readString(project.name)
    if (!message) continue
    signals.push({
      source: "project",
      repository: readString(project.githubRepo) || readString(project.repoSlug),
      commitSha: readString(project.latestCommitSha) || readString(project.commitSha),
      branchDepth: readString(project.branch) || "Workspace project metadata branch context",
      vercelDeploymentId: readString(project.vercelDeploymentId),
      hostingPlatformConfiguration,
      verifiedDataStructureLines: estimateDataStructureLines(project),
      municipalEndpointMaps: inferMunicipalEndpointMaps(message),
      message,
      url: readString(project.liveUrl) || readString(project.deployUrl),
      updatedAt: readString(project.updatedAt),
    })
  }

  const seen = new Set<string>()
  return signals.filter((signal) => {
    const key = [signal.source, signal.repository, signal.commitSha, signal.message].join("|")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildPrompt(params: {
  workspaceName: string
  clientId: string | null
  signals: CommitSignal[]
}) {
  return `You are an AI trust-accounting analyst for a software development agency.

Convert the commit/deployment signals into client-facing ledger receipt rows. Write concise professional descriptions of the operational output, then assign a localized professional benchmark allocation. Use the benchmark matrix as the pricing reference; allocations should be realistic slices of those benchmark values, not necessarily the full benchmark.

Return ONLY valid JSON matching this schema:
[
  {
    "description": "Milestone Completed: concise business-readable output statement",
    "actorRole": "AI Ingestion Engine",
    "deductionAmount": 500,
    "valueAllocationAmount": 500,
    "benchmarkCategory": "one benchmark category",
    "sourceCommitSha": "sha or null",
    "sourceRepository": "owner/repo or null",
    "sourceBranchDepth": "branch or commit-window detail",
    "vercelDeploymentId": "deployment/project id or null",
    "hostingPlatformConfiguration": "hosting/DNS configuration summary",
    "verifiedDataStructureLines": 42,
    "municipalEndpointMaps": ["endpoint or map label"]
  }
]

Rules:
1. Produce 1 to 5 receipt rows.
2. Do not invent work unrelated to the signals.
3. deductionAmount and valueAllocationAmount must be positive numbers in USD.
4. Use actorRole exactly "AI Ingestion Engine".
5. Keep descriptions specific, professional, and suitable for a client trust ledger.
6. Preserve source repository, branch depth, Vercel deployment id, hosting configuration, verified data structure line counts, and municipal endpoint maps when present.

Workspace: ${params.workspaceName}
Client ID: ${params.clientId ?? "not linked"}

Benchmark matrix:
${BENCHMARKS.map((item) => `- ${item.category}: $${item.floorValue.toLocaleString("en-US")} standard agency floor value`).join("\n")}

Commit/deployment signals:
${params.signals
  .slice(0, 30)
  .map(
    (signal, index) =>
      `${index + 1}. [${signal.source}] ${signal.repository ?? "workspace"} ${signal.commitSha ? `(${signal.commitSha.slice(0, 8)}) ` : ""}${signal.message}
   Branch depth: ${signal.branchDepth ?? "not recorded"}
   Vercel deployment ID: ${signal.vercelDeploymentId ?? "not recorded"}
   Hosting configuration: ${signal.hostingPlatformConfiguration ?? "not recorded"}
   Verified data structure lines: ${signal.verifiedDataStructureLines}
   Municipal endpoint maps: ${
     signal.municipalEndpointMaps.length > 0
       ? signal.municipalEndpointMaps.join(", ")
       : "none recorded"
   }`
  )
  .join("\n")}`
}

async function analyzeWithClaude(prompt: string): Promise<LedgerReceiptDraft[]> {
  const requestBody: AnthropicRequest = {
    model: "claude-opus-4-5",
    max_tokens: 2048,
    system:
      "You convert software commit logs into precise JSON ledger receipt rows. Respond with JSON only.",
    messages: [{ role: "user", content: prompt }],
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getAnthropicKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(requestBody),
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
  return Array.isArray(parsed) ? (parsed as LedgerReceiptDraft[]) : []
}

function normalizeReceiptDraft(draft: LedgerReceiptDraft, fallback: CommitSignal, index: number) {
  const deductionAmount =
    readNumber(draft.deductionAmount) ?? readNumber(draft.valueAllocationAmount) ?? 500
  const benchmarkCategory =
    readString(draft.benchmarkCategory) ?? BENCHMARKS[index % BENCHMARKS.length].category
  const description =
    readString(draft.description) ??
    `Milestone Completed: ${fallback.message.split("\n")[0].slice(0, 140)}`

  return {
    description,
    actorRole: "AI Ingestion Engine",
    deductionAmount: Math.max(1, Math.round(deductionAmount * 100) / 100),
    valueAllocationAmount: Math.max(1, Math.round(deductionAmount * 100) / 100),
    benchmarkCategory,
    sourceCommitSha: readString(draft.sourceCommitSha) ?? fallback.commitSha,
    sourceRepository: readString(draft.sourceRepository) ?? fallback.repository,
    sourceBranchDepth: readString(draft.sourceBranchDepth) ?? fallback.branchDepth,
    vercelDeploymentId: readString(draft.vercelDeploymentId) ?? fallback.vercelDeploymentId,
    hostingPlatformConfiguration:
      readString(draft.hostingPlatformConfiguration) ?? fallback.hostingPlatformConfiguration,
    verifiedDataStructureLines:
      readNumber(draft.verifiedDataStructureLines) ?? fallback.verifiedDataStructureLines,
    municipalEndpointMaps:
      readStringArray(draft.municipalEndpointMaps).length > 0
        ? readStringArray(draft.municipalEndpointMaps)
        : fallback.municipalEndpointMaps,
    sourceUrl: fallback.url,
    sourceKind: fallback.source,
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const auth = await authenticate(request, params.workspaceId)
    const db = getAdminDb()
    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const workspaceSnap = await workspaceRef.get()

    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }

    const workspace = workspaceSnap.data() as Record<string, unknown>
    const workspaceName =
      readString(workspace.workspaceName) ||
      readString(workspace.businessName) ||
      readString(workspace.name) ||
      params.workspaceId
    const clientId = readString(workspace.clientId)
    const signals = await collectWorkspaceSignals(db, params.workspaceId, workspace, body)

    if (signals.length === 0) {
      return NextResponse.json({
        success: true,
        receipts: [],
        message: "No commit or deployment signals were available for analysis.",
      })
    }

    const prompt = buildPrompt({ workspaceName, clientId, signals })
    const drafts = await analyzeWithClaude(prompt)
    const receipts = drafts
      .slice(0, 5)
      .map((draft, index) => normalizeReceiptDraft(draft, signals[index] ?? signals[0], index))

    if (receipts.length === 0) {
      return NextResponse.json({
        success: true,
        receipts: [],
        message: "AI analysis did not produce receipt rows.",
      })
    }

    const batch = db.batch()
    const createdReceipts: Array<Record<string, unknown>> = []

    for (const receipt of receipts) {
      const fingerprint = stableId(
        [
          params.workspaceId,
          receipt.sourceRepository,
          receipt.sourceCommitSha,
          receipt.description,
          receipt.deductionAmount,
        ].join("|")
      )
      const ledgerRef = workspaceRef.collection("ledger").doc(`ai_${fingerprint}`)
      const existing = await ledgerRef.get()
      if (existing.exists) continue

      const payload = {
        ...receipt,
        createdAt: FieldValue.serverTimestamp(),
        analyzedAt: FieldValue.serverTimestamp(),
        source: "ai-commit-ledger",
        sourceFingerprint: fingerprint,
        createdByUid: auth.uid,
        createdByEmail: auth.email,
      }
      batch.set(ledgerRef, payload)
      createdReceipts.push({ id: ledgerRef.id, ...receipt })
    }

    if (createdReceipts.length > 0) {
      batch.set(workspaceRef, { updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      await batch.commit()
    }

    return NextResponse.json({
      success: true,
      receipts: createdReceipts,
      analyzedSignals: signals.length,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /workspaces/[workspaceId]/ledger/analyze error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to analyze ledger." },
      { status: 500 }
    )
  }
}
