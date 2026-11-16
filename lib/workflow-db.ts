// Applies a workflow transition to the database. Kept free of Next.js APIs
// (no cookies/revalidate) so it can be exercised from scripts; the server
// action wraps it with auth + revalidation.

import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { RequestStatus, Role } from "@/lib/generated/prisma/enums";
import { submitToPayer } from "@/lib/integration/tick";
import {
  TRANSITIONS,
  auditEntriesFor,
  checkTransition,
  type AuditContext,
  type TransitionKey,
} from "@/lib/workflow";
import { generate278Request } from "@/lib/x12/generate278";
import { build278Input, type RequestFor278 } from "@/lib/x12/from-request";

export type Actor = { id: string; name: string; role: Role };

export type TransmissionResult = { ok: true; messageId: string } | { ok: false; error: string };

export type ApplyResult =
  | {
      ok: true;
      from: RequestStatus;
      to: RequestStatus;
      controlNumber?: number;
      /** Set when the transition sends the 278 to the payer (after commit) */
      transmission?: TransmissionResult;
    }
  | { ok: false; error: string; currentStatus?: RequestStatus };

/** Sends a stored 278 to the payer. Injectable so tests can simulate an outage. */
export type Transmit = (
  request: { clinicalNotesAttached: boolean; conservativeTreatmentTried: boolean },
  ediText: string,
  now: Date,
) => Promise<{ messageId: string }>;

type ApplyArgs = { requestId: string; key: TransitionKey; actor: Actor; note?: string | null };

/** Thrown inside the transaction to roll it back with a friendly message. */
class TransitionRejected extends Error {
  constructor(
    message: string,
    readonly currentStatus?: RequestStatus,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function applyTransition(
  db: PrismaClient,
  args: ApplyArgs & { transmit?: Transmit; now?: Date },
): Promise<ApplyResult> {
  const result = await applyInTransaction(db, args);
  if (!result.ok || TRANSITIONS[args.key].afterCommit !== "TRANSMIT_TO_PAYER") return result;

  // After commit: the payer call must not hold the hospital's transaction open,
  // and a payer failure must not roll back the (already valid) approval.
  result.transmission = await transmitToPayer(db, {
    requestId: args.requestId,
    actor: args.actor,
    controlNumber: result.controlNumber,
    transmit: args.transmit ?? submitToPayer,
    now: args.now ?? new Date(),
  });
  return result;
}

async function transmitToPayer(
  db: PrismaClient,
  args: { requestId: string; actor: Actor; controlNumber?: number; transmit: Transmit; now: Date },
): Promise<TransmissionResult> {
  const { requestId, actor, transmit, now } = args;
  const request = await db.priorAuthRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { raw278Request: true, clinicalNotesAttached: true, conservativeTreatmentTried: true },
  });

