import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import {
  generateWorkspaceId,
  normalizeWorkspace,
  normalizeWorkspaceMember,
  parseWorkspaceRole,
} from "@/lib/workspaces"

export const dynamic = "force-dynamic"

async function isAdmin(uid: string) {
  if (process.env.NEXT_PUBLIC_ADMIN_UID && uid === process.env.NEXT_PUBLIC_ADMIN_UID) {
    return true
  }
  const snap = await getAdminDb().collection("users").doc(uid).get()
  const roles = snap.exists ? (snap.data() as Record<string, unknown>).roles : null
  return Array.isArray(roles) && roles.includes("beam-admin")
}

// ─── GET /api/workspaces — list workspaces for the calling user ───────────────

export async function GET(request: NextRequest) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const uid = decodedToken.uid
    const db = getAdminDb()
    const adminParam = request.nextUrl.searchParams.get("admin") === "true"

    if (adminParam) {
      if (!(await isAdmin(uid))) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 })
      }

      const search = request.nextUrl.searchParams.get("search")?.trim().toLowerCase() || ""
      const snapshot = await db
        .collection("workspaces")
        .orderBy("updatedAt", "desc")
        .limit(500)
        .get()

      let workspaces = snapshot.docs.map((snap) =>
        normalizeWorkspace(snap.id, snap.data() as Record<string, unknown>)
      )

      if (search) {
        workspaces = workspaces.filter((workspace) =>
          [
            workspace.id,
            workspace.name,
            workspace.clientId ?? "",
            workspace.clientEmail ?? "",
            workspace.orgId ?? "",
            workspace.githubOrg ?? "",
            workspace.vercelTeamId ?? "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(search)
        )
      }

      return NextResponse.json({ success: true, workspaces })
    }

    const userSnap = await db.collection("users").doc(uid).get()
    const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {}
    const workspaceIds: string[] = Array.isArray(userData.workspaceIds)
      ? (userData.workspaceIds as string[]).filter((id) => typeof id === "string")
      : []

    if (workspaceIds.length === 0) {
      return NextResponse.json({ success: true, workspaces: [] })
    }

    const workspaceEntries = await Promise.all(
      workspaceIds.map(async (id) => {
        const [workspaceSnap, memberSnap, membersSnap] = await Promise.all([
          db.collection("workspaces").doc(id).get(),
          db.collection("workspaces").doc(id).collection("members").doc(uid).get(),
          db.collection("workspaces").doc(id).collection("members").limit(50).get(),
        ])
        return { workspaceSnap, memberSnap, membersSnap }
      })
    )

    const workspaces = workspaceEntries
      .filter(({ workspaceSnap }) => workspaceSnap.exists)
      .map(({ workspaceSnap, memberSnap, membersSnap }) => {
        const workspace = normalizeWorkspace(
          workspaceSnap.id,
          workspaceSnap.data() as Record<string, unknown>
        )
        const memberData = memberSnap.exists
          ? (memberSnap.data() as Record<string, unknown>)
          : null
        const memberSummaries = membersSnap.docs.map((memberDoc) => {
          const member = normalizeWorkspaceMember(
            memberDoc.id,
            memberDoc.data() as Record<string, unknown>
          )
          return {
            uid: member.uid,
            email: member.email,
            displayName: member.displayName,
            role: member.role,
          }
        })
        return {
          ...workspace,
          currentUserRole: parseWorkspaceRole(memberData?.role) ?? null,
          memberSummaries,
        }
      })

    return NextResponse.json({ success: true, workspaces })
  } catch (error) {
    console.error("GET /api/workspaces error:", error)
    return NextResponse.json({ error: "Unable to load workspaces." }, { status: 500 })
  }
}

