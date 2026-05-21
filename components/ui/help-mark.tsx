"use client"

import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const DEFAULT_STEPS = [
  "Workspace activity, files, repositories, and utility invoices create the operating record.",
  "Contract drafts translate that record into scope, deliverables, payment terms, and review notes.",
  "Retainer and hosting ledgers show how escrow funds are allocated to production work and third-party utilities.",
  "Admin review keeps approvals, contract status, and client records synchronized across ReadyAimGo dashboards.",
]

export function HelpMark({
  text,
  title = "How this connects to contracts and escrow",
  steps = DEFAULT_STEPS,
}: {
  text: string
  title?: string
  steps?: string[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label="Section help"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-[11px] font-bold leading-none text-slate-400 shadow-sm transition hover:border-slate-300 hover:text-slate-700"
      >
        ?
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-normal leading-5 text-slate-600 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        {text}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-200" />
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg rounded-[28px]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="leading-6">{text}</DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm leading-6 text-slate-600">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </span>
  )
}
