import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { PayerTicker } from "@/components/payer-ticker";
import { KeyFacts, PageContainer, PageHeader } from "@/components/page-header";
import { DateTime } from "@/components/date-time";
import { EdiPanel } from "@/components/edi-panel";
import { DetailSkeleton } from "@/components/skeletons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIsoDate, timeZoneLabel } from "@/lib/format";
import { describeDecision, getMessage, suggestDecision } from "@/lib/payer/console";
import { REJECT_CODES } from "@/lib/payer/manual";
import { formatEdi } from "@/lib/x12/format";
import { REJECT_REASON_CODES } from "@/lib/x12/reject-reasons";
import { DecidedByBadge, MessageStatusBadge, OutcomeBadge } from "../_components/badges";
import { DecidePanel } from "../_components/decide-panel";

export const metadata: Metadata = { title: "Request review" };

const yesNo = (b: boolean | undefined) => (b === undefined ? "Unknown" : b ? "Yes" : "No");

export default function PayerMessagePage({ params }: PageProps<"/payer/[messageId]">) {
  return (
    <PageContainer>
      <Suspense fallback={<DetailSkeleton label="Loading request" />}>
        <MessageDetail params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function MessageDetail({ params }: { params: PageProps<"/payer/[messageId]">["params"] }) {
  const { messageId } = await params;
  const m = await getMessage(messageId);
  if (!m) notFound();

  const s = m.summary;
  const responded = m.status === "RESPONDED";
  // Request-time "now" (after the DB read, inside Suspense)
  const suggestion = await suggestDecision({ requestEdi: m.requestEdi, attachments: m.attachments }, new Date());
  const title = s?.patientName ?? "Unreadable request";

  return (
    <>
      <PayerTicker
        key={`${m.status}:${m.deliveredAt ? "delivered" : "pending"}`}
        active={!responded || !m.deliveredAt}
        watch="payer"
        label={responded ? "Delivering response…" : "Watching for changes…"}
      />

      <PageHeader
        breadcrumbs={[{ label: "Inbox", href: "/payer" }, { label: title }]}
        title={title}
        badge={
          <>
            <MessageStatusBadge status={m.status} />
            {m.outcome && <OutcomeBadge outcome={m.outcome} />}
            <DecidedByBadge decidedBy={m.decidedBy} />
          </>
        }
      >
        <KeyFacts
          items={[
            { label: "Member ID", value: <span className="font-mono">{s?.memberId ?? "—"}</span> },
            {
              label: "Procedure",
              value: (
                <>
                  {s?.procedureLabel ?? "Procedure"}{" "}
                  {s?.procedureCode && <span className="font-mono text-muted-foreground">({s.procedureCode})</span>}
                </>
              ),
            },
            { label: "Units", value: s?.units ?? "—" },
            { label: "Received", value: <DateTime value={m.receivedAt} /> },
          ]}
        />
      </PageHeader>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {responded ? (
            <Card>
              <CardHeader>
                <CardTitle>Decision sent</CardTitle>
                <CardDescription>
                  {m.deliveredAt ? "Delivered to the hospital." : "Waiting to be delivered to the hospital."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {m.authorizationNumber && (
                  <div className="rounded-lg bg-green-50 px-4 py-3 ring-1 ring-green-600/20">
                    <p className="text-xs font-medium tracking-wide text-green-800 uppercase">Authorization number</p>
                    <p className="mt-0.5 font-mono text-xl font-semibold tracking-wide text-green-950">
                      {m.authorizationNumber}
                    </p>
                    <p className="mt-1 text-xs text-green-800">Issued by this payer and sent to the hospital in the 278 response</p>
                  </div>
                )}
                <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  <Field label="Outcome">
                    <OutcomeBadge outcome={m.outcome} />
                  </Field>
                  <Field label="Decided by">
                    {m.decidedBy === "MANUAL" ? "Reviewer" : m.decidedBy === "AUTO" ? "Automatic rules" : "—"}
                  </Field>
                  <Field label="Reason" className="sm:col-span-2">
                    {m.response?.rejections.length
                      ? [
                          m.response.rejections.map((r) => `AAA ${r.code}: ${r.text}`).join("; "),
                          m.response.reason,
                        ]
                          .filter(Boolean)
                          .join(" - ")
                      : (m.response?.reason ?? <span className="text-muted-foreground">No reason given</span>)}
                  </Field>
                </dl>
              </CardContent>
            </Card>
          ) : (
            <Card className="ring-2 ring-primary/30">
              <CardHeader>
                <CardTitle>Decide</CardTitle>
                <CardDescription>
                  Your decision replaces the automatic one if it hasn&apos;t been made yet. The hospital receives it on
                  the next update.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DecidePanel
                  messageId={m.id}
                  requestedUnits={s?.units}
                  rejectCodes={REJECT_CODES.map((code) => ({ code, text: REJECT_REASON_CODES[code] }))}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Request summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <Field label="Patient">
                  {s?.patientName ?? "—"}
                  <Sub>Born {formatIsoDate(s?.dob) ?? "—"}</Sub>
                </Field>
                <Field label="Member ID">
                  <span className="font-mono">{s?.memberId ?? "—"}</span>
                </Field>
                <Field label="Payer">
                  {s?.payerName ?? "—"}
                  {s?.payerId && <Sub>Payer ID {s.payerId}</Sub>}
                </Field>
                <Field label="Requesting provider">
                  {s?.providerName ?? "—"}
                  <Sub>NPI {s?.providerNpi ?? "—"}</Sub>
                </Field>
                <Field label="Diagnosis (ICD-10)">
                  <span className="font-mono">{s?.diagnosisCode ?? "—"}</span>
                </Field>
                <Field label="Procedure (CPT)">
                  {s?.procedureLabel ?? "—"}
                  {s?.procedureCode && <Sub mono>{s.procedureCode}</Sub>}
                </Field>
                <Field label="Units requested">{s?.units ?? "—"}</Field>
                <Field label="Service date">{formatIsoDate(s?.serviceDate) ?? "—"}</Field>
                <Field label="Trace number (BHT03)" className="sm:col-span-2">
                  <span className="font-mono text-xs">{s?.reference ?? "—"}</span>
                </Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>EDI 278</CardTitle>
              <CardDescription>X12 005010X217 transactions for this request.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <EdiPanel
                title="278 request"
                description="Received from the hospital"
                text={formatEdi(m.requestEdi)}
                emptyText="No request content."
              />
              <EdiPanel
                title="278 response"
                description="Sent to the hospital"
                text={m.responseEdi ? formatEdi(m.responseEdi) : null}
                emptyText="No response has been sent yet."
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb aria-hidden className="size-4 text-primary" />
                Rules check
              </CardTitle>
              <CardDescription>What the automatic rules {responded ? "would have decided" : "suggest"}.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">
                {describeDecision(suggestion)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">A hint only. These simulated rules are not real payer policy.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attachments received</CardTitle>
              <CardDescription>Sent alongside the 278 (in place of an X12 275).</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Field label="Clinical notes">{yesNo(m.attachments?.clinicalNotesAttached)}</Field>
                <Field label="Conservative treatment documented">
                  {yesNo(m.attachments?.conservativeTreatmentDocumented)}
                </Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timing</CardTitle>
              <CardDescription>Times in {timeZoneLabel(m.receivedAt)}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <TimeField label="Received" value={m.receivedAt} />
                <TimeField label="Acknowledge at" value={m.acknowledgeAt} />
                <TimeField label="Automatic decision at" value={m.respondAt} />
                <TimeField label="Responded" value={m.respondedAt} />
                <TimeField label="Delivered to hospital" value={m.deliveredAt} />
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
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

function TimeField({ label, value }: { label: string; value: Date | null }) {
  return (
    <Field label={label}>
      {value ? <DateTime value={value} /> : <span className="text-muted-foreground">Not yet</span>}
    </Field>
  );
}

function Sub({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <span className={`block text-xs text-muted-foreground ${mono ? "font-mono" : ""}`}>{children}</span>;
}
