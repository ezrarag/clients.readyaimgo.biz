"use client"

import { CheckCircle2, CreditCard, ExternalLink, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { BeamContract } from "@/lib/contracts"
import type { ClientInvoice } from "@/lib/invoices"

import type { ClientDeliverable } from "@/lib/deliverables"

interface ContractMilestonePipelineProps {
  contract: BeamContract
  invoices: ClientInvoice[]
  deliverables: ClientDeliverable[]
  onPayDeliverable: (deliverableId: string) => Promise<void>
  payingDeliverableId: string | null
}

export function ContractMilestonePipeline({
  contract,
  invoices,
  deliverables,
  onPayDeliverable,
  payingDeliverableId,
}: ContractMilestonePipelineProps) {
  const milestones = contract.paymentDates || []
  if (milestones.length === 0) return null

  // Format currency
  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100)
  }

  return (
    <div className="rounded-2xl border border-neutral-700/60 bg-neutral-900/40 p-5 space-y-4">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-widest text-orange-500 font-mono">
          Milestone Payments
        </h4>
        <p className="mt-1 text-sm text-neutral-400">
          Track and pay installments mapped to your workspace contractor agreement.
        </p>
      </div>

      <div className="relative mt-4 flex flex-col space-y-5">
        {milestones.map((milestone, idx) => {
          // Find matching invoice by installmentIndex
          const matchingInvoice = invoices.find(
            (inv) => inv.contractId === contract.id && inv.installmentIndex === idx
          )

          let status: "unbilled" | "draft" | "pending" | "paid" = "unbilled"
          let deliverableId: string | null = null
          let totalCents = 0
          let paymentLink: string | null = null

          if (matchingInvoice) {
            totalCents = matchingInvoice.totalCents
            paymentLink = matchingInvoice.paymentLink || null
            deliverableId = matchingInvoice.deliverableId || null

            if (matchingInvoice.status === "paid") {
              status = "paid"
            } else if (matchingInvoice.status === "draft") {
              status = "draft"
            } else {
              status = "pending"
            }
          }

          const isPaying = deliverableId && payingDeliverableId === deliverableId

          return (
            <div key={idx} className="flex items-start gap-4">
              {/* Stepper Dot & Connector */}
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={[
                    "h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold font-mono transition-colors border",
                    status === "paid"
                      ? "bg-emerald-500 text-neutral-950 border-emerald-400"
                      : status === "pending"
                      ? "bg-orange-500 text-neutral-950 border-orange-400 animate-pulse"
                      : status === "draft"
                      ? "bg-blue-500 text-neutral-950 border-blue-400"
                      : "bg-neutral-800 text-neutral-500 border-neutral-700",
                  ].join(" ")}
                >
                  {status === "paid" ? (
                    <CheckCircle2 className="h-4 w-4 stroke-[3px]" />
                  ) : (
                    idx + 1
                  )}
                </div>
                {idx < milestones.length - 1 && (
                  <div className="h-10 w-px bg-neutral-800 mt-2 shrink-0" />
                )}
              </div>

              {/* Milestone Details */}
              <div className="flex-1 min-w-0 bg-neutral-900/60 rounded-xl border border-neutral-800 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white leading-snug">{milestone}</p>
                    {matchingInvoice ? (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                        <span>Invoice: {matchingInvoice.invoiceNumber}</span>
                        <span>·</span>
                        <span>Due: {new Date(matchingInvoice.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                        {totalCents > 0 && (
                          <>
                            <span>·</span>
                            <span className="font-medium text-orange-400/90">{formatCurrency(totalCents)}</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-neutral-600">No invoice issued yet.</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {status === "unbilled" ? (
                      <Badge variant="secondary" className="border border-neutral-700 text-neutral-500 bg-transparent">
                        Unbilled
                      </Badge>
                    ) : status === "paid" ? (
                      <Badge variant="secondary" className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                        Paid
                      </Badge>
                    ) : status === "draft" ? (
                      <Badge variant="secondary" className="border border-blue-500/30 bg-blue-500/10 text-blue-400">
                        In Review
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        {deliverableId ? (
                          <Button
                            size="sm"
                            disabled={isPaying || Boolean(payingDeliverableId)}
                            onClick={() => deliverableId && onPayDeliverable(deliverableId)}
                            className="bg-orange-500 text-neutral-950 hover:bg-orange-600 font-semibold text-xs px-3 h-8 flex items-center gap-1.5"
                          >
                            {isPaying ? (
                              <Loader2 className="h-3 w-3 animate-spin text-neutral-950" />
                            ) : (
                              <CreditCard className="h-3.5 w-3.5 text-neutral-950" />
                            )}
                            Pay
                          </Button>
                        ) : paymentLink ? (
                          <a
                            href={paymentLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-orange-400 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Pay via Link
                          </a>
                        ) : (
                          <Badge variant="secondary" className="border border-orange-500/30 bg-orange-500/10 text-orange-400">
                            Pending Payment
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
