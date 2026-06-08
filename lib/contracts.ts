import {
  addDoc,
  collection,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONTRACT_TYPES = [
  "fleet_maintenance",
  "anchor_partner",
  "cohort_services",
  "mou",
] as const

export const CONTRACT_STATUSES = [
  "draft",
  "reviewed",
  "sent",
  "signed",
  "active",
  "expired",
] as const

export const BEAM_NGOS = [
  "transport",
  "finance",
  "law",
  "forge",
  "grounds",
] as const

export type ContractType = (typeof CONTRACT_TYPES)[number]
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]
export type BeamNgo = (typeof BEAM_NGOS)[number]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LegalReview {
  id: string
  participantId: string
  participantName: string
  reviewDate: string | null
  status: "pending" | "in-progress" | "complete"
  flaggedClauses: string[]
  memo: string
  supervisorId: string
  supervisorApproved: boolean
  attachmentUrl: string | null
}

export interface FinancialReview {
  id: string
  participantId: string
  participantName: string
  reviewDate: string | null
  monthlyValue: number
  annualProjection: number
  accountingTreatment: string
  taxImplications: string
  grantEligibilityNotes: string
  memo: string
  supervisorApproved: boolean
}

export interface ContractFinancialProposal {
  amount: number
  cadence: "one-time" | "monthly" | "milestone" | "custom"
  paymentDates: string[]
  note: string
  proposedByUid: string | null
  proposedByEmail: string | null
  proposedAt: string | null
  status: "pending" | "approved" | "declined"
}

export interface BeamContract {
  id: string
  workspaceId?: string | null
  clientId: string
  clientName: string
  clientEmail: string
  contractType: ContractType
  status: ContractStatus
  title: string
  summary: string
  monthlyValue: number
  proposedAmount?: number
  termMonths: number
  startDate: string | null
  endDate: string | null
  createdAt: string | null
  updatedAt: string | null
  createdBy: string
  documentUrl: string | null
  beamNgos: string[]
  notes: string
  pricingCadence?: "one-time" | "monthly" | "milestone" | "custom"
  paymentDates?: string[]
  pendingFinancialProposal?: ContractFinancialProposal | null
  legalReviews?: LegalReview[]
  financialReviews?: FinancialReview[]
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}

function readString(v: unknown, fallback = "") {
  return typeof v === "string" ? v : fallback
}

function readNumber(v: unknown, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

function readBool(v: unknown, fallback = false) {
  return typeof v === "boolean" ? v : fallback
}

function readEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && allowed.includes(v as T) ? (v as T) : fallback
}

