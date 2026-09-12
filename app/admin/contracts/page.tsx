"use client"

import { useCallback, useEffect, useState } from "react"
import {
  FileText,
  Loader2,
  LogOut,
  Plus,
  Search,
  X,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { ContractCard } from "@/components/contracts/ContractCard"
import { ContractDetailModal } from "@/components/contracts/ContractDetailModal"
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
import { Textarea } from "@/components/ui/textarea"
import { signOut } from "@/lib/firebase/auth"
import {
  BEAM_NGOS,
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
} from "@/lib/contracts"
import type { BeamContract, ContractStatus, ContractType } from "@/lib/contracts"
import { useRouter } from "next/navigation"

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Label maps ───────────────────────────────────────────────────────────────

const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  fleet_maintenance: "Fleet Maintenance",
  anchor_partner: "Anchor Partner",
  cohort_services: "Cohort Services",
  mou: "MOU",
  client_project: "Client Project",
}

const STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  sent: "Sent",
  signed: "Signed",
  active: "Active",
  expired: "Expired",
}

const NGO_LABELS: Record<string, string> = {
  transport: "BEAM Transport",
  finance: "BEAM Finance",
  law: "BEAM Law",
  forge: "BEAM Forge",
  grounds: "BEAM Grounds",
}

// ─── Create form default state ────────────────────────────────────────────────

interface MilestoneInput {
  label: string
  amount: string
}

interface CreateFormState {
  workspaceId: string
  clientId: string
  clientName: string
  clientEmail: string
  title: string
  summary: string
  monthlyValue: string
  termMonths: string
  totalContractValue: string
  startDate: string
  endDate: string
  contractType: ContractType
  beamNgos: string[]
  notes: string
  milestones: MilestoneInput[]
}

const FORM_DEFAULTS: CreateFormState = {
  workspaceId: "",
  clientId: "",
  clientName: "",
  clientEmail: "",
  title: "",
  summary: "",
  monthlyValue: "",
  termMonths: "",
  totalContractValue: "",
  startDate: "",
  endDate: "",
  contractType: "mou",
  beamNgos: [],
  notes: "",
  milestones: [],
}

// ─── Create Contract Dialog ───────────────────────────────────────────────────

interface CreateContractDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (contract: BeamContract) => void
  user: { getIdToken: () => Promise<string> }
}

