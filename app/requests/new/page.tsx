import { Suspense } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { todayIsoDate } from "@/lib/validation/request";
import { NewRequestForm, type PatientOption } from "./new-request-form";

export default function NewRequestPage() {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Link
        href="/requests"
        className="mb-6 inline-block text-sm text-blue-700 hover:underline"
      >
        ← Back to requests
      </Link>
      <h1 className="mb-1 text-2xl font-semibold">New prior authorization request</h1>
      <p className="mb-6 text-sm text-gray-500">
        Saved as a draft. Nothing is sent to the payer yet.
      </p>
      <div className="max-w-3xl">
        <Suspense fallback={<p className="text-sm text-gray-500">Loading form…</p>}>
          <NewRequestFormLoader />
        </Suspense>
      </div>
    </main>
  );
}

async function NewRequestFormLoader() {
  const patients = await db.patient.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const options: PatientOption[] = patients.map((p) => ({
    value: p.id,
    label: `${p.lastName}, ${p.firstName} (${p.memberId}, ${p.payerName})`,
  }));

  // Computed at request time (after the DB read), never in the prerendered shell
  return <NewRequestForm patients={options} minServiceDate={todayIsoDate()} />;
}
