// ============================================================================
// SIMULATED MOCK-PAYER RULES. NOT REAL PAYER POLICY.
// Invented for a synthetic portfolio demo. They do not reflect any insurer's
// coverage criteria, medical policy, or a certified X12 implementation.
// ============================================================================
//
// The mock payer only knows what arrives in the 278 request plus a separate
// attachments object (in real life clinical documentation travels separately,
// e.g. as an X12 275). It never sees the hospital's database.
//
// Pure logic: no database access and no clock reads; "today" is passed in.

import { PAYERS, PROCEDURES, findProcedure } from "@/lib/catalog";
import type { Parsed278 } from "@/lib/x12/parse278";
import { REJECT_REASON_CODES, type RejectReasonCode } from "@/lib/x12/reject-reasons";
// The payer's Decision is passed straight into generate278Response (lib/payer/inbox.ts),
// so tsc checks it stays compatible with the response's ResponseDecision type.
import type { RejectionLoop } from "@/lib/x12/generate278Response";

export { REJECT_REASON_CODES, type RejectReasonCode };

type ProcedureCode = (typeof PROCEDURES)[number]["code"];

export type ProcedureRule = {
  /** ICD-10 category prefixes without the decimal, e.g. "M54" covers M54.16 and M5450 */
  allowedDiagnosisPrefixes: readonly string[];
  requiresClinicalNotes: boolean;
  requiresConservativeTreatment: boolean;
  /** Most units the plan approves per request; more is partially approved */
  maxUnits: number;
};

/** One rule per catalog procedure; tsc fails if a catalog procedure has no rule. */
export const PROCEDURE_RULES = {
  // MRI lumbar spine
  "72148": { allowedDiagnosisPrefixes: ["M54"], requiresClinicalNotes: false, requiresConservativeTreatment: true, maxUnits: 1 },
  // MRI knee
  "73721": { allowedDiagnosisPrefixes: ["M17", "M25"], requiresClinicalNotes: true, requiresConservativeTreatment: false, maxUnits: 1 },
  // MRI brain
  "70553": { allowedDiagnosisPrefixes: ["G43", "R51"], requiresClinicalNotes: true, requiresConservativeTreatment: false, maxUnits: 1 },
  // Upper GI endoscopy
  "43239": { allowedDiagnosisPrefixes: ["K21", "K25", "R10"], requiresClinicalNotes: false, requiresConservativeTreatment: false, maxUnits: 1 },
  // Cardiac catheterization
  "93458": { allowedDiagnosisPrefixes: ["I25", "I20"], requiresClinicalNotes: true, requiresConservativeTreatment: false, maxUnits: 1 },
  // Total knee replacement
  "27447": { allowedDiagnosisPrefixes: ["M17"], requiresClinicalNotes: true, requiresConservativeTreatment: true, maxUnits: 1 },
  // Physical therapy, per visit
  "97110": { allowedDiagnosisPrefixes: ["M54", "M25", "M17"], requiresClinicalNotes: true, requiresConservativeTreatment: false, maxUnits: 12 },
  // Epidural steroid injection
  "64483": { allowedDiagnosisPrefixes: ["M54"], requiresClinicalNotes: false, requiresConservativeTreatment: true, maxUnits: 1 },
} as const satisfies Record<ProcedureCode, ProcedureRule>;

const ruleFor = (code: string): ProcedureRule | undefined =>
  (PROCEDURE_RULES as Record<string, ProcedureRule>)[code];

/** Payer ids this mock payer answers for (all simulated, see lib/catalog.ts). */
const KNOWN_PAYER_IDS: ReadonlySet<string> = new Set(PAYERS.map((p) => p.payerId));

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

/** Fields the payer reads from a parsed 278 request. Anything may be missing. */
export type PayerRequest = {
  payerId?: string;
  memberId?: string;
  providerNpi?: string;
  /** With or without the decimal point: "M54.16" or "M5416" */
  diagnosisCode?: string;
  procedureCode?: string;
  units?: number;
  /** CCYYMMDD */
  serviceDate?: string;
};

