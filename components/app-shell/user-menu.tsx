"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Info, Loader2, LogOut } from "lucide-react";
import { signOut } from "@/app/actions/session";
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
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type MenuRole = { title: string; initials: string };

/**
 * Top-right menu for the signed-in role: its title, About and Sign out.
 * `role` is undefined while the session loads (Suspense fallback).
 */
export function UserMenu({ role }: { role?: MenuRole }) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [signingOut, startSignOut] = useTransition();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!role || signingOut}
          aria-label={role ? `Account menu, signed in as ${role.title}` : "Account menu"}
          className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {signingOut ? <Loader2 aria-hidden className="size-4 animate-spin" /> : (role?.initials ?? "")}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block truncate text-sm font-medium">{role?.title ?? "Loading…"}</span>
            <span className="block truncate text-xs text-muted-foreground">{role ? "Signed in" : " "}</span>
          </span>
          <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="block text-xs font-normal text-muted-foreground">Signed in as</span>
              <span className="block text-sm font-medium text-foreground">{role?.title}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAboutOpen(true)}>
            <Info aria-hidden className="text-muted-foreground" />
            About AuthDesk
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => startSignOut(() => signOut())}>
            <LogOut aria-hidden className="text-muted-foreground" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>About AuthDesk</DialogTitle>
            <DialogDescription>
              Prior authorization workspace for authorization specialists and utilization reviewers, built on X12 278
              (005010X217).
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
            Demonstration environment. All patient, provider and payer data is synthetic. The insurance company is
            simulated. Choosing a role on the sign-in page stands in for real authentication.
          </p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
