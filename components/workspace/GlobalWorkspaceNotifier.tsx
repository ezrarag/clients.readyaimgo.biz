"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Bell, CreditCard, FileSignature, ShieldAlert } from "lucide-react"
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore"

import { useAuth } from "@/components/auth/AuthProvider"
import { getDb } from "@/lib/firebase/config"

type NotifierSeverity = "critical" | "warning" | "info"
type NotifierKind = "retainer-renewal" | "unsigned-contract" | "security-flag" | "general"

interface WorkspaceNotification {
  id: string
  workspaceId: string
  title: string
  body: string
  severity: NotifierSeverity
  kind: NotifierKind
  dueAt: string | null
  active: boolean
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeNotification(
  workspaceId: string,
  id: string,
  data: Record<string, unknown>
): WorkspaceNotification {
  const severity =
    data.severity === "critical" || data.severity === "warning" || data.severity === "info"
      ? data.severity
      : "info"
  const kind =
    data.kind === "retainer-renewal" ||
    data.kind === "unsigned-contract" ||
    data.kind === "security-flag"
      ? data.kind
      : "general"
  const dueValue = data.dueAt
  const dueAt =
    typeof dueValue === "string"
      ? dueValue
      : dueValue && typeof (dueValue as { toDate?: () => Date }).toDate === "function"
        ? (dueValue as { toDate: () => Date }).toDate().toISOString()
        : null

  return {
    id,
    workspaceId,
    title: readString(data.title) ?? "Workspace alert",
    body: readString(data.body) ?? "",
    severity,
    kind,
    dueAt,
    active: data.active !== false,
  }
}

function notificationIcon(kind: NotifierKind) {
  if (kind === "retainer-renewal") return CreditCard
  if (kind === "unsigned-contract") return FileSignature
  if (kind === "security-flag") return ShieldAlert
  return Bell
}

export function GlobalWorkspaceNotifier() {
  const { workspaceIds } = useAuth()
  const [items, setItems] = useState<WorkspaceNotification[]>([])

  useEffect(() => {
    if (workspaceIds.length === 0) {
      setItems([])
      return
    }

    const db = getDb()
    const unsubscribes: Unsubscribe[] = []
    const byWorkspace = new Map<string, WorkspaceNotification[]>()

    workspaceIds.slice(0, 10).forEach((workspaceId) => {
      const unsubscribe = onSnapshot(
        collection(db, "workspaces", workspaceId, "notifications"),
        (snapshot) => {
          byWorkspace.set(
            workspaceId,
            snapshot.docs
              .map((doc) =>
                normalizeNotification(workspaceId, doc.id, doc.data() as Record<string, unknown>)
              )
              .filter((item) => item.active)
          )
          setItems(Array.from(byWorkspace.values()).flat())
        },
        () => {
          byWorkspace.set(workspaceId, [])
          setItems(Array.from(byWorkspace.values()).flat())
        }
      )
      unsubscribes.push(unsubscribe)
    })

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [workspaceIds])

  const visibleItems = useMemo(() => {
    const severityWeight: Record<NotifierSeverity, number> = {
      critical: 3,
      warning: 2,
      info: 1,
    }
    return [...items]
      .sort((a, b) => {
        const severityDelta = severityWeight[b.severity] - severityWeight[a.severity]
        if (severityDelta !== 0) return severityDelta
        return String(a.dueAt ?? "").localeCompare(String(b.dueAt ?? ""))
      })
      .slice(0, 4)
  }, [items])

  if (visibleItems.length === 0) return null

  return (
    <aside className="fixed bottom-5 right-5 z-40 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-semibold text-slate-900">Account Overview</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
          {visibleItems.length}
        </span>
      </div>
      <div className="space-y-2">
        {visibleItems.map((item) => {
          const Icon = notificationIcon(item.kind)
          return (
            <div key={`${item.workspaceId}-${item.id}`} className="rounded-xl bg-slate-50 p-3">
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                  {item.body ? <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.body}</p> : null}
                  {item.dueAt ? (
                    <p className="mt-1 text-[11px] font-medium text-slate-400">
                      {new Date(item.dueAt).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
