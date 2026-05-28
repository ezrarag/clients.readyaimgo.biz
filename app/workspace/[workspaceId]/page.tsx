"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  CheckCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Globe2,
  ExternalLink,
  FileText,
  Github,
  BarChart3,
  Info,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  Receipt,
  Server,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  UserPlus,
  Users,
} from "lucide-react"
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage"

import { useAuth } from "@/components/auth/AuthProvider"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { HelpMark } from "@/components/ui/help-mark"
import { ContractCard } from "@/components/contracts/ContractCard"
import { ContractDetailModal } from "@/components/contracts/ContractDetailModal"
import { getStorageInstance } from "@/lib/firebase/config"
import { signOut } from "@/lib/firebase/auth"
import type { BeamContract } from "@/lib/contracts"
import type { InfrastructureLink } from "@/lib/infrastructure-links"
import {
  infraStatusVariant,
  infraStatusLabel,
  infraProviderLabel,
} from "@/lib/infrastructure-links"
import {
  ALLOWED_MIME_TYPES,
  FILE_INPUT_ACCEPT,
  MAX_FILE_SIZE_BYTES,
  WORKSPACE_FILES_STORAGE_PREFIX,
  buildStorageFileName,
  formatFileSize,
  normalizeWorkspaceFile,
} from "@/lib/workspace-files"
import type { WorkspaceFile } from "@/lib/workspace-files"
import type {
  GitHubRepo,
  ManualDnsTarget,
  StaticHostingPlatform,
  VercelProject,
  Workspace,
  WorkspaceMeetingProvider,
  WorkspaceMember,
  WorkspaceRole,
} from "@/lib/workspaces"
import type { ValuePaymentRecord } from "@/lib/value-profile"
import type { ClientDeliverable } from "@/lib/deliverables"

// ─── Local types ──────────────────────────────────────────────────────────────

interface WorkspacePaymentData {
  clientId: string | null
  stripeCustomerId: string | null
  totalPaid: number
  retainerBalance: number
  ledger: WorkspaceLedgerEntry[]
  payments: ValuePaymentRecord[]
  deliverables: ClientDeliverable[]
  accountOwner: {
    uid: string | null
    email: string | null
    displayName: string | null
    role: "owner"
  } | null
}

interface WorkspaceLedgerEntry {
  id: string
  createdAt: string | null
  description: string
  actorRole: string
  deductionAmount: number
  valueAllocationAmount: number
  benchmarkCategory: string | null
  sourceRepository: string | null
  sourceBranchDepth: string | null
  vercelDeploymentId: string | null
  hostingPlatformConfiguration: string | null
  verifiedDataStructureLines: number | null
  municipalEndpointMaps: string[]
}

interface WorkspaceExpense {
  id: string
  source: string
  description: string
  amount: number
  status: "paid" | "unpaid"
  serviceProvider: "Namecheap" | "Zoho" | "Twilio" | "Vercel"
  billingCycleType:
    | "Domain Renewal"
    | "Business Email Tier"
    | "API Consumption"
    | "Compute Allocation"
  dueDate: string | null
  domain: string | null
  evidenceSnippet: string | null
  sourceSystem: string | null
  sourceRef: string | null
  daysOverdue: number
  criticalSystemFlag: boolean
  vendor: string | null
  category: string
  contractAppendageReady: boolean
  createdAt: string | null
  paidAt: string | null
}

interface DraftFormState {
  projectDescription: string
  completedWork: string
  upcomingWork: string
  paymentTerms: string
  constraints: string
  revisionRequest: string
  sourceDocumentIds: string[]
}

const DRAFT_FORM_DEFAULTS: DraftFormState = {
  projectDescription: "",
  completedWork: "",
  upcomingWork: "",
  paymentTerms: "",
  constraints: "",
  revisionRequest: "",
  sourceDocumentIds: [],
}

interface GeneratedDraft {
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

interface WorkspaceProject {
  id: string
  name?: string
  title?: string
  clientId?: string
  workspaceId?: string | null
  status?: string
  description?: string
  summary?: string
  projectType?: string
  assetProjectType?: AssetProjectType
  /** "github-connection" | "vercel-connection" for synthesized entries; absent on Firestore records */
  source?: string
  repository?: { fullName?: string; url?: string } | null
  repoSlug?: string
  githubRepo?: string
  vercelProjectId?: string
  branch?: string
  commitSha?: string
  latestCommitSha?: string
  latestCommitMessage?: string
  liveUrl?: string
  deployUrl?: string
  productionUrl?: string
  scopeObjectives?: Array<{ id?: string; title?: string; description?: string }>
  launchObjectives?: Array<{ id?: string; title?: string; description?: string }>
  deliverables?: string[]
  fleetIds?: string[]
  mileageTotal?: number
  propertyLocations?: Array<{ label?: string; latitude?: number; longitude?: number }>
  updatedAt?: string
  createdAt?: string
}

type AssetProjectType = "webdev" | "participant" | "transportation" | "real-estate"

interface WorkspaceProjectTask {
  id: string
  title?: string
  description?: string
  status?: string
  priority?: string
  projectId?: string
  workspaceId?: string | null
  objectiveId?: string
  objectiveTitle?: string
  dueDate?: string
  source?: string
  createdByEmail?: string
}

interface CorrespondenceItem {
  id: string
  kind: "email" | "event"
  subject?: string
  title?: string
  snippet?: string
  from?: string
  to?: string
  attendees?: string[]
  date?: string
  start?: string
  end?: string
  threadUrl?: string
  calendarEventUrl?: string
}

interface TaskDraftState {
  title: string
  description: string
}

interface CorrespondenceResponse {
  items: CorrespondenceItem[]
  locked?: boolean
  meetingProviders?: WorkspaceMeetingProvider[]
  defaultMeetingProvider?: string | null
}

interface ConnectorMeta {
  configured?: boolean
  owner?: string | null
  teamId?: string | null
  tokenEnv?: string | null
  warning?: string | null
}

interface HostingAnalyzeDiagnostics {
  attachedVercelProjects: number
  projectDomainsFound: number
  accountDomainsFound: number
  matchedDomains: number
  repoMatchedVercelProjects?: number
  repoMatchedDomains?: number
  warnings: string[]
}

interface GitHubReposResponse {
  repos: GitHubRepo[]
  meta?: ConnectorMeta
}

interface VercelProjectsResponse {
  projects: VercelProject[]
  meta?: ConnectorMeta
}

interface WorkspaceConnectionResponse {
  workspace?: Workspace
  projects?: WorkspaceProject[]
  removedProjectIds?: string[]
}

const PROJECT_ROLE_ORDER: WorkspaceRole[] = [
  "owner",
  "developer",
  "collaborator",
  "employee-of-client",
  "beam-participant",
]

const HIDDEN_WORKSPACE_TABS = new Set(["deliverables", "correspondence", "projections"])

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  user: { getIdToken: () => Promise<string> },
  path: string,
  options?: RequestInit
): Promise<T> {
  const token = await user.getIdToken()
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    cache: "no-store",
  })
  const payload = await res.json()
  if (!res.ok) throw new Error(payload?.error ?? "Request failed.")
  return payload as T
}

// ─── Repo Card ────────────────────────────────────────────────────────────────

