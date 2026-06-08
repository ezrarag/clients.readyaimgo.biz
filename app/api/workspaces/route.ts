import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { buildFirebaseAuthFailureDiagnostics } from "@/lib/firebase-diagnostics"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import {
  assetProjectTypeLabel,
  generateWorkspaceId,
  normalizeWorkspace,
  normalizeWorkspaceMember,
  parseAssetProjectType,
  parseWorkspaceRole,
  slugifyWorkspaceName,
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

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function workspaceNameSlug(data: Record<string, unknown>) {
  const name =
    readString(data.workspaceName) ||
    readString(data.businessName) ||
    readString(data.clientBusinessName) ||
    readString(data.name) ||
    ""
  return slugifyWorkspaceName(name)
}

function safeProjectDocId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180)
}

function initialProjectId(workspaceId: string, projectType: ReturnType<typeof parseAssetProjectType>) {
  return safeProjectDocId(`${workspaceId}__initial__${projectType}`)
}

function buildInitialProject({
  projectId,
  workspaceId,
  workspaceName,
  projectType,
  clientId,
  uid,
  email,
  now,
}: {
  projectId: string
  workspaceId: string
  workspaceName: string
  projectType: ReturnType<typeof parseAssetProjectType>
  clientId: string | null
  uid: string
  email: string
  now: FirebaseFirestore.FieldValue
}) {
  const label = assetProjectTypeLabel(projectType)
  const title = `${workspaceName} ${label}`.trim()
  return {
    id: projectId,
    name: title,
    title,
    summary: `${label} project created from the workspace dashboard.`,
    description: `${label} project created from the workspace dashboard.`,
    workspaceId,
    clientId,
    assetProjectType: projectType,
    projectType,
    status: "scoping",
    source: "dashboard-create",
    sourceNgo: "readyaimgo",
    createdByUid: uid,
    createdByEmail: email.toLowerCase(),
    createdAt: now,
    updatedAt: now,
  }
}

async function findExistingWorkspaceForName({
  db,
  uid,
  clientId,
  name,
}: {
  db: FirebaseFirestore.Firestore
  uid: string
  clientId: string | null
  name: string
}) {
  const targetSlug = slugifyWorkspaceName(name)
  if (!targetSlug) return null

  const [ownerSnap, clientSnap] = await Promise.all([
    db.collection("workspaces").where("ownerUid", "==", uid).limit(50).get().catch(() => null),
    clientId
      ? db.collection("workspaces").where("clientId", "==", clientId).limit(50).get().catch(() => null)
      : Promise.resolve(null),
  ])

  const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()
  for (const doc of ownerSnap?.docs ?? []) candidates.set(doc.id, doc)
  for (const doc of clientSnap?.docs ?? []) candidates.set(doc.id, doc)

  for (const doc of candidates.values()) {
    const data = doc.data() as Record<string, unknown>
    if (workspaceNameSlug(data) === targetSlug) {
      return { id: doc.id, data }
    }
  }

  return null
}

// ─── GET /api/workspaces — list workspaces for the calling user ───────────────

