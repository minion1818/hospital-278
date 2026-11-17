import Link from "next/link";

// Payer side of the demo. Deliberately looks different from the hospital app
// (emerald header) so it's obvious which "company" you are looking at.
export default function PayerLayout({ children }: LayoutProps<"/payer">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-emerald-50/40">
      <header className="border-b border-emerald-900 bg-emerald-800 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-8 py-3">
          <Link href="/payer" className="font-semibold">
            Insurance company (simulated)
            <span className="ml-2 text-xs font-normal text-emerald-200">payer console · synthetic demo</span>
          </Link>
          <Link href="/requests" className="text-xs font-medium text-emerald-100 hover:text-white hover:underline">
            ← Hospital dashboard
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
