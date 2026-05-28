/**
 * POST /api/workspaces/[workspaceId]/infrastructure/analyze
 *
 * Evidence-driven hosting analysis. Collects signals from all available
 * sources — email correspondence, clientActivity items written by raCommand,
 * admin-created hosting fields, and attached Vercel/GitHub assets — then
 * runs a single Claude call to normalize them into InfrastructureLink records.
 *
 * Idempotency: if the workspace already has ≥1 high-confidence link
 * (confidence ≥ 0.6), the analysis is skipped unless `force=true` is passed.
 */

import { createHash } from "crypto"
import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import {
  enrichVercelProjectsWithDomains,
  getVercelToken,
  matchReposToVercelProjects,
} from "@/lib/vercel-server"
import type {
  InfrastructureProvider,
  InfrastructureType,
  InfrastructureStatus,
} from "@/lib/infrastructure-links"
import type { GitHubRepo, VercelProject } from "@/lib/workspaces"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// ─── Types ───────────────────────────────────────────────────────────────────

type AnthropicResponse = {
  content: Array<{ type: "text"; text?: string }>
}

interface RawInfrastructureDraft {
  provider?: string
  type?: string
  domain?: string | null
  status?: string
  amount?: number | string | null
  dueDate?: string | null
  sourceSystem?: string
  sourceRef?: string | null
  evidenceSnippet?: string | null
  confidence?: number
  clientVisible?: boolean
}

interface EvidenceItem {
  id: string
  sourceSystem: string
  /** Short text block handed to Claude. */
  text: string
}

interface VercelDomain {
  name?: string
  verified?: boolean
  registrar?: string | null
  renew?: boolean | null
  expiresAt?: number | string | null
  boughtAt?: number | string | null
  createdAt?: number | string | null
}

interface VercelDomainsResponse {
  domains?: VercelDomain[]
  pagination?: { next?: number | null }
}

interface VercelProjectDomainResponse {
  name?: string
  verified?: boolean
  verification?: unknown[]
}

interface VercelProjectDomain {
  name?: string
  verified?: boolean
  createdAt?: number | string | null
  updatedAt?: number | string | null
  gitBranch?: string | null
}

interface VercelProjectDomainsResponse {
  domains?: VercelProjectDomain[]
}

interface VercelDomainRecord {
  provider: InfrastructureProvider
  type: InfrastructureType
  domain: string
  status: InfrastructureStatus
  amount: null
  dueDate: string | null
  sourceSystem: "vercel-domain"
  sourceRef: string
  evidenceSnippet: string
  confidence: number
  clientVisible: boolean
  verified: boolean
  registrar: string | null
  expirationSource: string
  vercelProjectId: string | null
  vercelProjectName: string | null
  vercelRenew: boolean | null
}

interface VercelScanDiagnostics {
  attachedVercelProjects: number
  projectDomainsFound: number
  accountDomainsFound: number
  matchedDomains: number
  repoMatchedVercelProjects: number
  repoMatchedDomains: number
  warnings: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readString(value: unknown, maxLen = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLen)
    : null
}

function readNumber(value: unknown): number | null {
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

function compact(value: unknown, maxLen = 400) {
  return readString(value, maxLen)?.replace(/\s+/g, " ") ?? ""
}

function cleanDomain(value: unknown) {
  const raw = readString(value, 300)
  if (!raw) return null
  const withoutProtocol = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "")
  const host = withoutProtocol.split(/[/?#]/)[0]?.trim().toLowerCase()
  return host && host.includes(".") ? host : null
}

function timestampToIso(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000
    const date = new Date(millis)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

function domainMatchesCandidate(domain: string, candidates: Set<string>) {
  const normalized = cleanDomain(domain)
  if (!normalized) return false
  for (const candidate of candidates) {
    if (
      normalized === candidate ||
      normalized.endsWith(`.${candidate}`) ||
      candidate.endsWith(`.${normalized}`)
    ) {
      return true
    }
  }
  return false
}

function vercelProviderForRegistrar(registrar: string | null): InfrastructureProvider {
  const raw = registrar?.toLowerCase() ?? ""
  if (raw.includes("namecheap")) return "Namecheap"
  return "Vercel"
}

async function fetchVercelJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Vercel API ${response.status}: ${body || response.statusText}`)
  }
  return (await response.json()) as T
}

async function fetchVercelDomains(token: string, teamId: string | null) {
  const domains: VercelDomain[] = []
  let until: number | null = null

  do {
    const params = new URLSearchParams({ limit: "100" })
    if (teamId) params.set("teamId", teamId)
    if (until) params.set("until", String(until))

    const payload = await fetchVercelJson<VercelDomainsResponse>(
      `https://api.vercel.com/v5/domains?${params.toString()}`,
      token
    )
    domains.push(...(payload.domains ?? []))
    until = payload.pagination?.next ?? null
  } while (until)

  return domains
}

