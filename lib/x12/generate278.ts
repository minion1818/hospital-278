// X12 005010X217 278 (Health Care Services Review: Request) generator.
//
// SIMPLIFIED, FOR DEMONSTRATION ONLY: follows the 005010X217 loop structure for
// a single-service outpatient request, but is not certified against any payer's
// companion guide. All data in this project is synthetic.
//
// Pure function: no database access and no clock reads. Every date/time comes
// from the input (formatted in UTC), so the same input always gives the same output.

export const X12_DELIMITERS = {
  element: "*",
  component: ":",
  segment: "~",
  repetition: "^",
} as const;

const { element: E, component: C, segment: T, repetition: R } = X12_DELIMITERS;

export type Generate278Input = {
  /** Used for ISA13 (9 digits), GS06, and ST02/SE02 (at least 4 digits). 1..999,999,999 */
  controlNumber: number;
  /** Request creation time; drives ISA09/10, GS04/05 and BHT04/05 */
  createdAt: Date;
  /** BHT03 submitter reference, also the base for TRN trace numbers (max 46 chars) */
  requestReference: string;
  /** "T" = test (default), "P" = production. This demo always sends test data. */
  usage?: "T" | "P";
  sender: { id: string };
  payer: { name: string; payerId: string };
  provider: { firstName: string; lastName: string; npi: string };
  patient: {
    firstName: string;
    lastName: string;
    memberId: string;
    dob: Date;
    gender: string;
  };
  service: {
    diagnosisCode: string;
    procedureCode: string;
    units: number;
    serviceDate: Date;
  };
};

/** Replaces delimiter characters (and line breaks) so a value can't break the file. */
export function sanitizeElement(value: string): string {
  return value
    .replace(/[*:~^\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const name = (v: string) => sanitizeElement(v).toUpperCase();

/** ICD-10 codes are sent without the decimal point (M54.16 -> M5416). */
export const icdForX12 = (code: string) => sanitizeElement(code).replace(/\./g, "").toUpperCase();

const pad2 = (n: number) => String(n).padStart(2, "0");
const ccyymmdd = (d: Date) =>
  `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
const yymmdd = (d: Date) => ccyymmdd(d).slice(2);
const hhmm = (d: Date) => `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;

/** Left-justified, space-padded fixed-width ISA field; throws if the value is too long. */
function fixed(value: string, width: number, field: string): string {
  const v = sanitizeElement(value);
  if (v.length > width) throw new Error(`${field} "${v}" exceeds ${width} characters`);
  return v.padEnd(width, " ");
}

function gender(g: string): "M" | "F" | "U" {
  const v = g.trim().toUpperCase();
  return v === "M" || v === "F" ? v : "U";
}

function assertValid(input: Generate278Input) {
  const n = input.controlNumber;
  if (!Number.isInteger(n) || n < 1 || n > 999_999_999) {
    throw new Error(`controlNumber must be an integer from 1 to 999999999, got ${n}`);
  }
  if (!Number.isInteger(input.service.units) || input.service.units < 1) {
    throw new Error(`units must be a positive integer, got ${input.service.units}`);
  }
  for (const [label, d] of [
    ["createdAt", input.createdAt],
    ["patient.dob", input.patient.dob],
    ["service.serviceDate", input.service.serviceDate],
  ] as const) {
    if (Number.isNaN(d.getTime())) throw new Error(`${label} is not a valid date`);
  }
  const ref = sanitizeElement(input.requestReference);
  if (ref.length < 1 || ref.length > 46) {
    throw new Error("requestReference must be 1-46 characters (TRN02 adds a 4-char suffix, max 50)");
  }
}

export function generate278Request(input: Generate278Input): string {
  assertValid(input);

  const { createdAt, sender, payer, provider, patient, service } = input;
  const senderId = sanitizeElement(sender.id);
  const receiverId = sanitizeElement(payer.payerId);
  const isaControl = String(input.controlNumber).padStart(9, "0");
  const gsControl = String(input.controlNumber);
  const stControl = String(input.controlNumber).padStart(4, "0");
  const ref = sanitizeElement(input.requestReference);
  // TRN03: 10-char originating company id; "9" = user-assigned identifier
  const originator = `9${senderId}`;
  const seg = (...elements: (string | number)[]) => elements.join(E) + T;

  const isa = seg(
    "ISA",
    "00", // ISA01 authorization info qualifier
    " ".repeat(10), // ISA02
    "00", // ISA03 security info qualifier
    " ".repeat(10), // ISA04
    "ZZ", // ISA05 mutually defined
    fixed(senderId, 15, "ISA06 sender id"),
    "ZZ", // ISA07
    fixed(receiverId, 15, "ISA08 receiver id"),
    yymmdd(createdAt), // ISA09
    hhmm(createdAt), // ISA10
    R, // ISA11 repetition separator
    "00501", // ISA12 version
    isaControl, // ISA13
    "0", // ISA14 no TA1 acknowledgment requested
    input.usage ?? "T", // ISA15 test indicator
    C, // ISA16 component separator
  );

  // Transaction set body, ST through SE. SE01 is computed from this list.
  const transaction = [
    seg("ST", "278", stControl, "005010X217"),
    // 0007 = info source/receiver/subscriber/event/services structure; 13 = request
    seg("BHT", "0007", "13", ref, ccyymmdd(createdAt), hhmm(createdAt)),

    // 2000A / 2010A: utilization management organization (payer)
    seg("HL", 1, "", 20, 1),
    seg("NM1", "X3", "2", name(payer.name), "", "", "", "", "PI", receiverId),

    // 2000B / 2010B: requesting provider
    seg("HL", 2, 1, 21, 1),
    seg("NM1", "1P", "1", name(provider.lastName), name(provider.firstName), "", "", "", "XX", sanitizeElement(provider.npi)),

    // 2000C / 2010C: subscriber (the patient is the subscriber in this demo)
    seg("HL", 3, 2, 22, 1),
    seg("NM1", "IL", "1", name(patient.lastName), name(patient.firstName), "", "", "", "MI", sanitizeElement(patient.memberId).toUpperCase()),
    seg("DMG", "D8", ccyymmdd(patient.dob), gender(patient.gender)),

    // 2000E: patient event
    seg("HL", 4, 3, "EV", 1),
    seg("TRN", "1", `${ref}-EV`, originator),
    // HS = health services review, I = initial, 3 = service type (consultation),
    // 11:B = place of service 11 (office), B = place-of-service code set
    seg("UM", "HS", "I", "3", `11${C}B`),
    seg("DTP", "472", "D8", ccyymmdd(service.serviceDate)),
    seg("HI", `ABK${C}${icdForX12(service.diagnosisCode)}`), // ABK = ICD-10-CM principal diagnosis

    // 2000F: service
    seg("HL", 5, 4, "SS", 0),
    seg("TRN", "1", `${ref}-SV1`, originator),
    // SV101 procedure, SV102 charge (not sent), SV103 unit basis UN, SV104 unit count
    seg("SV1", `HC${C}${sanitizeElement(service.procedureCode).toUpperCase()}`, "", "UN", service.units),
    seg("DTP", "472", "D8", ccyymmdd(service.serviceDate)),
  ];
  transaction.push(seg("SE", transaction.length + 1, stControl));

  const segments = [
    isa,
    seg("GS", "HI", senderId, receiverId, ccyymmdd(createdAt), hhmm(createdAt), gsControl, "X", "005010X217"),
    ...transaction,
    seg("GE", 1, gsControl),
    seg("IEA", 1, isaControl),
  ];

  return segments.join("\n");
}
