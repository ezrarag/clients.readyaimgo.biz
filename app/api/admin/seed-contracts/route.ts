/**
 * One-time seed endpoint — admin only.
 * POST /api/admin/seed-contracts
 *
 * Idempotent: calls seedRagFleetContract() which checks for an existing record
 * before inserting. Safe to call multiple times.
 */

import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"

async function isAdmin(uid: string) {
  const db = getAdminDb()
  const snap = await db.collection("users").doc(uid).get()
  if (!snap.exists) return false
  const roles = (snap.data() as Record<string, unknown>).roles
  return Array.isArray(roles) && roles.includes("beam-admin")
}

export async function POST(req: NextRequest) {
  try {
    const h = req.headers.get("authorization") || ""
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : null
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(token)
    if (!(await isAdmin(decoded.uid))) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 })
    }

    const db = getAdminDb()

    // Check if already seeded
    const existing = await db
      .collection("contracts")
      .where("clientEmail", "==", "ezra@readyaimgo.biz")
      .where("contractType", "==", "fleet_maintenance")
      .limit(1)
      .get()

    if (!existing.empty) {
      return NextResponse.json({ seeded: false, message: "RAG fleet contract already exists." })
    }

    await db.collection("contracts").add({
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
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: decoded.uid,
      documentUrl: null,
      beamNgos: ["transport", "finance", "law"],
      notes:
        "First fleet client. Pilot for BEAM Transportation cohort model. VC414 pitch anchor.",
    })

    return NextResponse.json({ seeded: true, message: "RAG fleet contract seeded." })
  } catch (error) {
    console.error("POST /api/admin/seed-contracts error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to seed contracts." },
      { status: 500 }
    )
  }
}
