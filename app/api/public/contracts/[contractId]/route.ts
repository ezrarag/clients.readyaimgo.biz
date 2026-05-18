/**
 * Public contract bridge — for BEAM NGO sites only.
 *
 * BEAM NGO sites (transport.beamthinktank.space, etc.) never have direct
 * Firestore access to the readyaimgo-ab187 project. Instead they call this
 * endpoint with a shared API key and receive a safe subset of contract data.
 *
 * Required header: X-Beam-Api-Key: <READYAIMGO_BEAM_API_KEY>
 *
 * Returns: { id, title, contractType, status, summary, monthlyValue,
 *            termMonths, beamNgos, legalReviews[], financialReviews[] }
 */

import { type NextRequest, NextResponse } from "next/server"

import { getAdminDb } from "@/lib/firebase-admin"
import {
  normalizeContract,
  normalizeLegalReview,
  normalizeFinancialReview,
} from "@/lib/contracts"

export const dynamic = "force-dynamic"

const BEAM_API_KEY = process.env.READYAIMGO_BEAM_API_KEY || ""

function verifyApiKey(req: NextRequest): boolean {
  const key = req.headers.get("x-beam-api-key") || ""
  return BEAM_API_KEY.length > 0 && key === BEAM_API_KEY
}

// GET /api/public/contracts/[contractId]
export async function GET(
  req: NextRequest,
  { params }: { params: { contractId: string } }
) {
  if (!verifyApiKey(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  const { contractId } = params
  if (!contractId) {
    return NextResponse.json({ error: "contractId is required." }, { status: 400 })
  }

  try {
    const db = getAdminDb()
    const snap = await db.collection("contracts").doc(contractId).get()

    if (!snap.exists) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 })
    }

    const contract = normalizeContract(snap.id, snap.data() as Record<string, unknown>)

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

    // Return only the safe public subset — never expose internal UIDs or emails
    return NextResponse.json({
      id: contract.id,
      title: contract.title,
      contractType: contract.contractType,
      status: contract.status,
      summary: contract.summary,
      monthlyValue: contract.monthlyValue,
      termMonths: contract.termMonths,
      startDate: contract.startDate,
      endDate: contract.endDate,
      beamNgos: contract.beamNgos,
      legalReviews: contract.legalReviews,
      financialReviews: contract.financialReviews,
    })
  } catch (error) {
    console.error("GET /api/public/contracts/[contractId] error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load contract." },
      { status: 500 }
    )
  }
}
