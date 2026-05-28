import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import type { WorkspaceRole } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const SERVICE_PROVIDERS = ["Namecheap", "Zoho", "Twilio", "Vercel"] as const
const BILLING_CYCLE_TYPES = [
  "Domain Renewal",
  "Business Email Tier",
  "API Consumption",
  "Compute Allocation",
] as const

type ServiceProvider = (typeof SERVICE_PROVIDERS)[number]
type BillingCycleType = (typeof BILLING_CYCLE_TYPES)[number]

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function asTimestampString(value: unknown): string | null {
  if (typeof value === "string") return value
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (
    value &&
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    const date = new Date((value as { seconds: number }).seconds * 1000)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return null
    }
  }
  return null
}

function normalizeServiceProvider(data: Record<string, unknown>): ServiceProvider {
  const raw = [data.serviceProvider, data.vendor, data.source, data.description]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()

  if (raw.includes("zoho")) return "Zoho"
  if (raw.includes("twilio")) return "Twilio"
  if (raw.includes("vercel")) return "Vercel"
  return "Namecheap"
}

function normalizeBillingCycleType(
  data: Record<string, unknown>,
  serviceProvider: ServiceProvider
): BillingCycleType {
  const raw = [data.billingCycleType, data.category, data.source, data.description]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()

  if (raw.includes("email") || raw.includes("mail") || serviceProvider === "Zoho") {
    return "Business Email Tier"
  }
  if (raw.includes("api") || raw.includes("sms") || serviceProvider === "Twilio") {
    return "API Consumption"
  }
  if (raw.includes("compute") || raw.includes("hosting") || serviceProvider === "Vercel") {
    return "Compute Allocation"
  }
  return "Domain Renewal"
}

function calculateDaysOverdue(dueDate: string | null) {
  if (!dueDate) return -1
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return -1
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfDueDate = new Date(due)
  startOfDueDate.setHours(0, 0, 0, 0)
  return Math.floor((startOfToday.getTime() - startOfDueDate.getTime()) / 86400000)
}

function normalizeExpense(id: string, data: Record<string, unknown>) {
  const source =
    typeof data.source === "string" && data.source.trim()
      ? data.source.trim()
      : "Infrastructure expense"
  const description =
    typeof data.description === "string" && data.description.trim()
      ? data.description.trim()
      : source
  const status = data.status === "paid" ? "paid" : "unpaid"
  const serviceProvider = normalizeServiceProvider(data)
  const dueDate = asTimestampString(data.dueDate)
  const daysOverdue = calculateDaysOverdue(dueDate)

  const expense = {
    id,
    source,
    description,
    amount: Math.max(0, asNumber(data.amount)),
    status,
    vendor:
      typeof data.vendor === "string" && data.vendor.trim() ? data.vendor.trim() : null,
    category:
      typeof data.category === "string" && data.category.trim()
        ? data.category.trim()
        : "infrastructure",
    serviceProvider,
    billingCycleType: normalizeBillingCycleType(data, serviceProvider),
    contractAppendageReady: Boolean(data.contractAppendageReady ?? true),
    createdAt: asTimestampString(data.createdAt),
    dueDate,
    domain:
      typeof data.domain === "string" && data.domain.trim()
        ? data.domain.trim().toLowerCase()
        : null,
    evidenceSnippet:
      typeof data.evidenceSnippet === "string" && data.evidenceSnippet.trim()
        ? data.evidenceSnippet.trim()
        : null,
    sourceSystem:
      typeof data.sourceSystem === "string" && data.sourceSystem.trim()
        ? data.sourceSystem.trim()
        : null,
    sourceRef:
      typeof data.sourceRef === "string" && data.sourceRef.trim()
        ? data.sourceRef.trim()
        : typeof data.sourceEmailId === "string" && data.sourceEmailId.trim()
          ? data.sourceEmailId.trim()
          : null,
    paidAt: asTimestampString(data.paidAt),
  }

  return {
    ...expense,
    daysOverdue,
    criticalSystemFlag: expense.status === "unpaid" && daysOverdue >= 0,
  }
}

