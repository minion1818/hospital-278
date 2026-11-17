import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { Pill, type Tone } from "@/components/pill";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActingRole } from "@/lib/demo-session";
import type { RequestStatus } from "@/lib/generated/prisma/enums";
import { availableTransitions, waitingMessage } from "@/lib/workflow";
import { ActionsPanel, type TransitionOption } from "./actions-panel";
import { PayerTicker } from "@/components/payer-ticker";
import { getPayerMode } from "@/lib/integration/tick";
import { formatEdi } from "@/lib/x12/format";
import { findDiagnosis, findProcedure } from "@/lib/catalog";
import { formatDate, timeZoneLabel } from "@/lib/format";
import { DateTime } from "@/components/date-time";
import { EdiPanel } from "@/components/edi-panel";
import { KeyFacts, PageContainer, PageHeader } from "@/components/page-header";
import { DetailSkeleton } from "@/components/skeletons";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Request details" };

const DECIDED_STATUSES = new Set<RequestStatus>([
  "APPROVED",
  "PARTIALLY_APPROVED",
  "DENIED",
  "PENDED",
  "REJECTED",
  "SERVICE_COMPLETED",
]);

const yesNo = (b: boolean) => (b ? "Yes" : "No");

// Timeline wording for audit actions (display only; stored values are unchanged)
const ACTION_LABELS: Record<string, { label: string; tone: Tone }> = {
  CREATED: { label: "Draft created", tone: "neutral" },
  SUBMITTED_FOR_REVIEW: { label: "Submitted for review", tone: "amber" },
  SENT_BACK_TO_STAFF: { label: "Sent back to staff", tone: "orange" },
  APPROVED_FOR_SUBMISSION: { label: "Approved for submission", tone: "blue" },
  SUBMITTED_TO_PAYER: { label: "Sent to payer", tone: "blue" },
  TRANSMISSION_FAILED: { label: "Transmission to payer failed", tone: "red" },
  PAYER_IN_REVIEW: { label: "Payer review started", tone: "indigo" },
  PAYER_APPROVED: { label: "Approved by payer", tone: "green" },
  PAYER_PARTIALLY_APPROVED: { label: "Partially approved by payer", tone: "teal" },
  PAYER_DENIED: { label: "Denied by payer", tone: "red" },
  PAYER_PENDED: { label: "Pended by payer (more information needed)", tone: "orange" },
  PAYER_REJECTED: { label: "Rejected by payer (needs correction)", tone: "rose" },
  PAYER_RESPONSE_INVALID: { label: "Payer response could not be read", tone: "red" },
  REOPENED_AS_DRAFT: { label: "Reopened as draft", tone: "neutral" },
  SERVICE_COMPLETED: { label: "Service completed", tone: "slate" },
};

function actionLabel(action: string) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const words = action.toLowerCase().replaceAll("_", " ");
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: "neutral" as Tone };
}

/** Stored actor/details text, tidied for display (no internal message ids). */
const displayActor = (actor: string) => actor.replace(/\s*\(simulated\)$/i, "");
const displayDetails = (details: string) => details.replace(/,?\s*payer message [a-z0-9]+/gi, "");

