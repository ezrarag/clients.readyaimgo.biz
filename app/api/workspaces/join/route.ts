/**
 * POST /api/workspaces/join
 *
 * Called by AuthProvider on every sign-in. Performs two workspace-membership
 * actions for the authenticated user and returns their final workspaceIds:
 *
 *   1. Pending-invite fulfilment — any workspace that has a pendingInvites doc
 *      keyed to the user's email gets converted into a live member doc.
 *      (Requires a Firestore collection-group index on pendingInvites.email —
 *       silently skipped if the index doesn't exist yet.)
 *
 *   2. Domain auto-assignment — any workspace whose `domains` array contains
 *      the user's email domain gets them added at `domainRole`.
 *
 * Always returns 200 with the user's current workspaceIds — never 500.
 * Individual query failures are logged and skipped.
 */

import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { buildFirebaseAuthFailureDiagnostics } from "@/lib/firebase-diagnostics"
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { parseWorkspaceRole } from "@/lib/workspaces"
import type { WorkspaceRole } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

function isArchivedWorkspace(data: Record<string, unknown>) {
  return (
    (typeof data.status === "string" && data.status === "archived") ||
    (typeof data.archivedDuplicateOf === "string" && data.archivedDuplicateOf.trim().length > 0)
  )
}

export async function POST(request: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const idToken = getBearerToken(request)
  if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

  let uid: string
  let email: string | undefined

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken)
    uid = decoded.uid
    email = decoded.email
  } catch (error) {
    console.warn(
      "workspaces/join: token verification failed",
      buildFirebaseAuthFailureDiagnostics(idToken, error)
    )
    return NextResponse.json({ error: "Invalid token." }, { status: 401 })
  }

  if (!email) {
    // Phone-only accounts have no email — no-op, return empty list.
    return NextResponse.json({ workspaceIds: [] })
  }

  const db = getAdminDb()
  const now = FieldValue.serverTimestamp()
  const emailKey = email.toLowerCase()
  const emailDomain = emailKey.split("@")[1] ?? ""

  // ── 1. Read current workspaceIds from the user doc ───────────────────────────
  const userRef = db.collection("users").doc(uid)
  let userData: Record<string, unknown> | null = null
  try {
    const userSnap = await userRef.get()
    userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : null
  } catch (err) {
    console.warn("workspaces/join: could not read user doc", err)
  }

  const existingIds: string[] = Array.isArray(userData?.workspaceIds)
    ? (userData!.workspaceIds as unknown[]).filter(
        (id): id is string => typeof id === "string"
      )
    : []
  const existingSet = new Set(existingIds)
  const newWorkspaceIds: string[] = []
  const archivedExistingIds: string[] = []

  if (existingIds.length > 0) {
    const existingSnaps = await Promise.all(
      existingIds.map((workspaceId) => db.collection("workspaces").doc(workspaceId).get().catch(() => null))
    )
    for (const snap of existingSnaps) {
      if (!snap?.exists) continue
      const workspaceData = snap.data() as Record<string, unknown>
      if (isArchivedWorkspace(workspaceData)) {
        existingSet.delete(snap.id)
        archivedExistingIds.push(snap.id)
      }
    }
  }

  const displayName =
    typeof userData?.displayName === "string" ? userData.displayName : null

  // ── 2. Pending-invite fulfilment ─────────────────────────────────────────────
  // Requires a Firestore collection-group index on the `email` field of
  // the `pendingInvites` subcollection. If the index is missing, Firestore
  // throws FAILED_PRECONDITION — we catch it and skip gracefully.
  try {
    const pendingSnap = await db
      .collectionGroup("pendingInvites")
      .where("email", "==", emailKey)
      .get()

    for (const inviteDoc of pendingSnap.docs) {
      const workspaceRef = inviteDoc.ref.parent.parent
      if (!workspaceRef) continue

      const workspaceId = workspaceRef.id
      const workspaceSnap = await workspaceRef.get().catch(() => null)
      const workspaceData = workspaceSnap?.exists ? (workspaceSnap.data() as Record<string, unknown>) : null
      if (!workspaceData || isArchivedWorkspace(workspaceData)) {
        await inviteDoc.ref.delete().catch(() => {})
        existingSet.delete(workspaceId)
        continue
      }

      // Clean up stale invite even if already a member
      if (existingSet.has(workspaceId)) {
        await inviteDoc.ref.delete().catch(() => {})
        continue
      }

      const inviteData = inviteDoc.data() as Record<string, unknown>
      const role: WorkspaceRole =
        parseWorkspaceRole(inviteData.role) ?? "collaborator"

      try {
        const batch = db.batch()
        batch.set(workspaceRef.collection("members").doc(uid), {
          uid,
          email: emailKey,
          displayName,
          role,
          addedAt: now,
          assignedRepos: [],
          assignedVercelIds: [],
        })
        batch.set(
          workspaceRef,
          { memberCount: FieldValue.increment(1), updatedAt: now },
          { merge: true }
        )
        batch.delete(inviteDoc.ref)
        await batch.commit()

        existingSet.add(workspaceId)
        newWorkspaceIds.push(workspaceId)
      } catch (err) {
        console.warn(`workspaces/join: failed to fulfil invite for ${workspaceId}`, err)
      }
    }
  } catch (err) {
    // Most likely: collection-group index not yet created.
    console.warn(
      "workspaces/join: pendingInvites collectionGroup query failed (index may be missing):",
      err
    )
  }

  // ── 3. Domain auto-assignment ─────────────────────────────────────────────────
  if (emailDomain) {
    try {
      const domainSnap = await db
        .collection("workspaces")
        .where("domains", "array-contains", emailDomain)
        .get()

      for (const wsDoc of domainSnap.docs) {
        const workspaceId = wsDoc.id
        if (existingSet.has(workspaceId)) continue

        const wsData = wsDoc.data() as Record<string, unknown>
        if (isArchivedWorkspace(wsData)) {
          existingSet.delete(workspaceId)
          continue
        }
        const role: WorkspaceRole =
          parseWorkspaceRole(wsData.domainRole) ?? "employee-of-client"

        try {
          const batch = db.batch()
          batch.set(wsDoc.ref.collection("members").doc(uid), {
            uid,
            email: emailKey,
            displayName,
            role,
            addedAt: now,
            assignedRepos: [],
            assignedVercelIds: [],
          })
          batch.set(
            wsDoc.ref,
            { memberCount: FieldValue.increment(1), updatedAt: now },
            { merge: true }
          )
          await batch.commit()

          existingSet.add(workspaceId)
          newWorkspaceIds.push(workspaceId)
        } catch (err) {
          console.warn(`workspaces/join: failed to auto-assign domain workspace ${workspaceId}`, err)
        }
      }
    } catch (err) {
      console.warn("workspaces/join: domain query failed:", err)
    }
  }

  // ── 4. Persist new ids back to the user doc ───────────────────────────────────
  if (newWorkspaceIds.length > 0 || archivedExistingIds.length > 0) {
    try {
      const update: Record<string, unknown> = { updatedAt: now }
      if (archivedExistingIds.length > 0) {
        update.workspaceIds = Array.from(existingSet)
      } else if (newWorkspaceIds.length > 0) {
        update.workspaceIds = FieldValue.arrayUnion(...newWorkspaceIds)
      }
      await userRef.set(update, { merge: true })
    } catch (err) {
      console.warn("workspaces/join: failed to update user workspaceIds", err)
    }
  }

  return NextResponse.json({ success: true, workspaceIds: Array.from(existingSet) })
}
