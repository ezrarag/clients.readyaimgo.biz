import { type NextRequest, NextResponse } from "next/server"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { normalizeInvoice, type ClientInvoice } from "@/lib/invoices"
import { getBearerToken } from "@/lib/portal-auth"

export const dynamic = "force-dynamic"

async function resolveUser(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) return null

  // Allow desktop internal API key bypass for raCommand native app
  const internalKey =
    process.env.RAG_INTERNAL_API_KEY ||
    process.env.READYAIMGO_INTERNAL_API_KEY ||
    process.env.DESKTOP_INTERNAL_API_KEY
  if (internalKey && token === internalKey) {
    return { uid: "racommand-internal-system", isSystemKey: true }
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token)
    return { ...decoded, isSystemKey: false }
  } catch {
    return null
  }
}

async function isAdmin(uid: string, isSystemKey = false) {
  if (isSystemKey) return true
  const db = getAdminDb()
  const snap = await db.collection("users").doc(uid).get()
  if (!snap.exists) return false
  const roles = (snap.data() as Record<string, unknown>).roles
  return Array.isArray(roles) && roles.includes("beam-admin")
}

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveUser(req)
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    if (!(await isAdmin(caller.uid, caller.isSystemKey))) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 })
    }

    const db = getAdminDb()
    const clientIdFilter = req.nextUrl.searchParams.get("clientId")?.trim() || ""
    const workspaceIdFilter = req.nextUrl.searchParams.get("workspaceId")?.trim() || ""
    const statusFilter = req.nextUrl.searchParams.get("status")?.trim() || ""

    // Collection Group query to fetch all invoices across all clients
    let queryRef: FirebaseFirestore.Query = db.collectionGroup("invoices")

    if (clientIdFilter) {
      queryRef = queryRef.where("clientId", "==", clientIdFilter)
    }

    const snap = await queryRef.get()

    let invoices: ClientInvoice[] = snap.docs.map((d) =>
      normalizeInvoice(d.id, d.data() as Record<string, unknown>)
    )

    if (workspaceIdFilter) {
      invoices = invoices.filter((i) => i.workspaceId === workspaceIdFilter)
    }

    if (statusFilter) {
      invoices = invoices.filter((i) => i.status === statusFilter)
    }

    // Sort by createdAt / issueDate descending
    invoices.sort((a, b) => {
      const ta = a.createdAt || a.issueDate ? new Date(a.createdAt || a.issueDate).getTime() : 0
      const tb = b.createdAt || b.issueDate ? new Date(b.createdAt || b.issueDate).getTime() : 0
      return tb - ta
    })

    return NextResponse.json({
      success: true,
      data: invoices,
      invoices,
    })
  } catch (error) {
    console.error("GET /api/admin/invoices error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load admin invoices." },
      { status: 500 }
    )
  }
}
