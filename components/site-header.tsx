import { Suspense } from "react";
import Link from "next/link";
import { getActingRole } from "@/lib/demo-session";
import { ROLE_LABELS } from "@/lib/workflow";
import { setActingRole } from "@/app/actions/role";
import type { Role } from "@/lib/generated/prisma/enums";

const ROLES: Role[] = ["STAFF", "REVIEWER"];

export function SiteHeader() {
  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-8 py-3">
        <Link href="/requests" className="font-semibold text-gray-900">
          Prior Auth Dashboard
          <span className="ml-2 text-xs font-normal text-gray-500">synthetic demo</span>
        </Link>
        {/* The cookie read is request-time data, so it streams in behind Suspense */}
        <Suspense fallback={<RoleSwitcherShell />}>
          <RoleSwitcher />
        </Suspense>
      </div>
    </header>
  );
}

async function RoleSwitcher() {
  const current = await getActingRole();
  return <RoleSwitcherShell current={current} />;
}

/** Without `current` it renders as a neutral placeholder (Suspense fallback). */
function RoleSwitcherShell({ current }: { current?: Role }) {
  return (
    // Demo stand-in for real authentication: see lib/demo-session.ts
    <form action={setActingRole} className="flex items-center gap-2 text-sm">
      <span className="text-gray-500">Acting as</span>
      <div role="group" aria-label="Acting as" className="flex rounded-lg border p-0.5">
        {ROLES.map((role) => {
          const active = role === current;
          return (
            <button
              key={role}
              type="submit"
              name="role"
              value={role}
              disabled={!current}
              aria-pressed={active}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
              } disabled:cursor-default`}
            >
              {ROLE_LABELS[role]}
            </button>
          );
        })}
      </div>
    </form>
  );
}
