export function PageBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,250,243,0.96),rgba(255,253,249,0.95))]" />
      <div className="absolute -left-24 top-[-6rem] h-[26rem] w-[26rem] rounded-full bg-orange-200/45 blur-3xl" />
      <div className="absolute right-[-8rem] top-24 h-[22rem] w-[22rem] rounded-full bg-sky-200/40 blur-3xl" />
      <div className="absolute bottom-[-9rem] left-1/2 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-amber-100/70 blur-3xl" />
      <div className="surface-grid absolute inset-0 opacity-[0.24]" />
    </div>
  )
}
