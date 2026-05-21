"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { User, onAuthStateChanged } from "firebase/auth"
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore"
import { usePathname, useRouter } from "next/navigation"

import type { BeamRole, BeamUser } from "@/lib/beam"
import {
  deriveSourceNgo,
  getEffectiveRoles,
  hasAnyRole,
  normalizeBeamUserDocument,
} from "@/lib/beam"
import { getAuthInstance, getDb } from "@/lib/firebase/config"
import type { WorkspaceRole } from "@/lib/workspaces"
import { parseWorkspaceRole } from "@/lib/workspaces"

// ─── Context shape ────────────────────────────────────────────────────────────

interface AuthContextType {
  user: User | null
  beamUser: BeamUser | null
  effectiveRoles: BeamRole[]
  sourceNgo: string
  /** All workspace IDs the signed-in user belongs to. */
  workspaceIds: string[]
  /** The primary (first) workspace — used as the default landing workspace. */
  primaryWorkspaceId: string | null
  /** The signed-in user's role in `primaryWorkspaceId`. */
  workspaceRole: WorkspaceRole | null
  loading: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  beamUser: null,
  effectiveRoles: [],
  sourceNgo: deriveSourceNgo(
    typeof window !== "undefined" ? window.location.hostname : undefined
  ),
  workspaceIds: [],
  primaryWorkspaceId: null,
  workspaceRole: null,
  loading: true,
})

// ─── Constants ────────────────────────────────────────────────────────────────

/** Routes that require a signed-in user — unauthenticated visitors are sent to /login. */
const AUTH_REQUIRED_PREFIXES = [
  "/claim-workspace",
  "/dashboard",
  "/admin",
  "/workspace",
  "/settings",
  "/partner",
]

