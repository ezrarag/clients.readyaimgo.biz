import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { normalizeContract, CONTRACT_TYPES, CONTRACT_STATUSES } from "@/lib/contracts"
import { assertWorkspaceRole, WorkspaceAuthError } from "@/lib/workspace-auth"
import { getBearerToken } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

function readString(v: unknown, fallback = "") {
  return typeof v === "string" ? v.trim() : fallback
}

function readNumber(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
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

// ---------------------------------------------------------------------------
// GET /api/contracts
//
// Three authorization paths — use exactly one:
//
//   ?admin=true        Admin path. Caller must be beam-admin. Returns all
//                      contracts ordered by createdAt desc (up to 500).
//                      Supports optional ?status= and ?search= filters applied
//                      server-side via JS after the collection scan.
//
//   ?workspaceId=xxx   Workspace-member path. Resolves clientId and
//                      clientEmail from the workspace doc and queries contracts
//                      by both identifiers, merged and deduplicated.
//
//   ?clientId=xxx      Legacy client path. Caller must own the client record
//                      (email match) or be an admin.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const decoded = await resolveUser(req)
    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    const db = getAdminDb()
    const adminParam = req.nextUrl.searchParams.get("admin") === "true"
    const workspaceId = req.nextUrl.searchParams.get("workspaceId")?.trim() || ""
    const clientId = req.nextUrl.searchParams.get("clientId")?.trim() || ""

    // ── Admin path ────────────────────────────────────────────────────────────
    if (adminParam) {
      if (!(await isAdmin(decoded.uid))) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 })
      }

      const statusFilter = req.nextUrl.searchParams.get("status")?.trim() || ""
      const searchFilter = req.nextUrl.searchParams.get("search")?.trim().toLowerCase() || ""

      const snap = await db
        .collection("contracts")
        .orderBy("createdAt", "desc")
        .limit(500)
        .get()

      let contracts = snap.docs.map((d) =>
        normalizeContract(d.id, d.data() as Record<string, unknown>)
      )

      if (statusFilter && CONTRACT_STATUSES.includes(statusFilter as never)) {
        contracts = contracts.filter((c) => c.status === statusFilter)
      }

      if (searchFilter) {
        contracts = contracts.filter(
          (c) =>
            c.title.toLowerCase().includes(searchFilter) ||
            c.clientName.toLowerCase().includes(searchFilter) ||
            c.clientEmail.toLowerCase().includes(searchFilter) ||
            c.clientId.toLowerCase().includes(searchFilter)
        )
      }

      return NextResponse.json({ contracts })
    }

    // ── Workspace path ────────────────────────────────────────────────────────
    if (workspaceId) {
      try {
        await assertWorkspaceRole(db, workspaceId, decoded.uid, "beam-participant")
      } catch (err) {
        if (err instanceof WorkspaceAuthError) {
          return NextResponse.json({ error: err.message }, { status: err.status })
        }
        throw err
      }

      // Load workspace to get legacy identifiers
      const wsSnap = await db.collection("workspaces").doc(workspaceId).get()
      const wsData = wsSnap.exists ? (wsSnap.data() as Record<string, unknown>) : {}
      const wsClientId = typeof wsData.clientId === "string" ? wsData.clientId : null
      const wsClientEmail = typeof wsData.clientEmail === "string" ? wsData.clientEmail : null

      // Collect unique identifiers to query against
      const identifiers = Array.from(
        new Set([workspaceId, wsClientId, wsClientEmail].filter(Boolean) as string[])
      )

      if (identifiers.length === 0) {
        return NextResponse.json({ contracts: [] })
      }

      // Run parallel queries: by clientId field, by clientEmail field, by workspaceId field.
      // Firestore `in` supports up to 30 values — well within budget here.
      const [byClientId, byClientEmail, byWorkspaceId] = await Promise.all([
        wsClientId
          ? db.collection("contracts").where("clientId", "==", wsClientId).get()
          : Promise.resolve(null),
        wsClientEmail
          ? db.collection("contracts").where("clientEmail", "==", wsClientEmail).get()
          : Promise.resolve(null),
        db.collection("contracts").where("workspaceId", "==", workspaceId).get(),
      ])

      // Merge and deduplicate by doc id
      const seen = new Set<string>()
      const allDocs = [
        ...(byClientId?.docs ?? []),
        ...(byClientEmail?.docs ?? []),
        ...(byWorkspaceId?.docs ?? []),
      ]
      const contracts = allDocs
        .filter((d) => {
          if (seen.has(d.id)) return false
          seen.add(d.id)
          return true
        })
        .map((d) => normalizeContract(d.id, d.data() as Record<string, unknown>))
        // Sort merged results by createdAt descending
        .sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return tb - ta
        })

      return NextResponse.json({ contracts })
    }

    // ── Legacy clientId path (unchanged) ──────────────────────────────────────
    if (!clientId) {
      return NextResponse.json(
        { error: "workspaceId or clientId is required." },
        { status: 400 }
      )
    }

    const admin = await isAdmin(decoded.uid)
    const callerEmail = (decoded.email || "").toLowerCase().trim()

    if (!admin) {
      const clientSnap = await db.collection("clients").doc(callerEmail).get()
      if (!clientSnap.exists) {
        return NextResponse.json({ error: "Access denied." }, { status: 403 })
      }
      const clientData = clientSnap.data() as Record<string, unknown>
      const clientEmail = (
        typeof clientData.email === "string" ? clientData.email : callerEmail
      ).toLowerCase()
      const storedClientId =
        typeof clientData.clientId === "string" ? clientData.clientId : clientEmail
      if (storedClientId !== clientId && clientEmail !== clientId) {
        return NextResponse.json({ error: "Access denied." }, { status: 403 })
      }
    }

    const snap = await db
      .collection("contracts")
      .where("clientId", "==", clientId)
      .orderBy("createdAt", "desc")
      .get()

    const contracts = snap.docs.map((d) =>
      normalizeContract(d.id, d.data() as Record<string, unknown>)
    )

    return NextResponse.json({ contracts })
  } catch (error) {
    console.error("GET /api/contracts error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load contracts." },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/contracts — admin only
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const decoded = await resolveUser(req)
    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    if (!(await isAdmin(decoded.uid))) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 })
    }

    const body = (await req.json()) as Record<string, unknown>

    const contractType = readString(body.contractType)
    if (!CONTRACT_TYPES.includes(contractType as never)) {
      return NextResponse.json({ error: "Invalid contractType." }, { status: 400 })
    }

    const db = getAdminDb()
    const ref = await db.collection("contracts").add({
      clientId: readString(body.clientId),
      clientName: readString(body.clientName),
      clientEmail: readString(body.clientEmail).toLowerCase(),
      // Optional workspace link — allows the workspace query path to find this
      // contract directly without relying solely on clientId matching.
      workspaceId: readString(body.workspaceId) || null,
      contractType,
      status: "draft",
      title: readString(body.title, "Untitled Agreement"),
      summary: readString(body.summary),
      monthlyValue: readNumber(body.monthlyValue),
      termMonths: readNumber(body.termMonths),
      startDate: body.startDate || null,
      endDate: body.endDate || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: decoded.uid,
      documentUrl: readString(body.documentUrl) || null,
      beamNgos: Array.isArray(body.beamNgos)
        ? body.beamNgos.filter((n): n is string => typeof n === "string")
        : [],
      notes: readString(body.notes),
    })

    return NextResponse.json({ contractId: ref.id }, { status: 201 })
  } catch (error) {
    console.error("POST /api/contracts error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create contract." },
      { status: 500 }
    )
  }
}