export default function RequestDetailPage({ params }: PageProps<"/requests/[id]">) {
  return (
    <PageContainer>
      <Suspense fallback={<DetailSkeleton label="Loading request" />}>
        <RequestDetail params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function RequestDetail({ params }: { params: PageProps<"/requests/[id]">["params"] }) {
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
  const patientName = `${patient.firstName} ${patient.lastName}`;
  const procedure = findProcedure(request.procedureCode);
  const diagnosis = findDiagnosis(request.diagnosisCode);
  const showDecision = request.decisionAt != null || request.decisionReason != null;
  // A reopened request keeps the payer's earlier decision so staff can see what to fix
  const decisionIsCurrent = DECIDED_STATUSES.has(request.status);

  // Stand-in for real auth: the role comes from a cookie (read inside Suspense)
  const role = await getActingRole();

  // Hint only: read through lib/integration, never from payer internals
  const waitingOnPayer = request.status === "SUBMITTED" || request.status === "IN_REVIEW";
  const payerManual = waitingOnPayer && (await getPayerMode()) === "MANUAL";
  const transitions: TransitionOption[] = availableTransitions(request.status, role).map((t) => ({
    key: t.key,
    label: t.label,
    description: t.description,
    noteRequired: t.noteRequired,
    notePrompt: t.notePrompt,
  }));

  return (
    <>
      <PayerTicker key={request.status} active={waitingOnPayer} label="Waiting for the payer…" />

      <PageHeader
        breadcrumbs={[{ label: "Requests", href: "/requests" }, { label: patientName }]}
        title={patientName}
        badge={<StatusBadge status={request.status} />}
      >
        <KeyFacts
          items={[
            { label: "Payer", value: patient.payerName },
            { label: "Member ID", value: <span className="font-mono">{patient.memberId}</span> },
            {
              label: "Procedure",
              value: (
                <>
                  {procedure?.label ?? "Procedure"}{" "}
                  <span className="font-mono text-muted-foreground">({request.procedureCode})</span>
                </>
              ),
            },
            { label: "Service date", value: formatDate(request.serviceDate) },
          ]}
        />
      </PageHeader>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {showDecision && (
            <DecisionCard
              current={decisionIsCurrent}
              status={request.status}
              reason={request.decisionReason}
              decisionAt={request.decisionAt}
              unitsApproved={request.unitsApproved}
              unitsRequested={request.unitsRequested}
              authorizationNumber={request.authorizationNumber}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Request details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <Field label="Patient">
                  {patientName}
                  <Sub>Born {formatDate(patient.dob)}</Sub>
                </Field>
                <Field label="Requesting provider">
                  {request.providerName}
                  <Sub>NPI {request.providerNpi}</Sub>
                </Field>
                <Field label="Diagnosis (ICD-10)">
                  {diagnosis?.label ?? "Diagnosis"}
                  <Sub mono>{request.diagnosisCode}</Sub>
                </Field>
                <Field label="Procedure (CPT)">
                  {procedure?.label ?? "Procedure"}
                  <Sub mono>{request.procedureCode}</Sub>
                </Field>
                <Field label="Service date">{formatDate(request.serviceDate)}</Field>
                <Field label="Units">
                  {request.unitsRequested} requested
                  {request.unitsApproved != null && <Sub>{request.unitsApproved} approved</Sub>}
                </Field>
                <Field label="Clinical notes attached">{yesNo(request.clinicalNotesAttached)}</Field>
                <Field label="Conservative treatment tried">{yesNo(request.conservativeTreatmentTried)}</Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>EDI 278</CardTitle>
              <CardDescription>X12 005010X217 transactions exchanged with the payer.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <EdiPanel
                title="278 request"
                description="Sent to payer"
                text={request.raw278Request ? formatEdi(request.raw278Request) : null}
                downloadHref={`/requests/${request.id}/278`}
                emptyText="No 278 request has been sent yet. It is generated when a reviewer approves and sends the request."
              />
              <EdiPanel
                title="278 response"
                description="Received from payer"
                text={request.raw278Response ? formatEdi(request.raw278Response) : null}
                downloadHref={`/requests/${request.id}/278/response`}
                emptyText="No response from the payer yet."
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              {transitions.length > 0 ? (
                // Keyed by status: a successful transition remounts the panel fresh
                <ActionsPanel key={request.status} requestId={request.id} transitions={transitions} />
              ) : (
                <div className="space-y-1">
                  <p className="text-sm text-foreground">{waitingMessage(request.status, role)}</p>
                  {payerManual && (
                    <p className="text-xs text-muted-foreground">
                      The payer is reviewing this request manually, so a decision may take longer.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status timeline</CardTitle>
              <CardDescription>Times in {timeZoneLabel(request.createdAt)}</CardDescription>
            </CardHeader>
            <CardContent>
              {request.auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              ) : (
                <ol className="space-y-0">
                  {[...request.auditLogs].reverse().map((log, i) => {
                    const latest = i === 0;
                    const { label, tone } = actionLabel(log.action);
                    return (
                      <li key={log.id} className="group relative flex gap-3 pb-4 last:pb-0">
                        {/* connector line */}
                        <span aria-hidden className="absolute top-4 bottom-0 left-[5px] w-px bg-border group-last:hidden" />
                        <span
                          aria-hidden
                          className={cn(
                            "relative mt-1.5 size-[11px] shrink-0 rounded-full ring-2 ring-card",
                            latest ? "bg-primary" : "bg-muted-foreground/40",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          {latest ? (
                            <Pill tone={tone} className="mb-0.5">
                              {label}
                            </Pill>
                          ) : (
                            <p className="text-sm font-medium text-foreground">{label}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {displayActor(log.actor)} · <DateTime value={log.createdAt} />
                          </p>
                          {log.details && (
                            <p className="mt-0.5 text-xs break-words text-muted-foreground">
                              {displayDetails(log.details)}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function DecisionCard({
  current,
  status,
  reason,
  decisionAt,
  unitsApproved,
  unitsRequested,
  authorizationNumber,
}: {
  current: boolean;
  status: RequestStatus;
  reason: string | null;
  decisionAt: Date | null;
  unitsApproved: number | null;
  unitsRequested: number;
  authorizationNumber: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{current ? "Payer decision" : "Previous payer decision"}</CardTitle>
        {!current && (
          <CardDescription>Kept for reference while the request is corrected and resubmitted.</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {authorizationNumber && (
          <div className="rounded-lg bg-green-50 px-4 py-3 ring-1 ring-green-600/20">
            <p className="text-xs font-medium tracking-wide text-green-800 uppercase">Authorization number</p>
            <p className="mt-0.5 font-mono text-xl font-semibold tracking-wide text-green-950">{authorizationNumber}</p>
          </div>
        )}
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {current && (
            <Field label="Decision">
              <StatusBadge status={status} />
            </Field>
          )}
          <Field label="Decision date">{decisionAt ? <DateTime value={decisionAt} /> : "Not recorded"}</Field>
          {unitsApproved != null && (
            <Field label="Units approved">
              {unitsApproved} of {unitsRequested}
            </Field>
          )}
          <Field label="Reason" className="sm:col-span-2">
            {reason ?? <span className="text-muted-foreground">No reason given</span>}
          </Field>
        </dl>
      </CardContent>
    </Card>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Sub({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <span className={cn("block text-xs text-muted-foreground", mono && "font-mono")}>{children}</span>;
}
