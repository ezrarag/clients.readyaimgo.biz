/**
 * ClientPagesPanel
 *
 * Shows all public RAG-built pages for a client (benefit pages, story pages,
 * partner pages) with live view and CTA-click counts from Firestore.
 *
 * Usage in /portal/[clientId]/page.tsx:
 *   import { ClientPagesPanel } from "@/components/client-pages-panel"
 *   <ClientPagesPanel clientId={clientId} />
 */

"use client"

import { useEffect, useState } from "react"
import { collection, onSnapshot } from "firebase/firestore"
import { ExternalLink, Eye, MousePointerClick, Share2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getDb } from "@/lib/firebase/config"

// ── Types ─────────────────────────────────────────────────────────────────────

type PageRecord = {
  id: string
  pageType: "benefit" | "story" | "partner" | "fleet"
  slug: string
  url: string
  label: string
  lastEventAt: string | null
  counts: {
    view?: number
    cta_click?: number
    contact_click?: number
  }
}

type Props = {
  clientId: string
}

const PAGE_TYPE_LABELS: Record<string, string> = {
  benefit: "Benefit Page",
  story: "Story",
  partner: "Partner Portal",
  fleet: "Fleet Page",
}

const RAG_BASE_URL = "https://readyaimgo.biz"

// ── Component ─────────────────────────────────────────────────────────────────

export function ClientPagesPanel({ clientId }: Props) {
  const [pages, setPages] = useState<PageRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const db = getDb()
    const pagesRef = collection(db, "clientPages", clientId, "pages")

    const unsub = onSnapshot(pagesRef, (snap) => {
      const records: PageRecord[] = snap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<PageRecord, "id">),
      }))
      // Sort by most views
      setPages(records.sort((a, b) => (b.counts.view ?? 0) - (a.counts.view ?? 0)))
      setLoading(false)
    })

    return () => unsub()
  }, [clientId])

  const handleShare = async (url: string) => {
    const fullUrl = `${RAG_BASE_URL}${url}`
    if (navigator.share) {
      await navigator.share({ url: fullUrl, title: "Check this out" })
    } else {
      await navigator.clipboard.writeText(fullUrl)
    }
  }

  if (loading) {
    return (
      <Card className="border border-border/70 bg-white/90">
        <CardHeader>
          <CardTitle>Your Pages</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 rounded-2xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (pages.length === 0) {
    return (
      <Card className="border border-border/70 bg-white/90">
        <CardHeader>
          <CardTitle>Your Pages</CardTitle>
          <CardDescription>
            Public pages ReadyAimGo has built for your business will appear here automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-[24px] border border-dashed border-border/80 bg-muted/35 px-5 py-10 text-center text-sm text-slate-600">
            No public pages yet — they'll appear here once built.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border border-border/70 bg-white/90">
      <CardHeader>
        <CardTitle>Your Pages</CardTitle>
        <CardDescription>
          Live pages ReadyAimGo has built for your business. Share them directly from here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pages.map((page) => (
          <div
            key={page.id}
            className="flex items-center justify-between gap-4 rounded-[20px] border border-border/70 bg-white/80 px-4 py-3"
          >
            {/* Left: info + stats */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-slate-900">{page.label}</span>
                <Badge variant="secondary" className="text-xs">
                  {PAGE_TYPE_LABELS[page.pageType] ?? page.pageType}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {RAG_BASE_URL}{page.url}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Eye className="h-3 w-3" />
                  {page.counts.view ?? 0} views
                </span>
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <MousePointerClick className="h-3 w-3" />
                  {(page.counts.cta_click ?? 0) + (page.counts.contact_click ?? 0)} clicks
                </span>
                {page.lastEventAt && (
                  <span className="text-xs text-slate-400">
                    Last visit {new Date(page.lastEventAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleShare(page.url)}
                className="h-8 w-8 p-0"
                title="Share this page"
              >
                <Share2 className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" asChild className="h-8">
                <a
                  href={`${RAG_BASE_URL}${page.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Open
                </a>
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