async function fetchVercelProjectDomain(params: {
  token: string
  teamId: string | null
  projectIdOrName: string
  domain: string
}) {
  const query = new URLSearchParams()
  if (params.teamId) query.set("teamId", params.teamId)
  const queryString = query.toString()
  const suffix = queryString ? `?${queryString}` : ""
  return fetchVercelJson<VercelProjectDomainResponse>(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(params.projectIdOrName)}/domains/${encodeURIComponent(params.domain)}${suffix}`,
    params.token
  ).catch(() => null)
}

async function fetchVercelProjectDomains(params: {
  token: string
  teamId: string | null
  projectIdOrName: string
}) {
  const query = new URLSearchParams({ limit: "100" })
  if (params.teamId) query.set("teamId", params.teamId)
  return fetchVercelJson<VercelProjectDomainsResponse>(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(params.projectIdOrName)}/domains?${query.toString()}`,
    params.token
  )
}

// ─── Evidence collectors ──────────────────────────────────────────────────────

/** Email correspondence — Zoho/domain/billing signals. */
async function collectEmailEvidence(
  db: FirebaseFirestore.Firestore,
  clientId: string
): Promise<EvidenceItem[]> {
  const snap = await db
    .collection("clientComms")
    .doc(clientId)
    .collection("emails")
    .limit(75)
    .get()
    .catch(() => null)

  return (snap?.docs ?? [])
    .map((doc) => {
      const d = doc.data() as Record<string, unknown>
      const subject = compact(d.subject ?? d.title, 200)
      const from = compact(d.from ?? d.sender, 100)
      const body =
        compact(d.text, 4000) ||
        compact(d.body, 4000) ||
        compact(d.snippet, 1200)
      const raw = [subject, from, body].join(" ").toLowerCase()

      const relevant =
        raw.includes("zoho") ||
        raw.includes("namecheap") ||
        raw.includes("domain") ||
        raw.includes("renewal") ||
        raw.includes("expiration") ||
        raw.includes("expires") ||
        raw.includes("due") ||
        raw.includes("dns") ||
        raw.includes("mx record") ||
        raw.includes("business email") ||
        raw.includes("twilio") ||
        raw.includes("vercel") ||
        raw.includes("invoice") ||
        raw.includes("receipt") ||
        raw.includes("payment") ||
        raw.includes("billing")

      if (!relevant) return null
      return {
        id: doc.id,
        sourceSystem: "zoho-email",
        text: `subject=${subject} from=${from} body=${body}`,
      } satisfies EvidenceItem
    })
    .filter((item): item is EvidenceItem => item !== null)
    .slice(0, 20)
}

/** raCommand / admin-ingested activity items. */
async function collectActivityEvidence(
  db: FirebaseFirestore.Firestore,
  clientId: string
): Promise<EvidenceItem[]> {
  const snap = await db
    .collection("clientActivity")
    .doc(clientId)
    .collection("items")
    .orderBy("createdAt", "desc")
    .limit(40)
    .get()
    .catch(() => null)

  return (snap?.docs ?? [])
    .map((doc) => {
      const d = doc.data() as Record<string, unknown>
      const text = compact(
        d.text ?? d.content ?? d.summary ?? d.description,
        400
      )
      if (!text) return null
      return {
        id: doc.id,
        sourceSystem: "ra-command",
        text,
      } satisfies EvidenceItem
    })
    .filter((item): item is EvidenceItem => item !== null)
}

