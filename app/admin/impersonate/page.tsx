"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Eye,
  Loader2,
  MessageSquare,
  Search,
  Send,
  User,
  X,
} from "lucide-react"
import { collection, getDocs, orderBy, query } from "firebase/firestore"

import { useAuth } from "@/components/auth/AuthProvider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { getDb } from "@/lib/firebase/config"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  email: string
  name: string
  companyName?: string
  planType?: string
  serviceInterests?: string[]
  claimedClientName?: string
  onboardingStatus?: string
  createdAt?: string
  uid?: string
}

interface RagNote {
  id: string
  clientEmail: string
  subject: string
  body: string
  authorName: string
  authorEmail: string
  type: "note" | "pulse" | "update"
  createdAt: string
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ImpersonatePage() {
  const { user, effectiveRoles, loading: authLoading } = useAuth()
  const router = useRouter()
  const isBeamAdmin = effectiveRoles.includes("beam-admin")

  const [clients, setClients] = useState<ClientRow[]>([])
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<ClientRow | null>(null)
  const [pageLoading, setPageLoading] = useState(true)

  // RAG note composer
  const [noteSubject, setNoteSubject] = useState("")
  const [noteBody, setNoteBody] = useState("")
  const [noteType, setNoteType] = useState<"note" | "pulse" | "update">("note")
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // Client's feedback (read-only view)
  const [clientFeedback, setClientFeedback] = useState<any[]>([])
  const [loadingFeedback, setLoadingFeedback] = useState(false)

  // ── Auth guard ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }
    if (!isBeamAdmin) { router.push("/dashboard"); return }
  }, [user, authLoading, isBeamAdmin, router])

  // ── Load all clients ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !isBeamAdmin) return

    const loadClients = async () => {
      try {
        const db = getDb()
        const snap = await getDocs(
          query(collection(db, "clients"), orderBy("createdAt", "desc"))
        )
        const rows: ClientRow[] = snap.docs.map((d) => ({
          email: d.id,
          ...d.data(),
        } as ClientRow))
        setClients(rows)
      } catch (e) {
        console.error("Failed to load clients:", e)
      } finally {
        setPageLoading(false)
      }
    }

    void loadClients()
  }, [user, isBeamAdmin])

  // ── Load feedback when client selected ───────────────────────────────────
  useEffect(() => {
    if (!selected) { setClientFeedback([]); return }
    setLoadingFeedback(true)

    fetch(`/api/feedback?projectId=${encodeURIComponent(selected.email)}`)
      .then((r) => r.json())
      .then((data) => setClientFeedback(data.feedback ?? []))
      .catch(() => setClientFeedback([]))
      .finally(() => setLoadingFeedback(false))
  }, [selected])

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredClients = clients.filter((c) => {
    const q = search.toLowerCase()
    return (
      !q ||
      c.email.toLowerCase().includes(q) ||
      (c.name || "").toLowerCase().includes(q) ||
      (c.companyName || "").toLowerCase().includes(q)
    )
  })

  // ── Send RAG note ─────────────────────────────────────────────────────────
  const sendNote = async () => {
    if (!selected || !noteSubject.trim() || !noteBody.trim()) return
    setSending(true)
    setSendResult(null)

    try {
      const res = await fetch("/api/rag-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientEmail: selected.email,
          subject: noteSubject.trim(),
          body: noteBody.trim(),
          type: noteType,
          authorName: user?.displayName || "Readyaimgo Team",
          authorEmail: user?.email || "",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSendResult({ ok: true, msg: "Note delivered to client dashboard." })
      setNoteSubject("")
      setNoteBody("")
    } catch (e: any) {
      setSendResult({ ok: false, msg: e.message || "Failed to send note." })
    } finally {
      setSending(false)
    }
  }

  // ── Loading / auth ────────────────────────────────────────────────────────
  if (authLoading || pageLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user || !isBeamAdmin) return null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/admin")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Admin
          </Button>
          <div className="h-5 w-px bg-slate-200" />
          <h1 className="text-lg font-semibold text-slate-900">
            Client Impersonation & RAG Notes
          </h1>
          {selected && (
            <>
              <ChevronRight className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-medium text-primary">{selected.email}</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-slate-500"
                onClick={() => setSelected(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!selected ? (
          // ── Client picker ──────────────────────────────────────────────────
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Select a client</h2>
              <p className="text-slate-500 mt-1">
                Choose a client to view their dashboard context and send RAG team notes.
              </p>
            </div>

            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name, email, or company…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="grid gap-3">
              {filteredClients.length === 0 ? (
                <p className="text-slate-400 py-8 text-center">No clients found.</p>
              ) : (
                filteredClients.map((client) => (
                  <button
                    key={client.email}
                    onClick={() => setSelected(client)}
                    className="w-full text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-primary hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900 truncate">
                            {client.name || client.email}
                          </p>
                          {client.planType && (
                            <Badge variant={client.planType === "free" ? "secondary" : "default"}>
                              {client.planType}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-slate-500 truncate">{client.email}</p>
                        {client.companyName && (
                          <p className="text-xs text-slate-400">{client.companyName}</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          // ── Client detail view ─────────────────────────────────────────────
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Left: Client context (what they see) */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Eye className="h-5 w-5 text-primary" />
                    <CardTitle>Client view — {selected.name || selected.email}</CardTitle>
                  </div>
                  <CardDescription>
                    This is what {selected.name || "the client"} sees in their account.
                    <br />
                    <a
                      href={`/dashboard?impersonate=${encodeURIComponent(selected.email)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline text-sm mt-1 inline-block"
                    >
                      Open full dashboard as this client →
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ["Email", selected.email],
                      ["Name", selected.name || "—"],
                      ["Company", selected.companyName || "—"],
                      ["Plan", selected.planType || "free"],
                      ["Status", selected.onboardingStatus || "—"],
                      ["Claimed", selected.claimedClientName || "—"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
                        <p className="text-sm font-medium text-slate-800 truncate">{value}</p>
                      </div>
                    ))}
                  </div>

                  {selected.serviceInterests && selected.serviceInterests.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Service interests</p>
                      <div className="flex flex-wrap gap-2">
                        {selected.serviceInterests.map((s) => (
                          <Badge key={s} variant="secondary">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Client feedback they submitted */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Their feedback</CardTitle>
                  <CardDescription>Notes and Loom videos submitted by this client.</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingFeedback ? (
                    <div className="flex items-center gap-2 text-slate-400 py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Loading…</span>
                    </div>
                  ) : clientFeedback.length === 0 ? (
                    <p className="text-slate-400 text-sm py-4 text-center">No feedback submitted yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {clientFeedback.map((fb) => (
                        <div key={fb.id} className="rounded-lg border border-slate-100 p-3 space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={
                              fb.urgency === "high" ? "danger"
                              : fb.urgency === "medium" ? "secondary"
                              : "default"
                            }>
                              {fb.urgency}
                            </Badge>
                            <Badge variant="accent">{fb.category}</Badge>
                            <Badge variant={fb.status === "open" ? "default" : "secondary"}>
                              {fb.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-slate-700">{fb.summary}</p>
                          {fb.loomUrl && (
                            <a href={fb.loomUrl} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-primary underline">
                              Watch Loom video
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: RAG note composer */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    <CardTitle>Send a RAG team note</CardTitle>
                  </div>
                  <CardDescription>
                    This note will appear in {selected.name || "the client"}'s dashboard under
                    "From your Readyaimgo team." Use it to share progress, pulse summaries,
                    or updates without emailing.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Type selector */}
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Note type</label>
                    <div className="flex gap-2 mt-2">
                      {(["note", "pulse", "update"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setNoteType(t)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            noteType === t
                              ? "bg-primary text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {t === "pulse" ? "Pulse summary" : t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {noteType === "note" && "A general note or message to the client."}
                      {noteType === "pulse" && "An AI-generated or manual pulse summary of what we're working on."}
                      {noteType === "update" && "A specific project update or milestone reached."}
                    </p>
                  </div>

                  {/* Subject */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Subject</label>
                    <Input
                      placeholder={
                        noteType === "pulse" ? "Weekly pulse — week of Apr 13"
                        : noteType === "update" ? "Your site is live in staging"
                        : "Quick note from the team"
                      }
                      value={noteSubject}
                      onChange={(e) => setNoteSubject(e.target.value)}
                    />
                  </div>

                  {/* Body */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Message</label>
                    <Textarea
                      className="min-h-32"
                      placeholder={
                        noteType === "pulse"
                          ? "This week we completed the mobile layout, wired up the contact form, and resolved the two bugs you flagged. Next: staging review and final polish."
                          : "Write your message to the client here…"
                      }
                      value={noteBody}
                      onChange={(e) => setNoteBody(e.target.value)}
                    />
                  </div>

                  {/* Send result */}
                  {sendResult && (
                    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                      sendResult.ok
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-red-50 text-red-700 border border-red-200"
                    }`}>
                      {sendResult.ok
                        ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                        : <AlertCircle className="h-4 w-4 flex-shrink-0" />}
                      {sendResult.msg}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={sendNote}
                    disabled={sending || !noteSubject.trim() || !noteBody.trim()}
                  >
                    {sending
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                      : <><Send className="h-4 w-4 mr-2" />Send to {selected.name || selected.email}</>
                    }
                  </Button>
                </CardContent>
              </Card>

              {/* Quick open link */}
              <Card className="border-dashed">
                <CardContent className="pt-5">
                  <p className="text-sm text-slate-500 mb-3">
                    To see exactly what this client sees (their full dashboard, not just the metadata above), open it in a new tab. You'll be viewing it as admin — a banner will remind you.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      window.open(
                        `/dashboard?impersonate=${encodeURIComponent(selected.email)}`,
                        "_blank"
                      )
                    }
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Preview as {selected.name || selected.email}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
