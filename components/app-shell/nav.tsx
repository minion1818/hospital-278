"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, FilePlus2, FileText, Landmark, LayoutDashboard, Menu, type LucideIcon } from "lucide-react";
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

type NavItem = { label: string; href: string; icon: LucideIcon; isActive: (path: string) => boolean };

// "Dashboard" is the work queue for now; "Requests" highlights while viewing one request.
const MAIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/requests", icon: LayoutDashboard, isActive: (p) => p === "/requests" },
  {
    label: "Requests",
    href: "/requests",
    icon: FileText,
    isActive: (p) => p.startsWith("/requests/") && p !== "/requests/new",
  },
  { label: "New request", href: "/requests/new", icon: FilePlus2, isActive: (p) => p === "/requests/new" },
];

const TOOLS_NAV: NavItem[] = [
  { label: "Payer simulator", href: "/payer", icon: Landmark, isActive: (p) => p.startsWith("/payer") },
];

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/requests" className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ClipboardCheck aria-hidden className="size-4" />
      </span>
      AuthDesk
    </Link>
  );
}

function NavLinks({ items, pathname }: { items: NavItem[]; pathname: string | null }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = pathname !== null && item.isActive(pathname);
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

/** Desktop sidebar body. `pathname` is null in the Suspense fallback (no active item yet). */
function SidebarBody({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col justify-between px-3 py-4">
      <NavLinks items={MAIN_NAV} pathname={pathname} />
      <div>
        <p className="mb-1.5 px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Tools</p>
        <NavLinks items={TOOLS_NAV} pathname={pathname} />
      </div>
    </nav>
  );
}

export function SidebarNav() {
  return <SidebarBody pathname={usePathname()} />;
}

export function SidebarNavFallback() {
  return <SidebarBody pathname={null} />;
}

/** Mobile: a menu button in the top bar that opens the same navigation. */
export function MobileNav() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open navigation menu"
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "md:hidden")}
      >
        <Menu aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          {MAIN_NAV.map((item) => (
            <DropdownMenuItem key={item.label} render={<Link href={item.href} />}>
              <item.icon aria-hidden className="text-muted-foreground" />
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
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
