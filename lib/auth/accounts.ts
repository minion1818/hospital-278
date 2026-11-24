import type { Role } from "@/lib/generated/prisma/enums";
import { ROLE_ACCOUNTS } from "./roles";

type UserLookup = {
  user: {
    findUnique(args: { where: { email: string } }): Promise<{ id: string; name: string; role: Role } | null>;
  };
};

export type RoleAccount = { id: string; name: string; role: Role };

/**
 * The seeded account for a role, or null if the database hasn't been seeded.
 * Takes the client as an argument so scripts can pass their own.
 */
export async function findRoleAccount(client: UserLookup, role: Role): Promise<RoleAccount | null> {
  const user = await client.user.findUnique({ where: { email: ROLE_ACCOUNTS[role].email } });
  // Guard against a mismatched row: the account must actually have that role
  return user && user.role === role ? { id: user.id, name: user.name, role } : null;
}
