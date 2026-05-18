import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import {
  WorkspaceAuthError,
  assertWorkspaceRole,
  assertCanAssignRole,
  parseRole,
} from "@/lib/workspace-auth"
import { normalizeWorkspaceMember, parseWorkspaceRole } from "@/lib/workspaces"
import type { WorkspaceRole } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

// ─── GET /api/workspaces/[workspaceId]/members ────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    // Any canonical workspace member can read the list.
    await assertWorkspaceRole(db, params.workspaceId, decodedToken.uid, "beam-participant")

    const membersSnap = await db
      .collection("workspaces")
      .doc(params.workspaceId)
      .collection("members")
      .get()

    const members = membersSnap.docs.map((doc) =>
      normalizeWorkspaceMember(doc.id, doc.data() as Record<string, unknown>)
    )

    return NextResponse.json({ success: true, members })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "Unable to load members." }, { status: 500 })
  }
}

// ─── POST /api/workspaces/[workspaceId]/members — invite by email ─────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    // Only developers and owners can invite.
    const callerRole = await assertWorkspaceRole(
      db,
      params.workspaceId,
      decodedToken.uid,
      "developer"
    )

    const body = (await request.json()) as Record<string, unknown>
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : null
    const rawRole = parseWorkspaceRole(body.role)
    const role: WorkspaceRole = rawRole ?? "collaborator"

    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 })
    }

    // Validate the caller can assign this role
    assertCanAssignRole(callerRole, role)

    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const workspaceSnap = await workspaceRef.get()
    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 })
    }

    let targetUid: string | null = null
    let targetDisplayName: string | null = null

    try {
      const targetUser = await getAdminAuth().getUserByEmail(email)
      targetUid = targetUser.uid
      targetDisplayName = targetUser.displayName ?? null
    } catch {
      // User doesn't exist yet — invite will be waiting when they sign up
    }

    const now = FieldValue.serverTimestamp()

    if (targetUid) {
      // Add them as a member immediately and update their workspaceIds
      const batch = db.batch()
      batch.set(workspaceRef.collection("members").doc(targetUid), {
        uid: targetUid,
        email,
        displayName: targetDisplayName,
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
      batch.set(
        db.collection("users").doc(targetUid),
        { workspaceIds: FieldValue.arrayUnion(params.workspaceId), updatedAt: now },
        { merge: true }
      )
      await batch.commit()

      return NextResponse.json({
        success: true,
        status: "added",
        member: { uid: targetUid, email, displayName: targetDisplayName, role },
      })
    }

    // Store a pending invite
    await workspaceRef.collection("pendingInvites").doc(email.replace(/\./g, "_")).set({
      email,
      role,
      invitedByUid: decodedToken.uid,
      invitedAt: now,
    })

    return NextResponse.json({
      success: true,
      status: "invited",
      message: `Invite recorded. ${email} will be added when they sign in.`,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /members error:", error)
    return NextResponse.json({ error: "Unable to invite member." }, { status: 500 })
  }
}

// ─── PATCH /api/workspaces/[workspaceId]/members — change role ────────────────
//
// Body: { targetUid: string; role: WorkspaceRole }
// Rules:
//   - Caller must be developer or owner.
//   - Caller cannot demote themselves (prevents accidental self-lockout).
//   - Only owners can grant / remove the owner role.

export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    const callerRole = await assertWorkspaceRole(
      db,
      params.workspaceId,
      decodedToken.uid,
      "developer"
    )

    const body = (await request.json()) as Record<string, unknown>
    const targetUid =
      typeof body.targetUid === "string" ? body.targetUid.trim() : null
    const newRole = parseWorkspaceRole(body.role)

    if (!targetUid) {
      return NextResponse.json({ error: "targetUid is required." }, { status: 400 })
    }
    if (!newRole) {
      return NextResponse.json(
        {
          error:
            "role must be one of: owner, developer, collaborator, employee-of-client, beam-participant.",
        },
        { status: 400 }
      )
    }

    // Prevent self-demotion
    if (targetUid === decodedToken.uid) {
      return NextResponse.json(
        { error: "You cannot change your own role." },
        { status: 400 }
      )
    }

    // Role hierarchy check
    assertCanAssignRole(callerRole, newRole)

    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const memberRef = workspaceRef.collection("members").doc(targetUid)
    const memberSnap = await memberRef.get()

    if (!memberSnap.exists) {
      return NextResponse.json(
        { error: "Target user is not a member of this workspace." },
        { status: 404 }
      )
    }

    const currentRole = parseRole((memberSnap.data() as Record<string, unknown>).role)

    // Only owners can demote other owners
    if (currentRole === "owner" && callerRole !== "owner") {
      return NextResponse.json(
        { error: "Only owners can change another owner's role." },
        { status: 403 }
      )
    }

    await memberRef.set({ role: newRole }, { merge: true })
    await workspaceRef.set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true })

    return NextResponse.json({ success: true, targetUid, role: newRole })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("PATCH /members error:", error)
    return NextResponse.json({ error: "Unable to update member role." }, { status: 500 })
  }
}

