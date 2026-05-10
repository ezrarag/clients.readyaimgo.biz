export function PageBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,250,243,0.98),rgba(255,253,249,0.96)_48%,rgba(255,248,239,0.95))]" />
      <div className="surface-grid absolute inset-0 opacity-[0.16]" />
    </div>
  )
}
