import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import {
  normalizeContract,
  normalizeLegalReview,
  normalizeFinancialReview,
  CONTRACT_STATUSES,
} from "@/lib/contracts"

export const dynamic = "force-dynamic"

function getBearerToken(req: NextRequest) {
  const h = req.headers.get("authorization") || ""
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null
}

async function resolveUser(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) return null
  try {
    return await getAdminAuth().verifyIdToken(token)
  } catch {
    return null
  }
}

async function isAdmin(uid: string) {
  const db = getAdminDb()
  const snap = await db.collection("users").doc(uid).get()
  if (!snap.exists) return false
  const roles = (snap.data() as Record<string, unknown>).roles
  return Array.isArray(roles) && roles.includes("beam-admin")
}

function readPositiveAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""))
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function normalizeCadence(value: unknown) {
  return value === "monthly" ||
    value === "milestone" ||
    value === "custom" ||
    value === "one-time"
    ? value
    : "custom"
}

// GET /api/contracts/[contractId]
export async function GET(
  req: NextRequest,
  { params }: { params: { contractId: string } }
) {
  try {
    const decoded = await resolveUser(req)
    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    const { contractId } = params
    if (!contractId) {
      return NextResponse.json({ error: "contractId is required." }, { status: 400 })
    }

    const db = getAdminDb()
    const snap = await db.collection("contracts").doc(contractId).get()

    if (!snap.exists) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 })
    }

    const contractData = snap.data() as Record<string, unknown>
    const admin = await isAdmin(decoded.uid)

    // Non-admins can only fetch contracts they own (matched by email)
    if (!admin) {
      const callerEmail = (decoded.email || "").toLowerCase().trim()
      const contractEmail = (
        typeof contractData.clientEmail === "string" ? contractData.clientEmail : ""
      ).toLowerCase()
      const contractClientId = typeof contractData.clientId === "string" ? contractData.clientId : ""

      // Check client record
      const clientSnap = await db.collection("clients").doc(callerEmail).get()
      if (!clientSnap.exists) {
        return NextResponse.json({ error: "Access denied." }, { status: 403 })
      }
      const clientData = clientSnap.data() as Record<string, unknown>
      const storedClientId =
        typeof clientData.clientId === "string" ? clientData.clientId : callerEmail

      if (contractEmail !== callerEmail && contractClientId !== storedClientId && contractClientId !== callerEmail) {
        return NextResponse.json({ error: "Access denied." }, { status: 403 })
      }
    }

    const contract = normalizeContract(snap.id, contractData)

    const [legalSnap, financialSnap] = await Promise.all([
      db
        .collection("contracts")
        .doc(contractId)
        .collection("legalReviews")
        .orderBy("reviewDate", "desc")
        .get(),
      db
        .collection("contracts")
        .doc(contractId)
        .collection("financialReviews")
        .orderBy("reviewDate", "desc")
        .get(),
    ])

    contract.legalReviews = legalSnap.docs.map((d) =>
      normalizeLegalReview(d.id, d.data() as Record<string, unknown>)
    )
    contract.financialReviews = financialSnap.docs.map((d) =>
      normalizeFinancialReview(d.id, d.data() as Record<string, unknown>)
    )

    return NextResponse.json({ contract })
  } catch (error) {
    console.error("GET /api/contracts/[contractId] error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load contract." },
      { status: 500 }
    )
  }
}

