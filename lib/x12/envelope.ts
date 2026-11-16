// Shared X12 building blocks for the 278 request and response generators:
// delimiters, value sanitizing, UTC date formats, and the ISA/GS/ST...SE/GE/IEA
// envelope (fixed-width 106-char ISA, computed SE01, matching control numbers).
// Pure: no clock reads; every timestamp is passed in.

export const X12_DELIMITERS = {
  element: "*",
  component: ":",
  segment: "~",
  repetition: "^",
} as const;

const { element: E, component: C, segment: T, repetition: R } = X12_DELIMITERS;

/** Replaces delimiter characters (and line breaks) so a value can't break the file. */
export function sanitizeElement(value: string): string {
  return value
    .replace(/[*:~^\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sanitized and uppercased, for names. */
export const x12Name = (v: string) => sanitizeElement(v).toUpperCase();

/** Joins elements into one segment, including the terminator. */
export const segment = (...elements: (string | number)[]) => elements.join(E) + T;

/** Joins components into one composite element, e.g. composite("HC", "72148") -> "HC:72148". */
export const composite = (...components: string[]) => components.join(C);

const pad2 = (n: number) => String(n).padStart(2, "0");
export const ccyymmdd = (d: Date) =>
  `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
export const hhmm = (d: Date) => `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;

/** Left-justified, space-padded fixed-width ISA field; throws if the value is too long. */
function fixed(value: string, width: number, field: string): string {
  const v = sanitizeElement(value);
  if (v.length > width) throw new Error(`${field} "${v}" exceeds ${width} characters`);
  return v.padEnd(width, " ");
}

export function assertControlNumber(n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 999_999_999) {
    throw new Error(`controlNumber must be an integer from 1 to 999999999, got ${n}`);
  }
}

export type InterchangeInput = {
  senderId: string;
  receiverId: string;
  /** ISA13 (9 digits), GS06, ST02/SE02 (at least 4 digits) */
  controlNumber: number;
  /** Drives ISA09/10 and GS04/05 (formatted in UTC) */
  at: Date;
  usage?: "T" | "P";
  /**
   * Transaction set segments from ST up to but NOT including SE. SE is appended
   * here, with SE01 computed from the real count. Use `stControl` in ST02.
   */
  buildTransaction: (stControl: string) => string[];
};

/** Wraps a 278 transaction set in ISA/GS ... GE/IEA, one segment per line. */
export function buildInterchange(input: InterchangeInput): string {
  assertControlNumber(input.controlNumber);
  if (Number.isNaN(input.at.getTime())) throw new Error("Interchange date is not valid");

  const senderId = sanitizeElement(input.senderId);
  const receiverId = sanitizeElement(input.receiverId);
  const isaControl = String(input.controlNumber).padStart(9, "0");
  const gsControl = String(input.controlNumber);
  const stControl = String(input.controlNumber).padStart(4, "0");

  const isa = segment(
    "ISA",
    "00", // ISA01 authorization info qualifier
    " ".repeat(10), // ISA02
    "00", // ISA03 security info qualifier
    " ".repeat(10), // ISA04
    "ZZ", // ISA05 mutually defined
    fixed(senderId, 15, "ISA06 sender id"),
    "ZZ", // ISA07
    fixed(receiverId, 15, "ISA08 receiver id"),
    ccyymmdd(input.at).slice(2), // ISA09 YYMMDD
    hhmm(input.at), // ISA10
    R, // ISA11 repetition separator
    "00501", // ISA12 version
    isaControl, // ISA13
    "0", // ISA14 no TA1 acknowledgment requested
    input.usage ?? "T", // ISA15 test indicator
    C, // ISA16 component separator
  );

  const transaction = input.buildTransaction(stControl);
  if (!transaction[0]?.startsWith(`ST${E}`)) throw new Error("Transaction must start with ST");
  transaction.push(segment("SE", transaction.length + 1, stControl)); // SE01 counts ST..SE

  return [
    isa,
    segment("GS", "HI", senderId, receiverId, ccyymmdd(input.at), hhmm(input.at), gsControl, "X", "005010X217"),
    ...transaction,
    segment("GE", 1, gsControl),
    segment("IEA", 1, isaControl),
  ].join("\n");
}
