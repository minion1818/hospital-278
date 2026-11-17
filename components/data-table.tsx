"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Table, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Card-framed table with a sticky header inside its own scroll area, used for
 * the work queues on both sides of the app.
 */
export function DataTable({ head, children, label }: { head: ReactNode; children: ReactNode; label: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <Table aria-label={label} containerClassName="max-h-[calc(100dvh-17rem)] min-h-40 overflow-auto">
        <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur [&_th]:h-9 [&_th]:text-xs [&_th]:font-medium [&_th]:tracking-wide [&_th]:text-muted-foreground [&_th]:uppercase [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
          <TableRow className="hover:bg-transparent">{head}</TableRow>
        </TableHeader>
        {children}
      </Table>
    </div>
  );
}

/**
 * A row that opens `href` when clicked anywhere. Keyboard and screen reader
 * users get the real link inside the row (the patient name), so the row itself
 * is not a second tab stop.
 */
export function ClickableRow({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <TableRow
      onClick={(e) => {
        // Let real links, buttons and text selection behave normally
        if ((e.target as HTMLElement).closest("a,button") || window.getSelection()?.toString()) return;
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
      className={cn(
        "cursor-pointer hover:bg-accent/60 [&_td]:py-2.5 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4",
        className,
      )}
    >
      {children}
    </TableRow>
  );
}
