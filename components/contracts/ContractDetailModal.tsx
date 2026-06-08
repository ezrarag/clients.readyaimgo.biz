"use client"

import { useState } from "react"
import { useAuth } from "@/components/auth/AuthProvider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type {
  BeamContract,
  ContractStatus,
  ContractType,
  LegalReview,
  FinancialReview,
} from "@/lib/contracts"
import { CONTRACT_STATUSES } from "@/lib/contracts"

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  sent: "Sent",
  signed: "Signed",
  active: "Active",
  expired: "Expired",
}

const STATUS_VARIANTS: Record<
  ContractStatus,
  "default" | "secondary" | "accent" | "success" | "warning" | "danger"
> = {
  draft: "secondary",
  reviewed: "accent",
  sent: "warning",
  signed: "success",
  active: "success",
  expired: "danger",
}

const TYPE_LABELS: Record<ContractType, string> = {
  fleet_maintenance: "Fleet Maintenance",
  anchor_partner: "Anchor Partner",
  cohort_services: "Cohort Services",
  mou: "MOU",
}

const NGO_LABELS: Record<string, string> = {
  transport: "BEAM Transport",
  finance: "BEAM Finance",
  law: "BEAM Law",
  forge: "BEAM Forge",
  grounds: "BEAM Grounds",
}

// ---------------------------------------------------------------------------
// Legal review row
// ---------------------------------------------------------------------------

const REVIEW_STATUS_LABELS: Record<LegalReview["status"], string> = {
  pending: "Pending",
  "in-progress": "In Progress",
  complete: "Complete",
}

const REVIEW_STATUS_VARIANTS: Record<
  LegalReview["status"],
  "default" | "secondary" | "warning" | "success"
> = {
  pending: "secondary",
  "in-progress": "warning",
  complete: "success",
}