/** Documentation sent alongside the 278 (modeled after an X12 275 attachment). */
export type Attachments = {
  clinicalNotesAttached: boolean;
  conservativeTreatmentDocumented: boolean;
};

export type RosterEntry = { active: boolean };
/** Member id -> eligibility, supplied by the caller. */
export type Roster = Readonly<Record<string, RosterEntry>>;

/** Where a rejection belongs in the 278 response, which decides which loop gets the AAA segment. */
export type { RejectionLoop };

export type Rejection = {
  /** X12 AAA03 reject reason code (see REJECT_REASON_CODES) */
  code: RejectReasonCode;
  text: string;
  loop: RejectionLoop;
};

export type Decision =
  | { kind: "REJECTED"; errors: Rejection[] }
  | { kind: "PENDED"; reason: string }
  | { kind: "DENIED"; reason: string }
  | { kind: "PARTIAL"; unitsApproved: number; reason: string }
  | { kind: "APPROVED"; unitsApproved: number };

export type EvaluateInput = {
  request: PayerRequest;
  attachments: Attachments;
  roster: Roster;
  /** CCYYMMDD; the caller decides what "today" is */
  today: string;
};


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "m54.16 " -> "M5416" */
export const normalizeDiagnosis = (code: string) => code.trim().toUpperCase().replace(/\./g, "");

/** ICD-10-CM shape: letter, digit, alphanumeric, then up to 4 more (decimal optional). */
const ICD10 = /^[A-Z][0-9][0-9A-Z][0-9A-Z]{0,4}$/;

