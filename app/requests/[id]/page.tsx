import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActingRole } from "@/lib/demo-session";
import type { RequestStatus } from "@/lib/generated/prisma/enums";
import { ROLE_LABELS, availableTransitions, waitingMessage } from "@/lib/workflow";
import { ActionsPanel, type TransitionOption } from "./actions-panel";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { readDelimiters } from "@/lib/x12/parse278";

// Date-only values are stored at UTC midnight, so format them in UTC
const formatDate = (d: Date) =>
  d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

const formatDateTime = (d: Date) =>
  d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const DECIDED_STATUSES = new Set<RequestStatus>([
  "APPROVED",
  "PARTIALLY_APPROVED",
  "DENIED",
  "PENDED",
  "REJECTED",
  "SERVICE_COMPLETED",
]);

const yesNo = (b: boolean) => (b ? "Yes" : "No");

/** SUBMITTED_FOR_REVIEW -> "Submitted for review" */
function humanizeAction(action: string) {
  const words = action.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** X12 is often stored on one line; put each segment on its own line. */
function formatEdi(raw: string) {
  if (raw.includes("\n")) return raw;
  let terminator = "~";
  try {
    terminator = readDelimiters(raw).segment; // the ISA declares the real terminator
  } catch {
    // Not a well-formed interchange; fall back to the common "~"
  }
  return raw
    .split(terminator)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s}${terminator}`)
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
  // A reopened request keeps the payer's earlier decision so staff can see what to fix
  const decisionIsCurrent = DECIDED_STATUSES.has(request.status);

  // Demo stand-in for real auth: the role comes from a cookie (read inside Suspense)
  const role = await getActingRole();
  const transitions: TransitionOption[] = availableTransitions(request.status, role).map(
    (t) => ({
      key: t.key,
      label: t.label,
      description: t.description,
      noteRequired: t.noteRequired,
      notePrompt: t.notePrompt,
    }),
  );

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

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-gray-500">
            Acting as {ROLE_LABELS[role]} (switch in the header).
          </p>
          {transitions.length > 0 ? (
            // Keyed by status: a successful transition remounts the panel fresh
            <ActionsPanel key={request.status} requestId={request.id} transitions={transitions} />
          ) : (
            <p className="text-sm text-gray-700">{waitingMessage(request.status, role)}</p>
          )}
        </CardContent>
      </Card>

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
              <CardTitle>{decisionIsCurrent ? "Payer decision" : "Previous payer decision"}</CardTitle>
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
          <EdiSection
            title="Request"
            raw={request.raw278Request}
            actions={
              request.raw278Request && (
                <>
                  <CopyButton text={formatEdi(request.raw278Request)} />
                  {/* Plain <a>: a route handler download, not a page navigation */}
                  <a
                    href={`/requests/${request.id}/278`}
                    download
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Download .edi
                  </a>
                </>
              )
            }
          />
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

function EdiSection({
  title,
  raw,
  actions,
}: {
  title: string;
  raw: string | null;
  actions?: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
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
