export const dynamic = "force-static"

export function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f97316"/><path d="M18 42 32 16l14 26h-9l-5-10-5 10h-9Z" fill="#fff"/></svg>`
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
