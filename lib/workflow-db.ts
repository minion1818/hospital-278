// Applies a workflow transition to the database. Kept free of Next.js APIs
// (no cookies/revalidate) so it can be exercised from scripts; the server
// action wraps it with auth + revalidation.

import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { RequestStatus, Role } from "@/lib/generated/prisma/enums";
import {
  auditEntriesFor,
  checkTransition,
  type AuditContext,
  type TransitionKey,
} from "@/lib/workflow";
import { generate278Request } from "@/lib/x12/generate278";
import { build278Input, type RequestFor278 } from "@/lib/x12/from-request";

export type Actor = { id: string; name: string; role: Role };

export type ApplyResult =
  | { ok: true; from: RequestStatus; to: RequestStatus; controlNumber?: number }
  | { ok: false; error: string; currentStatus?: RequestStatus };

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
  args: { requestId: string; key: TransitionKey; actor: Actor; note?: string | null },
): Promise<ApplyResult> {
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
 * Builds the 278 for the request and stores it. A request that was already
 * transmitted once (and reopened) gets a fresh control number, because X12
 * interchange control numbers must not be reused for a different interchange.
 */
async function generateAndStore278(
  tx: Tx,
  request: RequestFor278 & { status: RequestStatus },
): Promise<number> {
  const previouslySent = await tx.auditLog.count({
    where: { requestId: request.id, action: "SUBMITTED_TO_PAYER" },
  });

  let controlNumber = request.controlNumber;
  if (previouslySent > 0) {
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