async function collectWorkspaceDomainCandidates(
  db: FirebaseFirestore.Firestore,
  workspaceId: string,
  workspace: Record<string, unknown>
) {
  const candidates = new Set<string>()
  const add = (value: unknown) => {
    const domain = cleanDomain(value)
    if (domain) candidates.add(domain)
  }

  add(workspace.targetDomain)
  add(workspace.primaryDomain)
  for (const domain of Array.isArray(workspace.domains) ? workspace.domains : []) add(domain)

  const hosting = (
    typeof workspace.hosting === "object" && workspace.hosting !== null
      ? workspace.hosting
      : {}
  ) as Record<string, unknown>
  for (const registrar of Array.isArray(hosting.domainRegistrars)
    ? (hosting.domainRegistrars as Array<Record<string, unknown>>)
    : []) {
    add(registrar.domain)
  }

  for (const project of Array.isArray(workspace.vercelProjects)
    ? (workspace.vercelProjects as Array<Record<string, unknown>>)
    : []) {
    add(project.url)
    for (const domain of Array.isArray(project.domains) ? project.domains : []) add(domain)
  }

  const projectSnaps = await Promise.all([
    db.collection("projects").where("workspaceId", "==", workspaceId).limit(50).get().catch(() => null),
    readString(workspace.clientId)
      ? db
          .collection("projects")
          .where("clientId", "==", readString(workspace.clientId))
          .limit(50)
          .get()
          .catch(() => null)
      : Promise.resolve(null),
    Promise.all(
      (Array.isArray(workspace.projectIds) ? workspace.projectIds : [])
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .slice(0, 30)
        .map((projectId) => db.collection("projects").doc(projectId).get().catch(() => null))
    ),
  ])

  const projectDocs = [
    ...(projectSnaps[0]?.docs ?? []),
    ...(projectSnaps[1]?.docs ?? []),
    ...projectSnaps[2].filter((doc): doc is FirebaseFirestore.DocumentSnapshot => Boolean(doc?.exists)),
  ]
  for (const doc of projectDocs) {
    const project = doc.data() as Record<string, unknown>
    add(project.liveUrl)
    add(project.deployUrl)
    add(project.productionUrl)
    add(project.url)
    for (const domain of Array.isArray(project.domains) ? project.domains : []) add(domain)
  }

  return candidates
}

