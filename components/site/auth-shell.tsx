import type { ReactNode } from "react"

import { CheckCircle2 } from "lucide-react"

import { BrandMark } from "@/components/site/brand"
import { PageBackdrop } from "@/components/site/page-backdrop"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface AuthShellProps {
  title: string
  description: string
  asideTitle: string
  asideDescription: string
  highlights: string[]
  children: ReactNode
  footer?: ReactNode
}

export function AuthShell({
  title,
  description,
  asideTitle,
  asideDescription,
  highlights,
  children,
  footer,
}: AuthShellProps) {
  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <PageBackdrop />
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:gap-10 lg:px-8 lg:py-10">
        <section className="animate-fade-up relative overflow-hidden rounded-[32px] border border-white/80 bg-white/65 p-8 shadow-glow backdrop-blur-sm lg:flex-1 lg:p-10">
          <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-orange-200/40 blur-3xl" />
          <BrandMark />
          <div className="relative mt-10 max-w-xl space-y-5">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-500">
              Client workspace
            </p>
            <h1 className="font-display text-balance text-5xl font-semibold leading-tight text-slate-950 sm:text-6xl">
              {asideTitle}
            </h1>
            <p className="max-w-lg text-base leading-7 text-slate-600 sm:text-lg">
              {asideDescription}
            </p>
          </div>
          <div className="relative mt-8 space-y-3">
            {highlights.map((highlight) => (
              <div
                key={highlight}
                className="flex items-center gap-3 rounded-2xl border border-white/70 bg-white/70 px-4 py-3 text-sm text-slate-700"
              >
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>{highlight}</span>
              </div>
            ))}
          </div>
        </section>

        <Card className="animate-fade-up w-full max-w-xl lg:w-[30rem]">
          <CardHeader className="pb-5">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {children}
            {footer}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