// ─── DELETE /api/workspaces/[workspaceId]/members — remove a member ───────────
//
// Query param: ?targetUid=<uid>
// Rules:
//   - Owners can remove anyone.
//   - Developers can remove collaborators, client employees, and BEAM participants, but not owners/developers.
//   - Members can remove themselves (leave workspace) unless they are the sole owner.

export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    const { searchParams } = new URL(request.url)
    const targetUid = searchParams.get("targetUid") ?? decodedToken.uid
    const isSelfRemoval = targetUid === decodedToken.uid

    const callerRole = await assertWorkspaceRole(
      db,
      params.workspaceId,
      decodedToken.uid,
      "beam-participant" // Everyone can at least attempt (we check permissions below)
    )

    if (!isSelfRemoval && callerRole !== "owner" && callerRole !== "developer") {
      return NextResponse.json(
        { error: "Only developers and owners can remove other members." },
        { status: 403 }
      )
    }

    const workspaceRef = db.collection("workspaces").doc(params.workspaceId)
    const memberRef = workspaceRef.collection("members").doc(targetUid)
    const memberSnap = await memberRef.get()

    if (!memberSnap.exists) {
      return NextResponse.json(
        { error: "Target user is not a member of this workspace." },
        { status: 404 }
      )
    }

    const targetRole = parseRole((memberSnap.data() as Record<string, unknown>).role)

    // Developers can't remove owners or other developers.
    if (!isSelfRemoval && callerRole === "developer" && (targetRole === "owner" || targetRole === "developer")) {
      return NextResponse.json(
        { error: "Developers can only remove collaborators, client employees, and BEAM participants." },
        { status: 403 }
      )
    }

    // Prevent sole-owner from leaving
    if (targetRole === "owner") {
      const ownersSnap = await workspaceRef
        .collection("members")
        .where("role", "==", "owner")
        .get()
      if (ownersSnap.size <= 1) {
        return NextResponse.json(
          {
            error:
              "Cannot remove the sole owner. Promote another member to owner first.",
          },
          { status: 400 }
        )
      }
    }

    const now = FieldValue.serverTimestamp()
    const batch = db.batch()
    batch.delete(memberRef)
    batch.set(
      workspaceRef,
      { memberCount: FieldValue.increment(-1), updatedAt: now },
      { merge: true }
    )
    batch.set(
      db.collection("users").doc(targetUid),
      { workspaceIds: FieldValue.arrayRemove(params.workspaceId), updatedAt: now },
      { merge: true }
    )
    await batch.commit()

    return NextResponse.json({ success: true, removed: targetUid })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("DELETE /members error:", error)
    return NextResponse.json({ error: "Unable to remove member." }, { status: 500 })
  }
}
