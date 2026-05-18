import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import {
  WorkspaceAuthError,
  assertWorkspaceRole,
  resolveWorkspaceContext,
} from "@/lib/workspace-auth"
import { normalizeWorkspace, parseWorkspaceRole } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

async function isAdmin(uid: string) {
  if (process.env.NEXT_PUBLIC_ADMIN_UID && uid === process.env.NEXT_PUBLIC_ADMIN_UID) {
    return true
  }
  const snap = await getAdminDb().collection("users").doc(uid).get()
  const roles = snap.exists ? (snap.data() as Record<string, unknown>).roles : null
  return Array.isArray(roles) && roles.includes("beam-admin")
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

function sanitizeHosting(value: unknown) {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  const flags =
    typeof raw.infrastructureFlags === "object" && raw.infrastructureFlags !== null
      ? (raw.infrastructureFlags as Record<string, unknown>)
      : {}
  const primaryProvider = [
    "vercel",
    "namecheap",
    "manual-dns",
    "static-host",
    "other",
  ].includes(String(raw.primaryProvider))
    ? raw.primaryProvider
    : "vercel"

  return {
    primaryProvider,
    domainRegistrars: Array.isArray(raw.domainRegistrars)
      ? raw.domainRegistrars.slice(0, 25).map((item, index) => {
          const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
          return {
            id: readString(entry.id) ?? `registrar-${index}`,
            registrar: entry.registrar === "namecheap" ? "namecheap" : "other",
            domain: readString(entry.domain) ?? "",
            nameservers: readStringArray(entry.nameservers),
            renewalDate: readString(entry.renewalDate),
            accountLabel: readString(entry.accountLabel),
            notes: readString(entry.notes),
          }
        })
      : [],
    manualDnsTargets: Array.isArray(raw.manualDnsTargets)
      ? raw.manualDnsTargets.slice(0, 50).map((item, index) => {
          const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
          const recordType = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"].includes(
            String(entry.recordType)
          )
            ? entry.recordType
            : "CNAME"
          const status = ["planned", "active", "needs-review"].includes(String(entry.status))
            ? entry.status
            : "planned"
          return {
            id: readString(entry.id) ?? `dns-${index}`,
            host: readString(entry.host) ?? "",
            recordType,
            value: readString(entry.value) ?? "",
            ttl: typeof entry.ttl === "number" && Number.isFinite(entry.ttl) ? entry.ttl : null,
            status,
            notes: readString(entry.notes),
          }
        })
      : [],
    staticHosts: Array.isArray(raw.staticHosts)
      ? raw.staticHosts.slice(0, 25).map((item, index) => {
          const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
          const provider = [
            "netlify",
            "cloudflare-pages",
            "github-pages",
            "firebase-hosting",
            "other",
          ].includes(String(entry.provider))
            ? entry.provider
            : "other"
          const status = ["planned", "active", "paused", "needs-review"].includes(String(entry.status))
            ? entry.status
            : "planned"
          return {
            id: readString(entry.id) ?? `static-${index}`,
            provider,
            projectName: readString(entry.projectName) ?? "",
            dashboardUrl: readString(entry.dashboardUrl),
            productionUrl: readString(entry.productionUrl),
            repoSlug: readString(entry.repoSlug),
            status,
          }
        })
      : [],
    infrastructureFlags: {
      hasExternalDns: Boolean(flags.hasExternalDns),
      hasManualRecords: Boolean(flags.hasManualRecords),
      hasStaticFallback: Boolean(flags.hasStaticFallback),
      needsDnsReview: Boolean(flags.needsDnsReview),
    },
    notes: readString(raw.notes),
  }
}

function sanitizeMeetingProviders(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 8).flatMap((item) => {
    const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
    const id = readString(entry.id)
    if (
      id !== "google-meet" &&
      id !== "zoom" &&
      id !== "microsoft-teams" &&
      id !== "facebook-messenger"
    ) {
      return []
    }
    const source =
      entry.source === "google-login" || entry.source === "profile" || entry.source === "ra-command"
        ? entry.source
        : "workspace"
    return [
      {
        id,
        enabled: Boolean(entry.enabled),
        label: readString(entry.label) ?? id,
        accountEmail: readString(entry.accountEmail),
        calendarId: readString(entry.calendarId),
        webhookUrl: readString(entry.webhookUrl),
        meetingBaseUrl: readString(entry.meetingBaseUrl),
        isDefault: Boolean(entry.isDefault),
        source,
      },
    ]
  })
}

// ─── GET /api/workspaces/[workspaceId] ────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    const { workspace } = await resolveWorkspaceContext(
      db,
      params.workspaceId,
      decodedToken.uid,
      "beam-participant"
    )

    return NextResponse.json({ success: true, workspace })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "Unable to load workspace." }, { status: 500 })
  }
}

// ─── PATCH /api/workspaces/[workspaceId] ─────────────────────────────────────
//
// Updatable fields (developers and above):
//   name          string
//   workspaceName string
//   githubOrg     string | null
//   vercelTeamId  string | null
//   domains       string[]        (email domain auto-join list)
//   domainRole    WorkspaceRole   (role granted to domain-matched users)
//   hosting       WorkspaceHostingConfig
//   meetingProviders WorkspaceMeetingProvider[]
//
// Requires owner:
//   (currently none beyond the above — future: billing, plan)

