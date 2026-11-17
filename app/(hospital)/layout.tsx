import { Suspense } from "react";
import { Brand, MobileNav, SidebarNav, SidebarNavFallback } from "@/components/app-shell/nav";
import { UserMenu } from "@/components/app-shell/user-menu";
import { getSessionUsers } from "@/lib/demo-session";
import { ROLE_TITLES } from "@/lib/workflow";

// Hospital application shell: sidebar navigation (top bar + menu on mobile) and
// the user menu. The payer simulator (/payer) has its own layout.
export default function HospitalLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b px-5">
          <Brand />
        </div>
        {/* usePathname suspends on pages with unknown dynamic params (e.g. /requests/[id]) */}
        <Suspense fallback={<SidebarNavFallback />}>
          <SidebarNav />
        </Suspense>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-1 md:hidden">
            <MobileNav />
            <Brand />
          </div>
          <div className="ml-auto">
            {/* The role cookie and user lookup are request-time data */}
            <Suspense fallback={<UserMenu users={[]} />}>
              <UserMenuLoader />
            </Suspense>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

async function UserMenuLoader() {
  const { current, users } = await getSessionUsers();
  return <UserMenu current={current} users={users.map((u) => ({ ...u, title: ROLE_TITLES[u.role] }))} />;
}
