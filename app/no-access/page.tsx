"use client"

import { signOut } from "@/lib/firebase/auth"
import { useRouter } from "next/navigation"

export default function NoAccessPage() {
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut()
    router.replace("/login")
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 p-6 text-center">
      <div className="max-w-md rounded-[28px] border border-rose-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-rose-500">Access Denied</p>
        <h1 className="mt-3 font-display text-2xl font-semibold text-slate-900">
          Your portal access has been revoked
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          Your account is not currently authorized to access the client portal. Please
          contact your Ready Aim Go administrator to restore access.
        </p>
        <button
          onClick={handleSignOut}
          className="mt-6 inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
