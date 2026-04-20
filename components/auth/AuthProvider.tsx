"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { User, onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"

import type { BeamRole, BeamUser } from "@/lib/beam"
import {
  deriveSourceNgo,
  getEffectiveRoles,
  normalizeBeamUserDocument,
} from "@/lib/beam"
import { getAuthInstance } from "@/lib/firebase/config"
import { getDb } from "@/lib/firebase/config"

interface AuthContextType {
  user: User | null
  beamUser: BeamUser | null
  effectiveRoles: BeamRole[]
  sourceNgo: string
  loading: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  beamUser: null,
  effectiveRoles: [],
  sourceNgo: deriveSourceNgo(typeof window !== "undefined" ? window.location.hostname : undefined),
  loading: true,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [beamUser, setBeamUser] = useState<BeamUser | null>(null)
  const [effectiveRoles, setEffectiveRoles] = useState<BeamRole[]>([])
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
        setLoading(false)
        return
      }

      try {
        const snapshot = await getDoc(doc(getDb(), "users", nextUser.uid))
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

        setBeamUser(nextBeamUser)
        setEffectiveRoles(
          getEffectiveRoles({
            uid: nextUser.uid,
            roles: nextBeamUser.roles,
          })
        )
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

        setBeamUser(fallbackBeamUser)
        setEffectiveRoles(
          getEffectiveRoles({
            uid: nextUser.uid,
            roles: fallbackBeamUser.roles,
          })
        )
      } finally {
        setLoading(false)
      }
    })

    return () => unsubscribe()
  }, [sourceNgo])

  return (
    <AuthContext.Provider
      value={{ user, beamUser, effectiveRoles, sourceNgo, loading }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
