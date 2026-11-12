import { Suspense } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import type { RequestStatus } from "@/lib/generated/prisma/enums";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

async function RequestsTable({
  searchParams,
}: {
  searchParams: PageProps<"/requests">["searchParams"];
}) {
  const view = parseView((await searchParams).view);
  const statuses = VIEWS[view].statuses;

  const [requests, counts] = await Promise.all([
    db.priorAuthRequest.findMany({
      where: statuses ? { status: { in: [...statuses] } } : undefined,
      include: { patient: true },
      orderBy: { createdAt: "desc" },
    }),
    db.priorAuthRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const countFor = (v: ViewKey) => {
    const s = VIEWS[v].statuses as readonly RequestStatus[] | null;
    return counts
      .filter((c) => !s || s.includes(c.status))
      .reduce((sum, c) => sum + c._count._all, 0);
  };

  return (
    <>
      <nav aria-label="Filter requests" className="mt-4 mb-4 flex flex-wrap gap-2">
        {(Object.keys(VIEWS) as ViewKey[]).map((key) => {
          const active = key === view;
          return (
            <Link
              key={key}
              href={key === "all" ? "/requests" : `/requests?view=${key}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                active
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 text-gray-700 hover:bg-gray-100"
              }`}
            >
              {VIEWS[key].label}
              <span className={`ml-1.5 ${active ? "text-gray-300" : "text-gray-400"}`}>
                {countFor(key)}
              </span>
            </Link>
          );
        })}
      </nav>

      <p className="mb-4 text-sm text-gray-500">
        {requests.length} requests · synthetic demo data
      </p>

      {requests.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
          No requests in this view.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Payer</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Diagnosis</TableHead>
              <TableHead>Procedure</TableHead>
              <TableHead>Service date</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <TableRow key={r.id} className="hover:bg-gray-50">
                <TableCell className="font-medium">
                  <Link
                    href={`/requests/${r.id}`}
                    className="text-blue-700 hover:underline"
                  >
                    {r.patient.firstName} {r.patient.lastName}
                  </Link>
                </TableCell>
                <TableCell>{r.patient.payerName}</TableCell>
                <TableCell>{r.providerName}</TableCell>
                <TableCell>{r.diagnosisCode}</TableCell>
                <TableCell>{r.procedureCode}</TableCell>
                <TableCell>{r.serviceDate.toLocaleDateString("en-US", { timeZone: "UTC" })}</TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

export default function RequestsPage({ searchParams }: PageProps<"/requests">) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Prior Authorization Requests</h1>
        <Link href="/requests/new" className={buttonVariants()}>
          New request
        </Link>
      </div>
      {/* searchParams and the DB read are request-time data, so both stay inside Suspense */}
      <Suspense fallback={<p className="text-sm text-gray-500">Loading requests…</p>}>
        <RequestsTable searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