async function collectVercelDomainRecords(params: {
  db: FirebaseFirestore.Firestore
  workspaceId: string
  workspace: Record<string, unknown>
}) {
  const diagnostics: VercelScanDiagnostics = {
    attachedVercelProjects: 0,
    projectDomainsFound: 0,
    accountDomainsFound: 0,
    matchedDomains: 0,
    repoMatchedVercelProjects: 0,
    repoMatchedDomains: 0,
    warnings: [],
  }
  const token = getVercelToken()
  if (!token) {
    diagnostics.warnings.push("Vercel token not configured.")
    return { records: [] as VercelDomainRecord[], diagnostics }
  }

  const teamId = readString(params.workspace.vercelTeamId) || process.env.VERCEL_TEAM_ID || null
  const workspaceVercelProjects = Array.isArray(params.workspace.vercelProjects)
    ? (params.workspace.vercelProjects as Array<Record<string, unknown>>)
    : []
  let vercelProjects = workspaceVercelProjects

  if (vercelProjects.length === 0 && Array.isArray(params.workspace.repos)) {
    const repos = (params.workspace.repos as unknown[]).filter(
      (repo): repo is GitHubRepo =>
        typeof repo === "object" &&
        repo !== null &&
        typeof (repo as Record<string, unknown>).fullName === "string" &&
        typeof (repo as Record<string, unknown>).id === "number"
    )
    const match = await matchReposToVercelProjects({ repos, token, teamId }).catch((error) => ({
      projects: [] as VercelProject[],
      diagnostics: {
        scannedVercelProjects: 0,
        matchedVercelProjects: 0,
        matchedDomains: 0,
        warnings: [
          error instanceof Error
            ? error.message
            : "Unable to reconcile GitHub repositories with Vercel projects.",
        ],
      },
    }))
    diagnostics.repoMatchedVercelProjects = match.diagnostics.matchedVercelProjects
    diagnostics.repoMatchedDomains = match.diagnostics.matchedDomains
    diagnostics.warnings.push(...match.diagnostics.warnings)

    if (match.projects.length > 0) {
      vercelProjects = match.projects as unknown as Array<Record<string, unknown>>
      await params.db.collection("workspaces").doc(params.workspaceId).set(
        {
          vercelProjects: match.projects,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    }
  } else if (vercelProjects.length > 0) {
    const enriched = await enrichVercelProjectsWithDomains({
      projects: vercelProjects as unknown as VercelProject[],
      token,
      teamId,
    })
    vercelProjects = enriched as unknown as Array<Record<string, unknown>>
  }

  diagnostics.attachedVercelProjects = vercelProjects.length

  const projectDomainMatches = new Map<
    string,
    {
      domain: string
      verified: boolean | null
      vercelProjectId: string | null
      vercelProjectName: string | null
    }
  >()

  for (const project of vercelProjects) {
    const projectId = readString(project.id)
    const projectName = readString(project.name)
    const projectLookupKey = projectId ?? projectName
    if (!projectLookupKey) continue

    const projectDomains = await fetchVercelProjectDomains({
      token,
      teamId,
      projectIdOrName: projectLookupKey,
    }).catch((error) => {
      diagnostics.warnings.push(
        `Unable to scan Vercel domains for ${projectName ?? projectId ?? "attached project"}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      )
      return null
    })

    for (const domain of projectDomains?.domains ?? []) {
      const name = cleanDomain(domain.name)
      if (!name) continue
      projectDomainMatches.set(name, {
        domain: name,
        verified: typeof domain.verified === "boolean" ? domain.verified : null,
        vercelProjectId: projectId,
        vercelProjectName: projectName,
      })
    }
  }
  diagnostics.projectDomainsFound = projectDomainMatches.size

  const candidates = await collectWorkspaceDomainCandidates(
    params.db,
    params.workspaceId,
    params.workspace
  )

  let domains: VercelDomain[] = []
  try {
    domains = await fetchVercelDomains(token, teamId)
  } catch (error) {
    diagnostics.warnings.push(
      error instanceof Error ? error.message : "Unable to scan Vercel account domains."
    )
  }
  diagnostics.accountDomainsFound = domains.length

  const accountDomainMap = new Map(
    domains.flatMap((domain) => {
      const name = cleanDomain(domain.name)
      return name ? [[name, domain] as const] : []
    })
  )
  const matchedDomainNames = new Set<string>(projectDomainMatches.keys())
  for (const domain of domains) {
    const name = cleanDomain(domain.name)
    if (!name) continue
    if (domainMatchesCandidate(name, candidates)) matchedDomainNames.add(name)
  }
  diagnostics.matchedDomains = matchedDomainNames.size

  const records: VercelDomainRecord[] = []

  for (const name of matchedDomainNames) {
    const domain = accountDomainMap.get(name) ?? { name }
    const projectMatch = projectDomainMatches.get(name)

    let projectBinding: {
      verified: boolean | null
      vercelProjectId: string | null
      vercelProjectName: string | null
    } = {
      verified:
        typeof projectMatch?.verified === "boolean"
          ? projectMatch.verified
          : typeof domain.verified === "boolean"
            ? domain.verified
            : null,
      vercelProjectId: projectMatch?.vercelProjectId ?? null,
      vercelProjectName: projectMatch?.vercelProjectName ?? null,
    }

    if (!projectMatch) {
      for (const project of vercelProjects) {
        const projectId = readString(project.id)
        const projectName = readString(project.name)
        const projectDomains = new Set<string>()
        addProjectDomain(projectDomains, project.url)
        for (const item of Array.isArray(project.domains) ? project.domains : []) {
          addProjectDomain(projectDomains, item)
        }
        if (![...projectDomains].some((candidate) => domainMatchesCandidate(name, new Set([candidate])))) {
          continue
        }

        const projectLookupKey = projectId ?? projectName
        const projectDomain = projectLookupKey
          ? await fetchVercelProjectDomain({
              token,
              teamId,
              projectIdOrName: projectLookupKey,
              domain: name,
            })
          : null
        projectBinding = {
          verified:
            typeof projectDomain?.verified === "boolean"
              ? projectDomain.verified
              : typeof domain.verified === "boolean"
                ? domain.verified
                : null,
          vercelProjectId: projectId,
          vercelProjectName: projectName,
        }
        break
      }
    }

    const verified = projectBinding.verified === true
    const registrar = readString(domain.registrar, 120)
    const expiresAt = timestampToIso(domain.expiresAt)
    const provider = vercelProviderForRegistrar(registrar)
    const registrarLabel = registrar ?? "not reported"
    const expirationSource = expiresAt ? "vercel" : "unavailable-from-vercel"

    records.push({
      provider,
      type: "domain",
      domain: name,
      status: verified ? "active" : "pending",
      amount: null,
      dueDate: expiresAt,
      sourceSystem: "vercel-domain",
      sourceRef: name,
      evidenceSnippet: `Domain attached through Vercel; registrar: ${registrarLabel}; ${
        verified ? "verified" : "needs verification"
      }; ${expiresAt ? "expiration tracked by Vercel" : "expiration not available from Vercel"}.`,
      confidence: verified ? 0.95 : 0.86,
      clientVisible: true,
      verified,
      registrar,
      expirationSource,
      vercelProjectId: projectBinding.vercelProjectId,
      vercelProjectName: projectBinding.vercelProjectName,
      vercelRenew: typeof domain.renew === "boolean" ? domain.renew : null,
    })
  }

  if (diagnostics.attachedVercelProjects > 0 && diagnostics.projectDomainsFound === 0) {
    diagnostics.warnings.push("No custom domains were found on attached Vercel projects.")
  }

  return { records, diagnostics }
}

function addProjectDomain(target: Set<string>, value: unknown) {
  const domain = cleanDomain(value)
  if (domain) target.add(domain)
}

/** Admin-created hosting metadata on the workspace doc itself. */
function collectWorkspaceHostingEvidence(
  workspaceId: string,
  workspace: Record<string, unknown>
): EvidenceItem[] {
  const items: EvidenceItem[] = []
  const hosting = (
    typeof workspace.hosting === "object" && workspace.hosting !== null
      ? workspace.hosting
      : {}
  ) as Record<string, unknown>

  // Domain registrars
  const registrars = Array.isArray(hosting.domainRegistrars)
    ? (hosting.domainRegistrars as Array<Record<string, unknown>>)
    : []
  for (const reg of registrars.slice(0, 5)) {
    const domain = readString(reg.domain)
    const provider = readString(reg.registrar ?? reg.provider)
    const renewalDate = readString(reg.renewalDate ?? reg.expiresAt)
    if (!domain && !provider) continue
    items.push({
      id: stableId(`admin-registrar-${workspaceId}-${domain}`),
      sourceSystem: "admin",
      text: `admin-hosting domain=${domain ?? "unknown"} registrar=${provider ?? "unknown"} renewalDate=${renewalDate ?? "unknown"}`,
    })
  }

  // Manual DNS targets with meaningful host
  const dnsTargets = Array.isArray(hosting.manualDnsTargets)
    ? (hosting.manualDnsTargets as Array<Record<string, unknown>>)
    : []
  for (const target of dnsTargets.slice(0, 5)) {
    const host = readString(target.host)
    const value = readString(target.value)
    const recordType = readString(target.recordType)
    if (!host && !value) continue
    items.push({
      id: stableId(`admin-dns-${workspaceId}-${host}-${value}`),
      sourceSystem: "admin",
      text: `admin-dns host=${host ?? "@"} type=${recordType ?? "A"} value=${value ?? "unknown"} status=${readString(target.status) ?? "unknown"}`,
    })
  }

  // Attached Vercel projects
  const vercelProjects = Array.isArray(workspace.vercelProjects)
    ? (workspace.vercelProjects as Array<Record<string, unknown>>)
    : []
  for (const vp of vercelProjects.slice(0, 5)) {
    const name = readString(vp.name)
    const url = readString(vp.url)
    if (!name && !url) continue
    items.push({
      id: stableId(`vercel-${workspaceId}-${name ?? url}`),
      sourceSystem: "vercel",
      text: `vercel-project name=${name ?? "unknown"} url=${url ?? "unknown"}`,
    })
  }

  return items
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

function buildPrompt(params: {
  workspaceName: string
  workspaceId: string
  evidence: EvidenceItem[]
}): string {
  return `You extract hosting and infrastructure facts from workspace evidence.

Return ONLY a valid JSON array. Each element must match this schema exactly:
{
  "provider": "Namecheap | Zoho | Twilio | Vercel | Other",
  "type": "domain | mail | hosting | communications | invoice",
  "domain": "domain name string or null",
  "status": "active | pending | renewal_due | unpaid | unknown",
  "amount": 0,
  "dueDate": "ISO-8601 date string or null",
  "sourceSystem": "zoho-email | ra-command | admin | manual | vercel",
  "sourceRef": "id from evidence list or null",
  "evidenceSnippet": "short phrase pulled directly from evidence",
  "confidence": 0.0,
  "clientVisible": true
}

Rules:
1. Namecheap → domain registrations, renewals. Zoho → business email / mail tiers. Twilio → SMS / phone APIs. Vercel → deployments and compute. Other → anything else.
2. Never invent amounts, domains, or dates. Use null when the evidence does not state them.
3. Every record must cite sourceRef (the id from the evidence) and evidenceSnippet.
4. Drop records below confidence 0.45.
5. Set clientVisible=false only if the record contains internal admin notes not safe for clients.
6. One record per distinct service/domain/invoice. Do not duplicate.

Workspace: ${params.workspaceName}
Workspace ID: ${params.workspaceId}

Evidence (${params.evidence.length} items):
${params.evidence
  .map(
    (item, i) =>
      `${i + 1}. id=${item.id} source=${item.sourceSystem}\n   ${item.text}`
  )
  .join("\n\n")}`
}

async function analyzeWithClaude(prompt: string): Promise<RawInfrastructureDraft[]> {
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
        "You extract hosting and infrastructure facts from evidence. Respond with a JSON array only — no prose, no markdown fences.",
      messages: [{ role: "user", content: prompt }],
    }),
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new Error(body?.error?.message ?? `Anthropic API error ${response.status}`)
  }

  const data = (await response.json()) as AnthropicResponse
  const rawText = data.content.find((b) => b.type === "text")?.text ?? ""
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim()
  const parsed = JSON.parse(cleaned) as unknown
  return Array.isArray(parsed) ? (parsed as RawInfrastructureDraft[]) : []
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

const VALID_PROVIDERS: InfrastructureProvider[] = [
  "Namecheap",
  "Zoho",
  "Twilio",
  "Vercel",
  "Other",
]
const VALID_TYPES: InfrastructureType[] = [
  "domain",
  "mail",
  "hosting",
  "communications",
  "invoice",
]
const VALID_STATUSES: InfrastructureStatus[] = [
  "active",
  "pending",
  "renewal_due",
  "unpaid",
  "unknown",
]

function billingCycleForRecord(record: Record<string, unknown>) {
  const provider = readString(record.provider)?.toLowerCase() ?? ""
  const type = readString(record.type)?.toLowerCase() ?? ""
  const text = [provider, type, readString(record.evidenceSnippet)?.toLowerCase()]
    .filter(Boolean)
    .join(" ")

  if (provider.includes("zoho") || type.includes("mail") || text.includes("email")) {
    return "Business Email Tier"
  }
  if (provider.includes("twilio") || type.includes("communication") || text.includes("sms")) {
    return "API Consumption"
  }
  if (provider.includes("vercel") || type.includes("hosting") || text.includes("compute")) {
    return "Compute Allocation"
  }
  return "Domain Renewal"
}

function serviceProviderForRecord(record: Record<string, unknown>) {
  const provider = readString(record.provider)
  return VALID_PROVIDERS.includes(provider as InfrastructureProvider)
    ? (provider as InfrastructureProvider)
    : "Other"
}

function shouldCreateExpense(record: Record<string, unknown>) {
  const amount = readNumber(record.amount)
  if (!amount || amount <= 0) return false
  const status = readString(record.status)?.toLowerCase()
  return status === "unpaid" || status === "renewal_due" || status === "pending" || status === "unknown"
}

function expenseStatusForRecord(record: Record<string, unknown>) {
  return readString(record.status) === "paid" ? "paid" : "unpaid"
}

function parseDatePhrase(value: string) {
  const match = value.match(
    /\b(?:due for renewal on|renewal on|due on|expires on|expiry date|expiration date)\s+([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})/i
  )
  if (!match?.[1]) return null
  const date = new Date(match[1].replace(/([A-Z][a-z]+)\./, "$1"))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function parseRenewalBillingEvidence(evidence: EvidenceItem[]) {
  const records: Record<string, unknown>[] = []
  const domainPattern = /((?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)/i
  const amountPattern = /\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/

  for (const item of evidence) {
    const text = item.text.replace(/\\n/g, "\n")
    const lower = text.toLowerCase()
    if (
      !lower.includes("renew") &&
      !lower.includes("expire") &&
      !lower.includes("invoice") &&
      !lower.includes("payment")
    ) {
      continue
    }

    const dueDate = parseDatePhrase(text)
    const provider = lower.includes("zoho") ? "Zoho" : "Namecheap"

    for (const rawLine of text.split(/\n| {2,}|\t/)) {
      const line = rawLine.trim()
      if (!line) continue
      const domain = cleanDomain(line.match(domainPattern)?.[1])
      const amount = readNumber(line.match(amountPattern)?.[1])
      if (!domain || !amount || amount <= 0) continue

      records.push({
        provider,
        type: "domain",
        domain,
        status: "renewal_due",
        amount,
        dueDate,
        sourceSystem: item.sourceSystem,
        sourceRef: item.id,
        evidenceSnippet: line.slice(0, 240),
        confidence: 0.96,
        clientVisible: true,
      })
    }
  }

  return records
}

function dedupeInfrastructureRecords(records: Record<string, unknown>[]) {
  const seen = new Set<string>()
  return records.filter((record) => {
    const key = [
      readString(record.provider),
      readString(record.type),
      cleanDomain(record.domain),
      readNumber(record.amount) ?? "",
      readString(record.dueDate) ?? "",
      readString(record.sourceRef) ?? "",
    ].join("|")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeDraft(
  draft: RawInfrastructureDraft
): Record<string, unknown> | null {
  const confidence = Math.max(0, Math.min(1, readNumber(draft.confidence) ?? 0))
  if (confidence < 0.45) return null

  const provider = VALID_PROVIDERS.includes(draft.provider as InfrastructureProvider)
    ? (draft.provider as InfrastructureProvider)
    : "Other"
  const type = VALID_TYPES.includes(draft.type as InfrastructureType)
    ? (draft.type as InfrastructureType)
    : "invoice"
  const status = VALID_STATUSES.includes(draft.status as InfrastructureStatus)
    ? (draft.status as InfrastructureStatus)
    : "unknown"

  return {
    provider,
    type,
    domain: readString(draft.domain),
    status,
    amount: readNumber(draft.amount),
    dueDate: readString(draft.dueDate),
    sourceSystem: readString(draft.sourceSystem) ?? "unknown",
    sourceRef: readString(draft.sourceRef),
    evidenceSnippet: readString(draft.evidenceSnippet, 240),
    confidence,
    clientVisible: draft.clientVisible !== false,
  }
}

// ─── Route ───────────────────────────────────────────────────────────────────

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

    // Parse body for force flag
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const force = body.force === true

    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const workspaceSnap = await workspaceRef.get()
    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }
    const workspace = workspaceSnap.data() as Record<string, unknown>
    const vercelScan = await collectVercelDomainRecords({
      db,
      workspaceId: params.workspaceId,
      workspace,
    })
    const hadExistingLinks = !(
      await workspaceRef.collection("infrastructureLinks").limit(1).get()
    ).empty
    const vercelCreated: Array<Record<string, unknown>> = []

    if (vercelScan.records.length > 0) {
      const vercelBatch = db.batch()
      for (const record of vercelScan.records.slice(0, 25)) {
        const fingerprint = stableId(
          [
            params.workspaceId,
            record.sourceSystem,
            record.domain,
            record.vercelProjectId,
          ].join("|")
        )
        const linkRef = workspaceRef.collection("infrastructureLinks").doc(`vercel_domain_${fingerprint}`)
        vercelBatch.set(
          linkRef,
          {
            ...record,
            createdByUid: decoded.uid,
            createdByEmail: decoded.email ?? null,
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
        vercelCreated.push({ id: linkRef.id, ...record })
      }
      vercelBatch.set(workspaceRef, { updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      await vercelBatch.commit()
    }

    // ── Idempotency check ─────────────────────────────────────────────────────
    if (!force) {
      if (hadExistingLinks) {
        // Already has evidence — Vercel was refreshed above, so avoid re-running Claude.
        const existingLinks = await workspaceRef
          .collection("infrastructureLinks")
          .orderBy("createdAt", "desc")
          .limit(50)
          .get()
        return NextResponse.json({
          success: true,
          skipped: true,
          records: existingLinks.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })),
          evidenceCount: vercelScan.records.length,
          diagnostics: vercelScan.diagnostics,
          warning: vercelScan.diagnostics.warnings.join(" ") || null,
          message:
            vercelCreated.length > 0
              ? "Vercel domain records were refreshed. Pass force=true to re-analyze email and activity evidence."
              : "Hosting records already exist. Pass force=true to re-analyze.",
        })
      }
    }

    // ── Collect evidence ──────────────────────────────────────────────────────
    const clientId = readString(workspace.clientId)
    const evidence: EvidenceItem[] = []

    // Source A: Workspace hosting fields (admin-created, always available)
    evidence.push(...collectWorkspaceHostingEvidence(params.workspaceId, workspace))

    if (clientId) {
      // Source B: Email correspondence
      const emailEvidence = await collectEmailEvidence(db, clientId)
      evidence.push(...emailEvidence)

      // Source C: raCommand / admin activity items
      const activityEvidence = await collectActivityEvidence(db, clientId)
      evidence.push(...activityEvidence)
    }

    if (evidence.length === 0) {
      return NextResponse.json({
        success: true,
        records: vercelCreated,
        evidenceCount: vercelScan.records.length,
        diagnostics: vercelScan.diagnostics,
        warning: vercelScan.diagnostics.warnings.join(" ") || null,
        message:
          vercelCreated.length > 0
            ? "Vercel domain records were refreshed; no additional hosting evidence was found."
            : "No hosting evidence was found across Vercel, correspondence, activity, or workspace records.",
      })
    }

    // ── Call Claude ───────────────────────────────────────────────────────────
    const workspaceName =
      readString(workspace.workspaceName) ||
      readString(workspace.businessName) ||
      readString(workspace.clientBusinessName) ||
      readString(workspace.name) ||
      params.workspaceId

    const deterministicRecords = parseRenewalBillingEvidence(evidence)
    const drafts = await analyzeWithClaude(
      buildPrompt({
        workspaceName,
        workspaceId: params.workspaceId,
        evidence: evidence.slice(0, 30),
      })
    )

    const normalized = dedupeInfrastructureRecords([
      ...deterministicRecords,
      ...drafts
        .map(normalizeDraft)
        .filter((r): r is Record<string, unknown> => r !== null),
    ]).filter((record) => {
      const type = readString(record.type)
      if (type !== "domain" && type !== "invoice") return true
      return Boolean(readString(record.domain) || readNumber(record.amount) || readString(record.dueDate))
    })

    if (normalized.length === 0) {
      return NextResponse.json({
        success: true,
        records: vercelCreated,
        evidenceCount: evidence.length + vercelScan.records.length,
        diagnostics: vercelScan.diagnostics,
        warning: vercelScan.diagnostics.warnings.join(" ") || null,
        message:
          vercelCreated.length > 0
            ? "Vercel domain records were refreshed; analysis found no additional source-backed hosting records."
            : "Analysis found no source-backed hosting records in the evidence.",
      })
    }

    // ── Write to Firestore ────────────────────────────────────────────────────
    const batch = db.batch()
    const created: Array<Record<string, unknown>> = []

    for (const record of normalized.slice(0, 15)) {
      const fingerprint = stableId(
        [
          params.workspaceId,
          record.provider,
          record.type,
          record.domain,
          record.sourceRef,
          record.evidenceSnippet,
        ].join("|")
      )
      const linkRef = workspaceRef
        .collection("infrastructureLinks")
        .doc(`${String(record.sourceSystem).replace(/[^a-z0-9]/gi, "_")}_${fingerprint}`)

      batch.set(
        linkRef,
        {
          ...record,
          createdByUid: decoded.uid,
          createdByEmail: decoded.email ?? null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

      if (shouldCreateExpense(record)) {
        const serviceProvider = serviceProviderForRecord(record)
        const expenseRef = workspaceRef
          .collection("expenses")
          .doc(`${String(record.sourceSystem).replace(/[^a-z0-9]/gi, "_")}_${fingerprint}`)
        batch.set(
          expenseRef,
          {
            source:
              serviceProvider === "Other"
                ? "Infrastructure Billing Evidence"
                : `${serviceProvider} ${billingCycleForRecord(record)}`,
            description:
              readString(record.evidenceSnippet, 240) ||
              `${billingCycleForRecord(record)}${readString(record.domain) ? ` for ${readString(record.domain)}` : ""}`,
            amount: readNumber(record.amount),
            status: expenseStatusForRecord(record),
            serviceProvider,
            billingCycleType: billingCycleForRecord(record),
            dueDate: readString(record.dueDate),
            vendor: serviceProvider === "Other" ? null : serviceProvider,
            category: "infrastructure",
            domain: cleanDomain(record.domain),
            sourceSystem: readString(record.sourceSystem),
            sourceRef: readString(record.sourceRef),
            evidenceSnippet: readString(record.evidenceSnippet, 240),
            confidence: readNumber(record.confidence),
            contractAppendageReady: true,
            createdByUid: decoded.uid,
            createdByEmail: decoded.email ?? null,
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
      records: [...vercelCreated, ...created],
      evidenceCount: evidence.length + vercelScan.records.length,
      diagnostics: vercelScan.diagnostics,
      warning: vercelScan.diagnostics.warnings.join(" ") || null,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error(
      "POST /workspaces/[workspaceId]/infrastructure/analyze error:",
      error
    )
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to analyze hosting records.",
      },
      { status: 500 }
    )
  }
}
