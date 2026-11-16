// X12 AAA03 "Reject Reason Code" values used by the mock payer, with their
// standard descriptions. Deliberately limited to codes this demo emits; see the
// README ("Mock payer rules") for the ones whose 005010X217 usage I'm unsure about.

export const REJECT_REASON_CODES = {
  "15": "Required application data missing",
  "33": "Input errors",
  "43": "Invalid/missing provider identification",
  "56": "Inappropriate date",
  "57": "Invalid/missing date(s) of service",
  "72": "Invalid/missing subscriber/insured ID",
  "75": "Subscriber/insured not found",
  "79": "Invalid participant identification",
  AF: "Invalid/missing diagnosis code(s)",
  AG: "Invalid/missing procedure code(s)",
} as const;

export type RejectReasonCode = keyof typeof REJECT_REASON_CODES;

export const describeRejectReason = (code: string): string =>
  (REJECT_REASON_CODES as Record<string, string>)[code] ?? `Reject reason code ${code}`;
