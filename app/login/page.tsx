import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardCheck, FilePenLine, ShieldCheck, type LucideIcon } from "lucide-react";
import { signIn } from "@/app/actions/session";
import { ROLE_ACCOUNTS, ROLES, landingPathFor } from "@/lib/auth/roles";
import { getSessionRole } from "@/lib/session";
import type { Role } from "@/lib/generated/prisma/enums";

export const metadata: Metadata = { title: "Sign in" };

// STAND-IN FOR REAL AUTHENTICATION: picking a role is the sign-in. There are no
// passwords or user names; each card submits a Server Action that sets the role
// cookie (app/actions/session.ts).

const ROLE_ICONS: Record<Role, LucideIcon> = { STAFF: FilePenLine, REVIEWER: ShieldCheck };

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      {/* The proxy already redirects signed-in visitors; this re-checks the cookie on the server */}
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>

      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ClipboardCheck aria-hidden className="size-6" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">AuthDesk</h1>
          <p className="mt-1 text-sm text-muted-foreground">Select your role to continue.</p>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          {ROLES.map((role) => {
            const account = ROLE_ACCOUNTS[role];
            const Icon = ROLE_ICONS[role];
            return (
              <li key={role}>
                <form action={signIn} className="h-full">
                  <input type="hidden" name="role" value={role} />
                  <button
                    type="submit"
                    className="group flex h-full w-full flex-col items-start gap-4 rounded-xl bg-card p-6 text-left shadow-sm ring-1 ring-foreground/10 transition-all outline-none hover:shadow-md hover:ring-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <span className="flex-1">
                      <span className="block font-semibold">{account.name}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">{account.description}</span>
                    </span>
                    <span className="flex items-center gap-1 text-sm font-medium text-primary">
                      Continue
                      <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>

        <p className="mt-10 text-center text-sm">
          <Link href="/payer" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Open payer simulator
          </Link>
        </p>
      </div>
    </main>
  );
}

async function RedirectIfSignedIn() {
  const role = await getSessionRole();
  if (role) redirect(landingPathFor(role));
  return null;
}
