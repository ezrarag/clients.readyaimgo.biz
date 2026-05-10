"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { User, onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { usePathname, useRouter } from "next/navigation"

import type { BeamRole, BeamUser } from "@/lib/beam"
import {
  deriveSourceNgo,
  getEffectiveRoles,
  hasAnyRole,
  normalizeBeamUserDocument,
} from "@/lib/beam"
import { getAuthInstance } from "@/lib/firebase/config"
import { getDb } from "@/lib/firebase/config"
import type { UserRole } from "@/lib/types/client-membership"

interface PortalIdentity {
  uid: string
  email: string | null
  activeClientId: string
  clientIds: string[]
  userRole: UserRole
}

interface AuthContextType {
  user: User | null
  beamUser: BeamUser | null
  effectiveRoles: BeamRole[]
  sourceNgo: string
  portalIdentity: PortalIdentity | null
  activeClientId: string | null
  clientIds: string[]
  userRole: UserRole | null
  loading: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  beamUser: null,
  effectiveRoles: [],
  sourceNgo: deriveSourceNgo(typeof window !== "undefined" ? window.location.hostname : undefined),
  portalIdentity: null,
  activeClientId: null,
  clientIds: [],
  userRole: null,
  loading: true,
})

const CLIENT_PROTECTED_PATHS = ["/dashboard", "/settings", "/portal"]
const STAFF_ROLES: BeamRole[] = [
  "beam-admin",
  "rag-lead",
  "ngo-coordinator",
  "client-manager",
]

async function resolvePortalIdentity(user: User): Promise<PortalIdentity | null> {
  try {
    const token = await user.getIdToken()
    const response = await fetch("/api/client-portal/identity", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as {
      identity?: PortalIdentity | null
    }

    return payload.identity ?? null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [beamUser, setBeamUser] = useState<BeamUser | null>(null)
  const [effectiveRoles, setEffectiveRoles] = useState<BeamRole[]>([])
  const [portalIdentity, setPortalIdentity] = useState<PortalIdentity | null>(null)
  const [loading, setLoading] = useState(true)
  const [sourceNgo] = useState(
    deriveSourceNgo(typeof window !== "undefined" ? window.location.hostname : undefined)
  )

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getAuthInstance(), async (nextUser) => {
      setLoading(true)
      setUser(nextUser)

      if (!nextUser) {
        setBeamUser(null)
        setEffectiveRoles([])
        setPortalIdentity(null)
        setLoading(false)
        return
      }

      const db = getDb()

      try {
        const snapshot = await getDoc(doc(db, "users", nextUser.uid))
        const nextBeamUser = normalizeBeamUserDocument(
          nextUser.uid,
          snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : null,
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
        const nextPortalIdentity = await resolvePortalIdentity(nextUser)
        const isClientProtectedPath = CLIENT_PROTECTED_PATHS.some(
          (path) => pathname === path || pathname.startsWith(`${path}/`)
        )

        setBeamUser(nextBeamUser)
        setEffectiveRoles(nextEffectiveRoles)
        setPortalIdentity(nextPortalIdentity)

        if (
          isClientProtectedPath &&
          !nextPortalIdentity &&
          !hasAnyRole(nextEffectiveRoles, STAFF_ROLES)
        ) {
          router.replace("/no-access")
          return
        }
      } catch (error) {
        console.error("Unable to load BEAM user profile:", error)

        const fallbackBeamUser = normalizeBeamUserDocument(
          nextUser.uid,
          null,
          {
            email: nextUser.email,
            displayName: nextUser.displayName,
            photoURL: nextUser.photoURL,
          },
          sourceNgo
        )
        const fallbackEffectiveRoles = getEffectiveRoles({
          uid: nextUser.uid,
          roles: fallbackBeamUser.roles,
        })
        const nextPortalIdentity = await resolvePortalIdentity(nextUser)

        setBeamUser(fallbackBeamUser)
        setEffectiveRoles(fallbackEffectiveRoles)
        setPortalIdentity(nextPortalIdentity)

        if (
          CLIENT_PROTECTED_PATHS.some(
            (path) => pathname === path || pathname.startsWith(`${path}/`)
          ) &&
          !nextPortalIdentity &&
          !hasAnyRole(fallbackEffectiveRoles, STAFF_ROLES)
        ) {
          router.replace("/no-access")
        }
      } finally {
        setLoading(false)
      }
    })

    return () => unsubscribe()
  }, [pathname, router, sourceNgo])

  return (
    <AuthContext.Provider
      value={{
        user,
        beamUser,
        effectiveRoles,
        sourceNgo,
        portalIdentity,
        activeClientId: portalIdentity?.activeClientId ?? null,
        clientIds: portalIdentity?.clientIds ?? [],
        userRole: portalIdentity?.userRole ?? null,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
