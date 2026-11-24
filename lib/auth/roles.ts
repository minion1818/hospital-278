// STAND-IN FOR REAL AUTHENTICATION.
// "Signing in" means picking a role on /login, which sets a plain, unsigned
// cookie. Anyone can set it to either role, so it identifies a workspace, not a
// person. Replace this with a real identity provider and signed sessions before
// any real use.
//
// Pure module (no Next.js or database imports) so the proxy, the server code,
// the seed script and the tests can all share it.

import type { Role } from "@/lib/generated/prisma/enums";

/** Cookie holding the signed-in role. Name kept from the earlier role switcher. */
export const ROLE_COOKIE = "demo-role";

export const ROLES = ["STAFF", "REVIEWER"] as const satisfies readonly Role[];

/** One shared account per role (seeded in prisma/seed.ts). */
export const ROLE_ACCOUNTS: Record<Role, { name: string; email: string; initials: string; description: string }> = {
  STAFF: {
    name: "Authorization Specialist",
    email: "authorization.specialist@authdesk.test",
    initials: "AS",
    description: "Create requests and follow up with the payer",
  },
  REVIEWER: {
    name: "Utilization Reviewer",
    email: "utilization.reviewer@authdesk.test",
    initials: "UR",
    description: "Review requests and send them to the payer",
  },
};

/** Display titles for each role (the enum values stay STAFF / REVIEWER). */
export const ROLE_TITLES: Record<Role, string> = {
  STAFF: ROLE_ACCOUNTS.STAFF.name,
  REVIEWER: ROLE_ACCOUNTS.REVIEWER.name,
};

/**
 * Parses the role cookie. The cookie is untrusted input: anything other than an
 * exact role value (missing, empty, tampered, different case) means signed out.
 */
export function parseRoleCookie(value: string | null | undefined): Role | null {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value) ? (value as Role) : null;
}

/** Where each role lands after signing in (and when opening "/" or "/login" while signed in). */
export function landingPathFor(role: Role): string {
  return role === "REVIEWER" ? "/requests?view=review" : "/requests";
}

/** Only the Authorization Specialist creates new requests. */
export function canCreateRequests(role: Role): boolean {
  return role === "STAFF";
}

/** Session cookie (no expiry): httpOnly, same-site lax, whole site. */
export const ROLE_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
} as const;
