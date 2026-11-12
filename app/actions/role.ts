"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { ROLE_COOKIE } from "@/lib/demo-session";

const roleSchema = z.enum(["STAFF", "REVIEWER"]);

// Demo stand-in for real authentication: switching "roles" just sets a cookie.
// Setting a cookie in a Server Action re-renders the current page with the new role.
export async function setActingRole(formData: FormData) {
  const parsed = roleSchema.safeParse(formData.get("role"));
  if (!parsed.success) return;

  const store = await cookies();
  store.set(ROLE_COOKIE, parsed.data, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  });
}
