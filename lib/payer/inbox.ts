// SIMULATED PAYER: inbound 278 queue.
//
// Payer side of the boundary. Reads and writes ONLY the payer tables
// (PayerMessage, PayerMember, PayerSettings). It never imports hospital modules
// or touches PriorAuthRequest / Patient / AuditLog. What crosses the boundary is
// EDI text plus an attachments object (standing in for an X12 275).
//
// Time is always passed in as `now`; nothing here reads the clock.

import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  evaluateRequest,
  payerRequestFromParsed,
  type Attachments,
  type Decision,
} from "@/lib/payer/rules";
import { ccyymmdd } from "@/lib/x12/envelope";
import { generate278Response } from "@/lib/x12/generate278Response";
import { parse278 } from "@/lib/x12/parse278";

export type PayerOutcome = "APPROVED" | "PARTIALLY_APPROVED" | "DENIED" | "PENDED" | "REJECTED";

export type ProcessDueResult = {
  /** Messages moved RECEIVED -> IN_REVIEW in this pass, with the request EDI so the caller can find its reference */
  acknowledged: { messageId: string; requestEdi: string }[];
  /** Every responded message not yet delivered (including ones answered in this pass) */
  responses: { messageId: string; responseEdi: string; outcome: string }[];
  /** Messages that could not be decided in this pass (left IN_REVIEW to retry) */
  failures: { messageId: string; error: string }[];
};

export const attachmentsSchema = z.object({
  clinicalNotesAttached: z.boolean(),
  conservativeTreatmentDocumented: z.boolean(),
});

const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

export const OUTCOME: Record<Decision["kind"], PayerOutcome> = {
  APPROVED: "APPROVED",
  PARTIAL: "PARTIALLY_APPROVED",
  DENIED: "DENIED",
  PENDED: "PENDED",
  REJECTED: "REJECTED",
};

/** Authorization numbers derive from the message's own counter: unique and deterministic. */
export const authorizationNumberFor = (controlNumber: number) =>
  `AUTH${String(controlNumber).padStart(8, "0")}`;

/** Matches the column defaults in prisma/schema.prisma (PayerSettings). */
const DEFAULT_SETTINGS = { id: 1, mode: "AUTO", ackDelaySeconds: 2, responseDelaySeconds: 8 } as const;

/**
 * The single settings row, or the defaults if it hasn't been saved yet.
 * Read-only on purpose: pages call this while rendering, and a write (upsert)
 * there both mutates during a GET and trips Cache Components' prerender check
 * (Prisma's upsert transaction calls crypto.randomUUID() synchronously).
 */
export async function getPayerSettings() {
  return (await db.payerSettings.findUnique({ where: { id: 1 } })) ?? { ...DEFAULT_SETTINGS };
}

/** Alias used by the payer console. */
export const getSettings = getPayerSettings;

export const settingsSchema = z.object({
  mode: z.enum(["AUTO", "MANUAL"], { error: "Choose AUTO or MANUAL." }),
  ackDelaySeconds: z.coerce
    .number({ error: "Enter a number of seconds." })
    .int({ error: "Use whole seconds." })
    .min(0, { error: "Use 0 to 60 seconds." })
    .max(60, { error: "Use 0 to 60 seconds." }),
  responseDelaySeconds: z.coerce
    .number({ error: "Enter a number of seconds." })
    .int({ error: "Use whole seconds." })
    .min(0, { error: "Use 0 to 60 seconds." })
    .max(60, { error: "Use 0 to 60 seconds." }),
});

export type SettingsInput = z.input<typeof settingsSchema>;

/**
 * Validates and saves settings. New delays apply to messages received from now
 * on; switching to AUTO lets already-due IN_REVIEW messages be decided on the next tick.
 */