export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    if (!(await isAdmin(decodedToken.uid))) {
      await assertWorkspaceRole(db, params.workspaceId, decodedToken.uid, "developer")
    }

    const body = (await request.json()) as Record<string, unknown>

    // Build the update payload — only include recognised fields
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (typeof body.name === "string" && body.name.trim()) {
      update.name = body.name.trim()
    }

    if ("workspaceName" in body) {
      update.workspaceName =
        typeof body.workspaceName === "string" && body.workspaceName.trim()
          ? body.workspaceName.trim()
          : "Untitled Workspace"
    }

    if ("githubOrg" in body) {
      update.githubOrg =
        typeof body.githubOrg === "string" && body.githubOrg.trim()
          ? body.githubOrg.trim()
          : null
    }

    if ("vercelTeamId" in body) {
      update.vercelTeamId =
        typeof body.vercelTeamId === "string" && body.vercelTeamId.trim()
          ? body.vercelTeamId.trim()
          : null
    }

    if ("hosting" in body) {
      update.hosting = sanitizeHosting(body.hosting)
    }

    if ("meetingProviders" in body) {
      update.meetingProviders = sanitizeMeetingProviders(body.meetingProviders)
    }

    if ("domains" in body) {
      if (!Array.isArray(body.domains)) {
        return NextResponse.json(
          { error: "domains must be an array of strings." },
          { status: 400 }
        )
      }
      const domains = (body.domains as unknown[]).filter(
        (d): d is string => typeof d === "string" && d.trim().length > 0
      )
      update.domains = domains.map((d) => d.trim().toLowerCase())
    }

    if ("domainRole" in body) {
      const dr = parseWorkspaceRole(body.domainRole)
      if (!dr) {
        return NextResponse.json(
          {
            error:
              "domainRole must be one of: owner, developer, collaborator, employee-of-client, beam-participant.",
          },
          { status: 400 }
        )
      }
      update.domainRole = dr
    }

    // ── Legacy bridge fields (nullable strings / string arrays) ────────────────
    if ("clientId" in body) {
      update.clientId =
        typeof body.clientId === "string" && body.clientId.trim()
          ? body.clientId.trim().toLowerCase()
          : null
    }
    if ("clientEmail" in body) {
      update.clientEmail =
        typeof body.clientEmail === "string" && body.clientEmail.trim()
          ? body.clientEmail.trim().toLowerCase()
          : null
    }
    if ("orgId" in body) {
      update.orgId =
        typeof body.orgId === "string" && body.orgId.trim()
          ? body.orgId.trim()
          : null
    }
    if ("stripeCustomerId" in body) {
      update.stripeCustomerId =
        typeof body.stripeCustomerId === "string" && body.stripeCustomerId.trim()
          ? body.stripeCustomerId.trim()
          : null
    }
    if ("projectIds" in body) {
      update.projectIds = Array.isArray(body.projectIds)
        ? (body.projectIds as unknown[]).filter((p): p is string => typeof p === "string")
        : []
    }
    if ("contractIds" in body) {
      update.contractIds = Array.isArray(body.contractIds)
        ? (body.contractIds as unknown[]).filter((c): c is string => typeof c === "string")
        : []
    }

    if (Object.keys(update).length === 1) {
      // Only updatedAt was going to be set — nothing meaningful changed
      return NextResponse.json(
        { error: "No recognised fields provided." },
        { status: 400 }
      )
    }

    await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .set(update, { merge: true })

    return NextResponse.json({ success: true, updated: update })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("PATCH /workspaces/[id] error:", error)
    return NextResponse.json({ error: "Unable to update workspace." }, { status: 500 })
  }
}

// ─── DELETE /api/workspaces/[workspaceId] ────────────────────────────────────
//
// Owner-only. Deletes the workspace document and all subcollections
// (members, pendingInvites), and removes the workspaceId from every member's
// users/{uid}.workspaceIds array.

export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    // Only owners can delete
    if (!(await isAdmin(decodedToken.uid))) {
      await assertWorkspaceRole(db, params.workspaceId, decodedToken.uid, "owner")
    }

    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const workspaceSnap = await workspaceRef.get()
    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }

    // Collect all members so we can remove the workspaceId from their user docs
    const membersSnap = await workspaceRef.collection("members").get()
    const pendingSnap = await workspaceRef.collection("pendingInvites").get()

    const now = FieldValue.serverTimestamp()

    // Firestore batches are limited to 500 ops — chunk if necessary
    const memberUids = membersSnap.docs.map((d) => d.id)
    const allDeletes = [
      ...membersSnap.docs.map((d) => d.ref),
      ...pendingSnap.docs.map((d) => d.ref),
      workspaceRef,
    ]

    // Batch-delete workspace + subcollections
    const BATCH_SIZE = 490
    for (let i = 0; i < allDeletes.length; i += BATCH_SIZE) {
      const batch = db.batch()
      allDeletes.slice(i, i + BATCH_SIZE).forEach((ref) => batch.delete(ref))
      await batch.commit()
    }

    // Remove workspaceId from each member's user doc
    for (let i = 0; i < memberUids.length; i += BATCH_SIZE) {
      const batch = db.batch()
      memberUids.slice(i, i + BATCH_SIZE).forEach((uid) => {
        batch.set(
          db.collection("users").doc(uid),
          {
            workspaceIds: FieldValue.arrayRemove(params.workspaceId),
            updatedAt: now,
          },
          { merge: true }
        )
      })
      await batch.commit()
    }

    return NextResponse.json({ success: true, deleted: params.workspaceId })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("DELETE /workspaces/[id] error:", error)
    return NextResponse.json({ error: "Unable to delete workspace." }, { status: 500 })
  }
}
