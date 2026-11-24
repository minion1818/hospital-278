import { NextResponse, type NextRequest } from "next/server";
import { ROLE_COOKIE, landingPathFor, parseRoleCookie } from "@/lib/auth/roles";

// Optimistic sign-in check (cookie only, no database). STAND-IN FOR REAL
// AUTHENTICATION: the "session" is the role picked on /login. Server code
// re-validates the cookie (lib/session.ts), so this is not the only check.
//
// Public: /login and the payer simulator (/payer, /api/payer/*, which the
// matcher skips entirely). Everything else in the hospital app needs a role.

const isPayerPath = (path: string) => path === "/payer" || path.startsWith("/payer/");

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const role = parseRoleCookie(request.cookies.get(ROLE_COOKIE)?.value);

  if (isPayerPath(path)) return NextResponse.next();

  if (path === "/login") {
    // Already signed in: go straight to that role's workspace
    return role ? NextResponse.redirect(new URL(landingPathFor(role), request.url)) : NextResponse.next();
  }

  if (!role) return NextResponse.redirect(new URL("/login", request.url));

  // No landing page of its own
  if (path === "/") return NextResponse.redirect(new URL("/requests", request.url));

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except the payer API, Next.js internals and static files
    "/((?!api/payer|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
