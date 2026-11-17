import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; href?: string };

/** Page title row: breadcrumbs, title (+ optional badge), subtitle and primary actions on the right. */
export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  badge,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  badge?: ReactNode;
  actions?: ReactNode;
  /** Extra content under the subtitle (e.g. a key facts row) */
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 space-y-2">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {breadcrumbs.map((c, i) => (
              <Fragment key={`${c.label}-${i}`}>
                {i > 0 && <ChevronRight aria-hidden className="size-3.5" />}
                <li>
                  {c.href ? (
                    <Link href={c.href} className="hover:text-foreground hover:underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-foreground">
                      {c.label}
                    </span>
                  )}
                </li>
              </Fragment>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** Small "label: value" facts shown under a detail page title. */
export function KeyFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 pt-2 text-sm">
      {items.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{f.label}</dt>
          <dd className="mt-0.5 font-medium text-foreground">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Standard page width and padding for every page. */
export function PageContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${className}`}>{children}</main>;
}