async function authenticate(
  request: NextRequest,
  workspaceId: string,
  minRole: WorkspaceRole = "beam-participant"
) {
  const idToken = getBearerToken(request)
  if (!idToken) {
    return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) }
  }

  const decoded = await getAdminAuth().verifyIdToken(idToken)
  const db = getAdminDb()
  const role = await assertWorkspaceRole(db, workspaceId, decoded.uid, minRole)
  return { db, uid: decoded.uid, email: decoded.email ?? null, role }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const auth = await authenticate(request, params.workspaceId)
    if ("error" in auth) return auth.error

    const snap = await auth.db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("expenses")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get()

    const expenses = snap.docs.map((doc) =>
      normalizeExpense(doc.id, doc.data() as Record<string, unknown>)
    )

    return NextResponse.json({ success: true, expenses })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /workspaces/[workspaceId]/expenses error:", error)
    return NextResponse.json({ error: "Unable to load expenses." }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const auth = await authenticate(request, params.workspaceId, "owner")
    if ("error" in auth) return auth.error

    const body = (await request.json()) as Record<string, unknown>
    const expenseId = typeof body.expenseId === "string" ? body.expenseId.trim() : ""
    if (!expenseId) {
      return NextResponse.json({ error: "expenseId is required." }, { status: 400 })
    }

    const workspaceRef = auth.db.collection("workspaces").doc(params.workspaceId)
    const expenseRef = workspaceRef.collection("expenses").doc(expenseId)
    const ledgerRef = workspaceRef.collection("ledger").doc()

    const result = await auth.db.runTransaction(async (transaction) => {
      const [workspaceSnap, expenseSnap] = await Promise.all([
        transaction.get(workspaceRef),
        transaction.get(expenseRef),
      ])

      if (!workspaceSnap.exists) throw new WorkspaceAuthError("Workspace not found.", 404)
      if (!expenseSnap.exists) throw new WorkspaceAuthError("Expense not found.", 404)

      const workspace = workspaceSnap.data() as Record<string, unknown>
      const expense = normalizeExpense(
        expenseSnap.id,
        expenseSnap.data() as Record<string, unknown>
      )
      if (expense.status === "paid") {
        return { expense, retainerBalance: asNumber(workspace.retainerBalance), alreadyPaid: true }
      }

      if (expense.amount <= 0) {
        throw new WorkspaceAuthError("Expense amount is not configured.", 403)
      }

      const currentBalance = asNumber(workspace.retainerBalance)
      if (currentBalance < expense.amount) {
        throw new WorkspaceAuthError("Retainer balance is insufficient for this expense.", 403)
      }

      const nextBalance = currentBalance - expense.amount
      const description = `${expense.source}: ${expense.description} - Deducted ${new Intl.NumberFormat(
        "en-US",
        { style: "currency", currency: "USD" }
      ).format(expense.amount)}`

      transaction.set(
        expenseRef,
        {
          status: "paid",
          paidAt: FieldValue.serverTimestamp(),
          paidByUid: auth.uid,
          paidByEmail: auth.email,
          updatedAt: FieldValue.serverTimestamp(),
          contractAppendageReady: true,
        },
        { merge: true }
      )
      transaction.set(ledgerRef, {
        expenseId: expense.id,
        source: expense.source,
        serviceProvider: expense.serviceProvider,
        billingCycleType: expense.billingCycleType,
        dueDate: expense.dueDate,
        daysOverdue: expense.daysOverdue,
        criticalSystemFlag: expense.criticalSystemFlag,
        description,
        actorRole: auth.role,
        actorUid: auth.uid,
        actorEmail: auth.email,
        deductionAmount: expense.amount,
        retainerBalanceAfter: nextBalance,
        contractAppendageReady: true,
        createdAt: FieldValue.serverTimestamp(),
      })
      transaction.set(
        workspaceRef,
        {
          retainerBalance: nextBalance,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )

      return { expense: { ...expense, status: "paid" as const }, retainerBalance: nextBalance }
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /workspaces/[workspaceId]/expenses error:", error)
    return NextResponse.json({ error: "Unable to authorize expense." }, { status: 500 })
  }
}
