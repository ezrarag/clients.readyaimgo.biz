import type { ReactNode } from "react"
import Link from "next/link"

import { BrandMark } from "@/components/site/brand"
import { PageBackdrop } from "@/components/site/page-backdrop"
import { cn } from "@/lib/utils"

interface NavItem {
  href: string
  label: string
  active?: boolean
}

interface AppShellProps {
  title: string
  description: string
  eyebrow?: string
  nav: NavItem[]
  actions?: ReactNode
  intro?: ReactNode
  children: ReactNode
}

export function AppShell({
  title,
  description,
  eyebrow = "Workspace",
  nav,
  actions,
  intro,
  children,
}: AppShellProps) {
  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <PageBackdrop />
      <header className="sticky top-0 z-20 border-b border-white/70 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <BrandMark compact />
            <nav className="flex flex-wrap items-center gap-2">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                    item.active
                      ? "bg-slate-950 text-white"
                      : "text-slate-600 hover:bg-white/80 hover:text-slate-950"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-14 pt-8 sm:px-6 lg:px-8">
        <section className="animate-fade-up mb-8 rounded-[32px] border border-white/80 bg-white/65 p-7 shadow-glow backdrop-blur-sm sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">
                {eyebrow}
              </p>
              <h1 className="font-display text-balance text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">
                {title}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                {description}
              </p>
            </div>
            {intro ? <div className="w-full max-w-md">{intro}</div> : null}
          </div>
        </section>

        {children}
      </main>
    </div>
  )
}
