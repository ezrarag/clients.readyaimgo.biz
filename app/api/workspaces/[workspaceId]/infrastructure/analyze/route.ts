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
import type {
  InfrastructureProvider,
  InfrastructureType,
  InfrastructureStatus,
} from "@/lib/infrastructure-links"

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
        compact(d.snippet, 300) ||
        compact(d.text, 500) ||
        compact(d.body, 500)
      const raw = [subject, from, body].join(" ").toLowerCase()

      const relevant =
        raw.includes("zoho") ||
        raw.includes("namecheap") ||
        raw.includes("domain") ||
        raw.includes("renewal") ||
        raw.includes("dns") ||
        raw.includes("mx record") ||
        raw.includes("business email") ||
        raw.includes("twilio") ||
        raw.includes("vercel") ||
        raw.includes("invoice") ||
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

    // ── Idempotency check ─────────────────────────────────────────────────────
    if (!force) {
      const existingSnap = await workspaceRef
        .collection("infrastructureLinks")
        .limit(1)
        .get()
      if (!existingSnap.empty) {
        // Already has evidence — return existing links without re-running Claude
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
          message: "Hosting records already exist. Pass force=true to re-analyze.",
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
        records: [],
        message:
          "No hosting evidence was found across correspondence, activity, or workspace records.",
      })
    }

    // ── Call Claude ───────────────────────────────────────────────────────────
    const workspaceName =
      readString(workspace.workspaceName) ||
      readString(workspace.businessName) ||
      readString(workspace.clientBusinessName) ||
      readString(workspace.name) ||
      params.workspaceId

    const drafts = await analyzeWithClaude(
      buildPrompt({
        workspaceName,
        workspaceId: params.workspaceId,
        evidence: evidence.slice(0, 30),
      })
    )

    const normalized = drafts
      .map(normalizeDraft)
      .filter((r): r is Record<string, unknown> => r !== null)

    if (normalized.length === 0) {
      return NextResponse.json({
        success: true,
        records: [],
        message: "Analysis found no source-backed hosting records in the evidence.",
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
      created.push({ id: linkRef.id, ...record })
    }

    batch.set(workspaceRef, { updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    await batch.commit()

    return NextResponse.json({
      success: true,
      records: created,
      evidenceCount: evidence.length,
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
