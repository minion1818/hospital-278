import { Suspense } from "react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Plus, Search, SearchX } from "lucide-react";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { RequestStatus } from "@/lib/generated/prisma/enums";
import { findProcedure } from "@/lib/catalog";
import { formatDate, pluralize } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { PayerTicker } from "@/components/payer-ticker";
import { PageContainer, PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ClickableRow, DataTable } from "@/components/data-table";
import { TableSkeleton, ToolbarSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableBody, TableCell, TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { canCreateRequests } from "@/lib/auth/roles";
import { getSessionRole, requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Requests" };

// ?view=... filters. `statuses: null` means no filter.
const VIEWS = {
  all: { label: "All", statuses: null },
  review: { label: "Review queue", statuses: ["PENDING_REVIEW"] },
  attention: { label: "Needs attention", statuses: ["PENDED", "REJECTED", "DENIED"] },
} as const satisfies Record<string, { label: string; statuses: readonly RequestStatus[] | null }>;

type ViewKey = keyof typeof VIEWS;

function parseView(value: string | string[] | undefined): ViewKey {
  return typeof value === "string" && value in VIEWS ? (value as ViewKey) : "all";
}

function parseQuery(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

/** Every word must match the patient's first name, last name or member ID. */
function searchWhere(q: string): Prisma.PriorAuthRequestWhereInput | undefined {
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);
  if (terms.length === 0) return undefined;
  return {
    AND: terms.map((t) => ({
      patient: {
        OR: [
          { firstName: { contains: t, mode: "insensitive" as const } },
          { lastName: { contains: t, mode: "insensitive" as const } },
          { memberId: { contains: t, mode: "insensitive" as const } },
        ],
      },
    })),
  };
}

const viewHref = (view: ViewKey, q: string) => {
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (q) params.set("q", q);
  const s = params.toString();
  return s ? `/requests?${s}` : "/requests";
};

export default function RequestsPage({ searchParams }: PageProps<"/requests">) {
  return (
    <PageContainer>
      <PageHeader
        title="Prior authorization requests"
        badge={
          <Suspense fallback={<Skeleton className="h-5 w-10 rounded-full" />}>
            <TotalCount />
          </Suspense>
        }
        subtitle="Track every request from draft to payer decision."
        actions={
          // Only the Authorization Specialist creates requests (role cookie: request-time data)
          <Suspense fallback={null}>
            <NewRequestButton />
          </Suspense>
        }
      />
      {/* searchParams and the DB read are request-time data, so both stay inside Suspense */}
      <Suspense
        fallback={
          <>
            <ToolbarSkeleton />
            <TableSkeleton label="Loading requests" />
          </>
        }
      >
        <RequestsQueue searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function NewRequestButton() {
  const role = await getSessionRole();
  if (!role || !canCreateRequests(role)) return null;
  return (
    <Link href="/requests/new" className={buttonVariants()}>
      <Plus aria-hidden />
      New request
    </Link>
  );
}

async function TotalCount() {
  const total = await db.priorAuthRequest.count();
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
      {total}
    </span>
  );
}

async function RequestsQueue({ searchParams }: { searchParams: PageProps<"/requests">["searchParams"] }) {
  // Re-validates the sign-in before reading request data (signed out redirects to /login)
  const role = await requireRole();
  const sp = await searchParams;
  const view = parseView(sp.view);
  const q = parseQuery(sp.q);
  const statuses = VIEWS[view].statuses;
  const search = searchWhere(q);

  const [requests, counts] = await Promise.all([
    db.priorAuthRequest.findMany({
      where: { AND: [statuses ? { status: { in: [...statuses] } } : {}, search ?? {}] },
      include: { patient: true },
      orderBy: { createdAt: "desc" },
    }),
    db.priorAuthRequest.groupBy({ by: ["status"], where: search, _count: { _all: true } }),
  ]);

  const waiting = requests.filter((r) => r.status === "SUBMITTED" || r.status === "IN_REVIEW");

  const countFor = (v: ViewKey) => {
    const s = VIEWS[v].statuses as readonly RequestStatus[] | null;
    return counts.filter((c) => !s || s.includes(c.status)).reduce((sum, c) => sum + c._count._all, 0);
  };

  return (
    <>
      {/* Polls for payer updates while any request shown is waiting on the payer */}
      <PayerTicker key={waiting.map((r) => `${r.id}:${r.status}`).join(",")} active={waiting.length > 0} />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Filter requests" className="flex w-fit rounded-lg bg-muted p-0.5">
          {(Object.keys(VIEWS) as ViewKey[]).map((key) => {
            const active = key === view;
            return (
              <Link
                key={key}
                href={viewHref(key, q)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  active ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/10" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {VIEWS[key].label}
                <span className={cn("text-xs tabular-nums", active ? "text-primary" : "text-muted-foreground")}>
                  {countFor(key)}
                </span>
              </Link>
            );
          })}
        </nav>

        <Form action="/requests" replace className="flex w-full items-center gap-2 lg:w-auto" role="search">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <div className="relative w-full lg:w-80">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              key={q}
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search patient name or member ID"
              aria-label="Search by patient name or member ID"
              className="bg-card pl-8"
            />
          </div>
        </Form>
      </div>

      {requests.length === 0 ? (
        q ? (
          <EmptyState
            icon={SearchX}
            title={`No requests match "${q}"`}
            description="Check the spelling, or search by member ID instead."
            action={
              <Link href={viewHref(view, "")} className={buttonVariants({ variant: "outline" })}>
                Clear search
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={view === "all" ? "No requests yet" : `Nothing in ${VIEWS[view].label.toLowerCase()}`}
            description={
              view === "all"
                ? "Create a request to start a prior authorization."
                : "You're all caught up. Requests will appear here when they need you."
            }
            action={
              view === "all" &&
              canCreateRequests(role) && (
                <Link href="/requests/new" className={buttonVariants()}>
                  <Plus aria-hidden />
                  New request
                </Link>
              )
            }
          />
        )
      ) : (
        <>
          <DataTable
            label="Prior authorization requests"
            head={
              <>
                <TableHead>Patient</TableHead>
                <TableHead>Procedure</TableHead>
                <TableHead className="hidden md:table-cell">Payer</TableHead>
                <TableHead className="hidden xl:table-cell">Provider</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead>Service date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
              </>
            }
          >
            <TableBody>
              {requests.map((r) => {
                const href = `/requests/${r.id}`;
                return (
                  <ClickableRow key={r.id} href={href}>
                    <TableCell>
                      <Link href={href} className="font-medium text-foreground hover:text-primary hover:underline">
                        {r.patient.firstName} {r.patient.lastName}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{r.patient.memberId}</div>
                    </TableCell>
                    <TableCell>
                      <div>{findProcedure(r.procedureCode)?.label ?? "Procedure"}</div>
                      <div className="font-mono text-xs text-muted-foreground">CPT {r.procedureCode}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{r.patient.payerName}</TableCell>
                    <TableCell className="hidden xl:table-cell">{r.providerName}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.unitsRequested}</TableCell>
                    <TableCell className="tabular-nums">{formatDate(r.serviceDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} short />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">
                      {r.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </TableCell>
                  </ClickableRow>
                );
              })}
            </TableBody>
          </DataTable>
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {pluralize(requests.length, "request")}
            {q && <> matching &ldquo;{q}&rdquo;</>}
          </p>
        </>
      )}
    </>
  );
}