// ─── POST /api/workspaces — create a new workspace ───────────────────────────
//
// Optional legacy bridge fields (all nullable):
//   clientId      — doc ID in clients/{clientId} (usually the email)
//   clientEmail   — canonical email if different from clientId
//   orgId         — linked organizations/{orgId} doc
//
// When clientId is supplied the route reads clients/{clientId} to mirror
// stripeCustomerId and writes workspaceId back onto the client doc so that
// the legacy identity chain can resolve the workspace going forward.

export async function POST(request: NextRequest) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const uid = decodedToken.uid
    const email = decodedToken.email ?? ""
    const db = getAdminDb()

    const body = (await request.json()) as Record<string, unknown>
    const name =
      typeof body.name === "string" && body.name.trim() ? body.name.trim() : null

    if (!name) {
      return NextResponse.json({ error: "name is required." }, { status: 400 })
    }

    // ── Bridge fields ──────────────────────────────────────────────────────────
    const clientId =
      typeof body.clientId === "string" && body.clientId.trim()
        ? body.clientId.trim().toLowerCase()
        : null
    const clientEmail =
      typeof body.clientEmail === "string" && body.clientEmail.trim()
        ? body.clientEmail.trim().toLowerCase()
        : clientId // fall back to clientId if it looks like an email
    const orgId =
      typeof body.orgId === "string" && body.orgId.trim()
        ? body.orgId.trim()
        : null

    // Mirror stripeCustomerId from the existing client doc if available
    let stripeCustomerId: string | null = null
    if (clientId) {
      try {
        const clientSnap = await db.collection("clients").doc(clientId).get()
        if (clientSnap.exists) {
          const cd = clientSnap.data() as Record<string, unknown>
          stripeCustomerId =
            typeof cd.stripeCustomerId === "string" ? cd.stripeCustomerId : null
        }
      } catch {
        // Non-fatal — proceed without Stripe data
      }
    }

    const workspaceId = generateWorkspaceId(name)
    const now = FieldValue.serverTimestamp()
    const batch = db.batch()

    const workspaceRef = db.collection("workspaces").doc(workspaceId)

    const workspaceDoc: Record<string, unknown> = {
      name,
      ownerUid: uid,
      repos: [],
      vercelProjects: [],
      memberCount: 1,
      domains: [],
      domainRole: "employee-of-client",
      githubOrg: null,
      vercelTeamId: null,
      hosting: {
        primaryProvider: "vercel",
        domainRegistrars: [],
        manualDnsTargets: [],
        staticHosts: [],
        infrastructureFlags: {
          hasExternalDns: false,
          hasManualRecords: false,
          hasStaticFallback: false,
          needsDnsReview: false,
        },
        notes: null,
      },
      meetingProviders: [],
      // Bridge fields — null when not supplied
      clientId,
      clientEmail,
      orgId,
      stripeCustomerId,
      projectIds: [],
      contractIds: [],
      createdAt: now,
      updatedAt: now,
    }

    batch.set(workspaceRef, workspaceDoc)

    batch.set(workspaceRef.collection("members").doc(uid), {
      uid,
      email,
      displayName: decodedToken.name ?? null,
      role: "owner",
      addedAt: now,
      assignedRepos: [],
      assignedVercelIds: [],
    })

    batch.set(
      db.collection("users").doc(uid),
      {
        workspaceIds: FieldValue.arrayUnion(workspaceId),
        lastSeenAt: now,
        updatedAt: now,
      },
      { merge: true }
    )

    // Write workspaceId back to clients/{clientId} so legacy resolution can
    // find this workspace without a full query.
    if (clientId) {
      batch.set(
        db.collection("clients").doc(clientId),
        { workspaceId, updatedAt: now },
        { merge: true }
      )
    }

    await batch.commit()

    const workspace = normalizeWorkspace(workspaceId, {
      ...workspaceDoc,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    return NextResponse.json({ success: true, workspace }, { status: 201 })
  } catch (error) {
    console.error("POST /api/workspaces error:", error)
    return NextResponse.json({ error: "Unable to create workspace." }, { status: 500 })
  }
}
