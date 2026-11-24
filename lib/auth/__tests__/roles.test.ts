import { describe, expect, it } from "vitest";
import {
  ROLE_ACCOUNTS,
  ROLE_TITLES,
  ROLES,
  canCreateRequests,
  landingPathFor,
  parseRoleCookie,
} from "@/lib/auth/roles";
import { findRoleAccount } from "@/lib/auth/accounts";

describe("parseRoleCookie", () => {
  it("accepts the two exact role values", () => {
    expect(parseRoleCookie("STAFF")).toBe("STAFF");
    expect(parseRoleCookie("REVIEWER")).toBe("REVIEWER");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", " "],
    ["lowercase", "staff"],
    ["padded", " REVIEWER"],
    ["unknown role", "ADMIN"],
    ["tampered", "REVIEWER;admin=1"],
    ["object-ish", "[object Object]"],
    ["prototype key", "__proto__"],
  ])("treats a %s value as signed out", (_label, value) => {
    expect(parseRoleCookie(value)).toBeNull();
  });
});

describe("landingPathFor", () => {
  it("sends the Authorization Specialist to the request list", () => {
    expect(landingPathFor("STAFF")).toBe("/requests");
  });

  it("sends the Utilization Reviewer to the pending review filter", () => {
    expect(landingPathFor("REVIEWER")).toBe("/requests?view=review");
  });
});

describe("role accounts", () => {
  it("only the Authorization Specialist creates requests", () => {
    expect(canCreateRequests("STAFF")).toBe(true);
    expect(canCreateRequests("REVIEWER")).toBe(false);
  });

  it("uses the role titles as account names", () => {
    expect(ROLES.map((r) => ROLE_TITLES[r])).toEqual(["Authorization Specialist", "Utilization Reviewer"]);
    for (const r of ROLES) expect(ROLE_ACCOUNTS[r].name).toBe(ROLE_TITLES[r]);
    expect(ROLE_ACCOUNTS.STAFF.initials).toBe("AS");
    expect(ROLE_ACCOUNTS.REVIEWER.initials).toBe("UR");
  });

  it("finds the seeded account by the role's email and checks its role", async () => {
    const rows = {
      [ROLE_ACCOUNTS.STAFF.email]: { id: "u1", name: "Authorization Specialist", role: "STAFF" as const },
      // A mismatched row must not grant the reviewer role
      [ROLE_ACCOUNTS.REVIEWER.email]: { id: "u2", name: "Utilization Reviewer", role: "STAFF" as const },
    };
    const client = { user: { findUnique: async ({ where }: { where: { email: string } }) => rows[where.email] ?? null } };

    expect(await findRoleAccount(client, "STAFF")).toEqual({ id: "u1", name: "Authorization Specialist", role: "STAFF" });
    expect(await findRoleAccount(client, "REVIEWER")).toBeNull();
    expect(await findRoleAccount({ user: { findUnique: async () => null } }, "STAFF")).toBeNull();
  });
});