export async function updateSettings(input: SettingsInput) {
  const data = settingsSchema.parse(input);
  return db.payerSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

/** Messages still needing payer work or delivery (drives the console's polling). */
export async function countOpenMessages() {
  return db.payerMessage.count({
    where: { OR: [{ status: { not: "RESPONDED" } }, { deliveredAt: null }] },
  });
}

/**
 * Accepts a 278 request. Throws on anything that isn't a structurally valid 278
 * request, the way a clearinghouse would bounce garbage before it reaches review.
 */
export async function receive278(
  ediText: string,
  attachments: Attachments,
  now: Date,
): Promise<{ messageId: string }> {
  let parsed;
  try {
    parsed = parse278(ediText);
  } catch (e) {
    throw new Error(`Payer could not read the 278: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (parsed.errors.length > 0) {
    throw new Error(`Payer rejected a malformed 278: ${parsed.errors.join("; ")}`);
  }
  if (parsed.bht?.purpose !== "13") {
    throw new Error(`Payer expected a 278 request (BHT02 13), got ${parsed.bht?.purpose ?? "none"}`);
  }
  const checkedAttachments = attachmentsSchema.parse(attachments);

  const settings = await getPayerSettings();
  const message = await db.payerMessage.create({
    data: {
      requestEdi: ediText,
      attachments: checkedAttachments,
      receivedAt: now,
      acknowledgeAt: addSeconds(now, settings.ackDelaySeconds),
      respondAt: addSeconds(now, settings.responseDelaySeconds),
    },
  });
  return { messageId: message.id };
}

/**
 * One pass of the payer's worker:
 *  (a) acknowledge due RECEIVED messages (-> IN_REVIEW)
 *  (b) AUTO mode only: decide due IN_REVIEW messages (-> RESPONDED)
 * Each message is claimed with a conditional update, so concurrent callers
 * can never both acknowledge or both decide the same message.
 */
export async function processDue(now: Date): Promise<ProcessDueResult> {
  const settings = await getPayerSettings();
  const result: ProcessDueResult = { acknowledged: [], responses: [], failures: [] };

  // (a) acknowledge
  const toAck = await db.payerMessage.findMany({
    where: { status: "RECEIVED", acknowledgeAt: { lte: now } },
    select: { id: true, requestEdi: true },
    orderBy: { receivedAt: "asc" },
  });
  for (const m of toAck) {
    const claimed = await db.payerMessage.updateMany({
      where: { id: m.id, status: "RECEIVED" },
      data: { status: "IN_REVIEW" },
    });
    if (claimed.count === 1) result.acknowledged.push({ messageId: m.id, requestEdi: m.requestEdi });
  }

  // (b) decide (AUTO only; MANUAL waits for a human)
  if (settings.mode === "AUTO") {
    const toDecide = await db.payerMessage.findMany({
      where: { status: "IN_REVIEW", respondAt: { lte: now } },
      select: { id: true },
      orderBy: { receivedAt: "asc" },
    });
    for (const { id } of toDecide) {
      try {
        await decideMessage(id, now);
      } catch (e) {
        result.failures.push({ messageId: id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // Everything answered but not yet delivered (at-least-once delivery)
  const undelivered = await db.payerMessage.findMany({
    where: { status: "RESPONDED", deliveredAt: null, responseEdi: { not: null } },
    select: { id: true, responseEdi: true, outcome: true },
    orderBy: { respondedAt: "asc" },
  });
  result.responses = undelivered.map((m) => ({
    messageId: m.id,
    responseEdi: m.responseEdi!,
    outcome: m.outcome ?? "",
  }));

  return result;
}

/** Claims, evaluates and answers one IN_REVIEW message, all in one transaction. */
async function decideMessage(id: string, now: Date) {
  await db.$transaction(async (tx) => {
    const claimed = await tx.payerMessage.updateMany({
      where: { id, status: "IN_REVIEW" },
      data: { status: "RESPONDED", respondedAt: now },
    });
    if (claimed.count !== 1) return; // someone else decided it

    const message = await tx.payerMessage.findUniqueOrThrow({ where: { id } });
    const decision = await rulesDecision(tx, message, now);
    await storeResponse(tx, message, decision, now, "AUTO");
  });
}

/** What the AUTO rules decide for a message. Reads the roster; writes nothing. */
export async function rulesDecision(
  client: Prisma.TransactionClient,
  message: { requestEdi: string; attachments: Prisma.JsonValue },
  now: Date,
): Promise<Decision> {
  const payerRequest = payerRequestFromParsed(parse278(message.requestEdi));
  return evaluateRequest({
    request: payerRequest,
    attachments: attachmentsSchema.parse(message.attachments),
    roster: await rosterFor(client, payerRequest.payerId, payerRequest.memberId),
    today: ccyymmdd(now),
  });
}

/**
 * Builds the 278 response for a decision and stores it on an already-claimed
 * message (status RESPONDED). Shared by AUTO decisions and the payer console.
 */
export async function storeResponse(
  tx: Prisma.TransactionClient,
  message: { id: string; requestEdi: string; controlNumber: number },
  decision: Decision,
  now: Date,
  decidedBy: "AUTO" | "MANUAL",
) {
  const certified = decision.kind === "APPROVED" || decision.kind === "PARTIAL";
  const authorizationNumber = certified ? authorizationNumberFor(message.controlNumber) : undefined;
  const responseEdi = generate278Response({
    request: parse278(message.requestEdi),
    decision,
    authorizationNumber,
    controlNumber: message.controlNumber,
    respondedAt: now,
  });

  await tx.payerMessage.update({
    where: { id: message.id },
    data: {
      status: "RESPONDED",
      respondedAt: now,
      responseEdi,
      outcome: OUTCOME[decision.kind],
      authorizationNumber: authorizationNumber ?? null,
      decidedBy,
    },
  });
  return { outcome: OUTCOME[decision.kind], authorizationNumber };
}

/** Roster for evaluateRequest: the one member asked about, if this payer has them. */
export async function rosterFor(
  tx: Prisma.TransactionClient,
  payerId: string | undefined,
  memberId: string | undefined,
) {
  if (!payerId || !memberId) return {};
  const member = await tx.payerMember.findUnique({ where: { memberId: memberId.trim() } });
  // A member enrolled with a different payer is "not found" for this one
  return member && member.payerId === payerId.trim() ? { [member.memberId]: { active: member.active } } : {};
}

/** Records that the hospital received a response. Idempotent. */
export async function markDelivered(messageId: string, now: Date) {
  await db.payerMessage.updateMany({
    where: { id: messageId, deliveredAt: null },
    data: { deliveredAt: now },
  });
}
