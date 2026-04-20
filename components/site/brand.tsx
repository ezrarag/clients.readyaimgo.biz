import Link from "next/link"

import { cn } from "@/lib/utils"

interface BrandMarkProps {
  className?: string
  compact?: boolean
  href?: string
}

export function BrandMark({
  className,
  compact = false,
  href = "/",
}: BrandMarkProps) {
  const content = (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex h-11 w-11 items-center justify-center rounded-[18px] border border-white/70 bg-white/80 shadow-sm">
        <div className="absolute inset-[3px] rounded-[14px] bg-gradient-readyaimgo opacity-90" />
        <div className="relative h-3.5 w-3.5 rounded-full bg-white shadow-sm" />
      </div>
      <div className="leading-none">
        <p className={cn("font-semibold tracking-tight text-slate-950", compact ? "text-base" : "text-lg")}>
          Readyaimgo
        </p>
        <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.32em] text-slate-500">
          Client Hub
        </p>
      </div>
    </div>
  )

  return (
    <Link href={href} className="inline-flex">
      {content}
    </Link>
  )
}
