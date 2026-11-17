// SIMULATED PAYER: data and actions behind the payer console (/payer).
//
// Payer side of the boundary: only payer tables, plus what is inside the
// received EDI text and its stored attachments. No hospital imports. Delivery of
// responses to the hospital stays with lib/integration/tick.ts.
// Time is always passed in as `now`.

import { PAYERS, findProcedure } from "@/lib/catalog";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { PayerMessageStatus } from "@/lib/generated/prisma/enums";
import { attachmentsSchema, rulesDecision, storeResponse } from "@/lib/payer/inbox";
import { ManualDecisionError, toManualDecision } from "@/lib/payer/manual";
import type { Attachments, Decision } from "@/lib/payer/rules";
import { parse278 } from "@/lib/x12/parse278";
import { parse278Response } from "@/lib/x12/parse278Response";

export { ManualDecisionError } from "@/lib/payer/manual";

export type MessageFilter = "all" | "waiting" | "responded";

/** What the payer can read from the received 278 request. */
export type RequestSummary = {
  reference?: string;
  patientName?: string;
  memberId?: string;
  dob?: string;
  payerName?: string;
  payerId?: string;
  providerName?: string;
  providerNpi?: string;
  /** Display form with the decimal restored, e.g. M17.11 */
  diagnosisCode?: string;
  procedureCode?: string;
  procedureLabel?: string;
  units?: number;
  /** YYYY-MM-DD */
  serviceDate?: string;
};

export type MessageView = {
  id: string;
  controlNumber: number;
  status: PayerMessageStatus;
  receivedAt: Date;
  acknowledgeAt: Date;
  respondAt: Date;
  respondedAt: Date | null;
  deliveredAt: Date | null;
  decidedBy: string | null;
  outcome: string | null;
  authorizationNumber: string | null;
  attachments: Attachments | null;
  summary: RequestSummary | null;
  requestEdi: string;
  responseEdi: string | null;
  /** MSG reason and AAA rejections read back from the stored response */
  response?: { reason?: string; rejections: { code: string; text: string }[] };
};

const isoDate = (ccyymmdd?: string) =>
  ccyymmdd && /^\d{8}$/.test(ccyymmdd)
    ? `${ccyymmdd.slice(0, 4)}-${ccyymmdd.slice(4, 6)}-${ccyymmdd.slice(6, 8)}`
    : ccyymmdd;

/** ICD-10 codes travel without the decimal; put it back after the category (3 chars). */
const dottedIcd = (code?: string) =>
  code && code.length > 3 && !code.includes(".") ? `${code.slice(0, 3)}.${code.slice(3)}` : code;

const titleCase = (s?: string) =>
  s?.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function summarizeRequest(requestEdi: string): RequestSummary | null {
  try {
    const p = parse278(requestEdi);
    const service = p.services[0];
    const dx = p.event?.diagnoses.find((d) => d.qualifier === "ABK") ?? p.event?.diagnoses[0];
    const payerId = p.payer?.id;
    return {
      reference: p.bht?.reference,
      patientName: p.subscriber ? titleCase(`${p.subscriber.firstName} ${p.subscriber.lastName}`) : undefined,
      memberId: p.subscriber?.memberId,
      dob: isoDate(p.subscriber?.dob),
      payerName: (payerId && PAYERS.find((x) => x.payerId === payerId)?.name) || titleCase(p.payer?.name),
      payerId,
      providerName: p.requester ? titleCase(`${p.requester.firstName} ${p.requester.lastName}`) : undefined,
      providerNpi: p.requester?.id,
      diagnosisCode: dottedIcd(dx?.code),
      procedureCode: service?.procedureCode,
      procedureLabel: service?.procedureCode ? findProcedure(service.procedureCode)?.label : undefined,
      units: service?.units,
      serviceDate: isoDate(service?.serviceDate ?? p.event?.serviceDate),
    };
  } catch {
    return null;
  }
}

type MessageRow = Awaited<ReturnType<typeof db.payerMessage.findUniqueOrThrow>>;

