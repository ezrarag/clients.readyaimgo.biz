"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  FileText,
  Loader2,
  Plus,
  Search,
  Send,
  CheckCircle2,
  Eye,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ClientInvoice, InvoiceStatus } from "@/lib/invoices"

async function apiFetch<T>(
  user: { getIdToken: () => Promise<string> },
  path: string,
  options?: RequestInit
): Promise<T> {
  const token = await user.getIdToken()
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    cache: "no-store",
  })
  const payload = await res.json()
  if (!res.ok) throw new Error((payload as { error?: string }).error ?? "Request failed.")
  return payload as T
}

const STATUS_BADGE_VARIANTS: Record<
  InvoiceStatus,
  "secondary" | "warning" | "accent" | "success" | "danger"
> = {
  draft: "secondary",
  client_review: "warning",
  accepted: "accent",
  paid: "success",
  cancelled: "danger",
}

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  client_review: "Sent · Reviewing",
  accepted: "Accepted",
  paid: "Paid",
  cancelled: "Cancelled",
}

export default function AdminInvoicesPage() {
  const { user } = useAuth()
  const [invoices, setInvoices] = useState<ClientInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all")

  const [previewInvoice, setPreviewInvoice] = useState<ClientInvoice | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadInvoices = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch<{ invoices: ClientInvoice[] }>(user, "/api/admin/invoices")
      setInvoices(res.invoices || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices.")
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadInvoices()
  }, [loadInvoices])

  const handleUpdateStatus = async (invoice: ClientInvoice, newStatus: InvoiceStatus) => {
    if (!user || !invoice.contractId) return
    setActionLoading(true)
    try {
      const res = await apiFetch<{ invoice: ClientInvoice }>(
        user,
        `/api/contracts/${invoice.contractId}/invoices/${invoice.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: newStatus }),
        }
      )
      if (res.invoice) {
        setInvoices((prev) => prev.map((i) => (i.id === res.invoice.id ? res.invoice : i)))
        if (previewInvoice?.id === res.invoice.id) {
          setPreviewInvoice(res.invoice)
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update invoice status.")
    } finally {
      setActionLoading(false)
    }
  }

  const handleCopyShareLink = (invoice: ClientInvoice) => {
    const portalUrl = `${window.location.origin}/workspace/${invoice.workspaceId || invoice.clientId}`
    navigator.clipboard.writeText(portalUrl)
    setCopiedId(invoice.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const filteredInvoices = invoices.filter((i) => {
    if (statusFilter !== "all" && i.status !== statusFilter) return false
    if (!search.trim()) return true
    const q = search.toLowerCase().trim()
    return (
      i.invoiceNumber.toLowerCase().includes(q) ||
      i.title.toLowerCase().includes(q) ||
      i.billTo.name.toLowerCase().includes(q) ||
      i.billTo.company.toLowerCase().includes(q) ||
      i.billTo.email.toLowerCase().includes(q) ||
      (i.milestoneLabel && i.milestoneLabel.toLowerCase().includes(q))
    )
  })

  // Metrics
  const totalInvoicedCents = invoices.reduce((sum, i) => sum + (i.totalCents || 0), 0)
  const totalPaidCents = invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + (i.totalCents || 0), 0)
  const totalPendingCents = invoices
    .filter((i) => i.status === "client_review" || i.status === "accepted")
    .reduce((sum, i) => sum + (i.totalCents || 0), 0)
  const totalDraftCents = invoices
    .filter((i) => i.status === "draft")
    .reduce((sum, i) => sum + (i.totalCents || 0), 0)

  return (
    <AppShell
      eyebrow="Admin"
      title="Invoices & Billing Control"
      description="Global overview of all client project milestone invoices, rendered HTML previews, and payment tracking."
      nav={[
        { href: "/dashboard", label: "Workspaces" },
        { href: "/admin/workspaces", label: "Admin · Workspaces" },
        { href: "/admin/contracts", label: "Admin · Contracts" },
        { href: "/admin/invoices", label: "Admin · Invoices", active: true },
        { href: "/admin/intake", label: "Admin · Intake" },
      ]}
    >
      <div className="space-y-8 p-6 max-w-7xl mx-auto">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="accent" className="bg-primary/10 text-primary border-primary/20">
                ReadyAimGo Admin
              </Badge>
              <Badge variant="secondary">Global Invoicing Hub</Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Invoices & Billing</h1>
            <p className="text-muted-foreground">
              Monitor sequential milestone invoices, review rendered previews, publish to client portals, and track payments.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={loadInvoices} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" asChild>
              <Link href="/admin/contracts">
                <Plus className="w-4 h-4 mr-2" />
                New Milestone Invoice (via Contracts)
              </Link>
            </Button>
          </div>
        </div>

        {/* Aggregate Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-slate-900 text-white shadow-md">
            <CardHeader className="pb-2">
              <CardDescription className="text-slate-400 text-xs font-medium uppercase tracking-wider">
                Total Invoiced
              </CardDescription>
              <CardTitle className="text-2xl font-bold">
                ${(totalInvoicedCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-400">{invoices.length} total invoice records</p>
            </CardContent>
          </Card>

          <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-emerald-700 text-xs font-medium uppercase tracking-wider">
                Total Collected (Paid)
              </CardDescription>
              <CardTitle className="text-2xl font-bold text-emerald-900">
                ${(totalPaidCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-emerald-700 font-medium">
                {invoices.filter((i) => i.status === "paid").length} paid milestone invoices
              </p>
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-amber-700 text-xs font-medium uppercase tracking-wider">
                Pending Review / Payment
              </CardDescription>
              <CardTitle className="text-2xl font-bold text-amber-900">
                ${(totalPendingCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-amber-700 font-medium">
                {invoices.filter((i) => i.status === "client_review" || i.status === "accepted").length} active in portal
              </p>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-slate-50/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-slate-500 text-xs font-medium uppercase tracking-wider">
                Draft Invoices
              </CardDescription>
              <CardTitle className="text-2xl font-bold text-slate-800">
                ${(totalDraftCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 font-medium">
                {invoices.filter((i) => i.status === "draft").length} unpublished drafts
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-white p-4 rounded-xl border border-border/80 shadow-sm">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search invoice number, client, project..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Filter Status:</span>
            <Select
              value={statusFilter}
              onValueChange={(val) => setStatusFilter(val as typeof statusFilter)}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses ({invoices.length})</SelectItem>
                <SelectItem value="draft">Draft ({invoices.filter((i) => i.status === "draft").length})</SelectItem>
                <SelectItem value="client_review">Sent / Review ({invoices.filter((i) => i.status === "client_review").length})</SelectItem>
                <SelectItem value="accepted">Accepted ({invoices.filter((i) => i.status === "accepted").length})</SelectItem>
                <SelectItem value="paid">Paid ({invoices.filter((i) => i.status === "paid").length})</SelectItem>
                <SelectItem value="cancelled">Cancelled ({invoices.filter((i) => i.status === "cancelled").length})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        {/* Invoice List Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Client Milestone Invoices</CardTitle>
            <CardDescription>
              Showing {filteredInvoices.length} of {invoices.length} invoices
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-12 flex justify-center items-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading invoices...
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="py-12 text-center text-slate-500 space-y-2">
                <FileText className="w-8 h-8 mx-auto text-slate-300" />
                <p className="font-semibold text-base">No invoices found</p>
                <p className="text-xs text-slate-400">
                  {invoices.length === 0
                    ? "Generate milestone invoices from /admin/contracts."
                    : "No invoices match the selected search or filter."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border/80 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      <th className="py-3 px-4">Invoice #</th>
                      <th className="py-3 px-4">Client / Company</th>
                      <th className="py-3 px-4">Milestone / Title</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredInvoices.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-slate-50/70 transition">
                        <td className="py-3.5 px-4 font-mono font-semibold text-slate-900">
                          {invoice.invoiceNumber}
                        </td>
                        <td className="py-3.5 px-4">
                          <p className="font-medium text-slate-900">
                            {invoice.billTo.name || invoice.billTo.company || invoice.clientId}
                          </p>
                          {invoice.billTo.email && (
                            <p className="text-xs text-slate-400">{invoice.billTo.email}</p>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <p className="font-medium text-slate-800">{invoice.title}</p>
                          {invoice.milestoneLabel && (
                            <p className="text-xs text-primary font-medium">
                              Milestone: {invoice.milestoneLabel}
                            </p>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                          ${(invoice.totalCents / 100).toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4">
                          <Badge variant={STATUS_BADGE_VARIANTS[invoice.status]}>
                            {STATUS_LABELS[invoice.status]}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPreviewInvoice(invoice)}
                              className="text-xs h-8"
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" />
                              Preview HTML
                            </Button>
                            {invoice.status === "draft" && (
                              <Button
                                size="sm"
                                onClick={() => handleUpdateStatus(invoice, "client_review")}
                                disabled={actionLoading}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                              >
                                <Send className="w-3.5 h-3.5 mr-1" />
                                Send
                              </Button>
                            )}
                            {invoice.status !== "paid" && invoice.status !== "draft" && (
                              <Button
                                size="sm"
                                onClick={() => handleUpdateStatus(invoice, "paid")}
                                disabled={actionLoading}
                                className="bg-emerald-700 text-white text-xs h-8"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                                Mark Paid
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleCopyShareLink(invoice)}
                              className="text-xs h-8 px-2"
                              title="Copy Portal Review Link"
                            >
                              {copiedId === invoice.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5 text-slate-400" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rendered HTML Invoice Preview Modal */}
      {previewInvoice && (
        <Dialog open={Boolean(previewInvoice)} onOpenChange={(v) => !v && setPreviewInvoice(null)}>
          <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col">
            <DialogHeader>
              <div className="flex items-center justify-between pr-6">
                <div>
                  <DialogTitle className="text-lg font-bold">
                    Invoice Preview: {previewInvoice.invoiceNumber}
                  </DialogTitle>
                  <p className="text-xs text-slate-500 mt-0.5">{previewInvoice.title}</p>
                </div>
                <Badge variant={STATUS_BADGE_VARIANTS[previewInvoice.status]}>
                  {STATUS_LABELS[previewInvoice.status]}
                </Badge>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto min-h-[480px] border border-border/80 rounded-xl bg-slate-900/5 p-1">
              {previewInvoice.renderedHtml ? (
                <iframe
                  srcDoc={previewInvoice.renderedHtml}
                  className="w-full h-[540px] rounded-lg bg-white border border-slate-200"
                  title={`Invoice ${previewInvoice.invoiceNumber}`}
                />
              ) : (
                <div className="p-8 text-slate-700 bg-white rounded-lg space-y-3">
                  <h4 className="font-bold text-xl">{previewInvoice.title}</h4>
                  <p className="text-sm text-slate-500">
                    Amount: ${(previewInvoice.totalCents / 100).toFixed(2)}
                  </p>
                  <p className="text-sm text-slate-500">Due: {previewInvoice.dueDate}</p>
                  <p className="text-xs text-slate-400 font-mono">
                    Client ID: {previewInvoice.clientId}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-border/60">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyShareLink(previewInvoice)}
                >
                  {copiedId === previewInvoice.id ? (
                    <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {copiedId === previewInvoice.id ? "Link Copied!" : "Copy Portal Link"}
                </Button>
                {previewInvoice.workspaceId && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link
                      href={`/workspace/${previewInvoice.workspaceId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                      View Client Portal
                    </Link>
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewInvoice(null)}>
                  Close
                </Button>
                {previewInvoice.status === "draft" && (
                  <Button
                    size="sm"
                    onClick={() => handleUpdateStatus(previewInvoice, "client_review")}
                    disabled={actionLoading}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Mark as Sent & Publish
                  </Button>
                )}
                {previewInvoice.status !== "paid" && previewInvoice.status !== "draft" && (
                  <Button
                    size="sm"
                    onClick={() => handleUpdateStatus(previewInvoice, "paid")}
                    disabled={actionLoading}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white font-medium flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark as Paid
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  )
}
