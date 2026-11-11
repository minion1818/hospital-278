import { Suspense } from "react";
import { db } from "@/lib/db";
import type { RequestStatus } from "@/lib/generated/prisma/enums";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Record<RequestStatus, ...> makes tsc fail if a status is added to the enum without a style
const STATUS_STYLES: Record<RequestStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_REVIEW: "bg-yellow-100 text-yellow-800",
  SUBMITTED: "bg-blue-100 text-blue-800",
  IN_REVIEW: "bg-indigo-100 text-indigo-800",
  APPROVED: "bg-green-100 text-green-800",
  PARTIALLY_APPROVED: "bg-lime-100 text-lime-800",
  DENIED: "bg-red-100 text-red-800",
  PENDED: "bg-orange-100 text-orange-800",
  REJECTED: "bg-rose-200 text-rose-900",
  SERVICE_COMPLETED: "bg-teal-100 text-teal-800",
};

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

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
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                {r.patient.firstName} {r.patient.lastName}
              </TableCell>
              <TableCell>{r.patient.payerName}</TableCell>
              <TableCell>{r.providerName}</TableCell>
              <TableCell>{r.diagnosisCode}</TableCell>
              <TableCell>{r.procedureCode}</TableCell>
              <TableCell>{r.serviceDate.toLocaleDateString("en-US")}</TableCell>
              <TableCell>
                <span
                  className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                    STATUS_STYLES[r.status]
                  }`}
                >
                  {formatStatus(r.status)}
                </span>
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
      <h1 className="mb-1 text-2xl font-semibold">Prior Authorization Requests</h1>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading requests…</p>}>
        <RequestsTable />
      </Suspense>
    </main>
  );
}