// Parses a 278 response (as produced by generate278Response) into the outcome
// the hospital needs. Reuses parse278 for delimiters, segments, HL loops and all
// envelope validation (control numbers, SE01, HL parents).

import { parse278, type HlLoop, type Parsed278 } from "@/lib/x12/parse278";
import { describeRejectReason } from "@/lib/x12/reject-reasons";

export type ResponseOutcome =
  | "APPROVED"
  | "PARTIALLY_APPROVED"
  | "DENIED"
  | "PENDED"
  | "REJECTED";

export type ResponseRejection = {
  /** AAA03 reject reason code */
  code: string;
  /** Standard description of the code */
  text: string;
  /** AAA04 follow-up action code (C = correct and resubmit) */
  followUp?: string;
  loop: "payer" | "requester" | "subscriber" | "event" | "service" | "unknown";
};

export type Parsed278Response = {
  /** BHT02: "11" = response, "13" = request */
  purpose?: string;
  /** undefined when neither HCR nor AAA could be found (see errors) */
  outcome?: ResponseOutcome;
  /** HCR01 as received */
  actionCode?: string;
  /** MSG01 */
  reason?: string;
  /** HCR02, for certified outcomes */
  authorizationNumber?: string;
  /** Service-loop SV104, only for APPROVED / PARTIALLY_APPROVED */
  unitsApproved?: number;
  rejections: ResponseRejection[];
  /** Envelope/structure problems plus response-specific ones */
  errors: string[];
  /** The full generic parse, for anything not summarized above */
  parsed: Parsed278;
};

const ACTION_TO_OUTCOME: Record<string, ResponseOutcome> = {
  A1: "APPROVED",
  A2: "PARTIALLY_APPROVED",
  A3: "DENIED",
  A4: "PENDED",
};

const LEVEL_TO_LOOP: Record<string, ResponseRejection["loop"]> = {
  "20": "payer",
  "21": "requester",
  "22": "subscriber",
  EV: "event",
  SS: "service",
};

export function parse278Response(text: string): Parsed278Response {
  const parsed = parse278(text);
  const errors = [...parsed.errors];
  const purpose = parsed.bht?.purpose;
  if (purpose !== "11") errors.push(`BHT02 is ${purpose ?? "missing"}, expected 11 (response)`);

  const firstIn = (loops: HlLoop[], id: string) => {
    for (const l of loops) {
      const s = l.segments.find((x) => x[0] === id);
      if (s) return s;
    }
    return undefined;
  };
  const eventLoops = parsed.loops.filter((l) => l.levelCode === "EV");
  const serviceLoops = parsed.loops.filter((l) => l.levelCode === "SS");

  const rejections: ResponseRejection[] = parsed.loops.flatMap((l) =>
    l.segments
      .filter((s) => s[0] === "AAA")
      .map((s) => ({
        code: s[3] ?? "",
        text: describeRejectReason(s[3] ?? ""),
        followUp: s[4] || undefined,
        loop: LEVEL_TO_LOOP[l.levelCode] ?? "unknown",
      })),
  );

  // Decision lives in the event loop; fall back to the service loop
  const hcr = firstIn(eventLoops, "HCR") ?? firstIn(serviceLoops, "HCR");
  const actionCode = hcr?.[1] || undefined;
  const reason = firstIn(eventLoops, "MSG")?.[1] || undefined;

  let outcome: ResponseOutcome | undefined;
  if (rejections.length > 0) {
    outcome = "REJECTED";
    if (hcr) errors.push("Response contains both AAA rejections and an HCR decision");
  } else if (actionCode && ACTION_TO_OUTCOME[actionCode]) {
    outcome = ACTION_TO_OUTCOME[actionCode];
  } else {
    errors.push(
      actionCode
        ? `Unsupported HCR01 action code ${actionCode}`
        : "Response has neither an HCR decision nor AAA rejections",
    );
  }

  const certified = outcome === "APPROVED" || outcome === "PARTIALLY_APPROVED";
  const authorizationNumber = certified ? hcr?.[2] || undefined : undefined;
  if (certified && !authorizationNumber) errors.push("Certified response is missing HCR02 (authorization number)");

  const sv1Units = parsed.services[0]?.units;
  const unitsApproved = certified ? sv1Units : undefined;
  if (certified && (unitsApproved === undefined || Number.isNaN(unitsApproved))) {
    errors.push("Certified response is missing the approved unit count (SV104)");
  }

  return {
    purpose,
    outcome,
    actionCode,
    reason,
    authorizationNumber,
    unitsApproved,
    rejections,
    errors,
    parsed,
  };
}
