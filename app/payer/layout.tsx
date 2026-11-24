import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Landmark } from "lucide-react";

export const metadata: Metadata = {
  title: { template: "%s | Payer simulator", default: "Payer simulator" },
};

// Payer side. Deliberately separate from the hospital app: its own top bar and
// a teal accent (.theme-payer), so it's obvious which organization you're in.
export default function PayerLayout({ children }: LayoutProps<"/payer">) {
  return (
    <div className="theme-payer flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/payer" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Landmark aria-hidden className="size-4" />
            </span>
            Payer simulator
            <span className="hidden rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground sm:inline">
              Insurance company
            </span>
          </Link>
          <Link
            href="/requests"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back to hospital app
          </Link>
        </div>
      </header>
      <div className="h-0.5 bg-primary" aria-hidden />
      {children}
    </div>
  );
}