function toView(m: MessageRow): MessageView {
  const attachments = attachmentsSchema.safeParse(m.attachments);
  let response: MessageView["response"];
  if (m.responseEdi) {
    try {
      const r = parse278Response(m.responseEdi);
      response = { reason: r.reason, rejections: r.rejections.map(({ code, text }) => ({ code, text })) };
    } catch {
      response = undefined;
    }
  }
  return {
    id: m.id,
    controlNumber: m.controlNumber,
    status: m.status,
    receivedAt: m.receivedAt,
    acknowledgeAt: m.acknowledgeAt,
    respondAt: m.respondAt,
    respondedAt: m.respondedAt,
    deliveredAt: m.deliveredAt,
    decidedBy: m.decidedBy,
    outcome: m.outcome,
    authorizationNumber: m.authorizationNumber,
    attachments: attachments.success ? attachments.data : null,
    summary: summarizeRequest(m.requestEdi),
    requestEdi: m.requestEdi,
    responseEdi: m.responseEdi,
    response,
  };
}

/** All messages, newest first. */
export async function listMessages(filter: MessageFilter = "all"): Promise<MessageView[]> {
  const rows = await db.payerMessage.findMany({
    where:
      filter === "waiting"
        ? { status: { not: "RESPONDED" } }
        : filter === "responded"
          ? { status: "RESPONDED" }
          : undefined,
    orderBy: [{ receivedAt: "desc" }, { controlNumber: "desc" }],
  });
  return rows.map(toView);
}

export async function countMessages() {
  const [all, waiting] = await Promise.all([
    db.payerMessage.count(),
    db.payerMessage.count({ where: { status: { not: "RESPONDED" } } }),
  ]);
  return { all, waiting, responded: all - waiting };
}

export async function getMessage(id: string): Promise<MessageView | null> {
  const row = await db.payerMessage.findUnique({ where: { id } });
  return row ? toView(row) : null;
}

/** What the AUTO rules WOULD decide right now. Reads only; stores nothing. */
export async function suggestDecision(
  message: { requestEdi: string; attachments: Prisma.JsonValue },
  now: Date,
): Promise<Decision> {
  return rulesDecision(db, message, now);
}

/** "DENY - Conservative treatment not documented; required for ..." */
export function describeDecision(d: Decision): string {
  switch (d.kind) {
    case "APPROVED":
      return `APPROVE ${d.unitsApproved} unit${d.unitsApproved === 1 ? "" : "s"}`;
    case "PARTIAL":
      return `APPROVE PART (${d.unitsApproved} units) - ${d.reason}`;
    case "DENIED":
      return `DENY - ${d.reason}`;
    case "PENDED":
      return `PEND - ${d.reason}`;
    case "REJECTED":
      return `REJECT - ${d.errors.map((e) => `AAA ${e.code}: ${e.text}`).join("; ")}`;
  }
}

/**
 * Decides a message by hand, in either mode. Allowed while the message is
 * RECEIVED or IN_REVIEW (so it can override the AUTO timer, even before the
 * acknowledgment delay). Atomic: a concurrent or repeated decision fails with a
 * friendly error and changes nothing. Delivery to the hospital happens on the next tick.
 */
export async function decideManually(messageId: string, input: unknown, now: Date) {
  return db.$transaction(async (tx) => {
    const message = await tx.payerMessage.findUnique({ where: { id: messageId } });
    if (!message) throw new ManualDecisionError("This message no longer exists.");
    if (message.status === "RESPONDED") {
      throw new ManualDecisionError("This request has already been responded to.");
    }

    // Validate before claiming, against the units in the received request
    const requestedUnits = parse278(message.requestEdi).services[0]?.units ?? NaN;
    const decision = toManualDecision(input, requestedUnits);

    const claimed = await tx.payerMessage.updateMany({
      where: { id: messageId, status: { in: ["RECEIVED", "IN_REVIEW"] } },
      data: { status: "RESPONDED", respondedAt: now },
    });
    if (claimed.count !== 1) {
      throw new ManualDecisionError("This request has already been responded to.");
    }

    return storeResponse(tx, message, decision, now, "MANUAL");
  });
}
