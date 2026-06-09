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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : []
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

function stripGeneratedSuffix(slug: string) {
  const match = slug.match(/^(.+)-[a-z0-9]{5}$/)
  return match?.[1] ? match[1] : slug
}

function normalizeDomain(value: string | null) {
  if (!value) return null
  const withoutProtocol = value.replace(/^https?:\/\//i, "").split("/")[0] ?? ""
  const normalized = withoutProtocol.replace(/^www\./i, "").trim().toLowerCase()
  return normalized || null
}

function normalizeRepo(value: string | null) {
  if (!value) return null
  return (
    value
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/\.git$/i, "")
      .trim()
      .toLowerCase() || null
  )
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function workspaceIsArchived(data: Record<string, unknown>) {
  return readString(data.status) === "archived" || Boolean(readString(data.archivedDuplicateOf))
}

function collectDomains(data: Record<string, unknown>) {
  const hosting = asRecord(data.hosting)
  const registrarDomains = Array.isArray(hosting.domainRegistrars)
    ? hosting.domainRegistrars.flatMap((item) => [readString(asRecord(item).domain)])
    : []
  const staticHosts = Array.isArray(hosting.staticHosts)
    ? hosting.staticHosts.flatMap((item) => [readString(asRecord(item).productionUrl)])
    : []
  const vercelDomains = Array.isArray(data.vercelProjects)
    ? data.vercelProjects.flatMap((project) => readStringArray(asRecord(project).domains))
    : []

  return unique(
    [
      readString(data.primaryDomain),
      readString(data.targetDomain),
      readString(data.productionUrl),
      readString(data.websiteUrl),
      readString(data.deployUrl),
      readString(data.liveUrl),
      readString(data.domain),
      readString(data.url),
      ...readStringArray(data.domains),
      ...registrarDomains,
      ...staticHosts,
      ...vercelDomains,
    ].map((value) => normalizeDomain(value ?? null))
  )
}

function collectRepos(data: Record<string, unknown>) {
  const repoObjects = Array.isArray(data.repos)
    ? data.repos.flatMap((repo) => {
        const record = asRecord(repo)
        return [readString(record.fullName), readString(record.url)]
      })
    : []
  const repository = asRecord(data.repository)

  return unique(
    [
      readString(data.githubRepo),
      readString(data.repo),
      readString(data.repository),
      readString(repository.fullName),
      readString(repository.url),
      ...readStringArray(data.githubRepos),
      ...readStringArray(data.repositoryChains),
      ...repoObjects,
    ].map((value) => normalizeRepo(value ?? null))
  )
}

function collectVercelKeys(data: Record<string, unknown>) {
  const projectObjects = Array.isArray(data.vercelProjects) ? data.vercelProjects : []
  return unique([
    readString(data.vercelProjectId),
    readString(data.vercelProjectName),
    readString(data.vercelProject),
    readString(data.vercelId),
    readString(data.vercelTeamId),
    ...readStringArray(data.vercelProjectIds),
    ...projectObjects.flatMap((project) => {
      const record = asRecord(project)
      return [
        readString(record.id),
        readString(record.name),
        normalizeDomain(readString(record.url)),
        ...readStringArray(record.domains).map((domain) => normalizeDomain(domain)),
      ]
    }),
  ])
}

function workspaceQualityScore(id: string, data: Record<string, unknown>) {
  const slug = workspaceNameSlug(data) || slugifyWorkspaceName(id)
  let score = 0
  if (collectDomains(data).length > 0) score += 120
  if (collectRepos(data).length > 0 || collectVercelKeys(data).length > 0) score += 90
  if (slug && slug !== "untitled-workspace") score += 45
  if (Array.isArray(data.projectIds) && data.projectIds.length > 0) score += 35
  if (typeof data.memberCount === "number" && data.memberCount > 0) score += 20
  if (stripGeneratedSuffix(slug) === slug) score += 10
  if (workspaceIsArchived(data)) score -= 500
  return score
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

async function findReusableWorkspaceCandidate({
  db,
  uid,
  userWorkspaceIds,
  clientId,
  clientEmail,
  name,
  requestData,
  existingClientData,
}: {
  db: FirebaseFirestore.Firestore
  uid: string
  userWorkspaceIds: string[]
  clientId: string | null
  clientEmail: string | null
  name: string
  requestData: Record<string, unknown>
  existingClientData: Record<string, unknown> | null
}) {
  const targetSlug = slugifyWorkspaceName(name)
  if (!targetSlug) return null
  const targetBaseSlug = stripGeneratedSuffix(targetSlug)
  const targetDomains = new Set(
    unique([
      ...collectDomains(requestData),
      ...collectDomains(existingClientData ?? {}),
    ])
  )
  const targetRepos = new Set(unique([...collectRepos(requestData), ...collectRepos(existingClientData ?? {})]))
  const targetVercelKeys = new Set(unique([...collectVercelKeys(requestData), ...collectVercelKeys(existingClientData ?? {})]))
  const explicitClientWorkspaceIds = new Set([
    readString(existingClientData?.workspaceId),
    ...readStringArray(existingClientData?.workspaceIds),
  ].filter((id): id is string => Boolean(id)))

  const [ownerSnap, clientSnap, clientEmailSnap, domainSnaps, linkedSnaps] = await Promise.all([
    db.collection("workspaces").where("ownerUid", "==", uid).limit(50).get().catch(() => null),
    clientId
      ? db.collection("workspaces").where("clientId", "==", clientId).limit(50).get().catch(() => null)
      : Promise.resolve(null),
    clientEmail
      ? db.collection("workspaces").where("clientEmail", "==", clientEmail).limit(50).get().catch(() => null)
      : Promise.resolve(null),
    Promise.all(
      Array.from(targetDomains)
        .slice(0, 10)
        .map((domain) =>
          db.collection("workspaces").where("domains", "array-contains", domain).limit(20).get().catch(() => null)
        )
    ),
    Promise.all(
      Array.from(new Set([...userWorkspaceIds, ...explicitClientWorkspaceIds]))
        .slice(0, 100)
        .map((workspaceId) => db.collection("workspaces").doc(workspaceId).get().catch(() => null))
    ),
  ])

  const candidates = new Map<string, FirebaseFirestore.DocumentSnapshot>()
  for (const doc of ownerSnap?.docs ?? []) candidates.set(doc.id, doc)
  for (const doc of clientSnap?.docs ?? []) candidates.set(doc.id, doc)
  for (const doc of clientEmailSnap?.docs ?? []) candidates.set(doc.id, doc)
  for (const snap of domainSnaps) {
    for (const doc of snap?.docs ?? []) candidates.set(doc.id, doc)
  }
  for (const snap of linkedSnaps) {
    if (snap?.exists) candidates.set(snap.id, snap as FirebaseFirestore.DocumentSnapshot)
  }

  const matches: Array<{ id: string; data: Record<string, unknown>; reasons: string[]; score: number }> = []
  for (const doc of candidates.values()) {
    const data = doc.data() as Record<string, unknown>
    if (workspaceIsArchived(data)) continue
    const reasons: string[] = []
    let score = 0
    const slug = workspaceNameSlug(data) || slugifyWorkspaceName(doc.id)
    const baseSlug = stripGeneratedSuffix(slug)
    const workspaceDomains = collectDomains(data)
    const workspaceRepos = collectRepos(data)
    const workspaceVercelKeys = collectVercelKeys(data)
    const ownerMatches = readString(data.ownerUid) === uid || userWorkspaceIds.includes(doc.id)

    if (explicitClientWorkspaceIds.has(doc.id)) {
      reasons.push("client workspace reference")
      score += 80
    }
    if (slug === targetSlug) {
      reasons.push("normalized name")
      score += 55
    } else if (baseSlug && baseSlug === targetBaseSlug) {
      reasons.push("generated suffix base name")
      score += 45
    }
    if (clientId && readString(data.clientId) === clientId) {
      reasons.push("clientId")
      score += 25
    }
    if (clientEmail && readString(data.clientEmail)?.toLowerCase() === clientEmail) {
      reasons.push("clientEmail")
      score += 25
    }
    if (ownerMatches) {
      reasons.push("owner or user workspace link")
      score += 20
    }
    if (workspaceDomains.some((domain) => targetDomains.has(domain))) {
      reasons.push("domain")
      score += 100
    }
    if (workspaceRepos.some((repo) => targetRepos.has(repo))) {
      reasons.push("GitHub repository")
      score += 90
    }
    if (workspaceVercelKeys.some((key) => targetVercelKeys.has(key))) {
      reasons.push("Vercel project")
      score += 90
    }

    const strongAssetMatch = score >= 70
    const nameOwnedMatch = score >= 55 && ownerMatches
    if (strongAssetMatch || nameOwnedMatch) {
      matches.push({ id: doc.id, data, reasons, score: score + workspaceQualityScore(doc.id, data) })
    }
  }

  matches.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return matches[0] ?? null
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
      .filter(({ workspaceSnap }) => !workspaceIsArchived(workspaceSnap.data() as Record<string, unknown>))
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

    const userSnap = await db.collection("users").doc(uid).get().catch(() => null)
    const userData = userSnap?.exists ? (userSnap.data() as Record<string, unknown>) : {}
    const userWorkspaceIds = readStringArray(userData.workspaceIds)
    const targetSlug = slugifyWorkspaceName(name)

    if (
      targetSlug === "untitled-workspace" &&
      (userWorkspaceIds.length > 0 || Boolean(clientId) || Boolean(existingClientData?.workspaceId))
    ) {
      return NextResponse.json(
        { error: "Untitled Workspace cannot be created when this account already has a workspace identity." },
        { status: 409 }
      )
    }

    const now = FieldValue.serverTimestamp()
    const existingWorkspace = await findReusableWorkspaceCandidate({
      db,
      uid,
      userWorkspaceIds,
      clientId,
      clientEmail,
      name,
      requestData: body,
      existingClientData,
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
          reuseReasons: existingWorkspace.reasons,
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