/** Staff roles that bypass the ragAllowlist gate on /settings. */
const STAFF_ROLES: BeamRole[] = [
  "beam-admin",
  "rag-lead",
  "ngo-coordinator",
  "client-manager",
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calls the join endpoint which:
 *   1. Fulfils any pending email invites for the user
 *   2. Auto-assigns them to workspaces whose `domains` match their email
 *
 * Returns the (possibly updated) workspaceIds array.
 * Fire-and-forget safe — always resolves, never throws.
 */
async function fulfillWorkspaceMembership(user: User): Promise<string[]> {
  try {
    const token = await user.getIdToken()
    const res = await fetch("/api/workspaces/join", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    })
    if (!res.ok) return []
    const payload = (await res.json()) as { workspaceIds?: string[] }
    return Array.isArray(payload.workspaceIds) ? payload.workspaceIds : []
  } catch {
    return []
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [beamUser, setBeamUser] = useState<BeamUser | null>(null)
  const [effectiveRoles, setEffectiveRoles] = useState<BeamRole[]>([])
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([])
  const [primaryWorkspaceId, setPrimaryWorkspaceId] = useState<string | null>(null)
  const [workspaceRole, setWorkspaceRole] = useState<WorkspaceRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [sourceNgo] = useState(
    deriveSourceNgo(typeof window !== "undefined" ? window.location.hostname : undefined)
  )

  useEffect(() => {
    let userDocUnsubscribe: Unsubscribe | null = null
    let memberDocUnsubscribe: Unsubscribe | null = null
    let activeUid: string | null = null
    let activePrimaryWorkspaceId: string | null = null
    let cancelled = false

    const clearLiveProfileListeners = () => {
      userDocUnsubscribe?.()
      memberDocUnsubscribe?.()
      userDocUnsubscribe = null
      memberDocUnsubscribe = null
      activePrimaryWorkspaceId = null
    }

    const redirectForWorkspaceState = async (
      nextUser: User,
      mergedIds: string[],
      nextEffectiveRoles: BeamRole[]
    ) => {
      const isClaimRoute =
        pathname === "/claim-workspace" || pathname.startsWith("/claim-workspace/")
      const isAuthRoute =
        pathname === "/login" ||
        pathname.startsWith("/login/") ||
        pathname === "/signup" ||
        pathname.startsWith("/signup/")
      const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/")
      const isDashboardRoute = pathname === "/dashboard" || pathname.startsWith("/dashboard/")
      const isDebugRoute = pathname === "/debug" || pathname.startsWith("/debug/")

      if (
        mergedIds.length === 0 &&
        !isClaimRoute &&
        !isAuthRoute &&
        !isAdminRoute &&
        !isDashboardRoute &&
        !isDebugRoute
      ) {
        router.replace("/claim-workspace")
        return
      }

      if (mergedIds.length > 0 && isClaimRoute) {
        router.replace("/dashboard")
        return
      }

      if (
        (pathname === "/settings" || pathname.startsWith("/settings/")) &&
        !hasAnyRole(nextEffectiveRoles, STAFF_ROLES)
      ) {
        try {
          const token = await nextUser.getIdToken()
          const res = await fetch("/api/client-portal/identity", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          })
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
              reason?: string
            } | null
            if (body?.reason === "revoked") {
              router.replace("/no-access")
            }
          }
        } catch {
          // Non-fatal. The workspace listener remains the authoritative gate.
        }
      }
    }

    let auth
    try {
      auth = getAuthInstance()
    } catch (error) {
      console.error("AuthProvider: Firebase Auth could not initialize:", error)
      setUser(null)
      setBeamUser(null)
      setEffectiveRoles([])
      setWorkspaceIds([])
      setPrimaryWorkspaceId(null)
      setWorkspaceRole(null)
      setLoading(false)
      return
    }

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      clearLiveProfileListeners()
      setLoading(true)
      setUser(nextUser)
      activeUid = nextUser?.uid ?? null

      if (!nextUser) {
        setBeamUser(null)
        setEffectiveRoles([])
        setWorkspaceIds([])
        setPrimaryWorkspaceId(null)
        setWorkspaceRole(null)
        setLoading(false)

        // Redirect away from protected pages
        const needsAuth = AUTH_REQUIRED_PREFIXES.some(
          (p) => pathname === p || pathname.startsWith(`${p}/`)
        )
        if (needsAuth) {
          router.replace(`/login?redirect=${encodeURIComponent(pathname)}`)
        }
        return
      }

      const db = getDb()
      const joinPromise = fulfillWorkspaceMembership(nextUser)

      // Presence — fire-and-forget, never blocks auth flow.
      void setDoc(
        doc(db, "users", nextUser.uid),
        { lastSeenAt: serverTimestamp() },
        { merge: true }
      ).catch(() => {})

      userDocUnsubscribe = onSnapshot(
        doc(db, "users", nextUser.uid),
        async (snapshot) => {
          if (cancelled || activeUid !== nextUser.uid) return

          const userData = snapshot.exists()
            ? (snapshot.data() as Record<string, unknown>)
            : null

          const nextBeamUser = normalizeBeamUserDocument(
            nextUser.uid,
            userData,
            {
              email: nextUser.email,
              displayName: nextUser.displayName,
              photoURL: nextUser.photoURL,
            },
            sourceNgo
          )
          const nextEffectiveRoles = getEffectiveRoles({
            uid: nextUser.uid,
            roles: nextBeamUser.roles,
          })

          const rawWsIds = Array.isArray(userData?.workspaceIds)
            ? (userData!.workspaceIds as unknown[]).filter(
                (id): id is string => typeof id === "string"
              )
            : []

        const joinedIds = await joinPromise.catch(() => [])
        if (cancelled || activeUid !== nextUser.uid) return
        const mergedIds = Array.from(new Set([...rawWsIds, ...joinedIds]))
        const primary = mergedIds[0] ?? null

        setBeamUser(nextBeamUser)
        setEffectiveRoles(nextEffectiveRoles)
        setWorkspaceIds(mergedIds)
        setPrimaryWorkspaceId(primary)

        if (activePrimaryWorkspaceId !== primary) {
          memberDocUnsubscribe?.()
          memberDocUnsubscribe = null
          activePrimaryWorkspaceId = primary
          setWorkspaceRole(null)

          if (primary) {
            memberDocUnsubscribe = onSnapshot(
              doc(db, "workspaces", primary, "members", nextUser.uid),
              (memberSnap) => {
                if (cancelled || activeUid !== nextUser.uid) return
                const role = memberSnap.exists()
                  ? parseWorkspaceRole((memberSnap.data() as Record<string, unknown>).role)
                  : null
                setWorkspaceRole(role)
                setLoading(false)
              },
              () => {
                if (cancelled || activeUid !== nextUser.uid) return
                setWorkspaceRole(null)
                setLoading(false)
              }
            )
          } else {
            setLoading(false)
          }
        } else {
          setLoading(false)
        }

        if (process.env.NEXT_PUBLIC_DEBUG_AUTH === "true") {
          console.log("AuthProvider workspace resolution", {
            uid: nextUser.uid,
            email: nextUser.email,
            activeClientId: primary,
            workspaceIds: mergedIds,
            primaryWorkspaceId: primary,
            workspaceRole: "live-member-listener",
            currentUser: {
              uid: nextUser.uid,
              email: nextUser.email,
              displayName: nextUser.displayName,
              providerData: nextUser.providerData,
            },
            pathname,
          })
        }

        await redirectForWorkspaceState(nextUser, mergedIds, nextEffectiveRoles)
      },
      (err) => {
        console.error("AuthProvider: error loading user profile:", err)

        // Fallback: best-effort BeamUser from Firebase Auth fields
        const fallback = normalizeBeamUserDocument(
          nextUser.uid,
          null,
          {
            email: nextUser.email,
            displayName: nextUser.displayName,
            photoURL: nextUser.photoURL,
          },
          sourceNgo
        )
        setBeamUser(fallback)
        setEffectiveRoles(getEffectiveRoles({ uid: nextUser.uid, roles: fallback.roles }))
        setWorkspaceIds([])
        setPrimaryWorkspaceId(null)
        setWorkspaceRole(null)

        if (process.env.NEXT_PUBLIC_DEBUG_AUTH === "true") {
          console.log("AuthProvider workspace resolution fallback", {
            uid: nextUser.uid,
            email: nextUser.email,
            activeClientId: null,
            workspaceIds: [],
            currentUser: {
              uid: nextUser.uid,
              email: nextUser.email,
              displayName: nextUser.displayName,
              providerData: nextUser.providerData,
            },
            pathname,
          })
        }

        const isClaimRoute =
          pathname === "/claim-workspace" || pathname.startsWith("/claim-workspace/")
        const isAuthRoute =
          pathname === "/login" ||
          pathname.startsWith("/login/") ||
          pathname === "/signup" ||
          pathname.startsWith("/signup/")
        const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/")
        const isDashboardRoute = pathname === "/dashboard" || pathname.startsWith("/dashboard/")
        const isDebugRoute = pathname === "/debug" || pathname.startsWith("/debug/")

        if (!isClaimRoute && !isAuthRoute && !isAdminRoute && !isDashboardRoute && !isDebugRoute) {
          router.replace("/claim-workspace")
        }
        setLoading(false)
      }
      )
    })

    return () => {
      cancelled = true
      unsubscribe()
      clearLiveProfileListeners()
    }
  }, [pathname, router, sourceNgo])

  return (
    <AuthContext.Provider
      value={{
        user,
        beamUser,
        effectiveRoles,
        sourceNgo,
        workspaceIds,
        primaryWorkspaceId,
        workspaceRole,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
