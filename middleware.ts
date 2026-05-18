import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Middleware is intentionally minimal.
 *
 * Firebase stores auth tokens in IndexedDB (not HTTP cookies), so there is no
 * reliable way to gate routes here without a full server-side session-cookie
 * setup. Authentication enforcement is handled client-side by AuthProvider
 * (onAuthStateChanged → redirect to /login) and server-side inside each API
 * route via getBearerToken / getAdminAuth().verifyIdToken().
 */
export function middleware(request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