function CreateContractDialog({
  open,
  onOpenChange,
  onCreated,
  user,
}: CreateContractDialogProps) {
  const [form, setForm] = useState<CreateFormState>(FORM_DEFAULTS)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setForm(FORM_DEFAULTS)
      setError(null)
    }
  }, [open])

  function set<K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function toggleNgo(ngo: string) {
    setForm((prev) => ({
      ...prev,
      beamNgos: prev.beamNgos.includes(ngo)
        ? prev.beamNgos.filter((n) => n !== ngo)
        : [...prev.beamNgos, ngo],
    }))
  }

  function addMilestone() {
    setForm((prev) => ({
      ...prev,
      milestones: [
        ...prev.milestones,
        { label: `Milestone ${prev.milestones.length + 1}`, amount: "" },
      ],
    }))
  }

  function updateMilestone(index: number, field: "label" | "amount", value: string) {
    setForm((prev) => {
      const next = [...prev.milestones]
      next[index] = { ...next[index], [field]: value }
      return { ...prev, milestones: next }
    })
  }

  function removeMilestone(index: number) {
    setForm((prev) => ({
      ...prev,
      milestones: prev.milestones.filter((_, i) => i !== index),
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.clientId.trim() || !form.title.trim()) {
      setError("Client ID and title are required.")
      return
    }

    const validMilestones = form.milestones.filter((m) => m.label.trim().length > 0)
    let totalContractValueCents = form.totalContractValue
      ? Math.round(Number(form.totalContractValue) * 100)
      : 0
    let milestoneAmountsCents: number[] = []

    if (validMilestones.length > 0) {
      milestoneAmountsCents = validMilestones.map((m) =>
        Math.round(Number(m.amount || 0) * 100)
      )
      const sumCents = milestoneAmountsCents.reduce((a, b) => a + b, 0)
      if (totalContractValueCents > 0 && Math.abs(sumCents - totalContractValueCents) > 1) {
        setError(
          `Sum of milestone amounts ($${(sumCents / 100).toFixed(2)}) must equal Total Contract Value ($${(totalContractValueCents / 100).toFixed(2)}).`
        )
        return
      }
      if (totalContractValueCents === 0) {
        totalContractValueCents = sumCents
      }
    }

    setError(null)
    setCreating(true)
    try {
      const paymentDates = validMilestones.map((m) => m.label.trim())

      const res = await apiFetch<{ contractId: string }>(user, "/api/contracts", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: form.workspaceId.trim() || null,
          clientId: form.clientId.trim(),
          clientName: form.clientName.trim(),
          clientEmail: form.clientEmail.trim().toLowerCase(),
          title: form.title.trim(),
          summary: form.summary.trim(),
          monthlyValue: form.monthlyValue ? Number(form.monthlyValue) : 0,
          termMonths: form.termMonths ? Number(form.termMonths) : 0,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          contractType: form.contractType,
          beamNgos: form.beamNgos,
          notes: form.notes.trim(),
          paymentDates,
          milestoneAmountsCents,
          totalContractValueCents,
        }),
      })

      // Build a local BeamContract so the parent list updates instantly
      const now = new Date().toISOString()
      const newContract: BeamContract = {
        id: res.contractId,
        workspaceId: form.workspaceId.trim() || undefined,
        clientId: form.clientId.trim(),
        clientName: form.clientName.trim(),
        clientEmail: form.clientEmail.trim().toLowerCase(),
        title: form.title.trim() || "Untitled Agreement",
        summary: form.summary.trim(),
        monthlyValue: form.monthlyValue ? Number(form.monthlyValue) : 0,
        termMonths: form.termMonths ? Number(form.termMonths) : 0,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        contractType: form.contractType,
        status: "draft",
        beamNgos: form.beamNgos,
        notes: form.notes.trim(),
        paymentDates,
        milestoneAmountsCents,
        totalContractValueCents,
        createdAt: now,
        updatedAt: now,
        createdBy: "",
        documentUrl: null,
      } as BeamContract

      onCreated(newContract)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create contract.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Contract</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          {error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          {/* Client fields */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
              Client
            </legend>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">
                  Client ID <span className="text-rose-500">*</span>
                </label>
                <Input
                  placeholder="e.g. readyaimgo"
                  value={form.clientId}
                  onChange={(e) => set("clientId", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Client Name</label>
                <Input
                  placeholder="e.g. ReadyAimGo"
                  value={form.clientName}
                  onChange={(e) => set("clientName", e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Client Email</label>
              <Input
                type="email"
                placeholder="client@example.com"
                value={form.clientEmail}
                onChange={(e) => set("clientEmail", e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                Workspace ID{" "}
                <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <Input
                placeholder="Firestore workspace doc ID"
                value={form.workspaceId}
                onChange={(e) => set("workspaceId", e.target.value)}
              />
            </div>
          </fieldset>

          {/* Contract details */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
              Contract
            </legend>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                Title <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="e.g. Fleet Maintenance Agreement — ReadyAimGo"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Summary</label>
              <Textarea
                placeholder="Brief description of the contract scope…"
                value={form.summary}
                onChange={(e) => set("summary", e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Contract Type</label>
              <Select
                value={form.contractType}
                onValueChange={(v) => {
                  const newType = v as ContractType
                  set("contractType", newType)
                  if (newType === "client_project" && form.milestones.length === 0) {
                    setForm((prev) => ({
                      ...prev,
                      contractType: newType,
                      milestones: [
                        { label: "Milestone 1: Kickoff & Setup", amount: "" },
                        { label: "Milestone 2: Final Handover", amount: "" },
                      ],
                    }))
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CONTRACT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </fieldset>

          {/* Financial terms */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
              Financial Terms
            </legend>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">
                  {form.contractType === "client_project"
                    ? "Total Contract Value ($)"
                    : "Monthly Value ($)"}
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={
                    form.contractType === "client_project"
                      ? form.totalContractValue
                      : form.monthlyValue
                  }
                  onChange={(e) =>
                    form.contractType === "client_project"
                      ? set("totalContractValue", e.target.value)
                      : set("monthlyValue", e.target.value)
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Term (months)</label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={form.termMonths}
                  onChange={(e) => set("termMonths", e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Start Date</label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">End Date</label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => set("endDate", e.target.value)}
                />
              </div>
            </div>
          </fieldset>

          {/* Milestones Section */}
          <fieldset className="space-y-3">
            <div className="flex items-center justify-between">
              <legend className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Milestone Invoicing Schedule
              </legend>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={addMilestone}
              >
                <Plus className="mr-1 h-3 w-3" /> Add Milestone
              </Button>
            </div>

            {form.milestones.length === 0 ? (
              <p className="text-xs text-slate-400 italic">
                No milestones added. Click &quot;Add Milestone&quot; to configure structured invoice milestones (e.g. RAG-CLIENT-MW1).
              </p>
            ) : (
              <div className="space-y-2">
                {form.milestones.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      placeholder={`e.g. Milestone ${idx + 1}: Implementation`}
                      value={m.label}
                      onChange={(e) => updateMilestone(idx, "label", e.target.value)}
                      className="flex-1 text-xs"
                    />
                    <div className="w-32 relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                        $
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Amount"
                        value={m.amount}
                        onChange={(e) => updateMilestone(idx, "amount", e.target.value)}
                        className="pl-6 text-xs"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMilestone(idx)}
                      className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          {/* BEAM NGOs */}
          <fieldset className="space-y-2">
            <div className="flex items-center justify-between">
              <legend className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                BEAM NGOs Involved
              </legend>
              {form.contractType === "client_project" && (
                <span className="text-[11px] text-slate-400 font-normal">(Optional for Client Projects)</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {BEAM_NGOS.map((ngo) => {
                const selected = form.beamNgos.includes(ngo)
                return (
                  <button
                    key={ngo}
                    type="button"
                    onClick={() => toggleNgo(ngo)}
                    className={[
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-slate-500 hover:border-primary/50 hover:text-slate-700",
                    ].join(" ")}
                  >
                    {NGO_LABELS[ngo] ?? ngo}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Internal Notes</label>
            <Textarea
              placeholder="Any internal context, caveats, or next steps…"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {creating ? "Creating…" : "Create Contract"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Admin Contracts Page ─────────────────────────────────────────────────────

export default function AdminContractsPage() {
  const { user } = useAuth()
  const router = useRouter()

  const [contracts, setContracts] = useState<BeamContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [selectedContract, setSelectedContract] = useState<BeamContract | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<ContractStatus | "all">("all")

  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ contracts: BeamContract[] }>(
        user,
        "/api/contracts?admin=true"
      )
      setContracts(res.contracts)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load contracts.")
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  // Client-side filter (search is already debounce-free; contract counts are small)
  const filtered = contracts.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        c.title.toLowerCase().includes(q) ||
        c.clientName.toLowerCase().includes(q) ||
        c.clientEmail.toLowerCase().includes(q) ||
        c.clientId.toLowerCase().includes(q)
      )
    }
    return true
  })

  const handleCreated = (contract: BeamContract) => {
    setContracts((prev) => [contract, ...prev])
    setMessage("Contract created.")
    setTimeout(() => setMessage(null), 4000)
  }

  const handleStatusUpdated = (id: string, status: ContractStatus) => {
    setContracts((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))
    setSelectedContract((prev) => (prev?.id === id ? { ...prev, status } : prev))
  }

  return (
    <AppShell
      eyebrow="Admin"
      title="Contracts"
      description={
        loading
          ? "Loading…"
          : `${contracts.length} contract${contracts.length !== 1 ? "s" : ""}${filtered.length !== contracts.length ? ` · ${filtered.length} shown` : ""}`
      }
      nav={[
        { href: "/dashboard", label: "Workspaces" },
        { href: "/admin/workspaces", label: "Admin · Workspaces" },
        { href: "/admin/contracts", label: "Admin · Contracts", active: true },
        { href: "/admin/invoices", label: "Admin · Invoices" },
        { href: "/admin/intake", label: "Admin · Intake" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Contract
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await signOut()
              router.replace("/login")
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      }
    >
      {/* Flash messages */}
      {error && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>
            <X className="h-4 w-4 opacity-60 hover:opacity-100" />
          </button>
        </div>
      )}
      {message && (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search by title, client name, email, or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as ContractStatus | "all")}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {CONTRACT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
        </div>
      )}

      {/* Stats row */}
      {!loading && contracts.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3">
          {CONTRACT_STATUSES.map((s) => {
            const count = contracts.filter((c) => c.status === s).length
            if (count === 0) return null
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                className="flex items-center gap-1.5 rounded-full border border-border/60 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 hover:border-primary/40 hover:text-slate-900 transition-colors"
              >
                <span>{STATUS_LABELS[s]}</span>
                <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">
                  {count}
                </Badge>
              </button>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <Card className="border-border/60">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-3 h-9 w-9 text-slate-300" />
            {contracts.length === 0 ? (
              <>
                <p className="text-sm font-semibold text-slate-600">No contracts yet.</p>
                <p className="mt-1 text-xs text-slate-400">
                  Create the first contract with the button above.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-600">No contracts match your filters.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSearch("")
                    setStatusFilter("all")
                  }}
                >
                  Clear filters
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Contract grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((contract) => (
            <ContractCard
              key={contract.id}
              contract={contract}
              onViewDetails={(c) => {
                setSelectedContract(c)
                setDetailOpen(true)
              }}
            />
          ))}
        </div>
      )}

      {/* Detail modal */}
      <ContractDetailModal
        contract={selectedContract}
        isAdmin
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onContractUpdated={(contract) => {
          setContracts((prev) =>
            prev.map((item) => (item.id === contract.id ? contract : item))
          )
          setSelectedContract(contract)
        }}
        onStatusUpdated={handleStatusUpdated}
      />

      {/* Create contract dialog */}
      {user && (
        <CreateContractDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={handleCreated}
          user={user}
        />
      )}
    </AppShell>
  )
}