function RepoCard({
  repo,
  attached,
  onToggle,
  busy,
}: {
  repo: GitHubRepo
  attached: boolean
  onToggle: () => void
  busy: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-white/80 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold text-slate-900">{repo.fullName}</p>
          {repo.isPrivate && <Badge variant="secondary">private</Badge>}
          {repo.language && <Badge variant="secondary">{repo.language}</Badge>}
        </div>
        {repo.description && (
          <p className="mt-1 line-clamp-1 text-xs text-slate-500">{repo.description}</p>
        )}
        {repo.homepage && (
          <a
            href={repo.homepage}
            target="_blank"
            rel="noreferrer"
            className="mt-1 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700"
          >
            <ExternalLink className="h-3 w-3" />
            {repo.homepage}
          </a>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a href={repo.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-700">
          <ExternalLink className="h-4 w-4" />
        </a>
        <Button
          size="sm"
          variant={attached ? "destructive" : "default"}
          onClick={onToggle}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : attached ? (
            <Trash2 className="h-3 w-3" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          <span className="ml-1">{attached ? "Remove" : "Add"}</span>
        </Button>
      </div>
    </div>
  )
}

// ─── Vercel Card ──────────────────────────────────────────────────────────────

function VercelCard({
  project,
  attached,
  onToggle,
  busy,
}: {
  project: VercelProject
  attached: boolean
  onToggle: () => void
  busy: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-white/80 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold text-slate-900">{project.name}</p>
          {project.framework && <Badge variant="secondary">{project.framework}</Badge>}
        </div>
        {project.url && (
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700"
          >
            <ExternalLink className="h-3 w-3" />
            {project.url}
          </a>
        )}
      </div>
      <Button
        size="sm"
        variant={attached ? "destructive" : "default"}
        onClick={onToggle}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : attached ? (
          <Trash2 className="h-3 w-3" />
        ) : (
          <Plus className="h-3 w-3" />
        )}
        <span className="ml-1">{attached ? "Remove" : "Add"}</span>
      </Button>
    </div>
  )
}

function projectTitle(project: WorkspaceProject) {
  return project.title || project.name || "Untitled Project"
}

function projectSummary(project: WorkspaceProject) {
  return project.summary || project.description || "Project summary pending."
}

function projectUrl(project: WorkspaceProject) {
  return project.liveUrl || project.deployUrl || project.productionUrl || project.repository?.url || ""
}

function projectRepositoryLabel(project: WorkspaceProject) {
  return project.githubRepo || project.repoSlug || project.repository?.fullName || "Repository not mapped"
}

function projectRepositoryUrl(project: WorkspaceProject) {
  return project.repository?.url || (projectRepositoryLabel(project).includes("/") ? `https://github.com/${projectRepositoryLabel(project)}` : "")
}

function projectCommitLabel(project: WorkspaceProject) {
  const sha = project.latestCommitSha || project.commitSha
  return sha ? sha.slice(0, 7) : "commit pending"
}

const ASSET_PROJECT_TYPES: Array<{ value: AssetProjectType; label: string }> = [
  { value: "webdev", label: "Nexus" },
  { value: "participant", label: "Participant Cohort" },
  { value: "transportation", label: "Transportation Asset" },
  { value: "real-estate", label: "Real Estate Portfolio" },
]

function parseAssetProjectType(value: unknown): AssetProjectType {
  return value === "participant" ||
    value === "transportation" ||
    value === "real-estate" ||
    value === "webdev"
    ? value
    : "webdev"
}

function fleetIdsForProject(project: WorkspaceProject) {
  if (Array.isArray(project.fleetIds) && project.fleetIds.length > 0) return project.fleetIds
  return [`FLT-${project.id.replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase() || "001"}`]
}

function propertyLocationsForProject(project: WorkspaceProject) {
  if (Array.isArray(project.propertyLocations) && project.propertyLocations.length > 0) {
    return project.propertyLocations
  }
  return [
    {
      label: projectTitle(project),
      latitude: 43.0389,
      longitude: -87.9065,
    },
  ]
}

function isLegacyGithubProject(project: WorkspaceProject) {
  return project.projectType === ["github", "repository"].join("-") || project.id.includes("__github__")
}

function mergeProjectMetadata(
  baseProject: WorkspaceProject,
  metadataProject: WorkspaceProject
): WorkspaceProject {
  return {
    ...baseProject,
    repository: baseProject.repository ?? metadataProject.repository,
    repoSlug: baseProject.repoSlug ?? metadataProject.repoSlug,
    githubRepo: baseProject.githubRepo ?? metadataProject.githubRepo,
    branch: baseProject.branch ?? metadataProject.branch,
    commitSha: baseProject.commitSha ?? metadataProject.commitSha,
    latestCommitSha: baseProject.latestCommitSha ?? metadataProject.latestCommitSha,
    latestCommitMessage:
      baseProject.latestCommitMessage ?? metadataProject.latestCommitMessage,
    liveUrl: baseProject.liveUrl ?? metadataProject.liveUrl,
  }
}

// Sources that mark a project as synthesized (not a real Firestore project record).
const SYNTHESIZED_SOURCES = new Set(["github-connection", "vercel-connection"])

function consolidateProjectCards(projects: WorkspaceProject[]) {
  // ── Partition ──────────────────────────────────────────────────────────────
  const legacyGithubProjects = projects.filter(isLegacyGithubProject)
  const allCanonical = projects.filter((p) => !isLegacyGithubProject(p))

  // Firestore-backed records have no `source`; synthesized ones do.
  const firestoreProjects = allCanonical.filter((p) => !SYNTHESIZED_SOURCES.has(p.source ?? ""))
  const synthesizedProjects = allCanonical.filter((p) => SYNTHESIZED_SOURCES.has(p.source ?? ""))

  // ── Index helpers ──────────────────────────────────────────────────────────
  function buildRepoIndex(list: WorkspaceProject[]) {
    const index = new Map<string, WorkspaceProject>()
    for (const p of list) {
      const key = projectRepositoryLabel(p)
      if (key && key !== "Repository not mapped") index.set(key, p)
    }
    return index
  }

  const githubByRepo = buildRepoIndex(legacyGithubProjects)
  const vercelByRepo = buildRepoIndex(synthesizedProjects)

  function resolveGithub(project: WorkspaceProject) {
    const key = projectRepositoryLabel(project)
    return (
      githubByRepo.get(key) ??
      (githubByRepo.size === 1 ? Array.from(githubByRepo.values())[0] : null)
    )
  }

  function resolveVercel(project: WorkspaceProject) {
    const key = projectRepositoryLabel(project)
    return (
      vercelByRepo.get(key) ??
      (synthesizedProjects.length === 1 ? synthesizedProjects[0] : null)
    )
  }

  // ── Tier 1: Firestore projects exist — they are the canonical base ─────────
  // Synthesized (vercel / github) entries enrich them; they do NOT render
  // as separate side-by-side cards.
  if (firestoreProjects.length > 0) {
    return firestoreProjects.map((project) => {
      const matchingGithub = resolveGithub(project)
      const matchingVercel = resolveVercel(project)
      let merged = project
      if (matchingGithub) merged = mergeProjectMetadata(merged, matchingGithub)
      if (matchingVercel) merged = mergeProjectMetadata(merged, matchingVercel)
      return merged
    })
  }

  // ── Tier 2: No Firestore projects — synthesized vercel entries are canonical ─
  // Each vercel card is enriched by a matching github-repository entry.
  if (synthesizedProjects.length > 0) {
    return synthesizedProjects.map((project) => {
      const matchingGithub = resolveGithub(project)
      return matchingGithub ? mergeProjectMetadata(project, matchingGithub) : project
    })
  }

  // ── Tier 3: Only legacy github-repository entries — promote them ───────────
  return legacyGithubProjects.map((project) => ({
    ...project,
    projectType: undefined,
    title: project.title || project.name || "Untitled Project",
  }))
}

function cleanDisplayValue(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

function buildLedgerJustificationTooltip(entries: WorkspaceLedgerEntry[]) {
  const repositories = Array.from(
    new Set(entries.map((entry) => entry.sourceRepository).filter(Boolean))
  )
  const branchDepths = Array.from(
    new Set(entries.map((entry) => entry.sourceBranchDepth).filter(Boolean))
  )
  const deployments = Array.from(
    new Set(entries.map((entry) => entry.vercelDeploymentId).filter(Boolean))
  )
  const hostingConfigurations = Array.from(
    new Set(entries.map((entry) => entry.hostingPlatformConfiguration).filter(Boolean))
  )
  const verifiedLines = entries.reduce(
    (sum, entry) => sum + Math.max(0, entry.verifiedDataStructureLines ?? 0),
    0
  )
  const endpointMaps = Array.from(
    new Set(entries.flatMap((entry) => entry.municipalEndpointMaps ?? []))
  )

  return [
    `GitHub repository: ${repositories.join(", ") || "No repository handle recorded"}`,
    `Branch depth: ${branchDepths.join(", ") || "No branch-depth metadata recorded"}`,
    `Vercel deployment ID: ${deployments.join(", ") || "No Vercel deployment ID recorded"}`,
    `Hosting configuration: ${
      hostingConfigurations.join("; ") || "No hosting platform configuration recorded"
    }`,
    `Verified data structure lines: ${verifiedLines.toLocaleString("en-US")}`,
    endpointMaps.length > 0
      ? `Municipal endpoint maps: ${endpointMaps.join(", ")}`
      : "Municipal endpoint maps: none recorded",
  ].join("\n")
}

function utilityHealthForProvider(
  expenses: WorkspaceExpense[],
  provider: WorkspaceExpense["serviceProvider"]
) {
  const related = expenses.filter((expense) => expense.serviceProvider === provider)
  const critical = related.some((expense) => expense.criticalSystemFlag)
  const unpaid = related.some((expense) => expense.status === "unpaid")

  if (critical) {
    return {
      label: "critical",
      variant: "danger" as const,
      detail: "Invoice overdue or due now; production component at risk.",
    }
  }
  if (unpaid) {
    return {
      label: "invoice pending",
      variant: "warning" as const,
      detail: "Tracked utility has an unpaid invoice awaiting clearance.",
    }
  }
  if (related.length > 0) {
    return {
      label: "cleared",
      variant: "success" as const,
      detail: "Tracked utility liabilities are currently cleared.",
    }
  }
  return {
    label: "tracked",
    variant: "secondary" as const,
    detail: "Utility dependency is tracked; no invoice is currently recorded.",
  }
}

function dateFromUnknown(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === "object") {
    if (
      "seconds" in value &&
      typeof (value as { seconds: unknown }).seconds === "number"
    ) {
      const date = new Date((value as { seconds: number }).seconds * 1000)
      return Number.isNaN(date.getTime()) ? null : date
    }
    if (
      "toDate" in value &&
      typeof (value as { toDate: unknown }).toDate === "function"
    ) {
      try {
        const date = (value as { toDate: () => Date }).toDate()
        return Number.isNaN(date.getTime()) ? null : date
      } catch {
        return null
      }
    }
  }
  return null
}

function formatSafeDate(
  value: unknown,
  options?: Intl.DateTimeFormatOptions,
  fallback = "N/A"
) {
  const date = dateFromUnknown(value)
  return date ? date.toLocaleDateString("en-US", options) : fallback
}

function hostingEvidenceLabel(link: InfrastructureLink) {
  if (link.sourceSystem === "vercel-domain") {
    return link.verified === false ? "Needs verification in Vercel" : "Domain attached through Vercel"
  }
  return link.evidenceSnippet ?? "Source-backed hosting record"
}

function hostingExpirationLabel(link: InfrastructureLink) {
  const dueDate = formatSafeDate(
    link.dueDate,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
    ""
  )
  if (dueDate) {
    return `Expiration tracked: ${dueDate}`
  }
  if (link.sourceSystem === "vercel-domain") {
    return "Expiration not available from Vercel"
  }
  return null
}

function domainStatusDescription(link: InfrastructureLink) {
  if (link.sourceSystem === "vercel-domain") {
    const verification = link.verified === false ? "Needs verification" : "Verified"
    const expiration = hostingExpirationLabel(link)
    return expiration ? `${verification} · ${expiration}` : verification
  }
  if (link.status === "renewal_due" || link.status === "unpaid") {
    const dueDate = formatSafeDate(
      link.dueDate,
      {
        month: "long",
        day: "numeric",
        year: "numeric",
      },
      ""
    )
    return dueDate ? `Renewal due ${dueDate}` : "Renewal due"
  }
  return link.status === "active" ? "Domain active" : infraStatusLabel(link.status)
}

function normalizeDomainValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
  return host.includes(".") ? host : null
}

function expenseSearchText(expense: WorkspaceExpense) {
  return [
    expense.domain,
    expense.source,
    expense.description,
    expense.evidenceSnippet,
    expense.vendor,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function expenseMatchesLink(expense: WorkspaceExpense, link: InfrastructureLink) {
  const linkDomain = normalizeDomainValue(link.domain)
  const expenseDomain = normalizeDomainValue(expense.domain)
  if (linkDomain && expenseDomain) {
    return linkDomain === expenseDomain || linkDomain.endsWith(`.${expenseDomain}`) || expenseDomain.endsWith(`.${linkDomain}`)
  }
  if (linkDomain) return expenseSearchText(expense).includes(linkDomain)
  return false
}

function findExpenseForInfrastructureLink(
  link: InfrastructureLink,
  expenses: WorkspaceExpense[]
) {
  const matching = expenses.filter((expense) => expenseMatchesLink(expense, link))
  return (
    matching.find((expense) => expense.status === "unpaid" && expense.criticalSystemFlag) ??
    matching.find((expense) => expense.status === "unpaid") ??
    matching[0] ??
    null
  )
}

function infrastructureLinkScore(link: InfrastructureLink, expense: WorkspaceExpense | null) {
  let score = 0
  if (expense?.amount) score += 100
  if (link.amount) score += 80
  if (link.dueDate || expense?.dueDate) score += 40
  if (link.sourceSystem === "vercel-domain") score += 90
  if (link.verified) score += 30
  score += link.confidence
  return score
}

function isRenderableInfrastructureLink(link: InfrastructureLink) {
  if (link.domain || link.amount || link.dueDate) return true
  return link.type !== "domain" && link.type !== "invoice"
}

function buildHostingStatusCards(
  links: InfrastructureLink[],
  expenses: WorkspaceExpense[]
) {
  const cards = new Map<
    string,
    {
      link: InfrastructureLink
      expense: WorkspaceExpense | null
      status: InfrastructureLink["status"]
    }
  >()

  for (const link of links) {
    if (!isRenderableInfrastructureLink(link)) continue
    const expense = findExpenseForInfrastructureLink(link, expenses)
    const domainKey = normalizeDomainValue(link.domain)
    const key = domainKey
      ? domainKey
      : `${link.provider}:${link.type}:${link.sourceSystem}:${link.id}`
    const status =
      expense?.status === "unpaid"
        ? expense.criticalSystemFlag
          ? "unpaid"
          : "renewal_due"
        : link.status
    const next = { link, expense, status }
    const current = cards.get(key)
    if (!current) {
      cards.set(key, next)
      continue
    }
    if (
      infrastructureLinkScore(next.link, next.expense) >
      infrastructureLinkScore(current.link, current.expense)
    ) {
      cards.set(key, next)
    }
  }

  return [...cards.values()]
}

// ─── InfoTooltip ──────────────────────────────────────────────────────────────
// Lightweight CSS-only tooltip rendered adjacent to section headers. Keeps the
// viewport clear of long explanatory prose while making context discoverable.
function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative ml-1.5 inline-flex shrink-0 items-center">
      <span className="group flex cursor-default items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600 focus:outline-none">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        {/* Floating tooltip panel */}
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 whitespace-pre-line rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-xs font-normal leading-5 text-slate-600 shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          {text}
          {/* Arrow caret */}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-200" />
        </span>
      </span>
    </span>
  )
}

function workspaceBusinessReference(workspace: Workspace) {
  return (
    cleanDisplayValue(workspace.businessName) ||
    cleanDisplayValue(workspace.clientBusinessName) ||
    cleanDisplayValue(workspace.workspaceName) ||
    cleanDisplayValue(workspace.name) ||
    "Parent Business"
  )
}

function roleDisplayLabel(role: WorkspaceRole) {
  if (role === "employee-of-client") return "employee"
  return role
}

function roleDescription(role: WorkspaceRole) {
  switch (role) {
    case "owner":
      return "The owner is the account authority for business decisions, workspace approvals, and billing direction."
    case "developer":
      return "The developer is the implementation operator assigned to connect code, hosting, and technical execution."
    case "collaborator":
      return "The collaborator is an external contributor assigned to the project track for review or delivery support."
    case "employee-of-client":
      return "The employee is a client-side member who can review project context and assigned deliverables."
    case "beam-participant":
      return "The beam-participant is attached to the delivery process as part of the ReadyAimGo service workflow."
    default:
      return "This role controls how a person participates in the workspace track."
  }
}

function memberDisplayName(member: WorkspaceMember) {
  return cleanDisplayValue(member.displayName) || cleanDisplayValue(member.email) || "Unnamed user"
}

function memberInitial(member: WorkspaceMember) {
  const label = memberDisplayName(member)
  return label.charAt(0).toUpperCase() || "U"
}

function projectAssignmentKeys(project: WorkspaceProject) {
  return new Set(
    [
      project.id,
      project.repository?.fullName,
      project.repository?.url,
      project.repoSlug,
      project.githubRepo,
      project.vercelProjectId,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
  )
}

function membersForProject(project: WorkspaceProject, members: WorkspaceMember[]) {
  const keys = projectAssignmentKeys(project)
  return members.filter((member) => {
    const repoAssignments = member.assignedRepos.map((repo) => repo.toLowerCase())
    const vercelAssignments = member.assignedVercelIds.map((id) => id.toLowerCase())
    if (repoAssignments.length === 0 && vercelAssignments.length === 0) return true
    return [...repoAssignments, ...vercelAssignments].some((assignment) => keys.has(assignment))
  })
}

function getProjectObjectives(project: WorkspaceProject) {
  const structured = project.scopeObjectives || project.launchObjectives || []
  if (structured.length > 0) {
    return structured.map((objective, index) => ({
      id: objective.id || `objective-${index}`,
      title: objective.title || `Objective ${index + 1}`,
      description: objective.description || "",
    }))
  }

  const deliverables = Array.isArray(project.deliverables) ? project.deliverables : []
  if (deliverables.length > 0) {
    return deliverables.map((title, index) => ({
      id: `deliverable-${index}`,
      title,
      description: "Derived from project deliverables.",
    }))
  }

  return [
    {
      id: "scope",
      title: project.summary || project.description || "Define scope of work objectives",
      description: "No canonical launch objectives have been recorded for this project yet.",
    },
  ]
}

function taskMatchesObjective(task: WorkspaceProjectTask, objective: { id: string; title: string }) {
  if (task.objectiveId && task.objectiveId === objective.id) return true
  const objectiveTitle = objective.title.toLowerCase()
  return Boolean(
    task.objectiveTitle?.toLowerCase() === objectiveTitle ||
      task.title?.toLowerCase().includes(objectiveTitle)
  )
}

function mergeWorkspaceProjects(
  current: WorkspaceProject[],
  incoming: WorkspaceProject[] = []
) {
  const byId = new Map<string, WorkspaceProject>()
  for (const project of current) byId.set(project.id, project)
  for (const project of incoming) byId.set(project.id, project)
  return Array.from(byId.values())
}

function statusTone(status?: string) {
  if (status === "done" || status === "complete" || status === "completed") return "bg-emerald-100 text-emerald-700"
  if (status === "blocked" || status === "declined") return "bg-rose-100 text-rose-700"
  if (status === "in_progress" || status === "active" || status === "accepted") return "bg-blue-100 text-blue-700"
  return "bg-slate-100 text-slate-600"
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkspacePage() {
  const params = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [directorySelection, setDirectorySelection] = useState<{
    role: WorkspaceRole
    projectId: string
  } | null>(null)
  const [allRepos, setAllRepos] = useState<GitHubRepo[]>([])
  const [allVercel, setAllVercel] = useState<VercelProject[]>([])
  const [childProjects, setChildProjects] = useState<WorkspaceProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectTasks, setProjectTasks] = useState<WorkspaceProjectTask[]>([])
  const [projectTasksLoading, setProjectTasksLoading] = useState(false)
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraftState>>({})
  const [creatingTaskFor, setCreatingTaskFor] = useState<string | null>(null)
  const [correspondence, setCorrespondence] = useState<CorrespondenceItem[]>([])
  const [correspondenceLocked, setCorrespondenceLocked] = useState(false)
  const [meetingProviders, setMeetingProviders] = useState<WorkspaceMeetingProvider[]>([])
  const [savingMeetingProviders, setSavingMeetingProviders] = useState(false)
  const [contracts, setContracts] = useState<BeamContract[]>([])
  const [selectedContract, setSelectedContract] = useState<BeamContract | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftFileInputRef = useRef<HTMLInputElement>(null)
  const [paymentData, setPaymentData] = useState<WorkspacePaymentData | null>(null)
  const [expenses, setExpenses] = useState<WorkspaceExpense[]>([])
  const [customPayAmount, setCustomPayAmount] = useState("")
  const [processingPayment, setProcessingPayment] = useState(false)
  const [payingDeliverableId, setPayingDeliverableId] = useState<string | null>(null)
  const [authorizingExpenseId, setAuthorizingExpenseId] = useState<string | null>(null)
  const [analyzingLedger, setAnalyzingLedger] = useState(false)
  const [analyzingHosting, setAnalyzingHosting] = useState(false)
  const [savingBillingEvidence, setSavingBillingEvidence] = useState(false)
  const [infrastructureLinks, setInfrastructureLinks] = useState<InfrastructureLink[]>([])
  const [billingEvidenceOpen, setBillingEvidenceOpen] = useState(false)
  const [billingEvidenceText, setBillingEvidenceText] = useState("")
  const [domainQuery, setDomainQuery] = useState("")
  const [retainerSlide, setRetainerSlide] = useState(0)
  const autoLedgerRefreshRef = useRef<Set<string>>(new Set())
  const autoHostingAnalyzedRef = useRef(false)
  const [insufficientExpense, setInsufficientExpense] = useState<WorkspaceExpense | null>(null)
  // Active tab — read from URL on mount so Stripe can redirect back to ?tab=payments
  const [activeTab, setActiveTab] = useState("projects")
  // AI contract draft dialog
  const [draftDialogOpen, setDraftDialogOpen] = useState(false)
  const [draftForm, setDraftForm] = useState<DraftFormState>(DRAFT_FORM_DEFAULTS)
  const [drafting, setDrafting] = useState(false)
  const [draftResult, setDraftResult] = useState<GeneratedDraft | null>(null)
  const [repoQuery, setRepoQuery] = useState("")
  const [vercelQuery, setVercelQuery] = useState("")
  const [projectTypeOverrides, setProjectTypeOverrides] = useState<Record<string, AssetProjectType>>({})
  const [showEcosystemSearch, setShowEcosystemSearch] = useState(false)
  const [savingHosting, setSavingHosting] = useState(false)
  const [savingConnectors, setSavingConnectors] = useState(false)
  const [githubMeta, setGithubMeta] = useState<ConnectorMeta | null>(null)
  const [vercelMeta, setVercelMeta] = useState<ConnectorMeta | null>(null)
  const [hostingDiagnostics, setHostingDiagnostics] = useState<HostingAnalyzeDiagnostics | null>(null)
  const hostingStatusCards = useMemo(
    () => buildHostingStatusCards(infrastructureLinks, expenses),
    [expenses, infrastructureLinks]
  )
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<
    "owner" | "developer" | "collaborator" | "employee-of-client" | "beam-participant"
  >("collaborator")
  const [loading, setLoading] = useState(true)
  const [reposBusy, setReposBusy] = useState<Set<number | string>>(new Set())
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const attachedRepoIds = useMemo(
    () => new Set(workspace?.repos.map((r) => r.id) ?? []),
    [workspace]
  )
  const attachedVercelIds = useMemo(
    () => new Set(workspace?.vercelProjects.map((p) => p.id) ?? []),
    [workspace]
  )
  const currentMember = useMemo(
    () => members.find((member) => member.uid === user?.uid) ?? null,
    [members, user?.uid]
  )
  const canManageWorkspace = currentMember?.role === "owner" || currentMember?.role === "developer"

  const filteredRepos = useMemo(() => {
    const q = repoQuery.toLowerCase()
    return q
      ? allRepos.filter(
          (r) =>
            r.fullName.toLowerCase().includes(q) ||
            (r.description ?? "").toLowerCase().includes(q)
        )
      : allRepos
  }, [allRepos, repoQuery])

  const filteredVercel = useMemo(() => {
    const q = vercelQuery.toLowerCase()
    return q
      ? allVercel.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.url ?? "").toLowerCase().includes(q)
        )
      : allVercel
  }, [allVercel, vercelQuery])

  const selectedProject = useMemo(
    () => childProjects.find((project) => project.id === selectedProjectId) ?? childProjects[0] ?? null,
    [childProjects, selectedProjectId]
  )
  const selectedProjectObjectives = useMemo(
    () => (selectedProject ? getProjectObjectives(selectedProject) : []),
    [selectedProject]
  )
  const projectCards = useMemo(
    () => consolidateProjectCards(childProjects),
    [childProjects]
  )
  const directoryProject = useMemo(
    () =>
      directorySelection
        ? projectCards.find((project) => project.id === directorySelection.projectId) ?? null
        : null,
    [directorySelection, projectCards]
  )
  const directoryMembers = useMemo(() => {
    if (!directoryProject || !directorySelection) return []
    return membersForProject(directoryProject, members).filter(
      (member) => member.role === directorySelection.role
    )
  }, [directoryProject, directorySelection, members])
  const agencyValuationBenchmarks = useMemo(() => {
    const grouped = new Map<
      string,
      {
        label: string
        value: number
        entries: WorkspaceLedgerEntry[]
      }
    >()

    for (const entry of paymentData?.ledger ?? []) {
      const value = entry.valueAllocationAmount || entry.deductionAmount || 0
      if (!Number.isFinite(value) || value <= 0) continue
      const label = entry.benchmarkCategory || "Uncategorized Production Equity"
      const current = grouped.get(label) ?? { label, value: 0, entries: [] }
      current.value += value
      current.entries.push(entry)
      grouped.set(label, current)
    }

    return Array.from(grouped.values()).sort((a, b) => b.value - a.value)
  }, [paymentData?.ledger])
  const totalAgencyProductionEquity = useMemo(
    () => agencyValuationBenchmarks.reduce((sum, item) => sum + item.value, 0),
    [agencyValuationBenchmarks]
  )

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const [wsRes, membersRes, projectsRes, reposRes, vercelRes, contractsRes, filesRes, paymentsRes, expensesRes, commsRes, linksRes] = await Promise.all([
        apiFetch<{ workspaces: Workspace[] }>(user, "/api/workspaces"),
        apiFetch<{ members: WorkspaceMember[] }>(
          user,
          `/api/workspaces/${params.workspaceId}/members`
        ),
        apiFetch<{ projects: WorkspaceProject[] }>(
          user,
          `/api/workspaces/${params.workspaceId}/projects`
        ).catch(() => ({ projects: [] as WorkspaceProject[] })),
        apiFetch<GitHubReposResponse>(
          user,
          `/api/github/repos?workspaceId=${encodeURIComponent(params.workspaceId)}`
        ).catch((err) => ({
          repos: [] as GitHubRepo[],
          meta: {
            configured: false,
            warning: err instanceof Error ? err.message : "Unable to load GitHub repos.",
          },
        })),
        apiFetch<VercelProjectsResponse>(
          user,
          `/api/vercel/projects?workspaceId=${encodeURIComponent(params.workspaceId)}`
        ).catch((err) => ({
          projects: [] as VercelProject[],
          meta: {
            configured: false,
            warning: err instanceof Error ? err.message : "Unable to load Vercel projects.",
          },
        })),
        // Contracts — soft fail if workspace has no linked clientId yet
        apiFetch<{ contracts: BeamContract[] }>(
          user,
          `/api/contracts?workspaceId=${params.workspaceId}`
        ).catch(() => ({ contracts: [] as BeamContract[] })),
        // Files — always soft fail; empty list is valid
        apiFetch<{ files: WorkspaceFile[] }>(
          user,
          `/api/workspaces/${params.workspaceId}/files`
        ).catch(() => ({ files: [] as WorkspaceFile[] })),
        // Payments — soft fail; empty state shown when no clientId linked
        apiFetch<WorkspacePaymentData>(
          user,
          `/api/workspaces/${params.workspaceId}/payments`
        ).catch(() => ({
          clientId: null,
          stripeCustomerId: null,
          totalPaid: 0,
          retainerBalance: 0,
          ledger: [] as WorkspaceLedgerEntry[],
          payments: [] as ValuePaymentRecord[],
          deliverables: [] as ClientDeliverable[],
          accountOwner: null,
        })),
        apiFetch<{ expenses: WorkspaceExpense[] }>(
          user,
          `/api/workspaces/${params.workspaceId}/expenses`
        ).catch(() => ({ expenses: [] as WorkspaceExpense[] })),
        apiFetch<CorrespondenceResponse>(
          user,
          `/api/workspaces/${params.workspaceId}/correspondence`
        ).catch((): CorrespondenceResponse => ({ items: [], locked: true })),
        apiFetch<{ links: InfrastructureLink[] }>(
          user,
          `/api/workspaces/${params.workspaceId}/infrastructure-links`
        ).catch(() => ({ links: [] as InfrastructureLink[] })),
      ])

      const ws = wsRes.workspaces.find((w) => w.id === params.workspaceId) ?? null
      if (!ws) {
        router.replace("/dashboard")
        return
      }

      setWorkspace(ws)
      setMembers(membersRes.members)
      setChildProjects(projectsRes.projects)
      setSelectedProjectId((current) => current || projectsRes.projects[0]?.id || null)
      setAllRepos(reposRes.repos)
      setAllVercel(vercelRes.projects)
      setGithubMeta(reposRes.meta ?? null)
      setVercelMeta(vercelRes.meta ?? null)
      setContracts(contractsRes.contracts)
      setFiles(filesRes.files)
      setPaymentData(paymentsRes)
      setExpenses(expensesRes.expenses)
      setCorrespondence(commsRes.items)
      setCorrespondenceLocked(Boolean(commsRes.locked))
      setMeetingProviders(commsRes.meetingProviders ?? [])
      setInfrastructureLinks(linksRes.links)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load workspace.")
    } finally {
      setLoading(false)
    }
  }, [params.workspaceId, router, user])

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login")
      return
    }
    if (!authLoading && user) {
      void load()
    }
  }, [authLoading, load, router, user])

  useEffect(() => {
    if (!user || !selectedProjectId) {
      setProjectTasks([])
      return
    }

    let cancelled = false
    setProjectTasksLoading(true)
    apiFetch<{ tasks: WorkspaceProjectTask[] }>(
      user,
      `/api/workspaces/${params.workspaceId}/projects/${encodeURIComponent(selectedProjectId)}/tasks`
    )
      .then((res) => {
        if (!cancelled) setProjectTasks(res.tasks ?? [])
      })
      .catch(() => {
        if (!cancelled) setProjectTasks([])
      })
      .finally(() => {
        if (!cancelled) setProjectTasksLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [params.workspaceId, selectedProjectId, user])

  const toggleRepo = async (repo: GitHubRepo) => {
    if (!user || !workspace) return
    const key = repo.id
    setReposBusy((prev) => new Set(prev).add(key))
    try {
      if (attachedRepoIds.has(repo.id)) {
        const res = await apiFetch<WorkspaceConnectionResponse>(
          user,
          `/api/workspaces/${params.workspaceId}/repos`,
          {
          method: "DELETE",
          body: JSON.stringify({ repoIds: [repo.id] }),
          }
        )
        if (res.workspace) {
          setWorkspace(res.workspace)
        } else {
          setWorkspace((prev) =>
            prev ? { ...prev, repos: prev.repos.filter((r) => r.id !== repo.id) } : prev
          )
        }
        if (res.removedProjectIds?.length) {
          const removed = new Set(res.removedProjectIds)
          setChildProjects((prev) => prev.filter((project) => !removed.has(project.id)))
          if (selectedProjectId && removed.has(selectedProjectId)) {
            setSelectedProjectId(null)
          }
        }
      } else {
        const res = await apiFetch<WorkspaceConnectionResponse>(
          user,
          `/api/workspaces/${params.workspaceId}/repos`,
          {
          method: "POST",
          body: JSON.stringify({ repos: [repo] }),
          }
        )
        if (res.workspace) {
          setWorkspace(res.workspace)
        } else {
          setWorkspace((prev) =>
            prev ? { ...prev, repos: [...prev.repos, repo] } : prev
          )
        }
        if (res.projects?.length) {
          setChildProjects((prev) => mergeWorkspaceProjects(prev, res.projects))
          setSelectedProjectId((current) => current || res.projects?.[0]?.id || null)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update repos.")
    } finally {
      setReposBusy((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const toggleVercel = async (project: VercelProject) => {
    if (!user || !workspace) return
    const key = project.id
    setReposBusy((prev) => new Set(prev).add(key))
    try {
      if (attachedVercelIds.has(project.id)) {
        const res = await apiFetch<WorkspaceConnectionResponse>(
          user,
          `/api/workspaces/${params.workspaceId}/repos`,
          {
          method: "DELETE",
          body: JSON.stringify({ vercelIds: [project.id] }),
          }
        )
        if (res.workspace) {
          setWorkspace(res.workspace)
        } else {
          setWorkspace((prev) =>
            prev
              ? { ...prev, vercelProjects: prev.vercelProjects.filter((p) => p.id !== project.id) }
              : prev
          )
        }
        if (res.removedProjectIds?.length) {
          const removed = new Set(res.removedProjectIds)
          setChildProjects((prev) => prev.filter((item) => !removed.has(item.id)))
          if (selectedProjectId && removed.has(selectedProjectId)) {
            setSelectedProjectId(null)
          }
        }
      } else {
        const res = await apiFetch<WorkspaceConnectionResponse>(
          user,
          `/api/workspaces/${params.workspaceId}/repos`,
          {
          method: "POST",
          body: JSON.stringify({ vercelProjects: [project] }),
          }
        )
        if (res.workspace) {
          setWorkspace(res.workspace)
        } else {
          setWorkspace((prev) =>
            prev ? { ...prev, vercelProjects: [...prev.vercelProjects, project] } : prev
          )
        }
        if (res.projects?.length) {
          setChildProjects((prev) => mergeWorkspaceProjects(prev, res.projects))
          setSelectedProjectId((current) => current || res.projects?.[0]?.id || null)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update Vercel projects.")
    } finally {
      setReposBusy((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const inviteMember = async () => {
    if (!user || !inviteEmail.trim()) return
    setInviting(true)
    setError(null)
    setMessage(null)
    try {
      const res = await apiFetch<{ status: string; message?: string }>(
        user,
        `/api/workspaces/${params.workspaceId}/members`,
        {
          method: "POST",
          body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
        }
      )
      setMessage(res.message ?? (res.status === "added" ? "Member added." : "Invite sent."))
      setInviteEmail("")
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to invite member.")
    } finally {
      setInviting(false)
    }
  }

  // Read ?tab= and ?payment= from the URL on first mount so Stripe can redirect
  // back to the payments tab after checkout.
  useEffect(() => {
    if (typeof window === "undefined") return
    const sp = new URLSearchParams(window.location.search)
    const tab = sp.get("tab")
    if (tab) setActiveTab(HIDDEN_WORKSPACE_TABS.has(tab) ? "projects" : tab)
    const payment = sp.get("payment")
    if (payment === "success") {
      setMessage("Payment successful! Your balance has been updated.")
    } else if (payment === "cancelled") {
      setError("Payment cancelled — you were not charged.")
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (HIDDEN_WORKSPACE_TABS.has(activeTab)) setActiveTab("projects")
  }, [activeTab])

  // ── AI contract draft handler ──────────────────────────────────────────────

  const handleDraftGenerate = async () => {
    if (!user || drafting || !draftForm.projectDescription.trim()) return
    setDrafting(true)
    setError(null)
    setDraftResult(null)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 90000)
    try {
      const res = await apiFetch<{
        contractId: string
        draft: GeneratedDraft
      }>(user, "/api/contracts/draft", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          workspaceId: params.workspaceId,
          ...draftForm,
        }),
      })
      // Prepend the new draft contract to the contracts list
      const notes = [
        res.draft.scopeOfWork && `## Scope of Work\n\n${res.draft.scopeOfWork}`,
        res.draft.timeline && `## Timeline\n\n${res.draft.timeline}`,
        res.draft.paymentTerms && `## Payment Terms\n\n${res.draft.paymentTerms}`,
        res.draft.revisionTerms && `## Revision Terms\n\n${res.draft.revisionTerms}`,
        res.draft.legalReviewNotes && `## Legal Review Notes\n\n${res.draft.legalReviewNotes}`,
      ]
        .filter(Boolean)
        .join("\n\n")
      const newContract: BeamContract = {
        id: res.contractId,
        clientId: workspace?.clientId ?? "",
        clientName: workspace?.name ?? "",
        clientEmail: workspace?.clientEmail ?? user.email ?? "",
        contractType: "mou" as const,
        status: "draft" as const,
        title: res.draft.title,
        summary: res.draft.summary,
        notes,
        monthlyValue: 0,
        termMonths: 0,
        startDate: null,
        endDate: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: "",
        documentUrl: null,
        beamNgos: [],
      }
      setContracts((prev) => [newContract, ...prev])
      setDraftResult(null)
      setDraftForm(DRAFT_FORM_DEFAULTS)
      setDraftDialogOpen(false)
      setMessage("Draft generated and saved. Review it in the Contracts list.")
      setTimeout(() => setMessage(null), 6000)
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "AbortError"
          ? "AI draft generation timed out. Please try again with a shorter prompt."
          : err instanceof Error
            ? err.message
            : "Unable to generate draft."
      )
    } finally {
      window.clearTimeout(timeout)
      setDrafting(false)
    }
  }

  // ── Payment action handlers ────────────────────────────────────────────────

  const handleValuePayment = async () => {
    if (!user || processingPayment) return
    const amount = Number(customPayAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid payment amount.")
      return
    }
    setProcessingPayment(true)
    setError(null)
    try {
      const res = await apiFetch<{ url: string }>(user, "/api/stripe/value-payment", {
        method: "POST",
        body: JSON.stringify({ workspaceId: params.workspaceId, amount }),
      })
      window.location.href = res.url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start payment.")
      setProcessingPayment(false)
    }
  }

  const handleDeliverablePayment = async (deliverableId: string) => {
    if (!user || !paymentData?.clientId) return
    setPayingDeliverableId(deliverableId)
    setError(null)
    try {
      const res = await apiFetch<{ url: string }>(user, "/api/stripe/deliverable-payment", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: params.workspaceId,
          clientId: paymentData.clientId,
          deliverableId,
        }),
      })
      window.location.href = res.url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start payment.")
      setPayingDeliverableId(null)
    }
  }

  const handleBillingPortal = async () => {
    const customerId = paymentData?.stripeCustomerId
    if (!user || !customerId) return
    setProcessingPayment(true)
    setError(null)
    try {
      const res = await apiFetch<{ url: string }>(user, "/api/stripe/create-portal-session", {
        method: "POST",
        body: JSON.stringify({ customerId, workspaceId: params.workspaceId }),
      })
      window.location.href = res.url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open billing portal.")
      setProcessingPayment(false)
    }
  }

  const handleAnalyzeLedger = useCallback(async (options?: {
    source?: "manual-reload" | "page-load"
    silent?: boolean
  }) => {
    if (!user || analyzingLedger) return
    setAnalyzingLedger(true)
    if (!options?.silent) {
      setError(null)
      setMessage(null)
    }
    try {
      const res = await apiFetch<{
        success: boolean
        receipts: Array<{ id: string }>
        analyzedSignals?: number
        message?: string
      }>(user, `/api/workspaces/${params.workspaceId}/ledger/analyze`, {
        method: "POST",
        body: JSON.stringify({ source: options?.source ?? "manual-reload" }),
      })
      if (res.receipts.length > 0) {
        setMessage(
          `AI ledger analysis created ${res.receipts.length} receipt${res.receipts.length === 1 ? "" : "s"} from ${res.analyzedSignals ?? "available"} commit signal${res.analyzedSignals === 1 ? "" : "s"}.`
        )
      } else if (!options?.silent) {
        setMessage(res.message ?? "AI ledger analysis found no new receipt rows.")
      }
      const updatedPaymentData = await apiFetch<WorkspacePaymentData>(
        user,
        `/api/workspaces/${params.workspaceId}/payments`
      )
      setPaymentData(updatedPaymentData)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to analyze commit ledger."
      if (options?.silent) {
        console.warn("Auto AI ledger refresh failed:", message)
      } else {
        setError(message)
      }
    } finally {
      setAnalyzingLedger(false)
    }
  }, [analyzingLedger, params.workspaceId, user])

  useEffect(() => {
    if (!user || loading || !workspace || !paymentData?.clientId) return
    const workspaceId = params.workspaceId
    if (autoLedgerRefreshRef.current.has(workspaceId)) return
    autoLedgerRefreshRef.current.add(workspaceId)
    void handleAnalyzeLedger({ source: "page-load", silent: true })
  }, [handleAnalyzeLedger, loading, params.workspaceId, paymentData?.clientId, user, workspace])

  const handleAnalyzeHosting = useCallback(
    async (opts: { force?: boolean; silent?: boolean } = {}) => {
      if (!user || analyzingHosting) return
      setAnalyzingHosting(true)
      if (!opts.silent) {
        setError(null)
        setMessage(null)
      }
      try {
        const res = await apiFetch<{
          success: boolean
          skipped?: boolean
          records: Array<{ id: string }>
          evidenceCount?: number
          diagnostics?: HostingAnalyzeDiagnostics
          warning?: string | null
          message?: string
        }>(user, `/api/workspaces/${params.workspaceId}/infrastructure/analyze`, {
          method: "POST",
          body: JSON.stringify({ force: opts.force ?? false }),
        })
        setHostingDiagnostics(res.diagnostics ?? null)

        // Refresh both infrastructure links and expenses after analysis
        const [linksRes, expensesRes] = await Promise.all([
          apiFetch<{ links: InfrastructureLink[] }>(
            user,
            `/api/workspaces/${params.workspaceId}/infrastructure-links`
          ).catch(() => ({ links: [] as InfrastructureLink[] })),
          apiFetch<{ expenses: WorkspaceExpense[] }>(
            user,
            `/api/workspaces/${params.workspaceId}/expenses`
          ).catch(() => ({ expenses: [] as WorkspaceExpense[] })),
        ])
        setInfrastructureLinks(linksRes.links)
        setExpenses(expensesRes.expenses)

        if (!opts.silent && !res.skipped) {
          setMessage(
            res.records.length > 0
              ? `Found ${res.records.length} hosting record${res.records.length === 1 ? "" : "s"} from ${res.evidenceCount ?? "available"} evidence item${res.evidenceCount === 1 ? "" : "s"}.`
              : (res.warning || res.message || "No hosting records found in the available evidence.")
          )
        }
      } catch (err) {
        if (!opts.silent) {
          setError(err instanceof Error ? err.message : "Unable to analyze hosting records.")
        }
      } finally {
        setAnalyzingHosting(false)
      }
    },
    [analyzingHosting, params.workspaceId, user]
  )

  const saveBillingEvidence = useCallback(async () => {
    if (!user || !canManageWorkspace) return
    const evidenceText = billingEvidenceText.trim()
    if (!evidenceText) {
      setError("Paste a Zoho, Namecheap, or renewal email before saving billing evidence.")
      return
    }

    setSavingBillingEvidence(true)
    setError(null)
    setMessage(null)
    try {
      await apiFetch<{ success: boolean; evidenceId: string }>(
        user,
        `/api/workspaces/${params.workspaceId}/hosting-evidence`,
        {
          method: "POST",
          body: JSON.stringify({
            subject: "Manual hosting billing evidence",
            evidenceText,
          }),
        }
      )
      setBillingEvidenceText("")
      setBillingEvidenceOpen(false)
      setMessage("Billing evidence saved. Refreshing hosting records now.")
      await handleAnalyzeHosting({ force: true, silent: true })
      setMessage("Billing evidence analyzed. Matching expenses now appear on hosting cards.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save billing evidence.")
    } finally {
      setSavingBillingEvidence(false)
    }
  }, [
    billingEvidenceText,
    canManageWorkspace,
    handleAnalyzeHosting,
    params.workspaceId,
    user,
  ])

  // Auto-analyze when the Hosting tab opens, once per session, if no links exist yet.
  useEffect(() => {
    if (
      activeTab !== "vercel" ||
      autoHostingAnalyzedRef.current ||
      loading ||
      !user ||
      !workspace
    ) {
      return
    }
    if (infrastructureLinks.length === 0) {
      autoHostingAnalyzedRef.current = true
      void handleAnalyzeHosting({ silent: true })
    } else {
      autoHostingAnalyzedRef.current = true
    }
  }, [activeTab, handleAnalyzeHosting, infrastructureLinks.length, loading, user, workspace])

  const authorizeExpenseDisbursement = async (expenseId: string) => {
    if (!user || !workspace || currentMember?.role !== "owner") return
    const targetExpense = expenses.find((expense) => expense.id === expenseId)
    const activeRetainerBalance = paymentData?.retainerBalance ?? 0
    if (targetExpense && activeRetainerBalance < targetExpense.amount) {
      setInsufficientExpense(targetExpense)
      return
    }
    setAuthorizingExpenseId(expenseId)
    setError(null)
    setMessage(null)
    try {
      const res = await apiFetch<{
        expense: WorkspaceExpense
        retainerBalance: number
      }>(user, `/api/workspaces/${params.workspaceId}/expenses`, {
        method: "POST",
        body: JSON.stringify({ expenseId }),
      })
      setExpenses((prev) =>
        prev.map((expense) =>
          expense.id === expenseId ? { ...expense, ...res.expense, status: "paid" } : expense
        )
      )
      setPaymentData((prev) =>
        prev ? { ...prev, retainerBalance: res.retainerBalance } : prev
      )
      setWorkspace((prev) =>
        prev ? { ...prev, updatedAt: new Date().toISOString() } : prev
      )
      setMessage("Retainer disbursement authorized and logged to the ledger.")
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to authorize expense.")
    } finally {
      setAuthorizingExpenseId(null)
    }
  }

  const saveHosting = async (hosting: Workspace["hosting"]) => {
    if (!user || !workspace || !canManageWorkspace) return
    setSavingHosting(true)
    setError(null)
    try {
      await apiFetch(user, `/api/workspaces/${params.workspaceId}`, {
        method: "PATCH",
        body: JSON.stringify({ hosting }),
      })
      setWorkspace((prev) => (prev ? { ...prev, hosting } : prev))
      setMessage("Hosting metadata saved.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save hosting metadata.")
    } finally {
      setSavingHosting(false)
    }
  }

  const saveConnectors = async () => {
    if (!user || !workspace || !canManageWorkspace) return
    setSavingConnectors(true)
    setError(null)
    setMessage(null)
    try {
      await apiFetch(user, `/api/workspaces/${params.workspaceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          githubOrg: workspace.githubOrg || null,
          vercelTeamId: workspace.vercelTeamId || null,
        }),
      })
      setMessage("GitHub and Vercel workspace connectors saved.")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save workspace connectors.")
    } finally {
      setSavingConnectors(false)
    }
  }

  const updateManualDnsTarget = (target: ManualDnsTarget) => {
    if (!workspace) return
    const hosting = {
      ...workspace.hosting,
      manualDnsTargets: workspace.hosting.manualDnsTargets.map((item) =>
        item.id === target.id ? target : item
      ),
      infrastructureFlags: {
        ...workspace.hosting.infrastructureFlags,
        hasManualRecords: true,
        needsDnsReview:
          target.status === "needs-review" || workspace.hosting.infrastructureFlags.needsDnsReview,
      },
    }
    setWorkspace({ ...workspace, hosting })
  }

  const addManualDnsTarget = () => {
    if (!workspace) return
    const next: ManualDnsTarget = {
      id: `dns-${Date.now()}`,
      host: "",
      recordType: "CNAME",
      value: "",
      ttl: 3600,
      status: "planned",
      notes: null,
    }
    setWorkspace({
      ...workspace,
      hosting: {
        ...workspace.hosting,
        manualDnsTargets: [...workspace.hosting.manualDnsTargets, next],
        infrastructureFlags: {
          ...workspace.hosting.infrastructureFlags,
          hasManualRecords: true,
        },
      },
    })
  }

  const addStaticHost = () => {
    if (!workspace) return
    const next: StaticHostingPlatform = {
      id: `static-${Date.now()}`,
      provider: "other",
      projectName: "",
      dashboardUrl: null,
      productionUrl: null,
      repoSlug: null,
      status: "planned",
    }
    setWorkspace({
      ...workspace,
      hosting: {
        ...workspace.hosting,
        staticHosts: [...workspace.hosting.staticHosts, next],
        infrastructureFlags: {
          ...workspace.hosting.infrastructureFlags,
          hasStaticFallback: true,
        },
      },
    })
  }

  const createManualTask = async (objective: { id: string; title: string }) => {
    if (!user || !selectedProject || !canManageWorkspace) return
    const draft = taskDrafts[objective.id]
    if (!draft?.title.trim()) return
    setCreatingTaskFor(objective.id)
    setError(null)
    try {
      const res = await apiFetch<{ task: WorkspaceProjectTask }>(
        user,
        `/api/workspaces/${params.workspaceId}/projects/${encodeURIComponent(selectedProject.id)}/tasks`,
        {
          method: "POST",
          body: JSON.stringify({
            title: draft.title,
            description: draft.description,
            objectiveId: objective.id,
            objectiveTitle: objective.title,
          }),
        }
      )
      setProjectTasks((prev) => [res.task, ...prev])
      setTaskDrafts((prev) => ({ ...prev, [objective.id]: { title: "", description: "" } }))
      setMessage("Task objective added.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create task.")
    } finally {
      setCreatingTaskFor(null)
    }
  }

  const saveMeetingProviders = async () => {
    if (!user || !canManageWorkspace) return
    setSavingMeetingProviders(true)
    setError(null)
    try {
      const defaultMeetingProvider =
        meetingProviders.find((provider) => provider.enabled && provider.isDefault)?.id ??
        meetingProviders.find((provider) => provider.enabled)?.id ??
        null
      const res = await apiFetch<{
        meetingProviders: WorkspaceMeetingProvider[]
      }>(user, `/api/workspaces/${params.workspaceId}/correspondence`, {
        method: "POST",
        body: JSON.stringify({ meetingProviders, defaultMeetingProvider }),
      })
      setMeetingProviders(res.meetingProviders)
      setMessage("Meeting provider settings saved.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save meeting providers.")
    } finally {
      setSavingMeetingProviders(false)
    }
  }

  const uploadWorkspaceFile = async (
    file: File,
    options: { category: "general" | "contract"; selectForDraft?: boolean }
  ) => {
    if (!user) return null

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setError(`File type not supported. Please upload a PDF, Word, Excel, PowerPoint, or plain-text file.`)
      return null
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("File must be smaller than 50 MB.")
      return null
    }

    setError(null)
    setUploading(true)
    setUploadProgress(0)

    try {
      const storage = getStorageInstance()
      const fileName = buildStorageFileName(file.name, user.uid)
      const storagePath = `${WORKSPACE_FILES_STORAGE_PREFIX}/${params.workspaceId}/contracts/${fileName}`
      const storageRef = ref(storage, storagePath)

      // Upload directly from the browser to Firebase Storage
      const uploadTask = uploadBytesResumable(storageRef, file, {
        contentType: file.type,
      })

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snap) => {
            setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100))
          },
          reject,
          resolve
        )
      })

      const downloadUrl = await getDownloadURL(storageRef)

      // Save metadata to Firestore via the API route
      const res = await apiFetch<{ file: Record<string, unknown> }>(
        user,
        `/api/workspaces/${params.workspaceId}/files`,
        {
          method: "POST",
          body: JSON.stringify({
            name: file.name,
            contentType: file.type,
            size: file.size,
            storagePath,
            downloadUrl,
            category: options.category,
          }),
        }
      )

      const newFile = normalizeWorkspaceFile(
        (res.file as { id?: string }).id ?? storagePath,
        res.file
      )
      setFiles((prev) => [newFile, ...prev])
      if (options.selectForDraft) {
        setDraftForm((prev) => ({
          ...prev,
          sourceDocumentIds: Array.from(new Set([...prev.sourceDocumentIds, newFile.id])),
        }))
      }
      setMessage("File uploaded successfully.")
      return newFile
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.")
      return null
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset input so the same file can be re-selected after an error
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (!file) return
    await uploadWorkspaceFile(file, { category: "general" })
  }

  const handleDraftFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (draftFileInputRef.current) draftFileInputRef.current.value = ""
    if (!file) return
    await uploadWorkspaceFile(file, { category: "contract", selectForDraft: true })
  }

  const handleDeleteFile = async (fileId: string) => {
    if (!user) return
    try {
      await apiFetch(user, `/api/workspaces/${params.workspaceId}/files?fileId=${fileId}`, {
        method: "DELETE",
      })
      setFiles((prev) => prev.filter((f) => f.id !== fileId))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete file.")
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!workspace) return null

  return (
    <AppShell
      eyebrow="Workspace"
      title={workspace.name}
      description={`${projectCards.length} child project${projectCards.length !== 1 ? "s" : ""} · ${members.length} member${members.length !== 1 ? "s" : ""} · ${workspace.repos.length} repo${workspace.repos.length !== 1 ? "s" : ""}`}
      nav={[
        { href: "/dashboard", label: "Workspaces" },
        { href: `/workspace/${workspace.id}`, label: workspace.name, active: true },
      ]}
      actions={
        <Button variant="outline" onClick={async () => { await signOut(); router.replace("/login") }}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      }
    >
      {error && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}
      <Dialog
        open={Boolean(insufficientExpense)}
        onOpenChange={(open) => {
          if (!open) setInsufficientExpense(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Insufficient Escrow Reserves</DialogTitle>
            <DialogDescription>
              Your active retainer balance cannot cover this allocation utility. Please
              load funds into your account below.
            </DialogDescription>
          </DialogHeader>
          {insufficientExpense ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <p className="font-semibold">{insufficientExpense.source}</p>
              <p className="mt-1">
                Required: {currencyFormatter.format(insufficientExpense.amount)} · Available:{" "}
                {currencyFormatter.format(paymentData?.retainerBalance ?? 0)}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setInsufficientExpense(null)}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={() => {
                setInsufficientExpense(null)
                setActiveTab("payments")
              }}
            >
              Load Funds
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 flex w-full max-w-full justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-2xl sm:flex-wrap sm:overflow-visible">
          <TabsTrigger value="projects">
            <Target className="mr-2 h-4 w-4" />
            Projects
            {projectCards.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {projectCards.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="contracts">
            <FileText className="mr-2 h-4 w-4" />
            Contracts
            {contracts.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {contracts.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="payments">
            <CreditCard className="mr-2 h-4 w-4" />
            Retainer
          </TabsTrigger>
          {!HIDDEN_WORKSPACE_TABS.has("deliverables") ? (
            <TabsTrigger value="deliverables">
              <CheckCircle className="mr-2 h-4 w-4" />
              Deliverables
            </TabsTrigger>
          ) : null}
          {!HIDDEN_WORKSPACE_TABS.has("correspondence") ? (
            <TabsTrigger value="correspondence">
              <MessageSquare className="mr-2 h-4 w-4" />
              Correspondence
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="team">
            <Users className="mr-2 h-4 w-4" />
            Team
          </TabsTrigger>
          {!HIDDEN_WORKSPACE_TABS.has("projections") ? (
            <TabsTrigger value="projections">
              <BarChart3 className="mr-2 h-4 w-4" />
              Audit
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="repos">
            <Github className="mr-2 h-4 w-4" />
            Repos
          </TabsTrigger>
          <TabsTrigger value="vercel">
            <Server className="mr-2 h-4 w-4" />
            Hosting
          </TabsTrigger>
          <TabsTrigger value="files">
            <UploadCloud className="mr-2 h-4 w-4" />
            Files
            {files.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {files.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Child Projects ── */}
        <TabsContent value="projects">
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                Projects
              </h2>
              <HelpMark text="Project cards are multi-asset containers. Switch the selector to view code delivery, participant cohorts, transportation assets, or property locations without exposing irrelevant technical strings." />
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {projectCards.length === 0 ? (
                <Card className="md:col-span-2 xl:col-span-3">
                  <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                    <Target className="mb-3 h-8 w-8 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-600">No child projects linked yet.</p>
                    <p className="mt-1 max-w-xl text-xs text-slate-400">
                      ReadyAimGo child projects tied to this workspace will appear here as separate execution assets.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                projectCards.map((project) => {
                  const url = projectUrl(project)
                  const repositoryLabel = projectRepositoryLabel(project)
                  const repositoryUrl = projectRepositoryUrl(project)
                  const projectMembers = membersForProject(project, members)
                  const assetType =
                    projectTypeOverrides[project.id] ??
                    parseAssetProjectType(project.assetProjectType ?? project.projectType)
                  return (
                    <Card
                      key={project.id}
                      className="flex h-full flex-col border-border bg-white/85 shadow-sm transition hover:border-primary/30 hover:shadow-md"
                    >
                      <CardHeader className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <CardTitle className="truncate text-lg">{projectTitle(project)}</CardTitle>
                            <CardDescription className="mt-1">
                              Business Reference: {workspaceBusinessReference(workspace)}
                            </CardDescription>
                          </div>
                          <select
                            value={assetType}
                            onChange={(event) =>
                              setProjectTypeOverrides((prev) => ({
                                ...prev,
                                [project.id]: event.target.value as AssetProjectType,
                              }))
                            }
                            className="h-8 shrink-0 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                            title="Project asset type"
                          >
                            {ASSET_PROJECT_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-1 flex-col">
                        <p className="min-h-16 text-sm leading-6 text-slate-600">
                          {projectSummary(project)}
                        </p>

                        {assetType === "webdev" ? (
                          <>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Badge variant="secondary" className="gap-1">
                                <Github className="h-3 w-3" />
                                {projectCommitLabel(project)}
                              </Badge>
                              {project.vercelProjectId ? (
                                <Badge variant="secondary" className="gap-1">
                                  <Server className="h-3 w-3" />
                                  Vercel
                                </Badge>
                              ) : null}
                            </div>

                            <div className="mt-4 grid gap-2 rounded-2xl border border-border bg-slate-50/70 p-3 text-xs">
                              <div className="flex items-start justify-between gap-3">
                                <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">
                                  Repository
                                </span>
                                {repositoryUrl ? (
                                  <a
                                    href={repositoryUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="min-w-0 truncate text-right font-semibold text-slate-700 hover:text-primary"
                                  >
                                    {repositoryLabel}
                                  </a>
                                ) : (
                                  <span className="text-right font-semibold text-slate-500">
                                    {repositoryLabel}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-start justify-between gap-3">
                                <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">
                                  Live URL
                                </span>
                                {url ? (
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="min-w-0 truncate text-right font-semibold text-slate-700 hover:text-primary"
                                  >
                                    {url.replace(/^https?:\/\//, "")}
                                  </a>
                                ) : (
                                  <span className="font-semibold text-slate-500">Not deployed</span>
                                )}
                              </div>
                              <div className="flex items-start justify-between gap-3">
                                <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">
                                  Branch / Commit
                                </span>
                                <span className="text-right font-semibold text-slate-700">
                                  {project.branch ? `${project.branch} / ` : ""}
                                  {projectCommitLabel(project)}
                                </span>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {repositoryUrl ? (
                                <a href={repositoryUrl} target="_blank" rel="noreferrer">
                                  <Badge variant="secondary" className="gap-1 hover:bg-slate-100">
                                    <Github className="h-3 w-3" />
                                    Git
                                  </Badge>
                                </a>
                              ) : null}
                              {url ? (
                                <a href={url} target="_blank" rel="noreferrer">
                                  <Badge variant="secondary" className="gap-1 hover:bg-slate-100">
                                    <ExternalLink className="h-3 w-3" />
                                    Live
                                  </Badge>
                                </a>
                              ) : null}
                            </div>
                          </>
                        ) : null}

                        {assetType === "participant" ? (
                          <div className="mt-4 rounded-2xl border border-border bg-slate-50/70 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              Candidate Cohort Registry
                            </p>
                            <div className="mt-3 grid gap-2">
                              {PROJECT_ROLE_ORDER.map((role) => {
                                const roleMembers = projectMembers.filter((member) => member.role === role)
                                return (
                                  <button
                                    key={role}
                                    type="button"
                                    onClick={() => setDirectorySelection({ role, projectId: project.id })}
                                    className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-left transition hover:bg-primary/5"
                                  >
                                    <span className="text-xs font-semibold text-slate-700">
                                      {roleDisplayLabel(role)}
                                    </span>
                                    <span className="flex -space-x-1">
                                      {roleMembers.slice(0, 4).map((member) => (
                                        <span
                                          key={member.uid}
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white bg-slate-200 text-[10px] font-bold text-slate-700"
                                        >
                                          {memberInitial(member)}
                                        </span>
                                      ))}
                                      <span className="ml-2 text-xs font-semibold text-slate-500">
                                        {roleMembers.length}
                                      </span>
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ) : null}

                        {assetType === "transportation" ? (
                          <div className="mt-4 rounded-2xl border border-border bg-slate-50/70 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              Fleet Tracking Log
                            </p>
                            <div className="mt-3 grid gap-2">
                              {fleetIdsForProject(project).map((fleetId, index) => (
                                <div key={fleetId} className="rounded-xl bg-white px-3 py-2">
                                  <p className="text-xs font-semibold text-slate-800">{fleetId}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    Mileage tracked: {((project.mileageTotal ?? 0) + index * 125).toLocaleString("en-US")} mi
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {assetType === "real-estate" ? (
                          <div className="mt-4 rounded-2xl border border-border bg-slate-50/70 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              Portfolio Property Grid
                            </p>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {propertyLocationsForProject(project).map((location, index) => (
                                <div key={`${location.label}-${index}`} className="rounded-xl bg-white px-3 py-2">
                                  <p className="text-xs font-semibold text-slate-800">
                                    {location.label || `Property ${index + 1}`}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {(location.latitude ?? 0).toFixed(4)}, {(location.longitude ?? 0).toFixed(4)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {assetType !== "participant" ? (
                          <div className="mt-auto pt-5">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              Directory
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {PROJECT_ROLE_ORDER.map((role) => {
                                const roleMembers = projectMembers.filter((member) => member.role === role)
                                if (roleMembers.length === 0) return null
                                return (
                                  <button
                                    key={role}
                                    type="button"
                                    onClick={() =>
                                      setDirectorySelection({ role, projectId: project.id })
                                    }
                                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                                  >
                                    {roleDisplayLabel(role)} {roleMembers.length}
                                  </button>
                                )
                              })}
                              {projectMembers.length === 0 ? (
                                <span className="rounded-full border border-dashed border-slate-200 px-3 py-1 text-xs font-semibold text-slate-400">
                                  no assignments
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  )
                })
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Deliverables ── */}
        <TabsContent value="deliverables">
          <Card>
            <CardHeader>
              <CardTitle>Deliverable Schedule</CardTitle>
              <CardDescription>
                Account-wide deliverables aggregated across child projects.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(paymentData?.deliverables ?? []).length === 0 ? (
                <div className="rounded-2xl border border-border/60 bg-slate-50/60 px-6 py-10 text-center">
                  <CheckCircle className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600">No open deliverables.</p>
                  <p className="mt-1 text-xs text-slate-400">Paid and upcoming deliverables will be grouped here by project.</p>
                </div>
              ) : (
                paymentData!.deliverables.map((deliverable) => (
                  <div key={deliverable.id} className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-white/80 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{deliverable.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{deliverable.description}</p>
                      {deliverable.projectId ? (
                        <p className="mt-1 font-mono text-[11px] text-slate-400">{deliverable.projectId}</p>
                      ) : null}
                    </div>
                    <Badge variant={deliverable.status === "paid" ? "default" : "secondary"}>
                      {deliverable.status}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Correspondence ── */}
        <TabsContent value="correspondence">
          <Card>
            <CardHeader>
              <CardTitle>Account Correspondence</CardTitle>
              <CardDescription>
                Email and calendar signals scoped to owner/developer workspace roles.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl border border-border bg-white/80 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <CalendarDays className="h-4 w-4" />
                      Meeting provider matrix
                    </p>
                    <p className="text-xs text-slate-500">Google Meet defaults for Google sign-in; Outlook/Teams, Zoom, and Messenger can override through workspace or raCommand settings.</p>
                  </div>
                  {canManageWorkspace ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void saveMeetingProviders()}
                      disabled={savingMeetingProviders}
                    >
                      {savingMeetingProviders ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                      Save Providers
                    </Button>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {meetingProviders.map((provider) => (
                    <div key={provider.id} className="space-y-2 rounded-xl bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <input
                            type="checkbox"
                            checked={provider.enabled}
                            disabled={!canManageWorkspace}
                            onChange={(event) =>
                              setMeetingProviders((prev) =>
                                prev.map((item) =>
                                  item.id === provider.id
                                    ? { ...item, enabled: event.target.checked }
                                    : item
                                )
                              )
                            }
                          />
                          {provider.label}
                        </label>
                        <label className="flex items-center gap-2 text-xs text-slate-500">
                          <input
                            type="radio"
                            checked={provider.isDefault}
                            disabled={!canManageWorkspace || !provider.enabled}
                            onChange={() =>
                              setMeetingProviders((prev) =>
                                prev.map((item) => ({
                                  ...item,
                                  isDefault: item.id === provider.id,
                                }))
                              )
                            }
                          />
                          Default
                        </label>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          placeholder="Account email"
                          value={provider.accountEmail ?? ""}
                          disabled={!canManageWorkspace}
                          onChange={(event) =>
                            setMeetingProviders((prev) =>
                              prev.map((item) =>
                                item.id === provider.id
                                  ? { ...item, accountEmail: event.target.value }
                                  : item
                              )
                            )
                          }
                        />
                        <Input
                          placeholder="Calendar ID"
                          value={provider.calendarId ?? ""}
                          disabled={!canManageWorkspace}
                          onChange={(event) =>
                            setMeetingProviders((prev) =>
                              prev.map((item) =>
                                item.id === provider.id
                                  ? { ...item, calendarId: event.target.value }
                                  : item
                              )
                            )
                          }
                        />
                        <Input
                          placeholder="Webhook URL"
                          value={provider.webhookUrl ?? ""}
                          disabled={!canManageWorkspace}
                          onChange={(event) =>
                            setMeetingProviders((prev) =>
                              prev.map((item) =>
                                item.id === provider.id
                                  ? { ...item, webhookUrl: event.target.value }
                                  : item
                              )
                            )
                          }
                        />
                        <Input
                          placeholder="Meeting base URL"
                          value={provider.meetingBaseUrl ?? ""}
                          disabled={!canManageWorkspace}
                          onChange={(event) =>
                            setMeetingProviders((prev) =>
                              prev.map((item) =>
                                item.id === provider.id
                                  ? { ...item, meetingBaseUrl: event.target.value }
                                  : item
                              )
                            )
                          }
                        />
                      </div>
                      <p className="text-[11px] font-medium text-slate-400">Source: {provider.source}</p>
                    </div>
                  ))}
                </div>
              </div>

              {correspondenceLocked ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Correspondence is private to owner and developer roles.
                </div>
              ) : correspondence.length === 0 ? (
                <div className="rounded-2xl border border-border/60 bg-slate-50/60 px-6 py-10 text-center">
                  <MessageSquare className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600">No correspondence synced yet.</p>
                </div>
              ) : (
                correspondence.slice(0, 30).map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="rounded-2xl border border-border bg-white/80 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.subject || item.title || "(No title)"}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.kind === "email" ? item.from : item.attendees?.join(", ")}
                        </p>
                      </div>
                      <Badge variant="secondary">{item.kind}</Badge>
                    </div>
                    {item.snippet ? <p className="mt-2 line-clamp-2 text-sm text-slate-500">{item.snippet}</p> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Projections & Audit ── */}
        <TabsContent value="projections">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Project Load</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-slate-900">{childProjects.length}</p>
                <p className="mt-1 text-xs text-slate-500">Active child asset records</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Open Deliverables</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-slate-900">{paymentData?.deliverables.length ?? 0}</p>
                <p className="mt-1 text-xs text-slate-500">Pending value checkpoints</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4" />
                  Security Posture
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-semibold text-emerald-700">Workspace role gate active</p>
                <p className="mt-1 text-xs text-slate-500">Data reads require canonical workspace membership.</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── GitHub Repos ── */}
        <TabsContent value="repos">
          <Card>
            <CardHeader>
              <CardTitle>GitHub Repositories</CardTitle>
              <CardDescription>
                Add repositories to this workspace. Attached repos appear at the top.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 rounded-2xl border border-border bg-slate-50/70 p-4 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-900">
                    GitHub owner or organization
                  </label>
                  <Input
                    placeholder="ezrarag, readyaimgo, or client-org"
                    value={workspace.githubOrg ?? ""}
                    disabled={!canManageWorkspace}
                    onChange={(event) =>
                      setWorkspace((prev) =>
                        prev ? { ...prev, githubOrg: event.target.value } : prev
                      )
                    }
                  />
                  <p className="text-xs text-slate-500">
                    Current source: {githubMeta?.owner || "global GitHub account"}
                    {githubMeta?.tokenEnv ? ` via ${githubMeta.tokenEnv}` : ""}
                  </p>
                </div>
                {canManageWorkspace ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveConnectors()}
                    disabled={savingConnectors}
                  >
                    {savingConnectors ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Github className="mr-2 h-4 w-4" />
                    )}
                    Save Connector
                  </Button>
                ) : null}
              </div>

              {githubMeta?.warning ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {githubMeta.warning}
                </div>
              ) : null}

              <Input
                placeholder="Search repos by name, language, or description…"
                value={repoQuery}
                onChange={(e) => setRepoQuery(e.target.value)}
                className="mb-2"
              />

              {allRepos.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-white/70 p-6 text-sm text-slate-600">
                  No GitHub repositories are available from the configured token and owner.
                </div>
              ) : null}

              {/* Attached repos first */}
              {workspace.repos.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Attached ({workspace.repos.length})
                  </p>
                  {workspace.repos.map((repo) => (
                    <RepoCard
                      key={repo.id}
                      repo={repo}
                      attached
                      onToggle={() => void toggleRepo(repo)}
                      busy={reposBusy.has(repo.id)}
                    />
                  ))}
                </div>
              )}

              {/* Available repos */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Available ({filteredRepos.filter((r) => !attachedRepoIds.has(r.id)).length})
                </p>
                {filteredRepos
                  .filter((r) => !attachedRepoIds.has(r.id))
                  .map((repo) => (
                    <RepoCard
                      key={repo.id}
                      repo={repo}
                      attached={false}
                      onToggle={() => void toggleRepo(repo)}
                      busy={reposBusy.has(repo.id)}
                    />
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Hosting & Infrastructure ── */}
        <TabsContent value="vercel">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Hosting & Infrastructure
                    <HelpMark text="Cards appear only when real evidence exists — from email correspondence, admin records, or connected deployments. Nothing is shown by default." />
                  </CardTitle>
                  <CardDescription>
                    Evidence-backed service health, domain status, and connected deployment assets.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleAnalyzeHosting({ force: true })}
                  disabled={analyzingHosting}
                >
                  {analyzingHosting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {analyzingHosting ? "Scanning…" : "Refresh Hosting Records"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {vercelMeta?.warning ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {vercelMeta.warning}
                </div>
              ) : null}
              {canManageWorkspace && hostingDiagnostics?.warnings.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  <p className="font-semibold">Vercel scan diagnostics</p>
                  <p className="mt-1">
                    Attached projects: {hostingDiagnostics.attachedVercelProjects} · Project domains:{" "}
                    {hostingDiagnostics.projectDomainsFound} · Account domains:{" "}
                    {hostingDiagnostics.accountDomainsFound} · Matched:{" "}
                    {hostingDiagnostics.matchedDomains} · Repo matches:{" "}
                    {hostingDiagnostics.repoMatchedVercelProjects ?? 0}
                  </p>
                  <p className="mt-1">{hostingDiagnostics.warnings.join(" ")}</p>
                </div>
              ) : null}

              {canManageWorkspace ? (
                <div className="rounded-2xl border border-border bg-slate-50/70 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Billing Evidence</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Paste a Zoho, Namecheap, or renewal email to source the due date and amount for this workspace.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setBillingEvidenceOpen((value) => !value)}
                    >
                      {billingEvidenceOpen ? "Hide Evidence" : "Add Billing Evidence"}
                    </Button>
                  </div>
                  {billingEvidenceOpen ? (
                    <div className="mt-4 space-y-3">
                      <Textarea
                        value={billingEvidenceText}
                        onChange={(event) => setBillingEvidenceText(event.target.value)}
                        placeholder="Paste the invoice or renewal email here. Include the domain, amount, and due or renewal date when available."
                        className="min-h-[140px] bg-white"
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-slate-500">
                          Saved as source-backed correspondence, then analyzed against the attached Vercel domain.
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void saveBillingEvidence()}
                          disabled={savingBillingEvidence || analyzingHosting || !billingEvidenceText.trim()}
                        >
                          {savingBillingEvidence || analyzingHosting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="mr-2 h-4 w-4" />
                          )}
                          Save & Analyze
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* ── Section 1: Hosting Status ── */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Hosting Status
                </p>

                {/* Evidence-driven provider cards */}
                {analyzingHosting && hostingStatusCards.length === 0 ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-border bg-slate-50/70 px-4 py-5">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    <p className="text-xs text-slate-500">Scanning hosting records…</p>
                  </div>
                ) : hostingStatusCards.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-slate-50/70 px-6 py-8 text-center">
                    <Globe2 className="mx-auto mb-3 h-7 w-7 text-slate-300" />
                    <p className="text-sm font-medium text-slate-600">No hosting records are attached yet.</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Search a domain below, or click Refresh Hosting Records to check for existing services.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {hostingStatusCards.map(({ link, expense, status }) => (
                      <div
                        key={link.id}
                        className={[
                          "rounded-2xl border bg-white/80 px-4 py-3",
                          expense?.criticalSystemFlag
                            ? "border-rose-300 bg-rose-50/60"
                            : expense?.status === "unpaid"
                              ? "border-amber-200 bg-amber-50/50"
                              : "border-border",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">
                              {infraProviderLabel(link)}
                            </p>
                            {link.domain ? (
                              <p className="mt-0.5 truncate text-xs text-slate-500">{link.domain}</p>
                            ) : null}
                          </div>
                          <Badge variant={infraStatusVariant(status)} className="shrink-0">
                            {infraStatusLabel(status)}
                          </Badge>
                        </div>
                        {expense?.amount || link.amount ? (
                          <p className="mt-2 text-sm font-semibold text-slate-900">
                            {currencyFormatter.format(expense?.amount ?? link.amount ?? 0)}
                            {expense?.dueDate || link.dueDate ? (
                              <span className="ml-1 text-xs font-normal text-slate-500">
                                due{" "}
                                {formatSafeDate(expense?.dueDate ?? link.dueDate, {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-400">
                          {expense?.evidenceSnippet ?? hostingEvidenceLabel(link)}
                        </p>
                        {expense?.daysOverdue && expense.daysOverdue > 0 ? (
                          <p className="mt-1 text-[11px] font-semibold leading-4 text-rose-600">
                            Overdue by {expense.daysOverdue} day{expense.daysOverdue === 1 ? "" : "s"}
                          </p>
                        ) : hostingExpirationLabel(link) ? (
                          <p className="mt-1 text-[11px] leading-4 text-slate-500">
                            {hostingExpirationLabel(link)}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}

                {expenses.length > 0 ? (
                  <div className="space-y-2">
                    {expenses.map((expense) => (
                      <div
                        key={expense.id}
                        className={[
                          "rounded-xl border bg-slate-50 p-3",
                          expense.criticalSystemFlag
                            ? "border-rose-300 bg-rose-50/70"
                            : expense.status === "paid"
                              ? "border-emerald-100 bg-emerald-50/50"
                              : "border-border",
                        ].join(" ")}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold text-slate-900">
                                {expense.source}
                              </p>
                              <Badge variant={expense.status === "paid" ? "success" : "warning"}>
                                {expense.status}
                              </Badge>
                              {expense.criticalSystemFlag ? (
                                <Badge variant="danger">Critical</Badge>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {expense.description}
                              {expense.dueDate
                                ? ` · Due ${formatSafeDate(expense.dueDate, { month: "short", day: "numeric", year: "numeric" })}`
                                : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <p className="text-base font-bold text-slate-900">
                              {currencyFormatter.format(expense.amount)}
                            </p>
                            {expense.status === "unpaid" ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void authorizeExpenseDisbursement(expense.id)}
                                disabled={
                                  currentMember?.role !== "owner" ||
                                  authorizingExpenseId === expense.id
                                }
                              >
                                {authorizingExpenseId === expense.id ? (
                                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                ) : null}
                                Clear via Retainer
                              </Button>
                            ) : (
                              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                                Cleared
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    No infrastructure expenses recorded yet.
                  </p>
                )}
              </div>

              {/* ── Section 2: Domain ── */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Domain
                </p>
                {(() => {
                  // Prefer infrastructure link evidence; fall back to expenses for payment CTA
                  const domainLinks = infrastructureLinks.filter((l) => l.type === "domain")
                  const domainExpenses = expenses.filter(
                    (e) =>
                      e.serviceProvider === "Namecheap" &&
                      e.billingCycleType === "Domain Renewal"
                  )

                  if (domainLinks.length > 0) {
                    return (
                      <div className="space-y-2">
                        {domainLinks.map((dl) => {
                          // Find a matching unpaid expense for the payment CTA
                          const matchingExpense = domainExpenses.find(
                            (e) =>
                              e.status === "unpaid" &&
                              (!dl.domain || e.source.toLowerCase().includes(dl.domain.toLowerCase()))
                          )
                          return (
                            <div
                              key={dl.id}
                              className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-white/80 px-4 py-3"
                            >
                              <div>
                                <p className="text-sm font-semibold text-slate-900">
                                  {dl.domain ?? dl.evidenceSnippet ?? "Domain"}
                                </p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {domainStatusDescription(dl)}
                                </p>
                              </div>
                              <div className="flex items-center gap-3">
                                {dl.amount ? (
                                  <p className="text-sm font-semibold text-slate-900">
                                    {currencyFormatter.format(dl.amount)}
                                  </p>
                                ) : null}
                                {matchingExpense ? (
                                  <Button
                                    size="sm"
                                    onClick={() => void authorizeExpenseDisbursement(matchingExpense.id)}
                                    disabled={
                                      currentMember?.role !== "owner" ||
                                      authorizingExpenseId === matchingExpense.id
                                    }
                                  >
                                    {authorizingExpenseId === matchingExpense.id ? (
                                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                    ) : null}
                                    Pay to Keep Active
                                  </Button>
                                ) : (
                                  <Badge variant={infraStatusVariant(dl.status)}>
                                    {infraStatusLabel(dl.status)}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  }

                  // No domain link — show domain search
                  return (
                    <div className="space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          placeholder="e.g. yourbusiness.com — search for a domain to request"
                          value={domainQuery}
                          onChange={(e) => setDomainQuery(e.target.value)}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!domainQuery.trim()}
                          onClick={() => {
                            setMessage(
                              `Domain request for "${domainQuery}" submitted. ReadyAimGo will secure this after payment is confirmed.`
                            )
                            setDomainQuery("")
                          }}
                        >
                          <Globe2 className="mr-2 h-4 w-4" />
                          Request Domain
                        </Button>
                      </div>
                      <p className="text-xs text-slate-500">
                        No domain is currently attached. ReadyAimGo will secure or renew your domain after payment is confirmed.
                      </p>
                    </div>
                  )
                })()}
              </div>

              {/* ── Section 3: Attached Assets ── */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Attached Assets
                </p>

                {workspace.repos.length === 0 && workspace.vercelProjects.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    No deployment assets are linked to this workspace yet.
                  </p>
                ) : null}

                {workspace.repos.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {workspace.repos.map((repo) => (
                      <a
                        key={repo.id}
                        href={repo.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-xl border border-border bg-white/80 px-3 py-2.5 text-sm font-medium text-slate-700 hover:border-primary/30 hover:text-primary"
                      >
                        <Github className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="truncate">{repo.fullName}</span>
                        <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />
                      </a>
                    ))}
                  </div>
                ) : null}

                {workspace.vercelProjects.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {workspace.vercelProjects.map((p) => (
                      <a
                        key={p.id}
                        href={p.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-xl border border-border bg-white/80 px-3 py-2.5 text-sm font-medium text-slate-700 hover:border-primary/30 hover:text-primary"
                      >
                        <Server className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="truncate">{p.name}</span>
                        {p.url ? (
                          <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />
                        ) : null}
                      </a>
                    ))}
                  </div>
                ) : null}

                <div className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowEcosystemSearch((v) => !v)}
                  >
                    <Server className="mr-2 h-4 w-4" />
                    {showEcosystemSearch ? "Hide" : "Search &"} Connect Assets
                  </Button>
                </div>

                {showEcosystemSearch ? (
                  <div className="space-y-4 rounded-2xl border border-border bg-white/80 p-4">
                    <Input
                      placeholder="Search connected Vercel deployments…"
                      value={vercelQuery}
                      onChange={(e) => setVercelQuery(e.target.value)}
                    />
                    {allVercel.length === 0 ? (
                      <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
                        No Vercel projects available from the configured token and team.
                      </p>
                    ) : null}
                    <div className="space-y-2">
                      {filteredVercel
                        .filter((p) => attachedVercelIds.has(p.id))
                        .map((p) => (
                          <VercelCard
                            key={p.id}
                            project={p}
                            attached
                            onToggle={() => void toggleVercel(p)}
                            busy={reposBusy.has(p.id)}
                          />
                        ))}
                      {filteredVercel
                        .filter((p) => !attachedVercelIds.has(p.id))
                        .map((p) => (
                          <VercelCard
                            key={p.id}
                            project={p}
                            attached={false}
                            onToggle={() => void toggleVercel(p)}
                            busy={reposBusy.has(p.id)}
                          />
                        ))}
                    </div>
                    {canManageWorkspace ? (
                      <div className="flex justify-end border-t border-border pt-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void saveConnectors()}
                          disabled={savingConnectors}
                        >
                          {savingConnectors ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Save Connector
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Contracts ── */}
        <TabsContent value="contracts">
          <div className="space-y-5">
            {/* Draft SOW button row */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {contracts.length === 0
                  ? "No contracts linked yet."
                  : `${contracts.length} contract${contracts.length !== 1 ? "s" : ""}`}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraftForm(DRAFT_FORM_DEFAULTS)
                  setDraftResult(null)
                  setDraftDialogOpen(true)
                }}
              >
                <Sparkles className="mr-2 h-3.5 w-3.5 text-violet-500" />
                Draft scope of work
              </Button>
            </div>

            <div className="rounded-2xl border border-border bg-white/80 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Independent agreement upload</p>
                  <p className="text-xs text-slate-500">Upload external MSAs, SOWs, amendments, or signed files for this workspace.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => draftFileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UploadCloud className="mr-2 h-4 w-4" />
                  )}
                  Upload Agreement
                </Button>
              </div>
              <input
                ref={draftFileInputRef}
                type="file"
                accept={FILE_INPUT_ACCEPT}
                className="sr-only"
                onChange={handleDraftFileChange}
              />
            </div>

            {/* Contract list */}
            {contracts.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-amber-50/40 px-6 py-16 text-center">
                <FileText className="mb-3 h-8 w-8 text-amber-400" />
                <p className="text-sm font-semibold text-slate-700">No contract on file yet.</p>
                <p className="mt-1 text-xs text-slate-500">
                  Contracts linked to this workspace will appear here once they&apos;re created.
                  Use &ldquo;Draft scope of work&rdquo; to generate an AI-assisted starting point.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {contracts.map((contract) => (
                  <ContractCard
                    key={contract.id}
                    contract={contract}
                    onViewDetails={(c) => {
                      setSelectedContract(c)
                      setDetailOpen(true)
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <ContractDetailModal
            contract={selectedContract}
            open={detailOpen}
            onOpenChange={setDetailOpen}
            onStatusUpdated={(id, status) => {
              setContracts((prev) =>
                prev.map((c) => (c.id === id ? { ...c, status } : c))
              )
              setSelectedContract((prev) =>
                prev?.id === id ? { ...prev, status } : prev
              )
            }}
          />

          <Dialog open={draftDialogOpen} onOpenChange={setDraftDialogOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Draft Scope of Work</DialogTitle>
                <DialogDescription>
                  Generate a structured draft from project context. This is a starting
                  point for review, not legal advice.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {drafting ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-800">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    AI Framework Assembly In Progress...
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Project description
                  </label>
                  <Textarea
                    value={draftForm.projectDescription}
                    onChange={(event) =>
                      setDraftForm((prev) => ({
                        ...prev,
                        projectDescription: event.target.value,
                      }))
                    }
                    placeholder="Describe the client, project, business need, and expected outcome."
                    rows={4}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Work already completed
                    </label>
                    <Textarea
                      value={draftForm.completedWork}
                      onChange={(event) =>
                        setDraftForm((prev) => ({
                          ...prev,
                          completedWork: event.target.value,
                        }))
                      }
                      placeholder="Summarize discovery, design, build, data work, reviews, or meetings already completed."
                      rows={4}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Upcoming work
                    </label>
                    <Textarea
                      value={draftForm.upcomingWork}
                      onChange={(event) =>
                        setDraftForm((prev) => ({
                          ...prev,
                          upcomingWork: event.target.value,
                        }))
                      }
                      placeholder="List expected next steps, implementation, revisions, QA, training, or support."
                      rows={4}
                    />
                  </div>
                </div>

                <div className="space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <label className="text-sm font-medium text-slate-700">
                    Inline AI revision assistant
                  </label>
                  <Textarea
                    value={draftForm.revisionRequest}
                    onChange={(event) =>
                      setDraftForm((prev) => ({
                        ...prev,
                        revisionRequest: event.target.value,
                      }))
                    }
                    placeholder="Ask for a revision. Admin workspace rules, boilerplate, and rulesets will be appended server-side."
                    rows={3}
                  />
                </div>

                {files.filter((file) => file.category === "contract").length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">Agreement files for context</p>
                    <div className="max-h-36 space-y-2 overflow-y-auto rounded-2xl border border-border p-2">
                      {files
                        .filter((file) => file.category === "contract")
                        .map((file) => (
                          <label key={file.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={draftForm.sourceDocumentIds.includes(file.id)}
                              onChange={(event) =>
                                setDraftForm((prev) => ({
                                  ...prev,
                                  sourceDocumentIds: event.target.checked
                                    ? Array.from(new Set([...prev.sourceDocumentIds, file.id]))
                                    : prev.sourceDocumentIds.filter((id) => id !== file.id),
                                }))
                              }
                            />
                            <span className="truncate">{file.name}</span>
                          </label>
                        ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Payment terms
                    </label>
                    <Textarea
                      value={draftForm.paymentTerms}
                      onChange={(event) =>
                        setDraftForm((prev) => ({
                          ...prev,
                          paymentTerms: event.target.value,
                        }))
                      }
                      placeholder="Retainer, milestone, monthly, due-on-signing, or custom payment expectations."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Constraints and notes
                    </label>
                    <Textarea
                      value={draftForm.constraints}
                      onChange={(event) =>
                        setDraftForm((prev) => ({
                          ...prev,
                          constraints: event.target.value,
                        }))
                      }
                      placeholder="Known exclusions, dependencies, deadlines, client responsibilities, or approval needs."
                      rows={3}
                    />
                  </div>
                </div>

                {draftResult ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Draft saved: {draftResult.title}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                  AI-generated drafts require human and legal review before execution.
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraftDialogOpen(false)}
                  disabled={drafting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleDraftGenerate}
                  disabled={drafting || !draftForm.projectDescription.trim()}
                >
                  {drafting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {drafting ? "AI Framework Assembly In Progress..." : "Generate Draft"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ── Files ── */}
        <TabsContent value="files">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Uploaded Files</CardTitle>
                <CardDescription>
                  PDFs, Word docs, spreadsheets, and other documents shared in this workspace.
                  Max 50 MB per file.
                </CardDescription>
              </div>
              <div>
                {/* Hidden file input — triggered by the button below */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={FILE_INPUT_ACCEPT}
                  className="sr-only"
                  onChange={handleFileChange}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UploadCloud className="mr-2 h-4 w-4" />
                  )}
                  {uploading ? "Uploading…" : "Upload File"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Upload progress bar */}
              {uploadProgress !== null && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Uploading…</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Empty state */}
              {files.length === 0 && uploadProgress === null && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-slate-50/60 px-6 py-14 text-center">
                  <UploadCloud className="mb-3 h-8 w-8 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600">No files yet.</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Upload a PDF, Word document, spreadsheet, or plain-text file to get started.
                  </p>
                </div>
              )}

              {/* File list */}
              {files.length > 0 && (
                <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between gap-4 bg-white/80 px-4 py-3 first:rounded-t-2xl last:rounded-b-2xl"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {file.name}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatFileSize(file.size)}
                          {" · "}
                          {new Date(file.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                          {file.uploadedByEmail && (
                            <>
                              {" · "}
                              <span className="text-slate-400">{file.uploadedByEmail}</span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <a
                          href={file.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Download"
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => void handleDeleteFile(file.id)}
                          title="Delete"
                          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Payments ── */}
        <TabsContent value="payments">
          <div className="space-y-6">
            {!paymentData?.clientId ? (
              /* No billing account linked to this workspace */
              <div className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-slate-50/60 px-6 py-16 text-center">
                <CreditCard className="mb-3 h-8 w-8 text-slate-300" />
                <p className="text-sm font-semibold text-slate-600">No billing account linked.</p>
                <p className="mt-1 text-xs text-slate-400">
                  Ask an admin to link a client account to this workspace to enable payments.
                </p>
              </div>
            ) : (
              <>
                {/* ── 1. Billing Summary ─────────────────────────────────── */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        Billing Summary
                        <HelpMark text="Retainers show escrow balance, Stripe receipts, agency-equivalent production value, and ledger drawdowns tied to workspace work." />
                      </CardTitle>
                      <CardDescription>
                        Client account:{" "}
                        <span className="font-semibold text-slate-700">
                          {paymentData.accountOwner?.displayName ||
                            paymentData.accountOwner?.email ||
                            workspace.name}
                        </span>
                      </CardDescription>
                    </div>
                    {paymentData.stripeCustomerId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBillingPortal}
                        disabled={processingPayment}
                      >
                        {processingPayment ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ExternalLink className="mr-2 h-4 w-4" />
                        )}
                        Manage Billing
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="grid gap-4 lg:grid-cols-[1fr_1.2fr_0.8fr]">
                    {/* Current Trust Balance */}
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5">
                      <p className="flex items-center text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                        Total Escrow Retainer Account Balance
                        <InfoTooltip text="Workspace-held retainer balance mirrored from the canonical workspace financial state." />
                      </p>
                      <p className="mt-3 text-4xl font-bold tracking-tight text-slate-950">
                        {currencyFormatter.format(paymentData.retainerBalance)}
                      </p>
                    </div>
                    {/* Carousel: Valuation / Contract Alignment / Hosting Implications */}
                    <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-5">
                      {/* Carousel header */}
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                          {retainerSlide === 0
                            ? "Valuation"
                            : retainerSlide === 1
                              ? "Contract Alignment"
                              : retainerSlide === 2
                                ? "Hosting Implications"
                                : "Build Cost Comparison"}
                        </p>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setRetainerSlide((s) => Math.max(0, s - 1))}
                            disabled={retainerSlide === 0}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-amber-600 transition hover:bg-amber-100 disabled:opacity-30"
                            aria-label="Previous"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <span className="min-w-[28px] text-center text-[10px] font-semibold text-amber-600">
                            {retainerSlide + 1}/4
                          </span>
                          <button
                            type="button"
                            onClick={() => setRetainerSlide((s) => Math.min(3, s + 1))}
                            disabled={retainerSlide === 3}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-amber-600 transition hover:bg-amber-100 disabled:opacity-30"
                            aria-label="Next"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Slide 0 — Valuation */}
                      {retainerSlide === 0 ? (
                        <div className="mt-4 space-y-3">
                          {agencyValuationBenchmarks.length === 0 ? (
                            <div className="rounded-xl bg-white/70 px-3 py-3">
                              <p className="text-xs font-medium leading-5 text-slate-500">
                                No production equity receipts have been calculated yet. Refresh
                                the AI ledger after connecting GitHub or Vercel activity.
                              </p>
                            </div>
                          ) : (
                            agencyValuationBenchmarks.map((item) => (
                              <div key={item.label} className="rounded-xl bg-white/70 px-3 py-2">
                                <p className="flex items-start text-xs font-semibold leading-5 text-slate-800">
                                  <span>{item.label}</span>
                                  <InfoTooltip text={buildLedgerJustificationTooltip(item.entries)} />
                                </p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {currencyFormatter.format(item.value)} aggregated verified
                                  production equity
                                </p>
                              </div>
                            ))
                          )}
                          <div className="border-t border-amber-200/70 pt-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                              Total Equivalent Agency Production Equity Delivered
                            </p>
                            <p className="mt-1 text-xl font-bold text-slate-950">
                              {currencyFormatter.format(totalAgencyProductionEquity)}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {/* Slide 1 — Contract Alignment */}
                      {retainerSlide === 1 ? (
                        <div className="mt-4 space-y-3">
                          {contracts.length === 0 ? (
                            <div className="rounded-xl bg-white/70 px-3 py-3">
                              <p className="text-xs font-medium leading-5 text-slate-500">
                                No contracts are attached to this workspace yet.
                              </p>
                            </div>
                          ) : (
                            contracts.map((contract) => (
                              <div key={contract.id} className="rounded-xl bg-white/70 px-3 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs font-semibold leading-5 text-slate-800">
                                    {contract.title}
                                  </p>
                                  <Badge
                                    variant={
                                      contract.status === "active" || contract.status === "signed"
                                        ? "success"
                                        : contract.status === "expired"
                                          ? "danger"
                                          : "secondary"
                                    }
                                    className="shrink-0 text-[10px]"
                                  >
                                    {contract.status}
                                  </Badge>
                                </div>
                                {contract.monthlyValue > 0 ? (
                                  <p className="mt-0.5 text-xs text-slate-500">
                                    {currencyFormatter.format(contract.monthlyValue)}/mo
                                    {contract.termMonths > 0
                                      ? ` · ${contract.termMonths} month term`
                                      : ""}
                                  </p>
                                ) : null}
                              </div>
                            ))
                          )}
                          <div className="border-t border-amber-200/70 pt-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                              Total Contracted Monthly Value
                            </p>
                            <p className="mt-1 text-xl font-bold text-slate-950">
                              {currencyFormatter.format(
                                contracts.reduce((sum, c) => sum + (c.monthlyValue || 0), 0)
                              )}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {/* Slide 2 — Hosting Implications */}
                      {retainerSlide === 2 ? (
                        <div className="mt-4 space-y-3">
                          {expenses.length === 0 ? (
                            <div className="rounded-xl bg-white/70 px-3 py-3">
                              <p className="text-xs font-medium leading-5 text-slate-500">
                                No hosting or infrastructure expenses are recorded for this
                                workspace.
                              </p>
                            </div>
                          ) : (
                            expenses.map((expense) => (
                              <div key={expense.id} className="rounded-xl bg-white/70 px-3 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs font-semibold leading-5 text-slate-800">
                                    {expense.source}
                                  </p>
                                  <Badge
                                    variant={
                                      expense.status === "paid"
                                        ? "success"
                                        : expense.criticalSystemFlag
                                          ? "danger"
                                          : "warning"
                                    }
                                    className="shrink-0 text-[10px]"
                                  >
                                    {expense.status}
                                  </Badge>
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {currencyFormatter.format(expense.amount)} · {expense.billingCycleType}
                                </p>
                              </div>
                            ))
                          )}
                          <div className="border-t border-amber-200/70 pt-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                              Total Unpaid Hosting Liabilities
                            </p>
                            <p className="mt-1 text-xl font-bold text-slate-950">
                              {currencyFormatter.format(
                                expenses
                                  .filter((e) => e.status === "unpaid")
                                  .reduce((sum, e) => sum + e.amount, 0)
                              )}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {/* Slide 3 — Build Cost Comparison */}
                      {retainerSlide === 3 ? (
                        <div className="mt-4 space-y-3">
                          {[
                            {
                              name: "Squarespace",
                              range: "$23–65 / mo",
                              scope: "Partial",
                              notes: "Templates only. No custom logic, no API integrations, no ownership.",
                              variant: "secondary" as const,
                            },
                            {
                              name: "WordPress",
                              range: "$25–200+ / mo",
                              scope: "Limited",
                              notes: "Plugin-dependent. Maintenance overhead, security risk, no product roadmap.",
                              variant: "secondary" as const,
                            },
                            {
                              name: "ReadyAimGo",
                              range: "$50 / mo",
                              scope: "Full scope",
                              notes: "Custom-built, client-owned, hosted, maintained, and continuously delivered.",
                              variant: "success" as const,
                            },
                          ].map((row) => (
                            <div key={row.name} className="rounded-xl bg-white/70 px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-semibold leading-5 text-slate-800">
                                  {row.name}
                                </p>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <Badge variant={row.variant} className="text-[10px]">
                                    {row.scope}
                                  </Badge>
                                  <span className="text-[11px] font-semibold text-slate-700">
                                    {row.range}
                                  </span>
                                </div>
                              </div>
                              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                                {row.notes}
                              </p>
                            </div>
                          ))}
                          <div className="border-t border-amber-200/70 pt-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                              Your retainer covers
                            </p>
                            <p className="mt-1 text-[11px] leading-5 text-slate-600">
                              Custom development, hosting, domain management, and continuous delivery
                              — at a fraction of what comparable agency work costs.
                            </p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    {/* Stripe Receipts */}
                    <div className="rounded-2xl border border-border bg-white/80 p-5">
                      <p className="flex items-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Stripe Receipts
                        <InfoTooltip text="Total client payments recorded through the value profile ledger." />
                      </p>
                      <p className="mt-3 text-2xl font-bold text-slate-900">
                        {currencyFormatter.format(paymentData.totalPaid)}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* ── 2. Make a Payment (promoted — second priority) ────── */}
                <Card>
                  <CardHeader>
                    <CardTitle>Make a Payment</CardTitle>
                    <CardDescription>
                      Pay a custom retainer amount or one-time value investment.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div className="relative flex-1">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                          $
                        </span>
                        <Input
                          type="number"
                          min="1"
                          step="0.01"
                          placeholder="0.00"
                          value={customPayAmount}
                          onChange={(e) => setCustomPayAmount(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleValuePayment()
                          }}
                          className="pl-7"
                          disabled={processingPayment}
                        />
                      </div>
                      <Button
                        onClick={handleValuePayment}
                        disabled={processingPayment || !customPayAmount}
                      >
                        {processingPayment ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CreditCard className="mr-2 h-4 w-4" />
                        )}
                        {processingPayment ? "Redirecting…" : "Pay Now"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* ── 3. Deliverables Due (conditional — data only) ─────── */}
                {paymentData.deliverables.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Deliverables Due</CardTitle>
                      <CardDescription>
                        Outstanding deliverables awaiting payment.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {paymentData.deliverables.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-white/80 px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-900">{d.title}</p>
                            {d.description && (
                              <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                                {d.description}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="text-sm font-semibold text-slate-900">
                              ${d.amount.toLocaleString()}
                            </span>
                            <Button
                              size="sm"
                              onClick={() => void handleDeliverablePayment(d.id)}
                              disabled={payingDeliverableId === d.id || processingPayment}
                            >
                              {payingDeliverableId === d.id ? (
                                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                              ) : null}
                              Pay
                            </Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* ── 4 & 5. Ledger + History — conditionally rendered ──── */}
                {/* When BOTH arrays are empty, show a single unified placeholder
                    instead of two skeleton cards cluttering the viewport.       */}
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                      <CardTitle className="flex items-center">
                        AI Git Commit Ledger
                        <InfoTooltip text="Analyzes connected GitHub, Vercel, and workspace project signals into trust-accounting receipt rows." />
                      </CardTitle>
                      <CardDescription>
                        Generate auto-receipts from the latest connected development activity.
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleAnalyzeLedger()}
                      disabled={analyzingLedger}
                    >
                      {analyzingLedger ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-4 w-4" />
                      )}
                      {analyzingLedger ? "Analyzing" : "Refresh AI Ledger"}
                    </Button>
                  </CardHeader>
                </Card>

                {paymentData.ledger.length === 0 && paymentData.payments.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
                      <Receipt className="mb-3 h-8 w-8 text-slate-300" />
                      <p className="text-sm font-semibold text-slate-700">
                        Your workspace trust ledger is active.
                      </p>
                      <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                        Transaction records, deductions, and payment histories will populate
                        here as work milestones are executed.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {/* ── Ledger Drawdown Statements (hidden when empty) ─── */}
                    {paymentData.ledger.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center">
                            Ledger Drawdown Statements
                            <InfoTooltip text="A historical ledger tracking trust-style drawdowns recorded against this workspace as work milestones are authorized and executed." />
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-hidden rounded-2xl border border-border">
                            <table className="min-w-full divide-y divide-border text-left text-sm">
                              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                <tr>
                                  <th className="px-4 py-3">Date</th>
                                  <th className="px-4 py-3">Statement</th>
                                  <th className="px-4 py-3">Actor Role</th>
                                  <th className="px-4 py-3 text-right">Deduction</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border bg-white/85">
                                {paymentData.ledger.map((entry) => (
                                  <tr key={entry.id}>
                                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                                      {entry.createdAt
                                        ? new Date(entry.createdAt).toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                          })
                                        : "Pending"}
                                    </td>
                                    <td className="px-4 py-3 font-medium text-slate-900">
                                      {entry.description}
                                    </td>
                                    <td className="px-4 py-3 text-slate-600">{entry.actorRole}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">
                                      Deducted {currencyFormatter.format(Math.abs(entry.deductionAmount))}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* ── Payment History / Stripe Receipts (hidden when empty) */}
                    {paymentData.payments.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center">
                            Payment History
                            <InfoTooltip text="A historical ledger tracking all Stripe receipts and value-profile payment records associated with this workspace account." />
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                            {paymentData.payments.map((p) => (
                              <div
                                key={p.id}
                                className="flex items-center justify-between gap-4 bg-white/80 px-4 py-3 first:rounded-t-2xl last:rounded-b-2xl"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-slate-900">
                                    {p.description || "Payment"}
                                  </p>
                                  <p className="mt-0.5 text-xs text-slate-400">
                                    {p.createdAt
                                      ? new Date(p.createdAt).toLocaleDateString("en-US", {
                                          month: "short",
                                          day: "numeric",
                                          year: "numeric",
                                        })
                                      : "—"}
                                    {p.clientEmail ? ` · ${p.clientEmail}` : ""}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-3">
                                  <span className="text-sm font-semibold text-slate-900">
                                    ${p.amount.toLocaleString()}
                                  </span>
                                  <span
                                    className={[
                                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                      p.status === "succeeded"
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "bg-slate-100 text-slate-600",
                                    ].join(" ")}
                                  >
                                    {p.status}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Partial placeholder: one table has data, the other is empty */}
                    {(paymentData.ledger.length === 0 || paymentData.payments.length === 0) && (
                      <p className="px-1 text-sm leading-6 text-slate-500">
                        Your workspace trust ledger is active. Transaction records, deductions,
                        and payment histories will populate here as work milestones are executed.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </TabsContent>

        {/* ── Team ── */}
        <TabsContent value="team">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Invite a Teammate</CardTitle>
                <CardDescription>
                  Enter a coworker&apos;s email. If they&apos;re already signed up they&apos;re added
                  instantly; otherwise the invite is held until they sign in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void inviteMember()
                    }}
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) =>
                      setInviteRole(
                        e.target.value as
                          | "owner"
                          | "developer"
                          | "collaborator"
                          | "employee-of-client"
                          | "beam-participant"
                      )
                    }
                    className="flex h-11 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="collaborator">Collaborator</option>
                    <option value="employee-of-client">Employee Of Client</option>
                    <option value="beam-participant">BEAM Participant</option>
                    <option value="developer">Developer</option>
                    <option value="owner">Owner</option>
                  </select>
                  <Button onClick={inviteMember} disabled={inviting || !inviteEmail.trim()}>
                    {inviting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="mr-2 h-4 w-4" />
                    )}
                    Invite
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Members ({members.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {members.map((member) => (
                  <div
                    key={member.uid}
                    className="flex items-center justify-between rounded-2xl border border-border bg-white/80 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {member.displayName ?? member.email}
                      </p>
                      {member.displayName && (
                        <p className="text-xs text-slate-500">{member.email}</p>
                      )}
                    </div>
                    <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                      {member.role}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(directorySelection)}
        onOpenChange={(open) => {
          if (!open) setDirectorySelection(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {directorySelection ? roleDisplayLabel(directorySelection.role) : "Role"} directory
            </DialogTitle>
            <DialogDescription>
              {directorySelection
                ? roleDescription(directorySelection.role)
                : "Workspace role assignment details."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {directoryProject ? (
              <div className="rounded-2xl border border-border bg-slate-50/70 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Project Track
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {projectTitle(directoryProject)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {workspaceBusinessReference(workspace)}
                </p>
              </div>
            ) : null}

            {directoryMembers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-white/80 px-4 py-8 text-center">
                <Users className="mx-auto mb-3 h-7 w-7 text-slate-300" />
                <p className="text-sm font-semibold text-slate-600">
                  No live people are assigned to this role yet.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {directoryMembers.map((member) => (
                  <div
                    key={member.uid}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-white/85 px-4 py-3"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {memberInitial(member)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {memberDisplayName(member)}
                      </p>
                      {member.displayName ? (
                        <p className="truncate text-xs text-slate-500">{member.email}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
