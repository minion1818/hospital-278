// HOSPITAL SIDE: applies what comes back from the payer.
//
// Reads and writes only hospital tables (PriorAuthRequest, AuditLog). It never
// imports lib/payer/* or reads payer tables; it only sees response EDI text.
// Time is always passed in as `now`.

import { db } from "@/lib/db";
import type { RequestStatus } from "@/lib/generated/prisma/enums";
import { parse278Response, type ResponseOutcome } from "@/lib/x12/parse278Response";

export const PAYER_ACTOR = "Payer (simulated)";

/** Statuses in which the hospital is still waiting for the payer. */
const AWAITING_PAYER: RequestStatus[] = ["SUBMITTED", "IN_REVIEW"];

const STATUS_FOR: Record<ResponseOutcome, RequestStatus> = {
  APPROVED: "APPROVED",
  PARTIALLY_APPROVED: "PARTIALLY_APPROVED",
  DENIED: "DENIED",
  PENDED: "PENDED",
  REJECTED: "REJECTED",
};

export type ApplyResponseResult =
  | { applied: true; requestId: string; status: RequestStatus }
  | { applied: false; requestId?: string; reason: string };

/**
 * Applies a 278 response to the request named in its BHT03. Idempotent: a
 * request that is no longer SUBMITTED/IN_REVIEW is left alone.
 */
export async function applyPayerResponse(
  responseEdi: string,
  now: Date,
): Promise<ApplyResponseResult> {
  let parsed;
  try {
    parsed = parse278Response(responseEdi);
  } catch (e) {
    return { applied: false, reason: `Unreadable response: ${e instanceof Error ? e.message : String(e)}` };
  }

  const requestId = parsed.parsed.bht?.reference;
  const request = requestId
    ? await db.priorAuthRequest.findUnique({ where: { id: requestId }, select: { id: true } })
    : null;
  if (!request) {
    return { applied: false, reason: `No request matches response reference ${requestId ?? "(none)"}` };
  }

  if (parsed.errors.length > 0 || !parsed.outcome) {
    const problems = parsed.errors.length > 0 ? parsed.errors.join("; ") : "no outcome found";
    await db.auditLog.create({
      data: {
        requestId: request.id,
        actor: PAYER_ACTOR,
        action: "PAYER_RESPONSE_INVALID",
        details: `Response could not be applied: ${problems}`,
        createdAt: now,
      },
    });
    return { applied: false, requestId: request.id, reason: problems };
  }

  const outcome = parsed.outcome;
  const status = STATUS_FOR[outcome];
  const certified = outcome === "APPROVED" || outcome === "PARTIALLY_APPROVED";
  const decisionReason =
    outcome === "REJECTED"
      ? [parsed.rejections.map((r) => `AAA ${r.code}: ${r.text}`).join("; "), parsed.reason]
          .filter(Boolean)
          .join(" - ")
      : (parsed.reason ?? null);

  return db.$transaction(async (tx) => {
    // Re-read inside the transaction; only act while still waiting on the payer
    const current = await tx.priorAuthRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, unitsRequested: true },
    });
    if (!AWAITING_PAYER.includes(current.status)) {
      return { applied: false as const, requestId: request.id, reason: `Ignored: request is ${current.status}` };
    }

    const updated = await tx.priorAuthRequest.updateMany({
      where: { id: request.id, status: { in: AWAITING_PAYER } },
      data: {
        status,
        raw278Response: responseEdi,
        decisionReason,
        decisionAt: now,
        unitsApproved: certified ? (parsed.unitsApproved ?? null) : null,
        authorizationNumber: certified ? (parsed.authorizationNumber ?? null) : null,
      },
    });
    if (updated.count !== 1) {
      return { applied: false as const, requestId: request.id, reason: "Ignored: request changed concurrently" };
    }

    const details = certified
      ? [
          `${parsed.unitsApproved} of ${current.unitsRequested} unit(s) approved, authorization ${parsed.authorizationNumber}`,
          parsed.reason,
        ]
          .filter(Boolean)
          .join(". ")
      : decisionReason;

    await tx.auditLog.create({
      data: { requestId: request.id, actor: PAYER_ACTOR, action: `PAYER_${status}`, details, createdAt: now },
    });
    return { applied: true as const, requestId: request.id, status };
  });
}

/** Payer acknowledged the request: SUBMITTED -> IN_REVIEW. No-op in any other status. */
export async function markInReview(requestId: string, now: Date): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const updated = await tx.priorAuthRequest.updateMany({
      where: { id: requestId, status: "SUBMITTED" },
      data: { status: "IN_REVIEW" },
    });
    if (updated.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        requestId,
        actor: PAYER_ACTOR,
        action: "PAYER_IN_REVIEW",
        details: "Payer received request, review started",
        createdAt: now,
      },
    });
    return true;
  });
}
