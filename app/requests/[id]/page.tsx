import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-US", { dateStyle: "medium" });

const formatDateTime = (d: Date) =>
  d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const yesNo = (b: boolean) => (b ? "Yes" : "No");

/** SUBMITTED_FOR_REVIEW -> "Submitted for review" */
function humanizeAction(action: string) {
  const words = action.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** X12 is often stored on one line; put each segment (terminated by ~) on its own line. */
function formatEdi(raw: string) {
  if (raw.includes("\n")) return raw;
  return raw
    .split("~")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s}~`)
    .join("\n");
}

export default function RequestDetailPage({
  params,
}: PageProps<"/requests/[id]">) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Link
        href="/requests"
        className="mb-6 inline-block text-sm text-blue-700 hover:underline"
      >
        ← Back to requests
      </Link>
      <Suspense
        fallback={<p className="text-sm text-gray-500">Loading request…</p>}
      >
        <RequestDetail params={params} />
      </Suspense>
    </main>
  );
}

async function RequestDetail({
  params,
}: {
  params: PageProps<"/requests/[id]">["params"];
}) {
  const { id } = await params;
  const request = await db.priorAuthRequest.findUnique({
    where: { id },
    include: {
      patient: true,
      auditLogs: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!request) notFound();

  const { patient } = request;
  const showDecision = request.decisionAt != null || request.decisionReason != null;

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {patient.firstName} {patient.lastName}
          </h1>
          <StatusBadge status={request.status} />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {patient.payerName} · Member ID {patient.memberId}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <Field label="Provider">
                {request.providerName}{" "}
                <span className="text-gray-500">(NPI {request.providerNpi})</span>
              </Field>
              <Field label="Diagnosis code">{request.diagnosisCode}</Field>
              <Field label="Procedure code">{request.procedureCode}</Field>
              <Field label="Service date">{formatDate(request.serviceDate)}</Field>
              <Field label="Units requested">{request.unitsRequested}</Field>
              <Field label="Units approved">{request.unitsApproved ?? "—"}</Field>
              <Field label="Clinical notes attached">
                {yesNo(request.clinicalNotesAttached)}
              </Field>
              <Field label="Conservative treatment tried">
                {yesNo(request.conservativeTreatmentTried)}
              </Field>
            </dl>
          </CardContent>
        </Card>

        {showDecision && (
          <Card>
            <CardHeader>
              <CardTitle>Payer decision</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Field label="Reason">{request.decisionReason ?? "—"}</Field>
                <Field label="Decision date">
                  {request.decisionAt ? formatDateTime(request.decisionAt) : "—"}
                </Field>
                {request.status === "PARTIALLY_APPROVED" && (
                  <Field label="Units approved">
                    {request.unitsApproved ?? 0} of {request.unitsRequested}
                  </Field>
                )}
              </dl>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Status timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {request.auditLogs.length === 0 ? (
            <p className="text-sm text-gray-500">No events recorded.</p>
          ) : (
            <ol className="relative ml-2 border-l border-gray-200">
              {request.auditLogs.map((log, i) => {
                const latest = i === request.auditLogs.length - 1;
                return (
                  <li key={log.id} className="relative pb-5 pl-6 last:pb-0">
                    <span
                      aria-hidden
                      className={`absolute top-1 -left-[7px] size-3 rounded-full ring-4 ring-white ${
                        latest ? "bg-blue-600" : "bg-gray-300"
                      }`}
                    />
                    <p
                      className={
                        latest ? "font-semibold text-gray-900" : "font-medium text-gray-700"
                      }
                    >
                      {humanizeAction(log.action)}
                      {latest && (
                        <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                          Latest
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {log.actor} · {formatDateTime(log.createdAt)}
                    </p>
                    {log.details && (
                      <p className="mt-1 text-sm text-gray-600">{log.details}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>EDI 278</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <EdiSection title="Request" raw={request.raw278Request} />
          <EdiSection title="Response" raw={request.raw278Response} />
        </CardContent>
      </Card>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900">{children}</dd>
    </>
  );
}

function EdiSection({ title, raw }: { title: string; raw: string | null }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium text-gray-700">{title}</h3>
      {raw ? (
        <pre className="overflow-x-auto rounded-md bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-800 ring-1 ring-gray-200">
          {formatEdi(raw)}
        </pre>
      ) : (
        <p className="text-sm text-gray-500">Not generated yet</p>
      )}
    </section>
  );
}
