"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { BeamContract, ContractStatus, ContractType } from "@/lib/contracts"

// ---------------------------------------------------------------------------
// Status helpers
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

const STATUS_ORDER: ContractStatus[] = [
  "draft",
  "reviewed",
  "sent",
  "signed",
  "active",
  "expired",
]

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

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
// Status timeline
// ---------------------------------------------------------------------------

type NormalStep = Exclude<ContractStatus, "expired">

function StatusTimeline({ status }: { status: ContractStatus }) {
  // Expired is a terminal state, not in the normal progression
  const steps = STATUS_ORDER.filter((s): s is NormalStep => s !== "expired")
  const isExpired = status === "expired"
  const currentIndex = isExpired ? steps.length : steps.indexOf(status as NormalStep)

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => {
        const isActive = step === status && !isExpired
        const isPast = i < currentIndex && !isExpired
        const isFuture = i > currentIndex || isExpired

        return (
          <div key={step} className="flex items-center gap-1">
            <div
              className={[
                "h-2 w-2 rounded-full transition-colors",
                isActive ? "bg-primary" : isPast ? "bg-emerald-500" : isFuture ? "bg-slate-200" : "bg-slate-200",
              ].join(" ")}
              title={STATUS_LABELS[step]}
            />
            {i < steps.length - 1 && (
              <div
                className={[
                  "h-px w-4",
                  isPast ? "bg-emerald-500" : "bg-slate-200",
                ].join(" ")}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContractCard
// ---------------------------------------------------------------------------

interface ContractCardProps {
  contract: BeamContract
  onViewDetails?: (contract: BeamContract) => void
}

export function ContractCard({ contract, onViewDetails }: ContractCardProps) {
  const displayAmount = contract.monthlyValue > 0 ? contract.monthlyValue : contract.proposedAmount ?? 0
  const hasValue = displayAmount > 0
  const hasTerm = contract.termMonths > 0
  const annualValue = contract.monthlyValue * 12

  return (
    <Card className="group border-border/60 transition-shadow hover:shadow-md">
      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 leading-snug line-clamp-2">
              {contract.title}
            </p>
            <p className="mt-1 text-sm text-slate-500">{TYPE_LABELS[contract.contractType]}</p>
          </div>
          <Badge variant={STATUS_VARIANTS[contract.status]} className="shrink-0">
            {STATUS_LABELS[contract.status]}
          </Badge>
        </div>

        {/* Summary */}
        {contract.summary ? (
          <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
            {contract.summary}
          </p>
        ) : null}

        {/* Value + Term */}
        {(hasValue || hasTerm) ? (
          <div className="flex flex-wrap gap-4 text-sm">
            {hasValue ? (
              <div>
                <span className="text-slate-500">
                  {contract.monthlyValue > 0 ? "Monthly value" : "Proposed amount"}
                </span>
                <p className="font-semibold text-slate-900">
                  ${displayAmount.toLocaleString()}
                  {contract.monthlyValue > 0 && hasTerm ? (
                    <span className="ml-1 text-xs font-normal text-slate-500">
                      / mo · ${annualValue.toLocaleString()} / yr
                    </span>
                  ) : contract.monthlyValue <= 0 && contract.pricingCadence ? (
                    <span className="ml-1 text-xs font-normal text-slate-500">
                      {contract.pricingCadence}
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}
            {hasTerm ? (
              <div>
                <span className="text-slate-500">Term</span>
                <p className="font-semibold text-slate-900">
                  {contract.termMonths} {contract.termMonths === 1 ? "month" : "months"}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* NGO tags */}
        {contract.beamNgos.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {contract.beamNgos.map((ngo) => (
              <Badge key={ngo} variant="accent" className="text-xs">
                {NGO_LABELS[ngo] ?? ngo}
              </Badge>
            ))}
          </div>
        ) : null}

        {/* Status timeline + action */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <StatusTimeline status={contract.status} />

          {onViewDetails ? (
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => onViewDetails(contract)}
            >
              View details
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
