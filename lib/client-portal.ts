/**
 * client-portal.ts
 *
 * Post-login routing helpers. The /org/* and legacy portal pages have been
 * removed — all authenticated users land on /dashboard (workspace list).
 */

type AuthLikeUser = {
  uid?: string | null
  email?: string | null
  displayName?: string | null
}

function normalizeEmail(email?: string | null) {
  return (email || "").trim().toLowerCase()
}

/**
 * Resolves the post-login destination for a user.
 *
 * Calls /api/organizations/resolve as a side-effect to ensure the user's
 * org record and users/{uid}.orgId cache are kept in sync, then always
 * returns /dashboard — the new workspace-first entry point.
 */
export async function resolveClientDestination(
  _firestoreDb: unknown,
  email?: string | null,
  user?: AuthLikeUser | null
): Promise<string> {
  const normalizedEmail = normalizeEmail(email)

  if (normalizedEmail && typeof window !== "undefined") {
    try {
      await fetch("/api/organizations/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          uid: user?.uid ?? null,
          name: user?.displayName ?? null,
        }),
      })
    } catch {
      // Non-fatal — org cache miss is acceptable
    }
  }

  return "/dashboard"
}
