import { Suspense } from "react";
import { Brand, MobileNav, SidebarNav, SidebarNavFallback } from "@/components/app-shell/nav";
import { UserMenu } from "@/components/app-shell/user-menu";
import { ROLE_ACCOUNTS } from "@/lib/auth/roles";
import { requireRole } from "@/lib/session";

// Hospital application shell: role-specific sidebar (top bar + menu on mobile)
// and the account menu. The proxy sends signed-out visitors to /login; the
// loaders below re-validate the role cookie (inside Suspense) and redirect too.
// The payer simulator (/payer) and /login have their own layouts.
export default function HospitalLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar md:flex">
        <Suspense
          fallback={
            <>
              <SidebarHeader />
              <SidebarNavFallback />
            </>
          }
        >
          <SidebarLoader />
        </Suspense>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-1 md:hidden">
            <Suspense fallback={<MobileNav />}>
              <MobileNavLoader />
            </Suspense>
            <Brand />
          </div>
          <div className="ml-auto">
            <Suspense fallback={<UserMenu />}>
              <UserMenuLoader />
            </Suspense>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

function SidebarHeader({ roleTitle }: { roleTitle?: string }) {
  return (
    <div className="flex h-14 items-center border-b px-5">
      <Brand roleTitle={roleTitle} />
    </div>
  );
}

async function SidebarLoader() {
  const role = await requireRole();
  return (
    <>
      <SidebarHeader roleTitle={ROLE_ACCOUNTS[role].name} />
      {/* usePathname/useSearchParams: rendered inside this Suspense boundary */}
      <SidebarNav role={role} />
    </>
  );
}

async function MobileNavLoader() {
  const role = await requireRole();
  return <MobileNav role={role} />;
}

async function UserMenuLoader() {
  const role = await requireRole();
  const { name, initials } = ROLE_ACCOUNTS[role];
  return <UserMenu role={{ title: name, initials }} />;
}
