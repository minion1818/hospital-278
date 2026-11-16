// X12 005010X217 278 (Health Care Services Review: Response) generator for the
// SIMULATED mock payer. Demonstration only, not certified against any payer's
// companion guide. Synthetic data only.
//
// Pure: no database access, no clock reads. Time, control number and the
// authorization number are passed in, so the same input gives the same output.
//
// Structure: the request's HL hierarchy is echoed (payer, requester, subscriber,
// event, service) with the decision added:
//   decided -> HCR in the event loop (A1/A2/A3/A4), reason in MSG,
//              approved units in the service loop SV1 (A1/A2)
//   rejected -> AAA*N**<reason code>*C in the loop where the problem is,
//              plus the explanation in MSG

import type { Decision, RejectionLoop } from "@/lib/payer/rules";
import {
  buildInterchange,
  ccyymmdd,
  composite,
  hhmm,
  sanitizeElement,
  segment as seg,
} from "@/lib/x12/envelope";
import type { Parsed278 } from "@/lib/x12/parse278";

/** HCR01 action codes used by this generator. */
export const HCR_ACTION_CODES = {
  APPROVED: "A1", // certified in total
  PARTIAL: "A2", // certified, partial
  DENIED: "A3", // not certified
  PENDED: "A4", // pended
} as const;

/** MSG01 maximum length in X12 */
const MSG_MAX = 264;

export type Generate278ResponseInput = {
  /** The parsed 278 request being answered */
  request: Parsed278;
  decision: Decision;
  /** HCR02 review identification number; required for APPROVED and PARTIAL */
  authorizationNumber?: string;
  /** Response ISA13/GS06/ST02 */
  controlNumber: number;
  /** Response date/time for ISA, GS and BHT (formatted in UTC) */
  respondedAt: Date;
};

export function generate278Response(input: Generate278ResponseInput): string {
  const { request, decision, respondedAt } = input;
  const reqC = request.delimiters.component;

  const auth = sanitizeElement(input.authorizationNumber ?? "");
  const certified = decision.kind === "APPROVED" || decision.kind === "PARTIAL";
  if (certified && (auth.length < 1 || auth.length > 50)) {
    throw new Error(`An authorization number (1-50 characters) is required for ${decision.kind}`);
  }

  const loop = (levelCode: string) => request.loops.find((l) => l.levelCode === levelCode);
  const find = (levelCode: string, id: string, q?: string) =>
    loop(levelCode)?.segments.find((s) => s[0] === id && (q === undefined || s[1] === q));

  /** Re-emits a request segment with our delimiters, sanitizing every component. */
  const echo = (elements: string[] | undefined, fallback: (string | number)[]) =>
    elements
      ? seg(...elements.map((el) => composite(...el.split(reqC).map(sanitizeElement))))
      : seg(...fallback);

  /** Request TRN echoed as a referenced trace (TRN01 = 2). */
  const echoTrn = (levelCode: string) => {
    const trn = find(levelCode, "TRN");
    return trn ? echo(["TRN", "2", ...trn.slice(2)], []) : undefined;
  };

  const aaaFor = (where: RejectionLoop) =>
    decision.kind === "REJECTED"
      ? decision.errors
          .filter((e) => e.loop === where)
          // AAA01 N = not valid, AAA02 not used, AAA03 reject reason, AAA04 C = correct and resubmit
          .map((e) => seg("AAA", "N", "", e.code, "C"))
      : [];

  const message =
    decision.kind === "REJECTED"
      ? decision.errors.map((e) => e.text).join("; ")
      : decision.kind === "APPROVED"
        ? undefined
        : decision.reason;

  const hcr =
    decision.kind === "REJECTED"
      ? undefined
      : certified
        ? seg("HCR", HCR_ACTION_CODES[decision.kind], auth)
        : seg("HCR", HCR_ACTION_CODES[decision.kind]);

  // Service line: approved units for A1/A2, otherwise the requested line as received
  const requestSv1 = find("SS", "SV1");
  const sv1 =
    certified && requestSv1
      ? echo([...requestSv1.slice(0, 3), "UN", String(decision.unitsApproved)], [])
      : certified
        ? seg("SV1", "", "", "UN", decision.unitsApproved)
        : echo(requestSv1, ["SV1"]);

  const defined = (s: string | undefined): s is string => s !== undefined;

  return buildInterchange({
    // Sender and receiver are reversed from the request
    senderId: request.interchange.receiverId,
    receiverId: request.interchange.senderId,
    controlNumber: input.controlNumber,
    at: respondedAt,
    usage: "T",
    buildTransaction: (stControl) =>
      [
        seg("ST", "278", stControl, "005010X217"),
        // 11 = response; BHT03 echoes the request's reference so the two can be matched
        seg("BHT", "0007", "11", sanitizeElement(request.bht?.reference ?? ""), ccyymmdd(respondedAt), hhmm(respondedAt)),

        // 2000A / 2010A: payer
        seg("HL", 1, "", 20, 1),
        echo(find("20", "NM1", "X3"), ["NM1", "X3", "2"]),
        ...aaaFor("payer"),

        // 2000B / 2010B: requesting provider
        seg("HL", 2, 1, 21, 1),
        echo(find("21", "NM1", "1P"), ["NM1", "1P", "1"]),
        ...aaaFor("requester"),

        // 2000C / 2010C: subscriber
        seg("HL", 3, 2, 22, 1),
        echo(find("22", "NM1", "IL"), ["NM1", "IL", "1"]),
        ...aaaFor("subscriber"),
        find("22", "DMG") && echo(find("22", "DMG"), []),

        // 2000E: patient event, which carries the decision
        seg("HL", 4, 3, "EV", 1),
        echoTrn("EV"),
        ...aaaFor("event"),
        find("EV", "UM") && echo(find("EV", "UM"), []),
        hcr,
        find("EV", "DTP") && echo(find("EV", "DTP"), []),
        find("EV", "HI") && echo(find("EV", "HI"), []),
        message !== undefined ? seg("MSG", sanitizeElement(message).slice(0, MSG_MAX)) : undefined,

        // 2000F: service
        seg("HL", 5, 4, "SS", 0),
        echoTrn("SS"),
        ...aaaFor("service"),
        sv1,
        find("SS", "DTP") && echo(find("SS", "DTP"), []),
      ].filter(defined),
  });
}
