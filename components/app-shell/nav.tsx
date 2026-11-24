"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ClipboardCheck,
  FilePlus2,
  FileText,
  Inbox,
  Landmark,
  LayoutDashboard,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Role = "STAFF" | "REVIEWER";
type Location = { path: string; view: string | null };
type NavItem = { label: string; href: string; icon: LucideIcon; isActive: (l: Location) => boolean };

const isDetail = ({ path }: Location) => path.startsWith("/requests/") && path !== "/requests/new";

const DASHBOARD: NavItem = {
  label: "Dashboard",
  href: "/requests",
  icon: LayoutDashboard,
  isActive: (l) => l.path === "/requests" && l.view !== "review",
};
const REQUESTS: NavItem = { label: "Requests", href: "/requests", icon: FileText, isActive: isDetail };

// "Dashboard" is the work queue for now; "Requests" highlights while viewing one request.
const MAIN_NAV: Record<Role, NavItem[]> = {
  STAFF: [
    DASHBOARD,
    REQUESTS,
    { label: "New request", href: "/requests/new", icon: FilePlus2, isActive: (l) => l.path === "/requests/new" },
  ],
  REVIEWER: [
    DASHBOARD,
    {
      label: "Review queue",
      href: "/requests?view=review",
      icon: Inbox,
      isActive: (l) => l.path === "/requests" && l.view === "review",
    },
    REQUESTS,
  ],
};

const TOOLS_NAV: NavItem[] = [
  { label: "Payer simulator", href: "/payer", icon: Landmark, isActive: (l) => l.path.startsWith("/payer") },
];

/** App name, with the signed-in role title underneath when known. */
export function Brand({ roleTitle, className }: { roleTitle?: string; className?: string }) {
  return (
    <Link href="/requests" className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ClipboardCheck aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block font-semibold tracking-tight">AuthDesk</span>
        {roleTitle && <span className="block truncate text-xs text-muted-foreground">{roleTitle}</span>}
      </span>
    </Link>
  );
}

function NavLinks({ items, location }: { items: NavItem[]; location: Location | null }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = location !== null && item.isActive(location);
        return (
          <li key={item.label}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon aria-hidden className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function useLocation(): Location {
  return { path: usePathname(), view: useSearchParams().get("view") };
}

/** Desktop sidebar navigation for the signed-in role. */
export function SidebarNav({ role }: { role: Role }) {
  const location = useLocation();
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col justify-between px-3 py-4">
      <NavLinks items={MAIN_NAV[role]} location={location} />
      <ToolsGroup location={location} />
    </nav>
  );
}

/** Shown while the role loads: only the Tools group, which is the same for everyone. */
export function SidebarNavFallback() {
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col justify-between px-3 py-4">
      <div aria-hidden className="space-y-2 px-2.5 pt-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-4 w-28 animate-pulse rounded bg-muted" />
        ))}
      </div>
      <ToolsGroup location={null} />
    </nav>
  );
}

function ToolsGroup({ location }: { location: Location | null }) {
  return (
    <div>
      <p className="mb-1.5 px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Tools</p>
      <NavLinks items={TOOLS_NAV} location={location} />
    </div>
  );
}

/** Mobile: a menu button in the top bar that opens the same navigation. */
export function MobileNav({ role }: { role?: Role }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open navigation menu"
        disabled={!role}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "md:hidden")}
      >
        <Menu aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        {role && (
          <DropdownMenuGroup>
            {MAIN_NAV[role].map((item) => (
              <DropdownMenuItem key={item.label} render={<Link href={item.href} />}>
                <item.icon aria-hidden className="text-muted-foreground" />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Tools</DropdownMenuLabel>
          {TOOLS_NAV.map((item) => (
            <DropdownMenuItem key={item.label} render={<Link href={item.href} />}>
              <item.icon aria-hidden className="text-muted-foreground" />
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