// PATCH /api/contracts/[contractId] — admin only
export async function PATCH(
  req: NextRequest,
  { params }: { params: { contractId: string } }
) {
  try {
    const decoded = await resolveUser(req)
    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    if (!(await isAdmin(decoded.uid))) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 })
    }

    const { contractId } = params
    if (!contractId) {
      return NextResponse.json({ error: "contractId is required." }, { status: 400 })
    }

    const body = (await req.json()) as Record<string, unknown>

    const db = getAdminDb()
    const snap = await db.collection("contracts").doc(contractId).get()
    if (!snap.exists) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 })
    }

    // Build the update payload — only allow safe fields
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (typeof body.status === "string") {
      if (!CONTRACT_STATUSES.includes(body.status as never)) {
        return NextResponse.json({ error: "Invalid status." }, { status: 400 })
      }
      update.status = body.status
    }

    if (typeof body.title === "string") update.title = body.title.trim()
    if (typeof body.summary === "string") update.summary = body.summary.trim()
    if (typeof body.notes === "string") update.notes = body.notes.trim()
    if (typeof body.documentUrl === "string") update.documentUrl = body.documentUrl.trim() || null
    if (typeof body.monthlyValue === "number") update.monthlyValue = body.monthlyValue
    if (typeof body.proposedAmount === "number") update.proposedAmount = body.proposedAmount
    if (typeof body.pricingCadence === "string") update.pricingCadence = normalizeCadence(body.pricingCadence)
    if (Array.isArray(body.paymentDates)) {
      update.paymentDates = body.paymentDates.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      )
    }
    if (body.pendingFinancialProposalStatus === "approved") {
      update["pendingFinancialProposal.status"] = "approved"
    }
    if (body.pendingFinancialProposalStatus === "declined") {
      update["pendingFinancialProposal.status"] = "declined"
    }
    if (typeof body.termMonths === "number") update.termMonths = body.termMonths
    if (body.startDate !== undefined) update.startDate = body.startDate || null
    if (body.endDate !== undefined) update.endDate = body.endDate || null
    if (Array.isArray(body.beamNgos)) {
      update.beamNgos = (body.beamNgos as unknown[]).filter(
        (n): n is string => typeof n === "string"
      )
    }

    await db.collection("contracts").doc(contractId).update(update)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("PATCH /api/contracts/[contractId] error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update contract." },
      { status: 500 }
    )
  }
}

// POST /api/contracts/[contractId] — submit a financial negotiation proposal.
export async function POST(
  req: NextRequest,
  { params }: { params: { contractId: string } }
) {
  try {
    const decoded = await resolveUser(req)
    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    const { contractId } = params
    if (!contractId) {
      return NextResponse.json({ error: "contractId is required." }, { status: 400 })
    }

    const body = (await req.json()) as Record<string, unknown>
    const amount = readPositiveAmount(body.amount)
    if (!amount) {
      return NextResponse.json({ error: "A positive amount is required." }, { status: 400 })
    }

    const db = getAdminDb()
    const snap = await db.collection("contracts").doc(contractId).get()
    if (!snap.exists) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 })
    }

    const contractData = snap.data() as Record<string, unknown>
    const admin = await isAdmin(decoded.uid)
    if (!admin) {
      const workspaceId =
        typeof contractData.workspaceId === "string" && contractData.workspaceId.trim()
          ? contractData.workspaceId.trim()
          : null
      if (workspaceId) {
        await assertWorkspaceRole(db, workspaceId, decoded.uid, "beam-participant")
      } else {
        const callerEmail = (decoded.email || "").toLowerCase().trim()
        const contractEmail = (
          typeof contractData.clientEmail === "string" ? contractData.clientEmail : ""
        ).toLowerCase()
        if (!callerEmail || callerEmail !== contractEmail) {
          return NextResponse.json({ error: "Access denied." }, { status: 403 })
        }
      }
    }

    const cadence = normalizeCadence(body.cadence)
    const paymentDates = Array.isArray(body.paymentDates)
      ? body.paymentDates.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : []
    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : ""
    const now = FieldValue.serverTimestamp()
    const proposal = {
      amount,
      cadence,
      paymentDates,
      note,
      proposedByUid: decoded.uid,
      proposedByEmail: decoded.email ?? null,
      proposedAt: now,
      status: "pending",
    }

    const contractRef = db.collection("contracts").doc(contractId)
    const proposalRef = contractRef.collection("financialProposals").doc()
    await db.runTransaction(async (transaction) => {
      transaction.set(proposalRef, proposal)
      transaction.set(
        contractRef,
        {
          pendingFinancialProposal: proposal,
          updatedAt: now,
        },
        { merge: true }
      )
    })

    return NextResponse.json({ success: true, proposalId: proposalRef.id })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /api/contracts/[contractId] error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit proposal." },
      { status: 500 }
    )
  }
}
