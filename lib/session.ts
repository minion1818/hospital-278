// Server-side session helpers (data access layer). STAND-IN FOR REAL
// AUTHENTICATION: the session is just the role cookie set on /login; see
// lib/auth/roles.ts.
//
// The proxy already redirects signed-out visitors, but it is only an optimistic
// check. Everything that reads the role re-validates the cookie here and treats
// an invalid value as signed out.

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/enums";
import { findRoleAccount } from "@/lib/auth/accounts";
import { ROLE_COOKIE, parseRoleCookie } from "@/lib/auth/roles";

/**
 * The signed-in role, or null when signed out. Request-time data: call only
 * inside a <Suspense> boundary, a Server Action or a Route Handler.
 */
export const getSessionRole = cache(async (): Promise<Role | null> => {
  const store = await cookies();
  return parseRoleCookie(store.get(ROLE_COOKIE)?.value);
});

/** The signed-in role; redirects to /login when signed out. */
export async function requireRole(): Promise<Role> {
  const role = await getSessionRole();
  if (!role) redirect("/login");
  return role;
}

/**
 * The account for the signed-in role (redirects to /login when signed out), or
 * null if the database hasn't been seeded.
 */
export async function getSessionUser() {
  const role = await requireRole();
  return findRoleAccount(db, role);
}
