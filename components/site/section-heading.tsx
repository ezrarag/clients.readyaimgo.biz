import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface SectionHeadingProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  align?: "left" | "center"
  className?: string
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
  align = "left",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "items-center text-center" : "items-start text-left",
        className
      )}
    >
      <div className="space-y-3">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="font-display text-balance text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">
          {title}
        </h2>
        {description ? (
          <p className="max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  )
}