function serializeTs(v: unknown): string | null {
  if (typeof v === "string") return v
  if (v instanceof Date) return v.toISOString()
  if (isRecord(v) && typeof v.toDate === "function") {
    return (v.toDate() as Date).toISOString()
  }
  return null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

function normalizeCadence(value: unknown): ContractFinancialProposal["cadence"] {
  return value === "monthly" ||
    value === "milestone" ||
    value === "custom" ||
    value === "one-time"
    ? value
    : "custom"
}

function normalizeFinancialProposal(value: unknown): ContractFinancialProposal | null {
  if (!isRecord(value)) return null
  const status =
    value.status === "approved" || value.status === "declined" || value.status === "pending"
      ? value.status
      : "pending"
  return {
    amount: readNumber(value.amount),
    cadence: normalizeCadence(value.cadence),
    paymentDates: readStringArray(value.paymentDates),
    note: readString(value.note),
    proposedByUid: typeof value.proposedByUid === "string" ? value.proposedByUid : null,
    proposedByEmail: typeof value.proposedByEmail === "string" ? value.proposedByEmail : null,
    proposedAt: serializeTs(value.proposedAt),
    status,
  }
}

export function normalizeLegalReview(id: string, data: Record<string, unknown>): LegalReview {
  return {
    id,
    participantId: readString(data.participantId),
    participantName: readString(data.participantName),
    reviewDate: serializeTs(data.reviewDate),
    status: readEnum(data.status, ["pending", "in-progress", "complete"] as const, "pending"),
    flaggedClauses: Array.isArray(data.flaggedClauses)
      ? data.flaggedClauses.filter((c): c is string => typeof c === "string")
      : [],
    memo: readString(data.memo),
    supervisorId: readString(data.supervisorId),
    supervisorApproved: readBool(data.supervisorApproved),
    attachmentUrl: typeof data.attachmentUrl === "string" ? data.attachmentUrl : null,
  }
}

export function normalizeFinancialReview(
  id: string,
  data: Record<string, unknown>
): FinancialReview {
  return {
    id,
    participantId: readString(data.participantId),
    participantName: readString(data.participantName),
    reviewDate: serializeTs(data.reviewDate),
    monthlyValue: readNumber(data.monthlyValue),
    annualProjection: readNumber(data.annualProjection),
    accountingTreatment: readString(data.accountingTreatment),
    taxImplications: readString(data.taxImplications),
    grantEligibilityNotes: readString(data.grantEligibilityNotes),
    memo: readString(data.memo),
    supervisorApproved: readBool(data.supervisorApproved),
  }
}

export function normalizeContract(id: string, data: Record<string, unknown>): BeamContract {
  return {
    id,
    workspaceId:
      typeof data.workspaceId === "string" && data.workspaceId.trim()
        ? data.workspaceId.trim()
        : null,
    clientId: readString(data.clientId),
    clientName: readString(data.clientName),
    clientEmail: readString(data.clientEmail),
    contractType: readEnum(data.contractType, CONTRACT_TYPES, "mou"),
    status: readEnum(data.status, CONTRACT_STATUSES, "draft"),
    title: readString(data.title, "Untitled Agreement"),
    summary: readString(data.summary),
    monthlyValue: readNumber(data.monthlyValue),
    proposedAmount: readNumber(data.proposedAmount),
    termMonths: readNumber(data.termMonths),
    startDate: serializeTs(data.startDate),
    endDate: serializeTs(data.endDate),
    createdAt: serializeTs(data.createdAt),
    updatedAt: serializeTs(data.updatedAt),
    createdBy: readString(data.createdBy),
    documentUrl: typeof data.documentUrl === "string" ? data.documentUrl : null,
    beamNgos: Array.isArray(data.beamNgos)
      ? data.beamNgos.filter((n): n is string => typeof n === "string")
      : [],
    notes: readString(data.notes),
    pricingCadence: normalizeCadence(data.pricingCadence),
    paymentDates: readStringArray(data.paymentDates),
    pendingFinancialProposal: normalizeFinancialProposal(data.pendingFinancialProposal),
  }
}

// ---------------------------------------------------------------------------
// Client-SDK helpers (used from the browser)
// ---------------------------------------------------------------------------

export async function getContracts(
  firestoreDb: Firestore,
  clientId: string
): Promise<BeamContract[]> {
  const snap = await getDocs(
    query(
      collection(firestoreDb, "contracts"),
      where("clientId", "==", clientId),
      orderBy("createdAt", "desc")
    )
  )
  return snap.docs.map((d) => normalizeContract(d.id, d.data() as Record<string, unknown>))
}

export async function getContract(
  firestoreDb: Firestore,
  contractId: string
): Promise<BeamContract | null> {
  const snap = await getDoc(doc(firestoreDb, "contracts", contractId))
  if (!snap.exists()) return null
  const contract = normalizeContract(snap.id, snap.data() as Record<string, unknown>)

  const [legalSnap, financialSnap] = await Promise.all([
    getDocs(
      query(
        collection(firestoreDb, "contracts", contractId, "legalReviews"),
        orderBy("reviewDate", "desc")
      )
    ),
    getDocs(
      query(
        collection(firestoreDb, "contracts", contractId, "financialReviews"),
        orderBy("reviewDate", "desc")
      )
    ),
  ])

  contract.legalReviews = legalSnap.docs.map((d) =>
    normalizeLegalReview(d.id, d.data() as Record<string, unknown>)
  )
  contract.financialReviews = financialSnap.docs.map((d) =>
    normalizeFinancialReview(d.id, d.data() as Record<string, unknown>)
  )

  return contract
}

export async function updateContractStatus(
  firestoreDb: Firestore,
  contractId: string,
  status: ContractStatus
): Promise<void> {
  await updateDoc(doc(firestoreDb, "contracts", contractId), {
    status,
    updatedAt: serverTimestamp(),
  })
}

// ---------------------------------------------------------------------------
// Seed function — run once to create the RAG fleet contract
// ---------------------------------------------------------------------------

export async function seedRagFleetContract(firestoreDb: Firestore): Promise<void> {
  const existing = await getDocs(
    query(
      collection(firestoreDb, "contracts"),
      where("clientEmail", "==", "ezra@readyaimgo.biz"),
      where("contractType", "==", "fleet_maintenance")
    )
  )
  if (!existing.empty) {
    console.log("RAG fleet contract already seeded — skipping.")
    return
  }

  await addDoc(collection(firestoreDb, "contracts"), {
    clientId: "readyaimgo",
    clientName: "ReadyAimGo",
    clientEmail: "ezra@readyaimgo.biz",
    contractType: "fleet_maintenance",
    status: "draft",
    title: "BEAM Transportation Fleet Maintenance — ReadyAimGo",
    summary:
      "Fleet maintenance services provided by BEAM Transportation cohort participants " +
      "to ReadyAimGo client vehicles. Covers scheduled maintenance, inspections, " +
      "and emergency repairs across the pilot client roster.",
    monthlyValue: 700,
    termMonths: 6,
    startDate: null,
    endDate: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: "system",
    documentUrl: null,
    beamNgos: ["transport", "finance", "law"],
    notes:
      "First fleet client. Pilot for BEAM Transportation cohort model. VC414 pitch anchor.",
  })
  console.log("RAG fleet contract seeded.")
}
