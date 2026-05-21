export function HelpMark({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label="Section help"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-[11px] font-bold leading-none text-slate-400 shadow-sm transition hover:border-slate-300 hover:text-slate-700"
      >
        ?
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-normal leading-5 text-slate-600 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        {text}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-200" />
      </span>
    </span>
  )
}