/** Real calendar date in CCYYMMDD form. */
export function isCcyymmdd(value: string): boolean {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d)); // pure: built from the input, not the clock
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** NPI: 10 digits with a valid Luhn check digit (computed with the 80840 prefix). */
export function isValidNpi(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = `80840${npi.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(npi[9]);
}

/** "73721 (MRI knee)" */
const describeProcedure = (code: string) => {
  const label = findProcedure(code)?.label;
  return label ? `${code} (${label})` : code;
};

// Reason texts travel in the 278 response MSG segment, where X12 delimiter
// characters (* : ~ ^) are not allowed, so they're avoided in every message.
const displayPrefixes = (prefixes: readonly string[]) => prefixes.join(", ");

const blank = (v: string | undefined): v is undefined => v === undefined || v.trim() === "";

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Decides a request. Categories are checked in a strict order:
 * REJECTED, then PENDED, then DENIED, then PARTIAL, then APPROVED.
 * Within a category, rules run in the fixed order written below and the first
 * failure is reported.
 */
export function evaluateRequest(input: EvaluateInput): Decision {
  const { request: r, attachments, roster, today } = input;

  // 1. REJECTED: data problems, in loop order (payer, subscriber, requester, event, service)
  const rejection = firstRejection(r, roster, today);
  if (rejection) return { kind: "REJECTED", errors: [rejection] };

  // From here every field is present and well formed
  const procedureCode = r.procedureCode!.trim();
  const rule = ruleFor(procedureCode)!;
  const memberId = r.memberId!.trim();
  const diagnosis = normalizeDiagnosis(r.diagnosisCode!);
  const units = r.units!;
  const procedure = describeProcedure(procedureCode);

  // 2. PENDED: documentation the payer needs before deciding
  if (rule.requiresClinicalNotes && !attachments.clinicalNotesAttached) {
    return { kind: "PENDED", reason: `Clinical notes required for ${procedure}` };
  }

  // 3. DENIED
  if (!roster[memberId].active) {
    return { kind: "DENIED", reason: `Coverage inactive for member ${memberId}` };
  }
  if (!rule.allowedDiagnosisPrefixes.some((p) => diagnosis.startsWith(p))) {
    return {
      kind: "DENIED",
      reason: `Medical necessity not established - diagnosis ${r.diagnosisCode!.trim().toUpperCase()} is not supported for ${procedure}; allowed diagnosis groups ${displayPrefixes(rule.allowedDiagnosisPrefixes)}`,
    };
  }
  if (rule.requiresConservativeTreatment && !attachments.conservativeTreatmentDocumented) {
    return {
      kind: "DENIED",
      reason: `Conservative treatment not documented; required for ${procedure}`,
    };
  }

  // 4. PARTIAL
  if (units > rule.maxUnits) {
    return {
      kind: "PARTIAL",
      unitsApproved: rule.maxUnits,
      reason: `Plan limit is ${rule.maxUnits} ${rule.maxUnits === 1 ? "unit" : "units"}; ${units} requested`,
    };
  }

  // 5. APPROVED
  return { kind: "APPROVED", unitsApproved: units };
}

function firstRejection(r: PayerRequest, roster: Roster, today: string): Rejection | undefined {
  const reject = (code: RejectReasonCode, text: string, loop: RejectionLoop): Rejection => ({ code, text, loop });

  // payer (2000A/2010A)
  if (blank(r.payerId) || !KNOWN_PAYER_IDS.has(r.payerId.trim())) {
    return reject("79", `Payer id ${blank(r.payerId) ? "is missing" : `${r.payerId.trim()} is not handled by this payer`}`, "payer");
  }

  // subscriber (2000C/2010C)
  if (blank(r.memberId)) return reject("72", "Member id is missing", "subscriber");
  if (!Object.hasOwn(roster, r.memberId.trim())) {
    return reject("75", `Member id ${r.memberId.trim()} not found`, "subscriber");
  }

  // requester (2000B/2010B)
  if (blank(r.providerNpi)) return reject("43", "Requesting provider NPI is missing", "requester");
  if (!isValidNpi(r.providerNpi.trim())) {
    return reject("43", `Requesting provider NPI ${r.providerNpi.trim()} is not a valid NPI`, "requester");
  }

  // event (2000E): service date, then diagnosis
  if (blank(r.serviceDate)) return reject("57", "Service date is missing", "event");
  if (!isCcyymmdd(r.serviceDate.trim())) {
    return reject("57", `Service date ${r.serviceDate.trim()} is not a valid CCYYMMDD date`, "event");
  }
  if (!isCcyymmdd(today)) throw new Error(`today must be a CCYYMMDD date, got "${today}"`);
  if (r.serviceDate.trim() < today) {
    return reject("56", `Service date ${r.serviceDate.trim()} is before today (${today}); retroactive requests are not accepted`, "event");
  }
  if (blank(r.diagnosisCode)) return reject("AF", "Diagnosis code is missing", "event");
  if (!ICD10.test(normalizeDiagnosis(r.diagnosisCode))) {
    return reject("AF", `Diagnosis code ${r.diagnosisCode.trim()} is not a valid ICD-10 code`, "event");
  }

  // service (2000F): procedure, then units
  if (blank(r.procedureCode)) return reject("AG", "Procedure code is missing", "service");
  if (!ruleFor(r.procedureCode.trim())) {
    return reject("AG", `Procedure code ${r.procedureCode.trim()} is not covered by this payer's review rules`, "service");
  }
  if (r.units === undefined || Number.isNaN(r.units)) return reject("15", "Unit count is missing", "service");
  if (!Number.isInteger(r.units) || r.units < 1) {
    return reject("33", `Unit count ${r.units} must be a whole number of at least 1`, "service");
  }

  return undefined;
}

/**
 * Extracts what the payer reads from a parsed 278 request. Missing or
 * unparseable values come through as undefined/NaN and are rejected by
 * evaluateRequest rather than throwing here.
 */
export function payerRequestFromParsed(parsed: Parsed278): PayerRequest {
  const service = parsed.services[0];
  const principal =
    parsed.event?.diagnoses.find((d) => d.qualifier === "ABK") ?? parsed.event?.diagnoses[0];
  return {
    payerId: parsed.payer?.id || parsed.interchange.receiverId || undefined,
    memberId: parsed.subscriber?.memberId || undefined,
    providerNpi: parsed.requester?.idQualifier === "XX" ? parsed.requester.id || undefined : undefined,
    diagnosisCode: principal?.code || undefined,
    procedureCode: service?.procedureCode || undefined,
    units: service?.units,
    serviceDate: service?.serviceDate || parsed.event?.serviceDate || undefined,
  };
}
