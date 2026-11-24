"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ROLE_COOKIE, ROLE_COOKIE_OPTIONS, landingPathFor, parseRoleCookie } from "@/lib/auth/roles";

// STAND-IN FOR REAL AUTHENTICATION: there are no passwords. Picking a role on
// /login is the sign-in, and it only sets the role cookie.

export async function signIn(formData: FormData) {
  const raw = formData.get("role");
  const role = parseRoleCookie(typeof raw === "string" ? raw : null);
  if (!role) redirect("/login");

  const store = await cookies();
  store.set(ROLE_COOKIE, role, ROLE_COOKIE_OPTIONS); // session cookie: no maxAge/expires
  redirect(landingPathFor(role));
}

export async function signOut() {
  const store = await cookies();
  store.delete({ name: ROLE_COOKIE, path: "/" });
  redirect("/login");
}