export async function GET(request: NextRequest) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    let decodedToken: Awaited<ReturnType<ReturnType<typeof getAdminAuth>["verifyIdToken"]>>
    try {
      decodedToken = await getAdminAuth().verifyIdToken(idToken)
    } catch (error) {
      console.warn(
        "GET /api/workspaces auth error:",
        buildFirebaseAuthFailureDiagnostics(idToken, error)
      )
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }
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

    const userSnap = await db.collection("users").doc(uid).get().catch(() => null)
    const userData = userSnap?.exists ? (userSnap.data() as Record<string, unknown>) : {}
    const workspaceIdsFromUser: string[] = Array.isArray(userData.workspaceIds)
      ? (userData.workspaceIds as string[]).filter((id) => typeof id === "string")
      : []

    // ── Fallback discovery ──────────────────────────────────────────────────
    // If workspaceIds is missing or empty on the user doc (e.g. data was
    // created before this field existed, or created in a different env),
    // run parallel fallback queries so the user's workspaces are always found.
    const [ownerSnap, memberGroupSnap] = await Promise.all([
      // Workspaces where this user is the ownerUid (single-field query, no index)
      db.collection("workspaces").where("ownerUid", "==", uid).limit(100).get().catch(() => null),
      // Workspaces where this user has a members subcollection doc
      // (collection group query — requires a composite index; soft-fails if absent)
      db.collectionGroup("members").where("uid", "==", uid).limit(100).get().catch(() => null),
    ])

    const discoveredIds = new Set<string>(workspaceIdsFromUser)

    for (const doc of ownerSnap?.docs ?? []) discoveredIds.add(doc.id)

    if (memberGroupSnap) {
      for (const memberDoc of memberGroupSnap.docs) {
        // parent path: workspaces/{workspaceId}/members/{uid}
        const workspaceId = memberDoc.ref.parent.parent?.id
        if (workspaceId) discoveredIds.add(workspaceId)
      }
    }

    // Back-fill workspaceIds on the user doc so future requests skip discovery
    if (discoveredIds.size > workspaceIdsFromUser.length) {
      db.collection("users")
        .doc(uid)
        .set(
          { workspaceIds: Array.from(discoveredIds), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
        .catch(() => undefined) // fire-and-forget, non-fatal
    }

    if (discoveredIds.size === 0) {
      return NextResponse.json({ success: true, workspaces: [] })
    }

    const workspaceEntries = await Promise.all(
      Array.from(discoveredIds).map(async (id) => {
        try {
          const [workspaceSnap, memberSnap, membersSnap] = await Promise.all([
            db.collection("workspaces").doc(id).get(),
            db.collection("workspaces").doc(id).collection("members").doc(uid).get(),
            db.collection("workspaces").doc(id).collection("members").limit(50).get(),
          ])
          return { workspaceSnap, memberSnap, membersSnap }
        } catch (error) {
          console.warn(`GET /api/workspaces: failed to read workspace ${id}`, error)
          return null
        }
      })
    )

    const workspaces = workspaceEntries
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
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
      // Sort newest first
      .sort((a, b) => {
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return tb - ta
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

    let decodedToken: Awaited<ReturnType<ReturnType<typeof getAdminAuth>["verifyIdToken"]>>
    try {
      decodedToken = await getAdminAuth().verifyIdToken(idToken)
    } catch (error) {
      console.warn(
        "POST /api/workspaces auth error:",
        buildFirebaseAuthFailureDiagnostics(idToken, error)
      )
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }
    const uid = decodedToken.uid
    const email = decodedToken.email ?? ""
    const db = getAdminDb()

    const body = (await request.json()) as Record<string, unknown>
    const name =
      typeof body.name === "string" && body.name.trim() ? body.name.trim() : null
    const initialProjectType = parseAssetProjectType(body.initialProjectType)

    if (!name) {
      return NextResponse.json({ error: "name is required." }, { status: 400 })
    }

    // ── Bridge fields ──────────────────────────────────────────────────────────
    const requestedClientId =
      typeof body.clientId === "string" && body.clientId.trim()
        ? body.clientId.trim().toLowerCase()
        : null
    const emailClientId = email ? email.trim().toLowerCase() : null
    const clientId = requestedClientId ?? emailClientId
    const clientEmail =
      typeof body.clientEmail === "string" && body.clientEmail.trim()
        ? body.clientEmail.trim().toLowerCase()
        : emailClientId ?? clientId // fall back to authenticated email when available
    const orgId =
      typeof body.orgId === "string" && body.orgId.trim()
        ? body.orgId.trim()
        : null

    // Mirror stripeCustomerId from the existing client doc if available
    let stripeCustomerId: string | null = null
    let existingClientData: Record<string, unknown> | null = null
    if (clientId) {
      try {
        const clientSnap = await db.collection("clients").doc(clientId).get()
        if (clientSnap.exists) {
          const cd = clientSnap.data() as Record<string, unknown>
          existingClientData = cd
          stripeCustomerId =
            typeof cd.stripeCustomerId === "string" ? cd.stripeCustomerId : null
        }
      } catch {
        // Non-fatal — proceed without Stripe data
      }
    }

    const now = FieldValue.serverTimestamp()
    const existingWorkspace = await findExistingWorkspaceForName({
      db,
      uid,
      clientId,
      name,
    })

    if (existingWorkspace) {
      const workspaceRef = db.collection("workspaces").doc(existingWorkspace.id)
      const batch = db.batch()
      const projectId = initialProjectId(existingWorkspace.id, initialProjectType)
      const projectRef = db.collection("projects").doc(projectId)

      batch.set(
        workspaceRef,
        {
          ownerUid: readString(existingWorkspace.data.ownerUid) || uid,
          projectIds: FieldValue.arrayUnion(projectId),
          updatedAt: now,
        },
        { merge: true }
      )
      batch.set(
        projectRef,
        buildInitialProject({
          projectId,
          workspaceId: existingWorkspace.id,
          workspaceName:
            readString(existingWorkspace.data.workspaceName) ||
            readString(existingWorkspace.data.name) ||
            name,
          projectType: initialProjectType,
          clientId,
          uid,
          email,
          now,
        }),
        { merge: true }
      )
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
          workspaceIds: FieldValue.arrayUnion(existingWorkspace.id),
          lastSeenAt: now,
          updatedAt: now,
        },
        { merge: true }
      )

      if (clientId) {
        batch.set(
          db.collection("clients").doc(clientId),
          {
            uid,
            businessEmail: clientEmail,
            email: clientEmail,
            workspaceId: existingWorkspace.id,
            workspaceIds: FieldValue.arrayUnion(existingWorkspace.id),
            adminApprovalPending:
              typeof existingClientData?.adminApprovalPending === "boolean"
                ? existingClientData.adminApprovalPending
                : true,
            updatedAt: now,
          },
          { merge: true }
        )
      }

      await batch.commit()

      return NextResponse.json(
        {
          success: true,
          workspace: normalizeWorkspace(existingWorkspace.id, {
            ...existingWorkspace.data,
            ownerUid: readString(existingWorkspace.data.ownerUid) || uid,
            projectIds: Array.from(
              new Set([
                ...(Array.isArray(existingWorkspace.data.projectIds)
                  ? (existingWorkspace.data.projectIds as unknown[]).filter(
                      (id): id is string => typeof id === "string"
                    )
                  : []),
                projectId,
              ])
            ),
            updatedAt: new Date().toISOString(),
          }),
          reused: true,
        },
        { status: 200 }
      )
    }

    const workspaceId = generateWorkspaceId(name)
    const projectId = initialProjectId(workspaceId, initialProjectType)
    const batch = db.batch()

    const workspaceRef = db.collection("workspaces").doc(workspaceId)
    const projectRef = db.collection("projects").doc(projectId)

    const workspaceDoc: Record<string, unknown> = {
      name,
      workspaceName: name,
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
      projectIds: [projectId],
      contractIds: [],
      createdAt: now,
      updatedAt: now,
    }

    batch.set(workspaceRef, workspaceDoc)
    batch.set(
      projectRef,
      buildInitialProject({
        projectId,
        workspaceId,
        workspaceName: name,
        projectType: initialProjectType,
        clientId,
        uid,
        email,
        now,
      })
    )

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
        {
          uid,
          businessEmail: clientEmail,
          email: clientEmail,
          clientBusinessName:
            typeof existingClientData?.clientBusinessName === "string"
              ? existingClientData.clientBusinessName
              : name,
          companyName:
            typeof existingClientData?.companyName === "string"
              ? existingClientData.companyName
              : name,
          workspaceId,
          workspaceIds: FieldValue.arrayUnion(workspaceId),
          adminApprovalPending:
            typeof existingClientData?.adminApprovalPending === "boolean"
              ? existingClientData.adminApprovalPending
              : true,
          createdAt: existingClientData?.createdAt ?? now,
          updatedAt: now,
        },
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
