"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setActingRole } from "@/app/actions/role";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";

type Role = "STAFF" | "REVIEWER";
export type MenuUser = { role: Role; name: string; title: string };

/**
 * Top-right user menu. Switching user calls the existing setActingRole Server
 * Action (it sets the role cookie and the page re-renders as that user).
 * `current` is undefined while the session is loading (Suspense fallback).
 */
export function UserMenu({ current, users }: { current?: Role; users: MenuUser[] }) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const me = users.find((u) => u.role === current);

  const switchTo = (user: MenuUser) => {
    if (user.role === current) return;
    const fd = new FormData();
    fd.set("role", user.role);
    startTransition(async () => {
      await setActingRole(fd);
      toast.success(`Signed in as ${user.name}`, { description: user.title });
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!me}
          aria-label={me ? `User menu for ${me.name}` : "User menu"}
          className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : me ? initials(me.name) : ""}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block truncate text-sm font-medium">{me?.name ?? "Loading…"}</span>
            <span className="block truncate text-xs text-muted-foreground">{me?.title ?? " "}</span>
          </span>
          <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Switch user</DropdownMenuLabel>
            {users.map((u) => (
              <DropdownMenuCheckboxItem
                key={u.role}
                checked={u.role === current}
                disabled={pending}
                closeOnClick
                onCheckedChange={() => switchTo(u)}
              >
                <Avatar className="size-6">
                  <AvatarFallback className="text-[10px] font-semibold">{initials(u.name)}</AvatarFallback>
                </Avatar>
                <span className="leading-tight">
                  <span className="block text-sm">{u.name}</span>
                  <span className="block text-xs text-muted-foreground">{u.title}</span>
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAboutOpen(true)}>
            <Info aria-hidden className="text-muted-foreground" />
            About AuthDesk
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>About AuthDesk</DialogTitle>
            <DialogDescription>
              Prior authorization workspace for authorization staff and utilization reviewers, built on X12 278
              (005010X217).
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
            Demonstration environment. All patient, provider and payer data is synthetic. The insurance company is
            simulated.
          </p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