  let outcome: TransmissionResult;
  try {
    if (!request.raw278Request) throw new Error("No 278 request was stored");
    const { messageId } = await transmit(request, request.raw278Request, now);
    outcome = { ok: true, messageId };
  } catch (e) {
    outcome = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Status stays SUBMITTED either way; a failure is made visible in the timeline.
  await db.auditLog.create({
    data: outcome.ok
      ? {
          requestId,
          actor: actor.name,
          action: "SUBMITTED_TO_PAYER",
          details: `278 request transmitted (control number ${args.controlNumber}, payer message ${outcome.messageId})`,
        }
      : {
          requestId,
          actor: actor.name,
          action: "TRANSMISSION_FAILED",
          details: `Transmission to payer failed: ${outcome.error}`,
        },
  });
  return outcome;
}

async function applyInTransaction(db: PrismaClient, args: ApplyArgs): Promise<ApplyResult> {
  const { requestId, key, actor, note } = args;
  try {
    return await db.$transaction(async (tx) => {
      // Re-read the request inside the transaction (the page may be stale)
      const current = await tx.priorAuthRequest.findUnique({
        where: { id: requestId },
        include: { patient: true },
      });
      if (!current) throw new TransitionRejected("This request no longer exists.");

      const check = checkTransition(key, actor.role, current.status, note);
      if (!check.ok) throw new TransitionRejected(check.error, current.status);
      const t = check.transition;
      const ctx: AuditContext = {};

      // Conditional update: only succeeds if the status is still one of the
      // from-statuses. This closes the race where two concurrent submits both
      // read the old status above; the second one updates 0 rows.
      const updated = await tx.priorAuthRequest.updateMany({
        where: { id: requestId, status: { in: [...t.from] } },
        data: {
          status: t.to,
          ...(key === "APPROVE_AND_SEND" ? { reviewedById: actor.id } : {}),
          ...(t.effect === "RESET_FOR_RESUBMISSION"
            ? {
                raw278Request: null,
                raw278Response: null,
                decisionReason: null,
                decisionAt: null,
                unitsApproved: null,
              }
            : {}),
        },
      });
      if (updated.count !== 1) {
        const latest = await tx.priorAuthRequest.findUnique({
          where: { id: requestId },
          select: { status: true },
        });
        throw new TransitionRejected(
          "Someone else just updated this request, so this action was not applied. The page has been refreshed.",
          latest?.status,
        );
      }

      if (t.effect === "RESET_FOR_RESUBMISSION") {
        ctx.previousDecision = summarizePreviousSubmission(current);
      }

      if (t.effect === "GENERATE_278") {
        ctx.controlNumber = await generateAndStore278(tx, current);
      }

      // Explicit, strictly increasing timestamps: a default now() can give every
      // row in one transaction the same time, which would scramble the timeline order.
      const base = Date.now();
      await tx.auditLog.createMany({
        data: auditEntriesFor(t, note, ctx).map((entry, i) => ({
          requestId,
          actor: actor.name,
          action: entry.action,
          details: entry.details,
          createdAt: new Date(base + i),
        })),
      });

      return { ok: true as const, from: current.status, to: t.to, controlNumber: ctx.controlNumber };
    });
  } catch (e) {
    if (e instanceof TransitionRejected) {
      return { ok: false, error: e.message, currentStatus: e.currentStatus };
    }
    throw e;
  }
}

/**
 * Builds the 278 for the request and stores it. A request that already had a
 * 278 generated once (and was reopened) gets a fresh control number, because X12
 * interchange control numbers must not be reused for a different interchange.
 * Counted by earlier approvals (each one generated a 278), whether or not that
 * transmission succeeded. Runs before this approval's own audit entry is written.
 */
async function generateAndStore278(
  tx: Tx,
  request: RequestFor278 & { status: RequestStatus },
): Promise<number> {
  const previousApprovals = await tx.auditLog.count({
    where: { requestId: request.id, action: "APPROVED_FOR_SUBMISSION" },
  });

  let controlNumber = request.controlNumber;
  if (previousApprovals > 0) {
    const [row] = await tx.$queryRaw<{ n: number }[]>`
      SELECT nextval(pg_get_serial_sequence('"PriorAuthRequest"', 'controlNumber'))::int AS n`;
    controlNumber = row.n;
  }

  let edi: string;
  try {
    edi = generate278Request(build278Input({ ...request, controlNumber }));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new TransitionRejected(`Could not generate the 278 request: ${reason}`, request.status);
  }

  await tx.priorAuthRequest.update({
    where: { id: request.id },
    data: { raw278Request: edi, controlNumber },
  });
  return controlNumber;
}

/** One-line summary of what RESET_FOR_RESUBMISSION is about to clear, for the audit log. */
function summarizePreviousSubmission(r: {
  status: RequestStatus;
  controlNumber: number;
  raw278Request: string | null;
  decisionReason: string | null;
}): string | undefined {
  if (!r.raw278Request && !r.decisionReason) return undefined;
  const parts = [`${r.status.replaceAll("_", " ").toLowerCase()} (control number ${r.controlNumber})`];
  if (r.decisionReason) parts.push(`reason: ${r.decisionReason}`);
  return parts.join(", ");
}
