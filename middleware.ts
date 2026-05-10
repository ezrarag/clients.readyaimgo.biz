import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PUBLIC_PATHS = ["/login", "/signup", "/join", "/no-access", "/api/"]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow public paths and static assets.
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname.startsWith("/_next")) {
    return NextResponse.next()
  }

  // The deep revocation check runs in server resolvers that can verify the
  // Firebase ID token and read ragAllowlist without exposing it to the browser.
  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}
