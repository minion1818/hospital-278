import { Suspense } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
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

async function RequestsTable() {
  const requests = await db.priorAuthRequest.findMany({
    include: { patient: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <p className="mb-6 text-sm text-gray-500">
        {requests.length} requests · synthetic demo data
      </p>

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
              <TableCell>{r.serviceDate.toLocaleDateString("en-US")}</TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

export default function RequestsPage() {
  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Prior Authorization Requests</h1>
        <Link href="/requests/new" className={buttonVariants()}>
          New request
        </Link>
      </div>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading requests…</p>}>
        <RequestsTable />
      </Suspense>
    </main>
  );
}