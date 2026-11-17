// ORCHESTRATOR: the only module that talks to both the hospital and the
// simulated payer. Everything it passes across is EDI text plus the
// attachments object (standing in for an X12 275 attachment transaction).
//
// tick() stands in for a background worker / webhook delivery: something has
// to move time forward on the payer side and carry responses back.

import { applyPayerResponse, markInReview } from "@/lib/hospital/applyPayerResponse";
import { db } from "@/lib/db";
import {
  countOpenMessages,
  getSettings,
  markDelivered,
  processDue,
  receive278,
} from "@/lib/payer/inbox";
import type { Attachments } from "@/lib/payer/rules";
import { parse278 } from "@/lib/x12/parse278";

export type TickResult = {
  /** Requests moved SUBMITTED -> IN_REVIEW */
  acknowledged: number;
  /** Responses applied to a request (status changed) */
  responded: number;
  /** Responses delivered but ignored (request no longer waiting, or invalid) */
  ignored: number;
  /** Payer-side or delivery errors in this pass */
  errors: string[];
};

export async function tick(now: Date): Promise<TickResult> {
  const due = await processDue(now);
  const result: TickResult = { acknowledged: 0, responded: 0, ignored: 0, errors: due.failures.map((f) => `${f.messageId}: ${f.error}`) };

  for (const { messageId, requestEdi } of due.acknowledged) {
    const requestId = requestReference(requestEdi);
    if (!requestId) {
      result.errors.push(`${messageId}: request has no BHT03 reference`);
      continue;
    }
    if (await markInReview(requestId, now)) result.acknowledged++;
  }

  for (const { messageId, responseEdi } of due.responses) {
    try {
      const applied = await applyPayerResponse(responseEdi, now);
      if (applied.applied) result.responded++;
      else result.ignored++;
      // Delivered either way: the hospital received it (and logged/ignored it)
      await markDelivered(messageId, now);
    } catch (e) {
      // Not marked delivered, so the next tick retries it
      result.errors.push(`${messageId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

/** The request id the hospital wrote into BHT03. */
function requestReference(requestEdi: string): string | undefined {
  try {
    return parse278(requestEdi).bht?.reference || undefined;
  } catch {
    return undefined;
  }
}

/** Sends a 278 to the payer with its attachments (the simulated 275). */
export async function submitToPayer(
  request: { clinicalNotesAttached: boolean; conservativeTreatmentTried: boolean },
  ediText: string,
  now: Date,
): Promise<{ messageId: string }> {
  const attachments: Attachments = {
    clinicalNotesAttached: request.clinicalNotesAttached,
    conservativeTreatmentDocumented: request.conservativeTreatmentTried,
  };
  return receive278(ediText, attachments, now);
}

/** Work still in flight on each side (drives the pollers on both UIs). */
export async function getPendingCounts(): Promise<{ requests: number; payerOpen: number }> {
  const [requests, payerOpen] = await Promise.all([
    db.priorAuthRequest.count({ where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } } }),
    countOpenMessages(),
  ]);
  return { requests, payerOpen };
}

/** The payer's current mode, for hospital-side hints ("manual mode, may take longer"). */
export async function getPayerMode(): Promise<"AUTO" | "MANUAL"> {
  return (await getSettings()).mode;
}