function LegalReviewRow({ review }: { review: LegalReview }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-slate-50 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{review.participantName || "Unnamed participant"}</p>
        <Badge variant={REVIEW_STATUS_VARIANTS[review.status]}>
          {REVIEW_STATUS_LABELS[review.status]}
        </Badge>
      </div>
      {review.memo ? (
        <p className="text-sm text-slate-600 leading-relaxed">{review.memo}</p>
      ) : null}
      {review.flaggedClauses.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {review.flaggedClauses.map((clause, i) => (
            <Badge key={i} variant="danger" className="text-xs">
              {clause}
            </Badge>
          ))}
        </div>
      ) : null}
      {review.reviewDate ? (
        <p className="text-xs text-slate-400">
          {new Date(review.reviewDate).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Financial review row
// ---------------------------------------------------------------------------

function FinancialReviewRow({ review }: { review: FinancialReview }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-slate-50 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{review.participantName || "Unnamed participant"}</p>
        <Badge variant={review.supervisorApproved ? "success" : "secondary"}>
          {review.supervisorApproved ? "Approved" : "Pending approval"}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {review.monthlyValue > 0 ? (
          <>
            <span className="text-slate-500">Monthly value</span>
            <span className="font-medium text-slate-900">${review.monthlyValue.toLocaleString()}</span>
          </>
        ) : null}
        {review.annualProjection > 0 ? (
          <>
            <span className="text-slate-500">Annual projection</span>
            <span className="font-medium text-slate-900">${review.annualProjection.toLocaleString()}</span>
          </>
        ) : null}
        {review.accountingTreatment ? (
          <>
            <span className="text-slate-500">Accounting</span>
            <span className="text-slate-700">{review.accountingTreatment}</span>
          </>
        ) : null}
      </div>
      {review.memo ? (
        <p className="text-sm text-slate-600 leading-relaxed">{review.memo}</p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">{title}</h3>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContractDetailModal
// ---------------------------------------------------------------------------

interface ContractDetailModalProps {
  contract: BeamContract | null
  isAdmin?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onStatusUpdated?: (contractId: string, newStatus: ContractStatus) => void
  onContractUpdated?: (contract: BeamContract) => void
}

export function ContractDetailModal({
  contract,
  isAdmin = false,
  open,
  onOpenChange,
  onStatusUpdated,
  onContractUpdated,
}: ContractDetailModalProps) {
  const { user } = useAuth()
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState("")
  const [legalReviewLoading, setLegalReviewLoading] = useState(false)
  const [legalReviewError, setLegalReviewError] = useState("")
  const [proposalAmount, setProposalAmount] = useState("")
  const [proposalNote, setProposalNote] = useState("")
  const [proposalCadence, setProposalCadence] =
    useState<"one-time" | "monthly" | "milestone" | "custom">("one-time")
  const [proposalPaymentDates, setProposalPaymentDates] = useState("")
  const [proposalLoading, setProposalLoading] = useState(false)
  const [proposalError, setProposalError] = useState("")
  const [proposalSuccess, setProposalSuccess] = useState("")

  if (!contract) return null

  const handleStatusChange = async (newStatus: string) => {
    if (!user || !contract) return
    setStatusError("")
    setStatusLoading(true)

    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error || "Unable to update status.")
      }

      onStatusUpdated?.(contract.id, newStatus as ContractStatus)
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Unable to update status.")
    } finally {
      setStatusLoading(false)
    }
  }

  const refreshContract = async () => {
    if (!user || !contract) return
    const token = await user.getIdToken()
    const res = await fetch(`/api/contracts/${contract.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!res.ok) return
    const body = (await res.json()) as { contract?: BeamContract }
    if (body.contract) onContractUpdated?.(body.contract)
  }

  const handleSubmitProposal = async () => {
    if (!user || !contract) return
    setProposalError("")
    setProposalSuccess("")
    setProposalLoading(true)
    try {
      const amount = Number(proposalAmount)
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Enter a positive amount.")
      }
      const token = await user.getIdToken()
      const res = await fetch(`/api/contracts/${contract.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount,
          cadence: proposalCadence,
          paymentDates: proposalPaymentDates
            .split(/\n|,/)
            .map((item) => item.trim())
            .filter(Boolean),
          note: proposalNote,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || "Unable to submit proposal.")
      }
      setProposalSuccess("Financial proposal submitted for admin review.")
      setProposalAmount("")
      setProposalNote("")
      setProposalPaymentDates("")
      await refreshContract()
    } catch (err) {
      setProposalError(err instanceof Error ? err.message : "Unable to submit proposal.")
    } finally {
      setProposalLoading(false)
    }
  }

  const handleAdminProposalDecision = async (decision: "approved" | "declined") => {
    if (!user || !contract?.pendingFinancialProposal) return
    setProposalError("")
    setProposalSuccess("")
    setProposalLoading(true)
    try {
      const proposal = contract.pendingFinancialProposal
      const token = await user.getIdToken()
      const monthlyValue = proposal.cadence === "monthly" ? proposal.amount : contract.monthlyValue
      const res = await fetch(`/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pendingFinancialProposalStatus: decision,
          ...(decision === "approved"
            ? {
                proposedAmount: proposal.amount,
                pricingCadence: proposal.cadence,
                paymentDates: proposal.paymentDates,
                monthlyValue,
              }
            : {}),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || "Unable to update proposal.")
      }
      setProposalSuccess(
        decision === "approved" ? "Financial proposal approved." : "Financial proposal declined."
      )
      await refreshContract()
    } catch (err) {
      setProposalError(err instanceof Error ? err.message : "Unable to update proposal.")
    } finally {
      setProposalLoading(false)
    }
  }

  const handleRequestLegalReview = async () => {
    if (!user || !contract) return
    setLegalReviewError("")
    setLegalReviewLoading(true)

    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/contracts/${contract.id}/legal-review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          participantName: "BEAM Law",
          participantId: "beam-law",
          memo: "Legal review requested.",
        }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error || "Unable to request legal review.")
      }
    } catch (err) {
      setLegalReviewError(err instanceof Error ? err.message : "Unable to request legal review.")
    } finally {
      setLegalReviewLoading(false)
    }
  }

  const proposedAmount = contract.proposedAmount ?? 0
  const displayValue = contract.monthlyValue > 0 ? contract.monthlyValue : proposedAmount
  const pricingCadence = contract.pricingCadence ?? "custom"
  const hasValue = displayValue > 0
  const hasTerm = contract.termMonths > 0
  const annualValue = contract.monthlyValue * 12
  const hasLegalReviews = (contract.legalReviews?.length ?? 0) > 0
  const hasFinancialReviews = (contract.financialReviews?.length ?? 0) > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-start gap-3 pr-8">
            <div className="min-w-0 flex-1">
              <DialogTitle className="leading-snug">{contract.title}</DialogTitle>
              <p className="mt-1 text-sm text-slate-500">{TYPE_LABELS[contract.contractType]}</p>
            </div>
            <Badge variant={STATUS_VARIANTS[contract.status]}>
              {STATUS_LABELS[contract.status]}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary */}
          {contract.summary ? (
            <Section title="Summary">
              <p className="text-sm text-slate-700 leading-relaxed">{contract.summary}</p>
            </Section>
          ) : null}

          {/* Financial details */}
          {(hasValue || hasTerm) ? (
            <Section title="Contract terms">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {hasValue ? (
                  <div className="rounded-2xl border border-border/60 bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">
                      {contract.monthlyValue > 0 ? "Monthly value" : "Proposed amount"}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      ${displayValue.toLocaleString()}
                      {contract.monthlyValue <= 0 && pricingCadence ? (
                        <span className="ml-1 text-xs font-normal text-slate-500">
                          {pricingCadence}
                        </span>
                      ) : null}
                    </p>
                  </div>
                ) : null}
                {contract.monthlyValue > 0 ? (
                  <div className="rounded-2xl border border-border/60 bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">Annual value</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      ${annualValue.toLocaleString()}
                    </p>
                  </div>
                ) : null}
                {hasTerm ? (
                  <div className="rounded-2xl border border-border/60 bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">Term</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      {contract.termMonths} {contract.termMonths === 1 ? "month" : "months"}
                    </p>
                  </div>
                ) : null}
              </div>

              {(contract.paymentDates?.length ?? 0) > 0 ? (
                <div className="rounded-2xl border border-border/60 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                    Payment dates
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {contract.paymentDates!.join(" · ")}
                  </p>
                </div>
              ) : null}

              {(contract.startDate || contract.endDate) ? (
                <div className="flex flex-wrap gap-4 text-sm">
                  {contract.startDate ? (
                    <div>
                      <span className="text-slate-500">Start date </span>
                      <span className="font-medium text-slate-900">
                        {new Date(contract.startDate).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  ) : null}
                  {contract.endDate ? (
                    <div>
                      <span className="text-slate-500">End date </span>
                      <span className="font-medium text-slate-900">
                        {new Date(contract.endDate).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Section>
          ) : null}

          <Section title="Amount negotiation">
            {contract.pendingFinancialProposal?.status === "pending" ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      Pending proposal: ${contract.pendingFinancialProposal.amount.toLocaleString()}{" "}
                      ({contract.pendingFinancialProposal.cadence})
                    </p>
                    {contract.pendingFinancialProposal.paymentDates.length > 0 ? (
                      <p className="mt-1 text-xs">
                        Dates: {contract.pendingFinancialProposal.paymentDates.join(" · ")}
                      </p>
                    ) : null}
                    {contract.pendingFinancialProposal.note ? (
                      <p className="mt-1 text-xs leading-5">
                        {contract.pendingFinancialProposal.note}
                      </p>
                    ) : null}
                  </div>
                  {isAdmin ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleAdminProposalDecision("approved")}
                        disabled={proposalLoading}
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void handleAdminProposalDecision("declined")}
                        disabled={proposalLoading}
                      >
                        Decline
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {proposalError ? (
              <p className="text-sm text-rose-600">{proposalError}</p>
            ) : null}
            {proposalSuccess ? (
              <p className="text-sm text-emerald-700">{proposalSuccess}</p>
            ) : null}

            {!isAdmin ? (
              <div className="space-y-3 rounded-2xl border border-border/60 bg-slate-50 px-4 py-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                  <Input
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="Proposed amount"
                    value={proposalAmount}
                    onChange={(event) => setProposalAmount(event.target.value)}
                  />
                  <Select
                    value={proposalCadence}
                    onValueChange={(value) =>
                      setProposalCadence(value as typeof proposalCadence)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one-time">One-time</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="milestone">Milestone</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  placeholder="Payment dates or milestones, comma separated"
                  value={proposalPaymentDates}
                  onChange={(event) => setProposalPaymentDates(event.target.value)}
                />
                <Textarea
                  placeholder="Explain the requested cost or payment-date change."
                  value={proposalNote}
                  onChange={(event) => setProposalNote(event.target.value)}
                  rows={3}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSubmitProposal()}
                  disabled={proposalLoading}
                >
                  {proposalLoading ? "Submitting..." : "Submit for admin review"}
                </Button>
              </div>
            ) : null}
          </Section>

          {/* NGOs */}
          {contract.beamNgos.length > 0 ? (
            <Section title="BEAM NGOs involved">
              <div className="flex flex-wrap gap-2">
                {contract.beamNgos.map((ngo) => (
                  <Badge key={ngo} variant="accent">
                    {NGO_LABELS[ngo] ?? ngo}
                  </Badge>
                ))}
              </div>
            </Section>
          ) : null}

          {/* Document link */}
          {contract.documentUrl ? (
            <Section title="Document">
              <a
                href={contract.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:opacity-80"
              >
                View contract document
              </a>
            </Section>
          ) : null}

          {/* Notes */}
          {contract.notes ? (
            <Section title="Notes">
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                {contract.notes}
              </p>
            </Section>
          ) : null}

          {/* Legal reviews */}
          {(hasLegalReviews || isAdmin) ? (
            <Section title="Legal reviews">
              {hasLegalReviews ? (
                <div className="space-y-3">
                  {contract.legalReviews!.map((r) => (
                    <LegalReviewRow key={r.id} review={r} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No legal reviews yet.</p>
              )}

              {isAdmin ? (
                <div className="pt-1">
                  {legalReviewError ? (
                    <p className="mb-2 text-sm text-rose-600">{legalReviewError}</p>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={legalReviewLoading}
                    onClick={handleRequestLegalReview}
                  >
                    {legalReviewLoading ? "Requesting..." : "Send for Legal Review"}
                  </Button>
                </div>
              ) : null}
            </Section>
          ) : null}

          {/* Financial reviews */}
          {hasFinancialReviews ? (
            <Section title="Financial reviews">
              <div className="space-y-3">
                {contract.financialReviews!.map((r) => (
                  <FinancialReviewRow key={r.id} review={r} />
                ))}
              </div>
            </Section>
          ) : null}

          {/* Admin status change */}
          {isAdmin ? (
            <Section title="Update status">
              {statusError ? (
                <p className="text-sm text-rose-600">{statusError}</p>
              ) : null}
              <Select
                value={contract.status}
                onValueChange={handleStatusChange}
                disabled={statusLoading}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
