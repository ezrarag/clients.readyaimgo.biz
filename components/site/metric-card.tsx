import type { LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type Tone = "brand" | "cool" | "success" | "neutral"

const toneClasses: Record<Tone, string> = {
  brand: "bg-primary/12 text-primary",
  cool: "bg-sky-100 text-sky-700",
  success: "bg-emerald-100 text-emerald-700",
  neutral: "bg-slate-100 text-slate-700",
}

interface MetricCardProps {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  tone?: Tone
  className?: string
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "brand",
  className,
}: MetricCardProps) {
  return (
    <Card className={cn("h-full", className)}>
      <CardContent className="flex h-full flex-col gap-4 p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
              {label}
            </p>
            <p className="text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
          </div>
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl",
              toneClasses[tone]
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="text-sm leading-6 text-slate-600">{detail}</p>
      </CardContent>
    </Card>
  )
}
