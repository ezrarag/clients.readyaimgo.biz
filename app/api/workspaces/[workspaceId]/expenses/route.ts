import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import type { WorkspaceRole } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function asTimestampString(value: unknown): string | null {
  if (typeof value === "string") return value
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return null
    }
  }
  return null
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

  return {
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
    contractAppendageReady: Boolean(data.contractAppendageReady ?? true),
    createdAt: asTimestampString(data.createdAt),
    paidAt: asTimestampString(data.paidAt),
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
