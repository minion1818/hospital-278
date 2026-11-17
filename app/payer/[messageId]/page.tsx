import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { PayerTicker } from "@/components/payer-ticker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { describeDecision, getMessage, suggestDecision } from "@/lib/payer/console";
import { REJECT_CODES } from "@/lib/payer/manual";
import { formatEdi } from "@/lib/x12/format";
import { REJECT_REASON_CODES } from "@/lib/x12/reject-reasons";
import { DecidedByBadge, MessageStatusBadge, OutcomeBadge } from "../_components/badges";
import { DecidePanel } from "../_components/decide-panel";

const formatDateTime = (d: Date | null) =>
  d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium" }) : "—";

const yesNo = (b: boolean | undefined) => (b === undefined ? "Unknown" : b ? "Yes" : "No");

export default function PayerMessagePage({ params }: PageProps<"/payer/[messageId]">) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Link href="/payer" className="mb-6 inline-block text-sm text-emerald-800 hover:underline">
        ← Back to inbox
      </Link>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading message…</p>}>
        <MessageDetail params={params} />
      </Suspense>
    </main>
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

  return (
    <>
      <PayerTicker
        key={`${m.status}:${m.deliveredAt ? "delivered" : "pending"}`}
        active={!responded || !m.deliveredAt}
        watch="payer"
        label={responded ? "Delivering response…" : "Watching for changes…"}
      />

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{s?.patientName ?? "Unreadable request"}</h1>
          <MessageStatusBadge status={m.status} />
          <OutcomeBadge outcome={m.outcome} />
          <DecidedByBadge decidedBy={m.decidedBy} />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {s?.payerName} · Member ID {s?.memberId ?? "—"} · Payer message #{m.controlNumber}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <Field label="Patient">{s?.patientName ?? "—"}</Field>
              <Field label="Date of birth">{s?.dob ?? "—"}</Field>
              <Field label="Member ID">{s?.memberId ?? "—"}</Field>
              <Field label="Payer">{s?.payerName ? `${s.payerName} (${s.payerId})` : "—"}</Field>
              <Field label="Requesting provider">
                {s?.providerName ?? "—"} <span className="text-gray-500">(NPI {s?.providerNpi ?? "—"})</span>
              </Field>
              <Field label="Diagnosis">{s?.diagnosisCode ?? "—"}</Field>
              <Field label="Procedure">
                {s?.procedureCode ?? "—"} {s?.procedureLabel && <span className="text-gray-500">{s.procedureLabel}</span>}
              </Field>
              <Field label="Units requested">{s?.units ?? "—"}</Field>
              <Field label="Service date">{s?.serviceDate ?? "—"}</Field>
              <Field label="Reference (BHT03)">
                <span className="font-mono text-xs">{s?.reference ?? "—"}</span>
              </Field>
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Attachments received</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-gray-500">Sent alongside the 278 (stands in for an X12 275).</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Field label="Clinical notes">{yesNo(m.attachments?.clinicalNotesAttached)}</Field>
                <Field label="Conservative treatment documented">
                  {yesNo(m.attachments?.conservativeTreatmentDocumented)}
                </Field>
              </dl>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-emerald-600">
            <CardHeader>
              <CardTitle>Rules check</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                <span className="font-medium">AUTO rules {responded ? "would have said" : "would"}: </span>
                {describeDecision(suggestion)}
              </p>
              <p className="mt-1 text-xs text-gray-500">A hint only. Simulated rules, not real payer policy.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timing</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                <Field label="Received">{formatDateTime(m.receivedAt)}</Field>
                <Field label="Acknowledge at">{formatDateTime(m.acknowledgeAt)}</Field>
                <Field label="AUTO respond at">{formatDateTime(m.respondAt)}</Field>
                <Field label="Responded">{formatDateTime(m.respondedAt)}</Field>
                <Field label="Delivered to hospital">{formatDateTime(m.deliveredAt)}</Field>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      {responded ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Decision sent</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <Field label="Outcome">
                <OutcomeBadge outcome={m.outcome} />
              </Field>
              <Field label="Reason">
                {m.response?.rejections.length
                  ? [
                      m.response.rejections.map((r) => `AAA ${r.code}: ${r.text}`).join("; "),
                      m.response.reason,
                    ]
                      .filter(Boolean)
                      .join(" - ")
                  : (m.response?.reason ?? "—")}
              </Field>
              <Field label="Authorization number">
                <span className="font-mono">{m.authorizationNumber ?? "—"}</span>
              </Field>
              <Field label="Decided by">{m.decidedBy === "MANUAL" ? "Manual review" : m.decidedBy === "AUTO" ? "Rules (AUTO)" : "—"}</Field>
            </dl>
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-6 border-emerald-300">
          <CardHeader>
            <CardTitle>Decide</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-xs text-gray-500">
              Overrides the AUTO timer if it hasn&apos;t fired yet. The hospital receives the response on the next tick.
            </p>
            <DecidePanel
              messageId={m.id}
              requestedUnits={s?.units}
              rejectCodes={REJECT_CODES.map((code) => ({ code, text: REJECT_REASON_CODES[code] }))}
            />
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>EDI 278</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <EdiBlock title="Request received" raw={m.requestEdi} />
          {m.responseEdi && <EdiBlock title="Response sent" raw={m.responseEdi} />}
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

function EdiBlock({ title, raw }: { title: string; raw: string }) {
  const text = formatEdi(raw);
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        <CopyButton text={text} />
      </div>
      <pre className="overflow-x-auto rounded-md bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-800 ring-1 ring-gray-200">
        {text}
      </pre>
    </section>
  );
}
