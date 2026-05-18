/**
 * workspace-auth.ts
 *
 * Server-side RBAC helpers for workspace access control.
 * Import only from API routes / Server Components — never from client components.
 */

import type { Firestore } from "firebase-admin/firestore"

import { normalizeWorkspace } from "@/lib/workspaces"
import type { Workspace, WorkspaceRole } from "@/lib/workspaces"

// ─── Role hierarchy ───────────────────────────────────────────────────────────

/**
 * Numeric weight for each role.
 * Higher = more privileges.
 */
const ROLE_WEIGHT: Record<WorkspaceRole, number> = {
  owner: 50,
  developer: 40,
  collaborator: 30,
  "employee-of-client": 20,
  "beam-participant": 20,
}

/**
 * Returns true when `actual` satisfies the `required` minimum level.
 *
 * Examples:
 *   roleAtLeast("owner", "developer") → true
 *   roleAtLeast("developer", "owner") → false
 *   roleAtLeast("collaborator", "beam-participant") → true
 */
export function roleAtLeast(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_WEIGHT[actual] >= ROLE_WEIGHT[required]
}

// ─── Core guard ───────────────────────────────────────────────────────────────

export class WorkspaceAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 | 404 = 403
  ) {
    super(message)
    this.name = "WorkspaceAuthError"
  }
}

/**
 * Verify that `uid` is a member of `workspaceId` and holds at least `minRole`.
 *
 * Returns the caller's actual `WorkspaceRole` on success.
 * Throws `WorkspaceAuthError` (with an HTTP status) on failure — callers should
 * catch it and return the appropriate NextResponse:
 *
 * ```ts
 * try {
 *   const role = await assertWorkspaceRole(db, workspaceId, uid, "developer")
 * } catch (err) {
 *   if (err instanceof WorkspaceAuthError) {
 *     return NextResponse.json({ error: err.message }, { status: err.status })
 *   }
 *   throw err
 * }
 * ```
 */
export async function assertWorkspaceRole(
  db: Firestore,
  workspaceId: string,
  uid: string,
  minRole: WorkspaceRole = "beam-participant"
): Promise<WorkspaceRole> {
  if (!uid) throw new WorkspaceAuthError("Unauthorized.", 401)

  const memberSnap = await db
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .doc(uid)
    .get()

  if (!memberSnap.exists) {
    throw new WorkspaceAuthError("Not a member of this workspace.", 403)
  }

  const data = memberSnap.data() as Record<string, unknown>
  const role = parseRole(data.role)

  if (!roleAtLeast(role, minRole)) {
    throw new WorkspaceAuthError(
      `Requires ${minRole} role or above (you are ${role}).`,
      403
    )
  }

  return role
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely parse an unknown value into a WorkspaceRole, defaulting to "employee-of-client". */
export function parseRole(value: unknown): WorkspaceRole {
  if (
    value === "owner" ||
    value === "developer" ||
    value === "collaborator" ||
    value === "employee-of-client" ||
    value === "beam-participant"
  ) {
    return value
  }
  return "employee-of-client"
}

/**
 * Validate that `targetRole` is a legal role and that `callerRole` is
 * permitted to assign it.
 *
 * Rules:
 *  - Only owners can assign/demote to owner.
 *  - Developers can assign developer/collaborator/employee-of-client/beam-participant but NOT owner.
 *  - Collaborators, employees, and BEAM participants cannot change roles.
 */
export function assertCanAssignRole(
  callerRole: WorkspaceRole,
  targetRole: WorkspaceRole
): void {
  if (!roleAtLeast(callerRole, "developer")) {
    throw new WorkspaceAuthError("Only developers and owners can change roles.", 403)
  }
  if (targetRole === "owner" && callerRole !== "owner") {
    throw new WorkspaceAuthError("Only owners can grant the owner role.", 403)
  }
}

// ─── Workspace context resolver ───────────────────────────────────────────────

export interface WorkspaceContext {
  workspace: Workspace
  role: WorkspaceRole
}

/**
 * Single-call helper used by API routes that need both the workspace document
 * and the caller's role in one shot.
 *
 * Throws `WorkspaceAuthError` if:
 *   - the caller is not a member, or
 *   - the caller's role is below `minRole`, or
 *   - the workspace document does not exist.
 *
 * Usage:
 * ```ts
 * const { workspace, role } = await resolveWorkspaceContext(
 *   db, workspaceId, decodedToken.uid, "beam-participant"
 * )
 * ```
 */
export async function resolveWorkspaceContext(
  db: Firestore,
  workspaceId: string,
  uid: string,
  minRole: WorkspaceRole = "beam-participant"
): Promise<WorkspaceContext> {
  // assertWorkspaceRole already fetches the member doc — reuse it for the role
  const role = await assertWorkspaceRole(db, workspaceId, uid, minRole)

  const snap = await db.collection("workspaces").doc(workspaceId).get()
  if (!snap.exists) {
    throw new WorkspaceAuthError("Workspace not found.", 404)
  }

  const workspace = normalizeWorkspace(snap.id, snap.data() as Record<string, unknown>)
  return { workspace, role }
}
