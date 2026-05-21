import { type NextRequest, NextResponse } from "next/server"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import { normalizeClientDeliverableDocument } from "@/lib/deliverables"
import {
  VALUE_PROFILE_COLLECTION,
  VALUE_PROFILE_PAYMENTS_COLLECTION,
  VALUE_PROFILE_STATE_DOC,
  normalizeValuePaymentRecord,
  normalizeValueProfile,
} from "@/lib/value-profile"

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

function normalizeLedgerEntry(id: string, data: Record<string, unknown>) {
  const description =
    typeof data.description === "string" && data.description.trim()
      ? data.description.trim()
      : "Ledger statement"
  const actorRole =
    typeof data.actorRole === "string" && data.actorRole.trim()
      ? data.actorRole.trim()
      : "system"
  const deductionAmount = asNumber(
    data.deductionAmount ?? data.deductionThreshold ?? data.drawdownAmount ?? data.amount
  )
  const valueAllocationAmount = asNumber(
    data.valueAllocationAmount ?? data.agencyValueAmount ?? data.productionEquityAmount
  )

  return {
    id,
    createdAt: asTimestampString(data.createdAt),
    description,
    actorRole,
    deductionAmount,
    valueAllocationAmount: valueAllocationAmount || deductionAmount,
    benchmarkCategory:
      typeof data.benchmarkCategory === "string" && data.benchmarkCategory.trim()
        ? data.benchmarkCategory.trim()
        : null,
    sourceRepository:
      typeof data.sourceRepository === "string" && data.sourceRepository.trim()
        ? data.sourceRepository.trim()
        : null,
    sourceBranchDepth:
      typeof data.sourceBranchDepth === "string" && data.sourceBranchDepth.trim()
        ? data.sourceBranchDepth.trim()
        : null,
    vercelDeploymentId:
      typeof data.vercelDeploymentId === "string" && data.vercelDeploymentId.trim()
        ? data.vercelDeploymentId.trim()
        : null,
    hostingPlatformConfiguration:
      typeof data.hostingPlatformConfiguration === "string" &&
      data.hostingPlatformConfiguration.trim()
        ? data.hostingPlatformConfiguration.trim()
        : null,
    verifiedDataStructureLines: asNumber(data.verifiedDataStructureLines),
    municipalEndpointMaps: Array.isArray(data.municipalEndpointMaps)
      ? (data.municipalEndpointMaps as unknown[]).filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [],
  }
}

// ─── GET /api/workspaces/[workspaceId]/payments ───────────────────────────────
//
// Returns payment state for the workspace's linked client account:
//   - clientId resolved from the workspace doc
//   - stripeCustomerId from the value-profile state doc
//   - totalPaid accumulated across all value-profile payments
//   - recent payments (newest-first, limit 20)
//   - pending (unpaid) deliverables
//   - accountOwner resolved from workspaces/{workspaceId}/members role=owner
//
// Returns an empty payload (clientId: null) when the workspace has no linked
// clientId bridge field — the tab will show a "no billing account" empty state.
// Requires workspace membership.
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "beam-participant")

    // Resolve clientId from workspace bridge field
    const wsSnap = await db.collection("workspaces").doc(params.workspaceId).get()
    const wsData = wsSnap.exists ? (wsSnap.data() as Record<string, unknown>) : {}
    const clientId =
      typeof wsData.clientId === "string" && wsData.clientId.trim()
        ? wsData.clientId.trim().toLowerCase()
        : null
    const retainerBalance = asNumber(wsData.retainerBalance)
    const ownerUid =
      typeof wsData.ownerUid === "string" && wsData.ownerUid.trim()
        ? wsData.ownerUid.trim()
        : null

    const ownerSnap = ownerUid
      ? await db
          .collection("workspaces")
          .doc(params.workspaceId)
          .collection("members")
          .doc(ownerUid)
          .get()
          .catch(() => null)
      : null
    const ownerQuerySnap = ownerSnap?.exists
      ? null
      : await db
          .collection("workspaces")
          .doc(params.workspaceId)
          .collection("members")
          .where("role", "==", "owner")
          .limit(1)
          .get()
          .catch(() => null)
    const ownerData = ownerSnap?.exists
      ? (ownerSnap.data() as Record<string, unknown>)
      : ownerQuerySnap?.docs[0]
        ? (ownerQuerySnap.docs[0].data() as Record<string, unknown>)
        : null
    const accountOwner = ownerData
      ? {
          uid:
            typeof ownerData.uid === "string"
              ? ownerData.uid
              : ownerSnap?.id ?? ownerQuerySnap?.docs[0]?.id ?? null,
          email: typeof ownerData.email === "string" ? ownerData.email : null,
          displayName:
            typeof ownerData.displayName === "string" && ownerData.displayName.trim()
              ? ownerData.displayName.trim()
              : null,
          role: "owner",
        }
      : null

    const ledgerSnap = await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("ledger")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get()
      .catch(() => null)
    const ledger = (ledgerSnap?.docs ?? []).map((doc) =>
      normalizeLedgerEntry(doc.id, doc.data() as Record<string, unknown>)
    )

    if (!clientId) {
      return NextResponse.json({
        clientId: null,
        stripeCustomerId: null,
        totalPaid: 0,
        retainerBalance,
        ledger,
        payments: [],
        deliverables: [],
        accountOwner,
      })
    }

    const profileRef = db
      .collection("clients")
      .doc(clientId)
      .collection(VALUE_PROFILE_COLLECTION)
      .doc(VALUE_PROFILE_STATE_DOC)

    // Parallel fetches — each soft-fails independently so a missing subcollection
    // doesn't block the whole response.
    const [profileSnap, paymentsSnap, deliverablesSnap] = await Promise.all([
      profileRef.get().catch(() => null),
      profileRef
        .collection(VALUE_PROFILE_PAYMENTS_COLLECTION)
        .orderBy("createdAt", "desc")
        .limit(20)
        .get()
        .catch(() => null),
      // Fetch all deliverables; filter to pending client-side to avoid needing
      // a composite index on (status, createdAt).
      db
        .collection("clients")
        .doc(clientId)
        .collection("deliverables")
        .get()
        .catch(() => null),
    ])

    const profile = normalizeValueProfile(
      clientId,
      profileSnap?.exists ? (profileSnap.data() as Record<string, unknown>) : null
    )

    const payments = (paymentsSnap?.docs ?? []).map((d) =>
      normalizeValuePaymentRecord(d.id, d.data() as Record<string, unknown>)
    )

    const deliverables = (deliverablesSnap?.docs ?? [])
      .map((d) =>
        normalizeClientDeliverableDocument(
          d.id,
          d.data() as Record<string, unknown>,
          clientId
        )
      )
      .filter((d) => d.status === "pending")

    return NextResponse.json({
      clientId,
      stripeCustomerId: profile.stripeCustomerId ?? null,
      totalPaid: profile.totalPaid,
      retainerBalance,
      ledger,
      payments,
      deliverables,
      accountOwner,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /workspaces/[workspaceId]/payments error:", error)
    return NextResponse.json({ error: "Unable to load payment data." }, { status: 500 })
  }
}
