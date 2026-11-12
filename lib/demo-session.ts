// DEMO STAND-IN FOR REAL AUTHENTICATION.
// The "acting as" role lives in a plain, unsigned cookie that anyone can change,
// and the acting user is simply the seeded user with that role. Replace this
// module with a real session (and server-side authorization) before any real use.

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/enums";

export const ROLE_COOKIE = "demo-role";
export const DEFAULT_ROLE: Role = "STAFF";

const DEMO_USER_EMAIL: Record<Role, string> = {
  STAFF: "staff@demo.test",
  REVIEWER: "reviewer@demo.test",
};

export function parseRole(value: string | undefined): Role {
  return value === "REVIEWER" || value === "STAFF" ? value : DEFAULT_ROLE;
}

/** Reads the role cookie. Request-time data: call only inside a <Suspense> boundary or a Server Action. */
export async function getActingRole(): Promise<Role> {
  const store = await cookies();
  return parseRole(store.get(ROLE_COOKIE)?.value);
}

/** The seeded user for the acting role, or null if the database hasn't been seeded. */
export async function getActingUser() {
  const role = await getActingRole();
  const user = await db.user.findUnique({ where: { email: DEMO_USER_EMAIL[role] } });
  return user ? { id: user.id, name: user.name, role } : null;
}
