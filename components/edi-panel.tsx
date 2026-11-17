"use client";

import { ChevronRight, Download } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * One X12 document in a collapsible section (collapsed by default), with Copy
 * and an optional Download in the header. `text` is already segment-per-line.
 */
export function EdiPanel({
  title,
  description,
  text,
  downloadHref,
  emptyText,
}: {
  title: string;
  description?: string;
  text: string | null;
  downloadHref?: string;
  emptyText: string;
}) {
  if (!text) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-3">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  const segments = text.split("\n").length;
  return (
    <Collapsible className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <CollapsibleTrigger className="group flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{title}</span>
            <span className="block text-xs text-muted-foreground">
              {description ? `${description} · ` : ""}
              {segments} segments
            </span>
          </span>
        </CollapsibleTrigger>
        <div className="flex gap-2">
          <CopyButton text={text} ariaLabel={`Copy ${title}`} />
          {downloadHref && (
            // Plain <a>: a route handler download, not a page navigation
            <a
              href={downloadHref}
              download
              aria-label={`Download ${title} as .edi`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download aria-hidden />
              Download
            </a>
          )}
        </div>
      </div>
      <CollapsibleContent>
        <pre className="max-h-96 overflow-auto border-t bg-muted/50 px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
          {text}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
