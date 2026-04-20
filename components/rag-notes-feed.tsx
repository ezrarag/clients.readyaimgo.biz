"use client"

import { useEffect, useState } from "react"
import { format } from "date-fns"
import { CheckCircle2, Loader2, MessageSquare, Zap, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface RagNote {
  id: string
  subject: string
  body: string
  type: "note" | "pulse" | "update"
  authorName: string
  read: boolean
  createdAt: string | null
}

interface RagNotesFeedProps {
  clientEmail: string
}

const typeConfig = {
  pulse: {
    label: "Pulse summary",
    icon: Zap,
    badgeClass: "bg-amber-100 text-amber-700 border-amber-200",
    borderClass: "border-l-amber-400",
  },
  update: {
    label: "Project update",
    icon: CheckCircle2,
    badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
    borderClass: "border-l-emerald-400",
  },
  note: {
    label: "Team note",
    icon: MessageSquare,
    badgeClass: "bg-blue-100 text-blue-700 border-blue-200",
    borderClass: "border-l-blue-400",
  },
}

export function RagNotesFeed({ clientEmail }: RagNotesFeedProps) {
  const [notes, setNotes] = useState<RagNote[]>([])
  const [loading, setLoading] = useState(true)
  const [markingRead, setMarkingRead] = useState<string | null>(null)

  const load = async () => {
    if (!clientEmail) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/rag-notes?clientEmail=${encodeURIComponent(clientEmail)}`
      )
      if (res.ok) {
        const data = await res.json()
        setNotes(data.notes ?? [])
      }
    } catch {
      // silently fail — non-critical
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientEmail])

  const markRead = async (noteId: string) => {
    setMarkingRead(noteId)
    try {
      await fetch("/api/rag-notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId, clientEmail }),
      })
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, read: true } : n))
      )
    } catch {
      // silently fail
    } finally {
      setMarkingRead(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading team notes…</span>
        </CardContent>
      </Card>
    )
  }

  if (notes.length === 0) {
    return null // don't show the section at all if nothing to display
  }

  const unreadCount = notes.filter((n) => !n.read).length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            <CardTitle>From your Readyaimgo team</CardTitle>
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-primary text-white text-xs font-bold">
                {unreadCount}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            className="text-slate-400 hover:text-slate-600"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription>
          Progress updates, pulse summaries, and notes from your team.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {notes.map((note) => {
          const cfg = typeConfig[note.type] ?? typeConfig.note
          const Icon = cfg.icon

          return (
            <div
              key={note.id}
              className={`rounded-xl border border-l-4 p-4 transition-all ${cfg.borderClass} ${
                note.read ? "bg-slate-50 opacity-75" : "bg-white shadow-sm"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="mt-0.5 flex-shrink-0">
                    <Icon className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.badgeClass}`}
                      >
                        {cfg.label}
                      </span>
                      {!note.read && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                          New
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-slate-900 text-sm leading-snug">
                      {note.subject}
                    </p>
                    <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                      {note.body}
                    </p>
                    <div className="flex items-center gap-3 pt-1">
                      <span className="text-xs text-slate-400">
                        {note.authorName}
                        {note.createdAt
                          ? ` · ${format(new Date(note.createdAt), "MMM d, yyyy")}`
                          : ""}
                      </span>
                    </div>
                  </div>
                </div>

                {!note.read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-shrink-0 text-slate-400 hover:text-emerald-600 text-xs"
                    disabled={markingRead === note.id}
                    onClick={() => void markRead(note.id)}
                  >
                    {markingRead === note.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Mark read
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
