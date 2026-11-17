// SIMULATED PAYER: validation for decisions made by hand in the payer console.
// Pure (no database, no clock), so it can be unit tested directly.

import { z } from "zod";
import type { Decision, RejectionLoop } from "@/lib/payer/rules";
import { REJECT_REASON_CODES, type RejectReasonCode } from "@/lib/x12/reject-reasons";

export const REASON_MAX = 200;

/** Where each reject code's AAA segment goes (same placement the AUTO rules use). */
export const REJECT_CODE_LOOP: Record<RejectReasonCode, RejectionLoop> = {
  "79": "payer",
  "72": "subscriber",
  "75": "subscriber",
  "43": "requester",
  "56": "event",
  "57": "event",
  AF: "event",
  AG: "service",
  "15": "service",
  "33": "service",
};

export const REJECT_CODES = Object.keys(REJECT_REASON_CODES) as RejectReasonCode[];

const reason = z
  .string({ error: "Enter a reason." })
  .trim()
  .min(1, { error: "Enter a reason." })
  .max(REASON_MAX, { error: `Keep the reason under ${REASON_MAX} characters.` });

/** What the console submits. Units for PARTIAL are checked against the request separately. */
export const manualDecisionSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("APPROVED") }),
    z.object({
      kind: z.literal("PARTIAL"),
      unitsApproved: z.coerce
        .number({ error: "Enter the number of units to approve." })
        .int({ error: "Units must be a whole number." }),
      reason,
    }),
    z.object({ kind: z.literal("DENIED"), reason }),
    z.object({ kind: z.literal("PENDED"), reason }),
    z.object({
      kind: z.literal("REJECTED"),
      code: z.enum(REJECT_CODES as [RejectReasonCode, ...RejectReasonCode[]], {
        error: "Choose a reject reason code.",
      }),
      reason,
    }),
  ],
  { error: "Choose a decision." },
);

export type ManualDecisionInput = z.input<typeof manualDecisionSchema>;

export type FieldErrors = Partial<Record<"kind" | "unitsApproved" | "reason" | "code", string>>;

export class ManualDecisionError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: FieldErrors = {},
  ) {
    super(message);
  }
}

/**
 * Turns console input into a payer Decision, given the units the request asked
 * for. Throws ManualDecisionError (with per-field messages) when invalid.
 */
export function toManualDecision(input: unknown, requestedUnits: number): Decision {
  const parsed = manualDecisionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = (issue.path[0] ?? "kind") as keyof FieldErrors;
      fieldErrors[key] ??= issue.message;
    }
    throw new ManualDecisionError("Please fix the highlighted fields.", fieldErrors);
  }
  const d = parsed.data;

  switch (d.kind) {
    case "APPROVED":
      if (!Number.isInteger(requestedUnits) || requestedUnits < 1) {
        throw new ManualDecisionError("The request has no valid unit count to approve.");
      }
      return { kind: "APPROVED", unitsApproved: requestedUnits };
    case "PARTIAL": {
      if (requestedUnits < 2) {
        throw new ManualDecisionError(
          "Only 1 unit was requested, so it can't be partially approved. Approve or deny it instead.",
          { kind: "Partial approval needs at least 2 requested units." },
        );
      }
      if (d.unitsApproved < 1 || d.unitsApproved > requestedUnits - 1) {
        throw new ManualDecisionError("Please fix the highlighted fields.", {
          unitsApproved: `Approve between 1 and ${requestedUnits - 1} units (${requestedUnits} requested).`,
        });
      }
      return { kind: "PARTIAL", unitsApproved: d.unitsApproved, reason: d.reason };
    }
    case "DENIED":
      return { kind: "DENIED", reason: d.reason };
    case "PENDED":
      return { kind: "PENDED", reason: d.reason };
    case "REJECTED":
      return {
        kind: "REJECTED",
        errors: [{ code: d.code, text: d.reason, loop: REJECT_CODE_LOOP[d.code] }],
      };
  }
}
