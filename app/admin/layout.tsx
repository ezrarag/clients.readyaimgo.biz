"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"

/**
 * Admin layout — gates all /admin/* routes to beam-admin users only.
 * Unauthenticated visitors → /login
 * Authenticated non-admins  → /dashboard
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, effectiveRoles, loading } = useAuth()
  const router = useRouter()

  const isAdmin = effectiveRoles.includes("beam-admin")

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace("/login")
    } else if (!isAdmin) {
      router.replace("/dashboard")
    }
  }, [loading, user, isAdmin, router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !isAdmin) return null

  return <>{children}</>
}
